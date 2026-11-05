import type { DexToken } from "../../../../packages/shared/src/token-media.ts";
import { tokenImageUrl } from "../../../../packages/shared/src/token-media.ts";
import { validMint } from "./gecko.ts";
import { RequestScheduler } from "../routes/eligibility.ts";
import { UserError } from "../client-message.ts";
const number = (x: unknown): number | null => {
  if (
    x === null ||
    x === undefined ||
    x === "" ||
    !(typeof x === "number" || typeof x === "string")
  )
    return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export function parseDexPairs(
  raw: unknown,
  mints: string[],
  now: number,
): DexToken[] {
  if (!Array.isArray(raw)) throw Error("Invalid DEX Screener response");
  const selected = new Map<string, DexToken>();
  const boosts = new Map<string, number>();
  for (const p of raw) {
    if (
      !p ||
      p.chainId !== "solana" ||
      !validMint(p.pairAddress ?? "") ||
      !mints.includes(p.baseToken?.address)
    )
      continue;
    const mint = p.baseToken.address,
      liquidity = number(p.liquidity?.usd),
      prior = selected.get(mint);
    boosts.set(
      mint,
      Math.max(boosts.get(mint) ?? 0, number(p.boosts?.active) ?? 0),
    );
    if (
      prior &&
      ((prior.liquidity ?? -1) > (liquidity ?? -1) ||
        ((prior.liquidity ?? -1) === (liquidity ?? -1) &&
          ((prior.marketCap ?? -1) > (number(p.marketCap) ?? -1) ||
            ((prior.marketCap ?? -1) === (number(p.marketCap) ?? -1) &&
              prior.pool.localeCompare(p.pairAddress) <= 0))))
    )
      continue;
    const at = number(p.pairCreatedAt),
      change =
        typeof p.priceChange?.h24 === "number" &&
        Number.isFinite(p.priceChange.h24)
          ? p.priceChange.h24
          : null;
    selected.set(mint, {
      mint,
      pool: p.pairAddress,
      name: String(p.baseToken.name ?? "Unknown token").slice(0, 100),
      symbol: String(p.baseToken.symbol ?? "?").slice(0, 24),
      icon: tokenImageUrl(p.info?.imageUrl),
      dex: String(p.dexId ?? "Unknown DEX").slice(0, 40),
      source: "DEX Screener",
      scope: "pool",
      fetchedAt: new Date(now).toISOString(),
      stale: false,
      price: number(p.priceUsd),
      marketCap: number(p.marketCap),
      fdv: number(p.fdv),
      liquidity,
      volume5m: number(p.volume?.m5),
      volume24h: number(p.volume?.h24),
      buys5m: number(p.txns?.m5?.buys),
      sells5m: number(p.txns?.m5?.sells),
      change24h: change,
      pairCreatedAt: at && at <= now ? new Date(at).toISOString() : null,
    });
  }
  return [...selected.values()].map((token) => ({
    ...token,
    activeBoosts: boosts.get(token.mint) ?? 0,
  }));
}
export class DexData {
  private scheduler: RequestScheduler;
  private cache = new Map<string, { at: number; data: DexToken | null }>();
  private flights = new Map<string, Promise<DexToken[]>>();
  private backoff = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    interval = 1000,
    private now = () => Date.now(),
  ) {
    this.scheduler = new RequestScheduler(interval);
  }
  peek(mint: string): DexToken | undefined {
    const e = this.cache.get(mint);
    return e?.data
      ? { ...e.data, stale: this.now() - e.at >= 60000 }
      : undefined;
  }
  readCache() {
    return Object.fromEntries(this.cache);
  }
  async tokens(mints: string[]): Promise<DexToken[]> {
    const unique = [...new Set(mints)];
    if (unique.length > 30) throw Error("At most 30 token addresses per batch");
    if (unique.some((m) => !validMint(m))) throw Error("Invalid Solana mint");
    if (!unique.length) return [];
    const needed = unique.filter((m) => {
      const c = this.cache.get(m);
      return !c || this.now() - c.at >= 60000;
    });
    if (!needed.length) return unique.flatMap((m) => this.peek(m) ?? []);
    const key = [...needed].sort().join(",");
    let flight = this.flights.get(key);
    if (!flight) {
      flight = this.scheduler
        .run(async () => {
          if (this.now() < this.backoff)
            throw new UserError("DEX Screener cooling down after rate limit");
          const r = await this.fetcher(
            "https://api.dexscreener.com/tokens/v1/solana/" + key,
            {
              signal: AbortSignal.timeout(12000),
              redirect: "error",
              headers: { accept: "application/json" },
            },
          );
          if (!r.ok) {
            if (r.status === 429)
              this.backoff =
                this.now() +
                Math.max(
                  60000,
                  Number(r.headers.get("retry-after") ?? 0) * 1000,
                );
            throw Error("DEX Screener HTTP " + r.status);
          }
          const rows = parseDexPairs(await r.json(), needed, this.now());
          for (const m of needed)
            this.cache.set(m, {
              at: this.now(),
              data: rows.find((d) => d.mint === m) ?? null,
            });
          while (this.cache.size > 500)
            this.cache.delete(this.cache.keys().next().value!);
          return rows;
        })
        .finally(() => this.flights.delete(key));
      this.flights.set(key, flight);
    }
    try {
      await flight;
    } catch (e) {
      if (!unique.some((m) => this.cache.get(m)?.data)) throw e;
    }
    return unique.flatMap((m) => this.peek(m) ?? []);
  }
}
