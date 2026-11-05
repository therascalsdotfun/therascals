import { selectionReasons } from "../../../../packages/shared/src/token-selection.ts";
import bs58 from "bs58";
import { discoveryPreset } from "../../../../packages/shared/src/discovery-presets.ts";
import { inferMemeTypes } from "../../../../packages/shared/src/meme-types.ts";
import type {
  FilterSpec,
  Metric,
  TokenObservation,
} from "../../../../packages/shared/src/market.ts";
export const DEFAULT_FILTERS: FilterSpec = discoveryPreset("strict");
export const BROAD_FILTERS: FilterSpec = discoveryPreset("broad");
const numeric = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
const timestamp = (x: unknown): string | null =>
  typeof x === "string" && Number.isFinite(Date.parse(x))
    ? new Date(x).toISOString()
    : null;
export function safeUrl(x: unknown): string | null {
  if (typeof x !== "string") return null;
  try {
    const u = new URL(x);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
export function normalizeJupiter(
  raw: unknown,
  now: number,
): TokenObservation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  try {
    if (typeof r.id !== "string" || bs58.decode(r.id).length !== 32)
      return null;
  } catch {
    return null;
  }
  if (!Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 18)
    return null;
  const asOf = timestamp(r.updatedAt),
    metric = (value: unknown, windowSeconds?: number): Metric => ({
      value: numeric(value),
      source: "jupiter",
      scope: "token",
      asOf,
      ...(windowSeconds ? { windowSeconds } : {}),
    });
  const buy = numeric(r.stats5m?.buyVolume),
    sell = numeric(r.stats5m?.sellVolume),
    poolAt = timestamp(r.firstPool?.createdAt);
  return {
    id: "solana-mainnet:" + r.id,
    mint: r.id,
    name: String(r.name ?? "Unknown token").slice(0, 100),
    symbol: String(r.symbol ?? "?").slice(0, 24),
    decimals: r.decimals,
    tokenProgram: String(r.tokenProgram ?? ""),
    icon: safeUrl(r.icon),
    mintCreatedAt: timestamp(r.createdAt),
    firstPoolCreatedAt: poolAt,
    firstPoolId: typeof r.firstPool?.id === "string" ? r.firstPool.id : null,
    graduatedAt: timestamp(r.graduatedAt),
    firstObservedAt: new Date(now).toISOString(),
    sourceUpdatedAt: asOf,
    fetchedAt: new Date(now).toISOString(),
    marketCap: metric(r.mcap),
    fdv: metric(r.fdv),
    liquidity: metric(r.liquidity),
    price: metric(r.usdPrice),
    volume5m: metric(buy !== null && sell !== null ? buy + sell : null, 300),
    buys5m: metric(r.stats5m?.numBuys, 300),
    sells5m: metric(r.stats5m?.numSells, 300),
    holders: metric(r.holderCount),
    links: {
      x: safeUrl(r.twitter),
      website: safeUrl(r.website),
      telegram: safeUrl(r.telegram),
    },
    mintAuthorityDisabled:
      typeof r.audit?.mintAuthorityDisabled === "boolean"
        ? r.audit.mintAuthorityDisabled
        : null,
    freezeAuthorityDisabled:
      typeof r.audit?.freezeAuthorityDisabled === "boolean"
        ? r.audit.freezeAuthorityDisabled
        : null,
    suspicious:
      r.audit != null &&
      Object.hasOwn(r.audit, "isSus") &&
      r.audit.isSus !== false,
    organicScore: numeric(r.organicScore),
    partialWindow5m: poolAt !== null && now - Date.parse(poolAt) < 300000,
    launchpad: typeof r.launchpad === "string" ? r.launchpad : null,
  };
}
export function evaluateFilters(
  t: TokenObservation,
  f: FilterSpec,
  now: number,
): { matches: boolean; reasons: string[] } {
  const reasons: string[] = [
      ...cageUniverseReasons(t, now),
      ...selectionReasons(t, f),
    ],
    ageAt = f.ageBasis === "mint" ? t.mintCreatedAt : t.firstPoolCreatedAt;
  if (
    f.memeTypes?.length &&
    !inferMemeTypes(t).some((c) => f.memeTypes!.includes(c))
  )
    reasons.push("meme_type_not_matched");
  if (!ageAt) reasons.push("unknown_age");
  else {
    const age = (now - Date.parse(ageAt)) / 60000;
    if (age < 0) reasons.push("future_timestamp");
    else if (age < f.minAgeMinutes) reasons.push("age_too_young");
    else if (age > f.maxAgeMinutes) reasons.push("age_too_old");
  }
  const min = (m: Metric, b: number | null, missing: string, low: string) => {
    if (b === null || b === 0) return;
    if (m.value === null) reasons.push(missing);
    else if (m.value < b) reasons.push(low);
  };
  min(t.marketCap, f.minMarketCap, "unknown_market_cap", "market_cap_too_low");
  if (f.maxMarketCap !== null) {
    if (t.marketCap.value === null) {
      if (!reasons.includes("unknown_market_cap"))
        reasons.push("unknown_market_cap");
    } else if (t.marketCap.value > f.maxMarketCap)
      reasons.push("market_cap_too_high");
  }
  min(t.liquidity, f.minLiquidity, "unknown_liquidity", "liquidity_too_low");
  min(t.volume5m, f.minVolume5m, "unknown_volume_5m", "volume_too_low");
  min(t.buys5m, f.minBuys5m, "unknown_buys", "too_few_buys");
  min(t.sells5m, f.minSells5m, "unknown_sells", "too_few_sells");
  min(t.holders, f.minHolders, "unknown_holders", "too_few_holders");
  const maximum = (
    m: Metric,
    limit: number | null | undefined,
    missing: string,
    high: string,
  ) => {
    if (limit == null) return;
    if (m.value === null) {
      if (!reasons.includes(missing)) reasons.push(missing);
    } else if (m.value > limit) reasons.push(high);
  };
  maximum(
    t.liquidity,
    f.maxLiquidity,
    "unknown_liquidity",
    "liquidity_too_high",
  );
  maximum(t.volume5m, f.maxVolume5m, "unknown_volume_5m", "volume_too_high");
  maximum(t.buys5m, f.maxBuys5m, "unknown_buys", "too_many_buys");
  maximum(t.sells5m, f.maxSells5m, "unknown_sells", "too_many_sells");
  maximum(t.holders, f.maxHolders, "unknown_holders", "too_many_holders");
  if (f.minBuyShare5m != null || f.maxBuyShare5m != null) {
    const buys = t.buys5m.value,
      sells = t.sells5m.value;
    if (t.partialWindow5m) reasons.push("incomplete_activity_window");
    else if (buys === null || sells === null || buys + sells <= 0)
      reasons.push("unknown_buy_share_5m");
    else {
      const share = (100 * buys) / (buys + sells);
      if (f.minBuyShare5m != null && share < f.minBuyShare5m)
        reasons.push("buy_share_too_low");
      if (f.maxBuyShare5m != null && share > f.maxBuyShare5m)
        reasons.push("buy_share_too_high");
    }
  }
  if (f.hasTelegram && !t.links.telegram) reasons.push("no_telegram");
  if (f.hasX && !t.links.x) reasons.push("no_x");
  if (f.hasWebsite && !t.links.website) reasons.push("no_website");
  return { matches: reasons.length === 0, reasons };
}
export function admissionReasons(t: TokenObservation, now: number): string[] {
  const r: string[] = cageUniverseReasons(t, now);
  if (!t.sourceUpdatedAt) r.push("unknown_freshness");
  else {
    const d = now - Date.parse(t.sourceUpdatedAt);
    if (d > (t.chain && t.chain !== "solana" ? 120000 : 60000))
      r.push("stale_metadata");
    if (d < 0) r.push("future_timestamp");
  }
  if (t.chain === "near") r.push("near_screening_not_configured");
  if (t.chain && t.chain !== "solana") return r; // Preview chains never use Solana authority claims.
  if (t.mintAuthorityDisabled !== true)
    r.push(
      t.mintAuthorityDisabled === null
        ? "unknown_mint_authority"
        : "mint_authority_active",
    );
  if (t.freezeAuthorityDisabled !== true)
    r.push(
      t.freezeAuthorityDisabled === null
        ? "unknown_freeze_authority"
        : "freeze_authority_active",
    );
  if (t.suspicious) r.push("provider_flagged");
  return r;
}
function cageUniverseReasons(t: TokenObservation, now: number): string[] {
  const r: string[] = [];
  const cap = t.marketCap.value;
  if (cap === null || !Number.isFinite(cap) || cap <= 0)
    r.push("unknown_market_cap");
  else if (cap >= 100000000) r.push("outside_small_cap_cage");
  const firstPool = Date.parse(t.firstPoolCreatedAt ?? "");
  if (
    !Number.isFinite(firstPool) ||
    now < firstPool ||
    now - firstPool > 86400000
  )
    r.push("outside_fresh_cage_window");
  return r;
}
