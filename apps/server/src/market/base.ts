import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
import type { TokenRisk } from "../../../../packages/shared/src/token-security.ts";
import { tokenImageUrl } from "../../../../packages/shared/src/token-media.ts";
import { RequestScheduler } from "../routes/eligibility.ts";
import { clientMessage, UserError } from "../client-message.ts";
export const validBaseAddress = (s: unknown): s is string =>
  typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
const num = (v: unknown) =>
  (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : null;
type PreviewChain = "base" | "bsc" | "near";
export function validPreviewAddress(
  chain: PreviewChain,
  value: unknown,
): value is string {
  return chain === "near"
    ? typeof value === "string" &&
        value.length >= 2 &&
        value.length <= 64 &&
        /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)
    : validBaseAddress(value);
}
export function parseBasePairs(
  raw: unknown,
  now: number,
  chain: PreviewChain = "base",
): TokenObservation[] {
  if (!Array.isArray(raw)) throw Error("Invalid preview-chain pool response");
  const chosen = new Map<string, any>();
  const earliest = new Map<string, number>();
  for (const p of raw) {
    if (
      p?.chainId !== chain ||
      !validPreviewAddress(chain, p.baseToken?.address) ||
      typeof p.pairAddress !== "string"
    )
      continue;
    const baseMint = p.baseToken.address.toLowerCase(),
      created = num(p.pairCreatedAt);
    if (created && created <= now)
      earliest.set(
        baseMint,
        Math.min(earliest.get(baseMint) ?? Infinity, created),
      );
    const mint = p.baseToken.address.toLowerCase(),
      old = chosen.get(mint);
    if (
      old &&
      ((num(old.liquidity?.usd) ?? -1) > (num(p.liquidity?.usd) ?? -1) ||
        ((num(old.liquidity?.usd) ?? -1) === (num(p.liquidity?.usd) ?? -1) &&
          (num(old.marketCap) ?? -1) >= (num(p.marketCap) ?? -1)))
    )
      continue;
    chosen.set(mint, p);
  }
  return [...chosen].map(([mint, p]) => {
    const at = new Date(now).toISOString(),
      created = earliest.get(mint) ?? null,
      poolAt =
        created && created <= now ? new Date(created).toISOString() : null;
    const metric = (v: unknown) => ({
      value: num(v),
      source: "dexscreener" as const,
      scope: "pool" as const,
      asOf: at,
    });
    const link = (type: string) => {
      const x = p.info?.websites?.[0]?.url;
      const y = p.info?.socials?.find((s: any) => s.type === type)?.url;
      const value = type === "website" ? x : y;
      try {
        return new URL(value).protocol === "https:" ? value : null;
      } catch {
        return null;
      }
    };
    return {
      id: chain + "-mainnet:" + mint,
      chain,
      previewOnly: chain === "near",
      mint,
      name: String(p.baseToken.name ?? "Unknown").slice(0, 100),
      symbol: String(p.baseToken.symbol ?? "?").slice(0, 24),
      decimals: null,
      tokenProgram: chain === "near" ? "NEP-141 · preview only" : "ERC-20",
      icon: tokenImageUrl(p.info?.imageUrl),
      mintCreatedAt: null,
      firstPoolCreatedAt: poolAt,
      firstPoolId: p.pairAddress,
      graduatedAt: null,
      firstObservedAt: at,
      sourceUpdatedAt: at,
      fetchedAt: at,
      marketCap: metric(p.marketCap),
      fdv: metric(p.fdv),
      liquidity: metric(p.liquidity?.usd),
      price: metric(p.priceUsd),
      volume5m: metric(p.volume?.m5),
      buys5m: metric(p.txns?.m5?.buys),
      sells5m: metric(p.txns?.m5?.sells),
      holders: metric(null),
      links: {
        website: link("website"),
        x: link("twitter"),
        telegram: link("telegram"),
      },
      mintAuthorityDisabled: null,
      freezeAuthorityDisabled: null,
      suspicious: false,
      organicScore: null,
      partialWindow5m: !!created && now - created < 300000,
      launchpad: null,
      dex: {
        mint,
        pool: p.pairAddress,
        name: String(p.baseToken.name ?? "Unknown").slice(0, 100),
        symbol: String(p.baseToken.symbol ?? "?").slice(0, 24),
        icon: tokenImageUrl(p.info?.imageUrl),
        dex: String(p.dexId ?? "Unknown").slice(0, 40),
        source: "DEX Screener" as const,
        scope: "pool" as const,
        fetchedAt: at,
        stale: false,
        price: num(p.priceUsd),
        marketCap: num(p.marketCap),
        fdv: num(p.fdv),
        liquidity: num(p.liquidity?.usd),
        volume5m: num(p.volume?.m5),
        volume24h: num(p.volume?.h24),
        buys5m: num(p.txns?.m5?.buys),
        sells5m: num(p.txns?.m5?.sells),
        change24h:
          typeof p.priceChange?.h24 === "number" ? p.priceChange.h24 : null,
        pairCreatedAt: poolAt,
        activeBoosts: num(p.boosts?.active) ?? 0,
      },
    };
  });
}
export function parseBaseRisk(raw: any, mint: string, now: number): TokenRisk {
  const r = raw?.code === 1 ? raw.result?.[mint.toLowerCase()] : null;
  const base = {
    mint,
    source: "GoPlus" as const,
    checkedAt: new Date(now).toISOString(),
    reportAt: null,
    score: null,
  };
  if (
    !r ||
    !["0", "1"].includes(r.is_honeypot) ||
    !["0", "1"].includes(r.is_open_source) ||
    !["0", "1"].includes(r.cannot_sell_all)
  )
    return {
      ...base,
      status: "unavailable",
      risks: [],
      error:
        "GoPlus has not returned a complete trade-risk report for this contract.",
    };
  const risks: TokenRisk["risks"] = [];
  for (const [key, label] of Object.entries({
    is_honeypot: "Honeypot",
    cannot_sell_all: "Selling restricted",
    is_blacklisted: "Blacklist control",
    is_mintable: "Mintable supply",
    can_take_back_ownership: "Ownership reclaim",
    owner_change_balance: "Owner balance control",
    selfdestruct: "Self-destruct",
    is_proxy: "Upgradeable proxy",
    transfer_pausable: "Transfers can pause",
  }))
    if (r[key] === "1")
      risks.push({
        name: label,
        level: "danger",
        description: `GoPlus reports ${key}.`,
      });
  if (r.is_open_source !== "1")
    risks.push({
      name: "Unverified source",
      level: "warn",
      description: "Contract source is not verified by GoPlus.",
    });
  for (const key of ["buy_tax", "sell_tax"])
    if (num(r[key]) === null || Number(r[key]) > 0.1)
      risks.push({
        name:
          key === "buy_tax" ? "Buy tax unknown/high" : "Sell tax unknown/high",
        level: "warn",
        description: "Tax is unavailable or greater than 10%.",
      });
  return { ...base, status: risks.length ? "flagged" : "checked", risks };
}
export class BaseDiscovery {
  private queue = new RequestScheduler(1200);
  private cache = new Map<string, TokenObservation>();
  private last = 0;
  private busy = false;
  private cooldown = new Map<string, number>();
  error: string | null = null;
  get loading() {
    return this.busy;
  }
  constructor(
    private fetcher: typeof fetch = fetch,
    private clock = () => Date.now(),
    readonly chain: PreviewChain = "base",
  ) {}
  private parse(raw: unknown) {
    return parseBasePairs(raw, this.clock(), this.chain);
  }
  private async scan(mint: string) {
    if (this.chain === "near")
      return {
        mint,
        source: "Not configured" as const,
        chain: "near" as const,
        status: "unavailable" as const,
        checkedAt: new Date(this.clock()).toISOString(),
        reportAt: null,
        score: null,
        risks: [],
        error:
          "NEAR risk screening is not connected. This token is observable but excluded from draws.",
      };
    return {
      ...parseBaseRisk(
        await this.get(
          "https://api.gopluslabs.io/api/v1/token_security/" +
            (this.chain === "bsc" ? "56" : "8453") +
            "?contract_addresses=" +
            mint,
        ),
        mint,
        this.clock(),
      ),
      chain: this.chain,
    };
  }
  private async get(url: string) {
    return this.queue.run(async () => {
      const origin = new URL(url).origin;
      if (this.clock() < (this.cooldown.get(origin) ?? 0))
        throw new UserError(
          "Preview-chain data provider cooling down. Try again shortly.",
        );
      const r = await this.fetcher(url, {
        signal: AbortSignal.timeout(12000),
        redirect: "error",
        headers: { accept: "application/json" },
      });
      if (!r.ok) {
        if (r.status === 429) this.cooldown.set(origin, this.clock() + 60000);
        throw Error("Preview-chain data provider HTTP " + r.status);
      }
      const reader = r.body?.getReader();
      if (!reader) throw Error("Empty preview-chain data response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new UserError("Preview-chain data response too large");
        }
        chunks.push(value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        body.set(c, offset);
        offset += c.length;
      }
      return JSON.parse(new TextDecoder().decode(body));
    });
  }
  restore(tokens: TokenObservation[]) {
    for (const t of tokens.slice(-100))
      if (
        t.chain === this.chain &&
        validPreviewAddress(this.chain, t.mint) &&
        t.dex &&
        t.id === this.chain + "-mainnet:" + t.mint.toLowerCase()
      )
        this.cache.set(t.mint.toLowerCase(), t);
  }
  tokens() {
    return [...this.cache.values()].map((t) => ({
      ...t,
      dex: t.dex
        ? {
            ...t.dex,
            stale: this.clock() - Date.parse(t.dex.fetchedAt) >= 120000,
          }
        : undefined,
    }));
  }
  async import(mint: string) {
    if (!validPreviewAddress(this.chain, mint))
      throw new UserError("Invalid token address");
    mint = mint.toLowerCase();
    const raw = await this.get(
      "https://api.dexscreener.com/token-pairs/v1/" +
        this.chain +
        "/" +
        encodeURIComponent(mint),
    );
    const t = this.parse(raw).find((t) => t.mint === mint);
    if (!t)
      throw new UserError(
        "Token not found on the selected chain on DEX Screener",
      );
    try {
      t.security = await this.scan(mint);
    } catch {
      t.security = {
        mint,
        source: this.chain === "near" ? "Not configured" : "GoPlus",
        chain: this.chain,
        status: "unavailable",
        checkedAt: new Date(this.clock()).toISOString(),
        reportAt: null,
        score: null,
        risks: [],
        error:
          "Security provider unavailable. This token stays outside the draw.",
      };
    }
    this.cache.delete(mint);
    this.cache.set(mint, t);
    while (this.cache.size > 100)
      this.cache.delete(this.cache.keys().next().value!);
    return t;
  }
  async collect() {
    if (this.busy || this.clock() - this.last < 90000) return;
    this.busy = true;
    this.last = this.clock();
    try {
      const [profiles, pools, olderPools, trending] = await Promise.allSettled([
        this.get("https://api.dexscreener.com/token-profiles/latest/v1"),
        this.get(
          "https://api.geckoterminal.com/api/v2/networks/" +
            this.chain +
            "/new_pools?page=1",
        ),
        this.get(
          "https://api.geckoterminal.com/api/v2/networks/" +
            this.chain +
            "/new_pools?page=2",
        ),
        this.get(
          "https://api.geckoterminal.com/api/v2/networks/" +
            this.chain +
            "/trending_pools",
        ),
      ]);
      // New-pool/profile feeds rotate quickly. Keep refreshing already
      // screened candidates, otherwise a valid coin disappears from draws
      // merely because it is no longer in a provider's "latest" response.
      const watched = [...this.cache.values()]
        .filter(
          (t) =>
            t.security?.status === "checked" &&
            !t.security.risks.length &&
            (t.marketCap.value ?? Infinity) < 100000000 &&
            (t.liquidity.value ?? 0) > 0 &&
            Number.isFinite(Date.parse(t.firstPoolCreatedAt ?? "")) &&
            this.clock() - Date.parse(t.firstPoolCreatedAt!) >= 0 &&
            this.clock() - Date.parse(t.firstPoolCreatedAt!) < 86400000,
        )
        .sort(
          (a, b) =>
            Date.parse(a.sourceUpdatedAt ?? "") -
            Date.parse(b.sourceUpdatedAt ?? ""),
        )
        .slice(0, 10)
        .map((t) => t.mint);
      if (
        !watched.length &&
        [profiles, pools, olderPools, trending].every(
          (r) => r.status === "rejected",
        )
      )
        throw new UserError(
          "Preview-chain discovery providers are unavailable. Existing data may expire.",
        );
      const ids = new Set<string>(watched);
      if (profiles.status === "fulfilled" && Array.isArray(profiles.value))
        for (const p of profiles.value)
          if (
            p.chainId === this.chain &&
            validPreviewAddress(this.chain, p.tokenAddress)
          )
            ids.add(p.tokenAddress.toLowerCase());
      const indexedPools = [pools, olderPools, trending].flatMap((response) =>
        response.status === "fulfilled" && Array.isArray(response.value?.data)
          ? response.value.data
          : [],
      );
      indexedPools.sort(
        (a, b) =>
          Number(
            b.attributes?.volume_usd?.m5 ?? b.attributes?.volume_usd?.h24 ?? 0,
          ) -
          Number(
            a.attributes?.volume_usd?.m5 ?? a.attributes?.volume_usd?.h24 ?? 0,
          ),
      );
      for (const p of indexedPools) {
        const created = Date.parse(p.attributes?.pool_created_at ?? "");
        if (!Number.isFinite(created) || this.clock() - created > 86400000)
          continue;
        const id = p.relationships?.base_token?.data?.id?.replace(
          new RegExp("^" + this.chain + "_"),
          "",
        );
        if (validPreviewAddress(this.chain, id)) ids.add(id.toLowerCase());
      }
      const addresses = [...ids].slice(0, 30);
      if (addresses.length) {
        const raw = await this.get(
          "https://api.dexscreener.com/tokens/v1/" +
            this.chain +
            "/" +
            addresses.map(encodeURIComponent).join(","),
        );
        const candidates = this.parse(raw);
        for (const token of candidates) {
          token.security =
            this.chain === "near"
              ? await this.scan(token.mint)
              : (this.cache.get(token.mint)?.security ?? {
                  mint: token.mint,
                  chain: this.chain,
                  source: "GoPlus",
                  status: "unavailable",
                  checkedAt: new Date(this.clock()).toISOString(),
                  reportAt: null,
                  score: null,
                  risks: [],
                  error:
                    "Awaiting the first risk report. This token stays outside draws.",
                });
          this.cache.set(token.mint, token);
        }
        const scan = candidates
          .filter(
            (t) =>
              (t.marketCap.value ?? Infinity) < 100000000 &&
              (t.liquidity.value ?? 0) > 0 &&
              t.firstPoolCreatedAt &&
              this.clock() - Date.parse(t.firstPoolCreatedAt) < 86400000,
          )
          .sort(
            (a, b) =>
              // Refresh clean reports before their five-minute TTL lapses. A
              // large backlog of incomplete reports must not starve a usable
              // candidate, while fresh clean reports keep normal age ordering.
              this.scanPriority(a) - this.scanPriority(b) ||
              (Date.parse(a.security?.checkedAt ?? "") || 0) -
                (Date.parse(b.security?.checkedAt ?? "") || 0) ||
              (b.volume5m.value ?? 0) - (a.volume5m.value ?? 0),
          )
          .slice(0, 15);
        // The public GoPlus endpoint may return only the first address in a
        // comma-separated request. Scan exact contracts separately so the
        // remaining tokens are not incorrectly treated as unreported.
        for (const t of scan) {
          try {
            t.security = await this.scan(t.mint);
            this.cache.set(t.mint, t);
          } catch {
            // Preserve the previous report and its timestamp; failed refreshes
            // must not make missing or expired evidence look current.
          }
        }
        while (this.cache.size > 100)
          this.cache.delete(this.cache.keys().next().value!);
      }

      this.error = [profiles, pools, olderPools, trending].some(
        (r) => r.status === "rejected",
      )
        ? "Some discovery providers are unavailable; coverage may be partial."
        : null;
    } catch (e) {
      this.error = clientMessage(
        e,
        "Preview-chain discovery unavailable.",
        "base discovery",
      );
    } finally {
      this.busy = false;
    }
  }
  private scanPriority(token: TokenObservation) {
    const risk = token.security;
    const age = this.clock() - Date.parse(risk?.checkedAt ?? "");
    return risk?.status === "checked" && !risk.risks.length && age >= 180000
      ? 0
      : 1;
  }
}
