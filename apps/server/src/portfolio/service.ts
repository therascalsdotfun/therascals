import { readFileSync } from "node:fs";
import { UserError } from "../client-message.ts";
import { RequestScheduler } from "../routes/eligibility.ts";
import { validMint } from "../market/gecko.ts";
import { tokenImageUrl } from "../../../../packages/shared/src/token-media.ts";
import type { MarketService } from "../market/service.ts";
import type {
  WalletAsset,
  WalletPortfolio,
} from "../../../web/src/wallets/providers.ts";
const SOL = "So11111111111111111111111111111111111111112";
type Transport = (url: string, method: string, params: unknown) => Promise<any>;
const scheduler = new RequestScheduler(1000);
let cooldown = 0;
async function publicRpc(url: string, method: string, params: unknown) {
  return scheduler.run(async () => {
    if (Date.now() < cooldown)
      throw new UserError(
        "Public portfolio RPC cooling down. Try again shortly.",
      );
    const r = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      if (r.status === 429) cooldown = Date.now() + 30000;
      throw Error(
        `Public portfolio RPC HTTP ${r.status}. A dedicated free RPC may be needed.`,
      );
    }
    const d = await r.json();
    if (d.error)
      throw Error(
        String(d.error.message ?? "Portfolio RPC failed").slice(0, 240),
      );
    return d.result;
  });
}
export class PortfolioService {
  private cache = new Map<string, WalletPortfolio>();
  private flights = new Map<string, Promise<WalletPortfolio>>();
  constructor(
    private markets: MarketService,
    private rpc: Transport = publicRpc,
  ) {}
  async read(
    kind: "near" | "solana" | "solana-devnet",
    address: string,
  ): Promise<WalletPortfolio> {
    if (kind !== "near" && !validMint(address))
      throw new UserError("Invalid Solana address");
    if (
      kind === "near" &&
      (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(address) ||
        address.length < 2 ||
        address.length > 64 ||
        address.endsWith(".testnet"))
    )
      throw new UserError("Use a valid NEAR mainnet account");
    const key = kind + ":" + address,
      prior = this.cache.get(key);
    if (prior && Date.now() - Date.parse(prior.asOf) < 30000) return prior;
    if (this.flights.has(key)) return this.flights.get(key)!;
    const p = (
      kind === "near"
        ? this.near(address)
        : this.solana(address, kind === "solana-devnet")
    )
      .then((r) => {
        this.cache.set(key, r);
        if (this.cache.size > 100)
          this.cache.delete(this.cache.keys().next().value!);
        return r;
      })
      .finally(() => this.flights.delete(key));
    this.flights.set(key, p);
    return p;
  }
  private async near(address: string): Promise<WalletPortfolio> {
    const r = await this.rpc("https://free.rpc.fastnear.com", "query", {
      request_type: "view_account",
      account_id: address,
      finality: "final",
    });
    if (!/^\d+$/.test(r?.amount ?? ""))
      throw Error("Invalid NEAR balance response");
    return {
      address,
      network: "NEAR mainnet",
      assets: [{ mint: "native", symbol: "NEAR", raw: r.amount, decimals: 24 }],
      asOf: new Date().toISOString(),
      coverage:
        "NEAR native account balance only; fungible tokens are not indexed. Storage reserve may reduce spendable balance.",
      warnings:
        BigInt(r.locked ?? "0") > 0n
          ? ["Additional NEAR is locked/staked and excluded from this balance."]
          : [],
    };
  }
  private async solana(
    address: string,
    devnet = false,
  ): Promise<WalletPortfolio> {
    const url = devnet
        ? "https://api.devnet.solana.com"
        : "https://api.mainnet-beta.solana.com",
      native = await this.rpc(url, "getBalance", [
        address,
        { commitment: "finalized" },
      ]);
    if (!Number.isSafeInteger(native?.value) || native.value < 0)
      throw Error("Invalid SOL balance response");
    const warnings: string[] = [],
      assets: WalletAsset[] = [
        {
          mint: "native",
          symbol: "SOL",
          raw: String(native.value),
          decimals: 9,
        },
      ],
      mints = new Map<string, WalletAsset>();
    for (const programId of [
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    ]) {
      try {
        const r = await this.rpc(url, "getTokenAccountsByOwner", [
          address,
          { programId },
          { encoding: "jsonParsed", commitment: "finalized" },
        ]);
        if (!Array.isArray(r?.value)) throw Error("Invalid token accounts");
        for (const a of r.value) {
          const info = a.account?.data?.parsed?.info,
            b = info?.tokenAmount;
          if (
            !validMint(info?.mint ?? "") ||
            !/^\d+$/.test(b?.amount ?? "") ||
            !Number.isInteger(b.decimals) ||
            b.decimals < 0 ||
            b.decimals > 36 ||
            BigInt(b.amount) === 0n
          )
            continue;
          const old = mints.get(info.mint);
          if (old && old.decimals !== b.decimals) {
            warnings.push("Conflicting decimals for " + info.mint);
            continue;
          }
          mints.set(info.mint, {
            mint: info.mint,
            symbol: info.mint.slice(0, 6) + "…",
            raw: String(BigInt(old?.raw ?? "0") + BigInt(b.amount)),
            decimals: b.decimals,
          });
        }
      } catch {
        warnings.push(
          programId.startsWith("Tokenz")
            ? "Token-2022 holdings unavailable on this RPC."
            : "Classic SPL holdings unavailable on this RPC.",
        );
      }
    }
    assets.push(...[...mints.values()].slice(0, 200));
    if (mints.size > 200)
      warnings.push("Only the first 200 token mints are shown.");
    if (devnet) {
      try {
        const manifest = JSON.parse(
          readFileSync("docs/evidence/devnet-market-manifest.json", "utf8"),
        );
        const labels = new Map<string, string>([
          [manifest.usdcMint, "TEST-USDC"],
          ...manifest.markets.map((m: any): [string, string] => [
            m.mintToken,
            m.symbol,
          ]),
        ]);
        for (const a of assets)
          if (labels.has(a.mint)) {
            a.symbol = labels.get(a.mint)!;
            a.name =
              a.symbol === "TEST-USDC"
                ? "Jackpot test dollar"
                : "Jackpot " + a.symbol;
          }
        const known = [...labels.keys()];
        const priority = (mint: string) => {
          const i = known.indexOf(mint);
          return i >= 0 ? i : mint === "native" ? 4 : 5;
        };
        assets.sort((a, b) => priority(a.mint) - priority(b.mint));
      } catch {
        warnings.push(
          "Test-token names unavailable; balances are still from Devnet.",
        );
      }
      return {
        address,
        network: "Solana Devnet",
        assets,
        asOf: new Date().toISOString(),
        coverage:
          "Actual Solana Devnet faucet assets. These test tokens have no monetary value; no mainnet price or USD total is shown.",
        warnings,
      };
    }
    try {
      for (let i = 0; i < assets.length; i += 100) {
        const batch = assets.slice(i, i + 100),
          raw = await this.markets.lookup(
            batch.map((a) => (a.mint === "native" ? SOL : a.mint)),
          ),
          meta = new Map<string, any>(
            (Array.isArray(raw) ? raw : []).map((r: any) => [r.id, r]),
          );
        for (const a of batch) {
          const r = meta.get(a.mint === "native" ? SOL : a.mint);
          if (!r) continue;
          a.symbol = String(r.symbol ?? a.symbol).slice(0, 24);
          a.name = String(r.name ?? a.symbol).slice(0, 100);
          a.icon = tokenImageUrl(r.icon);
          const p = r.usdPrice,
            v = (Number(a.raw) / 10 ** a.decimals) * p;
          if (
            typeof p === "number" &&
            Number.isFinite(p) &&
            p > 0 &&
            Number.isFinite(v)
          ) {
            a.priceUsd = p;
            a.valueUsd = v;
          }
        }
      }
    } catch {
      warnings.push(
        "Some token names/prices are unavailable; raw holdings are still real.",
      );
    }
    return {
      address,
      network: "Solana mainnet",
      assets,
      asOf: new Date().toISOString(),
      coverage:
        "Native SOL and nonzero classic SPL + Token-2022 balances, up to 200 mints. Prices are best-effort Jupiter snapshots, not guaranteed exit values.",
      warnings,
    };
  }
}
