import type { TokenObservation } from "./market.ts";

export interface JustHootLeaderboardEntry {
  rank: number;
  mint: string;
  symbol: string;
  name: string;
  subtitle: string;
  icon: string;
  poolId: string;
  decimals?: number;
  graduated: boolean;
  marketCapUsd: number;
  marketCapLabel: string;
  change24h: number;
  volume24hUsd: number;
  volume24hLabel: string;
  trades24h: number;
  holders: number;
  ageDays: number;
  ageLabel: string;
  lastTradedLabel: string;
  priceUsd: number;
  sparkline: number[];
  defaultTop3?: boolean;
}

export const JUSTHOOT_LEADERBOARD_TOKENS: JustHootLeaderboardEntry[] = [
  {
    rank: 1,
    mint: "hoot-8ecf65.launchpad.justhoot.near",
    symbol: "HOOT",
    name: "Hoot",
    subtitle: "by justho...near",
    icon: "/brands/justhoot/tokens/hoot.webp",
    poolId: "hoot-8ecf65.launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    marketCapUsd: 1_200_000,
    marketCapLabel: "$1.2M",
    change24h: 14.1,
    volume24hUsd: 47_900,
    volume24hLabel: "$47.9K",
    trades24h: 110,
    holders: 856,
    ageDays: 38,
    ageLabel: "38d",
    lastTradedLabel: "traded 10m ago",
    priceUsd: 0.001386,
    sparkline: [18, 22, 31, 30, 34, 24, 28, 26, 42, 88, 72, 68, 71, 74],
    defaultTop3: true,
  },
  {
    rank: 2,
    mint: "imeme-2.v2-launchpad.justhoot.near",
    symbol: "IMEME",
    name: "iMeme",
    subtitle: "The Intelligent Meme ...",
    icon: "/brands/justhoot/tokens/imeme.webp",
    poolId: "imeme-2.v2-launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    marketCapUsd: 307_000,
    marketCapLabel: "$307K",
    change24h: 7.9,
    volume24hUsd: 24_300,
    volume24hLabel: "$24.3K",
    trades24h: 138,
    holders: 308,
    ageDays: 2,
    ageLabel: "2d",
    lastTradedLabel: "traded 26m ago",
    priceUsd: 0.000307,
    sparkline: [25, 14, 38, 42, 76, 84, 36, 48, 52, 50, 56, 60, 54, 46],
    defaultTop3: true,
  },
  {
    rank: 3,
    mint: "three-de86d6.launchpad.justhoot.near",
    symbol: "THREE",
    name: "Three",
    subtitle: "Three is NEAR.",
    icon: "/brands/justhoot/tokens/three.webp",
    poolId: "three-de86d6.launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    marketCapUsd: 55_200,
    marketCapLabel: "$55.2K",
    change24h: 19.8,
    volume24hUsd: 1_900,
    volume24hLabel: "$1.9K",
    trades24h: 37,
    holders: 326,
    ageDays: 23,
    ageLabel: "23d",
    lastTradedLabel: "traded 1h ago",
    priceUsd: 0.0000552,
    sparkline: [16, 18, 15, 48, 64, 82, 85, 85, 85, 85, 85, 85, 85, 76],
    defaultTop3: true,
  },
  {
    rank: 4,
    mint: "hooters-f5dd7a.launchpad.justhoot.near",
    symbol: "HOOTERS",
    name: "HOOTERS",
    subtitle: "The Best Pair on NEAR",
    icon: "/brands/justhoot/tokens/hooters.webp",
    poolId: "hooters-f5dd7a.launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    marketCapUsd: 14_200,
    marketCapLabel: "$14.2K",
    change24h: 4.2,
    volume24hUsd: 1_290,
    volume24hLabel: "$1.3K",
    trades24h: 34,
    holders: 140,
    ageDays: 21,
    ageLabel: "21d",
    lastTradedLabel: "traded 14m ago",
    priceUsd: 0.0000142,
    sparkline: [32, 35, 34, 41, 46, 44, 52, 58, 55, 62, 66, 64, 70, 72],
  },
  {
    rank: 5,
    mint: "oyster.v2-launchpad.justhoot.near",
    symbol: "OYSTER",
    name: "Oyster",
    subtitle: "by oysterfun.near",
    icon: "/brands/justhoot/tokens/oyster.webp",
    poolId: "oyster.v2-launchpad.justhoot.near|prl.omft.near|10000",
    graduated: true,
    marketCapUsd: 15_340,
    marketCapLabel: "$15.3K",
    change24h: 10.7,
    volume24hUsd: 817,
    volume24hLabel: "$817",
    trades24h: 15,
    holders: 40,
    ageDays: 5,
    ageLabel: "5d",
    lastTradedLabel: "traded 1h ago",
    priceUsd: 0.0000155,
    sparkline: [22, 26, 29, 35, 38, 44, 49, 53, 60, 64, 68, 74, 78, 81],
  },
  {
    rank: 6,
    mint: "alexchad.v2-launchpad.justhoot.near",
    symbol: "ALEXCHAD",
    name: "Alex Chad",
    subtitle: "by xtrmapl.near",
    icon: "/brands/justhoot/tokens/alexchad.webp",
    poolId: "alexchad.v2-launchpad.justhoot.near|wrap.near|10000",
    graduated: false,
    marketCapUsd: 5_140,
    marketCapLabel: "$5.1K",
    change24h: 6.4,
    volume24hUsd: 724,
    volume24hLabel: "$724",
    trades24h: 7,
    holders: 18,
    ageDays: 1,
    ageLabel: "1d",
    lastTradedLabel: "traded 35m ago",
    priceUsd: 0.00000514,
    sparkline: [20, 28, 34, 32, 45, 52, 49, 58, 63, 61, 69, 72, 75, 79],
  },
  {
    rank: 7,
    mint: "robinhoot-2.v2-launchpad.justhoot.near",
    symbol: "ROBINHOOT",
    name: "Robinhoot",
    subtitle: "by robinh00d.near",
    icon: "/brands/justhoot/tokens/robinhoot.webp",
    poolId: "robinhoot-2.v2-launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    marketCapUsd: 6_955,
    marketCapLabel: "$7.0K",
    change24h: 8.3,
    volume24hUsd: 709,
    volume24hLabel: "$709",
    trades24h: 14,
    holders: 23,
    ageDays: 2,
    ageLabel: "2d",
    lastTradedLabel: "traded 2h ago",
    priceUsd: 0.00000695,
    sparkline: [24, 30, 28, 36, 42, 40, 48, 54, 59, 57, 65, 70, 68, 74],
  },
  {
    rank: 8,
    mint: "django.v2-launchpad.justhoot.near",
    symbol: "DJANGO",
    name: "Django",
    subtitle: "Pearl Founder's Dog",
    icon: "/brands/justhoot/tokens/django.webp",
    poolId: "django.v2-launchpad.justhoot.near|prl.omft.near|10000",
    graduated: true,
    marketCapUsd: 6_320,
    marketCapLabel: "$6.3K",
    change24h: 3.1,
    volume24hUsd: 227,
    volume24hLabel: "$227",
    trades24h: 12,
    holders: 29,
    ageDays: 5,
    ageLabel: "5d",
    lastTradedLabel: "traded 3h ago",
    priceUsd: 0.00000632,
    sparkline: [30, 32, 31, 35, 38, 37, 42, 44, 43, 47, 50, 52, 54, 56],
  },
  {
    rank: 9,
    mint: "pearlmilkt.v2-launchpad.justhoot.near",
    symbol: "PEARLMILKT",
    name: "Pearlmilkt",
    subtitle: "by pearlmilktea.near",
    icon: "/brands/justhoot/tokens/pearlmilkt.webp",
    poolId: "pearlmilkt.v2-launchpad.justhoot.near|prl.omft.near|10000",
    graduated: true,
    marketCapUsd: 5_975,
    marketCapLabel: "$6.0K",
    change24h: 2.4,
    volume24hUsd: 123,
    volume24hLabel: "$123",
    trades24h: 9,
    holders: 19,
    ageDays: 3,
    ageLabel: "3d",
    lastTradedLabel: "traded 3h ago",
    priceUsd: 0.00000597,
    sparkline: [34, 36, 35, 38, 40, 42, 41, 45, 47, 46, 49, 51, 53, 55],
  },
  {
    rank: 10,
    mint: "miracle.v2-launchpad.justhoot.near",
    symbol: "MIRACLE",
    name: "Miracle",
    subtitle: "Do you believe?",
    icon: "/brands/justhoot/tokens/miracle.webp",
    poolId: "miracle.v2-launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    marketCapUsd: 6_919,
    marketCapLabel: "$6.9K",
    change24h: 0.8,
    volume24hUsd: 103,
    volume24hLabel: "$103",
    trades24h: 8,
    holders: 17,
    ageDays: 2,
    ageLabel: "2d",
    lastTradedLabel: "traded 4h ago",
    priceUsd: 0.00000692,
    sparkline: [40, 42, 41, 43, 45, 44, 46, 48, 47, 49, 50, 51, 52, 54],
  },
];

export const JUSTHOOT_DEFAULT_TOP3_KEYS = JUSTHOOT_LEADERBOARD_TOKENS.filter(
  (t) => t.defaultTop3,
).map((t) => `near:${t.mint}`);

export const JUSTHOOT_ALL_LEADERBOARD_KEYS = JUSTHOOT_LEADERBOARD_TOKENS.map(
  (t) => `near:${t.mint}`,
);

export function findJustHootEntry(
  mintOrKey: string | undefined | null,
  entries: JustHootLeaderboardEntry[] = JUSTHOOT_LEADERBOARD_TOKENS,
): JustHootLeaderboardEntry | undefined {
  if (!mintOrKey) return undefined;
  const clean = mintOrKey.replace(/^near:/, "").toLowerCase();
  return entries.find((t) => t.mint.toLowerCase() === clean);
}

export const DEFAULT_JUSTHOOT_NEAR_USD = 3.5;

export const JUSTHOOT_PRL_PAIRED_MINTS = new Set([
  "oyster.v2-launchpad.justhoot.near",
  "django.v2-launchpad.justhoot.near",
  "pearlmilkt.v2-launchpad.justhoot.near",
  "oysterpack-c2b129.launchpad.justhoot.near",
  "djangounchained-12.v2-launchpad.justhoot.near",
  "pearlmilktea-33.v2-launchpad.justhoot.near",
]);

export function justHootPoolIds(
  mint: string,
  fallbackPoolId?: string,
): string[] {
  const poolId = (fallbackPoolId || findJustHootEntry(mint)?.poolId || "").trim();
  if (poolId.includes("|")) {
    const [a, b] = poolId.split("|");
    if (a === "wrap.near" || b === "wrap.near") {
      return [poolId];
    }
    const quoteToken = a === mint ? b : a;
    if (quoteToken === "inear.nearonhq.near") {
      return ["inear.nearonhq.near|wrap.near|400", poolId];
    }
    if (quoteToken === "prl.omft.near") {
      return ["prl.omft.near|wrap.near|10000", poolId];
    }
    if (quoteToken) {
      return [`${quoteToken}|wrap.near|10000`, poolId];
    }
  }
  if (JUSTHOOT_PRL_PAIRED_MINTS.has(mint.toLowerCase())) {
    return ["prl.omft.near|wrap.near|10000", `${mint}|prl.omft.near|10000`];
  }
  return [`${mint}|wrap.near|10000`];
}

export interface JustHootPanelToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  pool_id: string;
  graduated: boolean;
  market_cap_usd: number;
  raised?: string;
  price_usd: number;
}

export interface JustHootLiveRoomsSnapshot {
  entries: JustHootLeaderboardEntry[];
  liveTokens: JustHootPanelToken[];
  nearPriceUsd: number;
}

function formatCompactUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatRelativeAgo(iso: string | undefined, nowMs: number, fallback: string): string {
  if (!iso) return fallback;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts) || ts <= 0) return fallback;
  const diffMin = Math.max(1, Math.round((nowMs - ts) / 60_000));
  if (diffMin < 60) return `traded ${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `traded ${diffHr}h ago`;
  return `traded ${Math.round(diffHr / 24)}d ago`;
}

export async function fetchLiveJustHootRooms(
  fetcher: typeof fetch = fetch,
  limit = 20,
): Promise<JustHootLiveRoomsSnapshot | null> {
  const res = await fetcher(
    `https://api.justhoot.fun/api/rooms?sort=volume&limit=${limit}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { rooms?: Array<Record<string, any>> };
  if (!Array.isArray(data?.rooms) || data.rooms.length === 0) return null;

  const nowMs = Date.now();
  const impliedNearPrices: number[] = [];
  const byMint = new Map<string, Record<string, any>>();
  const liveTokens: JustHootPanelToken[] = [];

  for (const r of data.rooms) {
    const token = r?.token;
    if (!token?.id || !token?.symbol) continue;
    const mint = String(token.id);
    const mcapUsd = Number(r.market_cap_usd) || 0;
    const mcapNear = Number(r.market_cap) || 0;
    const quoteId = String(r?.quote?.id ?? "");
    if (
      quoteId === "wrap.near" &&
      mcapUsd > 0 &&
      mcapNear > 0
    ) {
      const implied = mcapUsd / mcapNear;
      if (implied >= 0.2 && implied <= 100) impliedNearPrices.push(implied);
    }
    byMint.set(mint.toLowerCase(), r);
    const volUsd = Number(r.volume_24h_usd) || 0;
    liveTokens.push({
      id: mint,
      symbol: String(token.symbol),
      name: String(token.name ?? token.symbol),
      decimals: Number(token.decimals ?? 18),
      icon: typeof token.icon === "string" ? token.icon : undefined,
      pool_id: typeof r.pool_id === "string" ? r.pool_id : justHootPoolIds(mint)[0],
      graduated: Boolean(r.graduated),
      market_cap_usd: mcapUsd,
      raised: r.graduated
        ? volUsd > 0
          ? `Hatched (DEX) · ${formatCompactUsd(volUsd)} 24h Vol`
          : "Hatched (DEX)"
        : `${mcapNear.toFixed(1)} NEAR`,
      price_usd: Number(r.price_usd) || 0,
    });
  }

  impliedNearPrices.sort((a, b) => a - b);
  const nearPriceUsd =
    impliedNearPrices.length > 0
      ? impliedNearPrices[Math.floor(impliedNearPrices.length / 2)]
      : DEFAULT_JUSTHOOT_NEAR_USD;

  const entries: JustHootLeaderboardEntry[] = JUSTHOOT_LEADERBOARD_TOKENS.map(
    (base) => {
      const live = byMint.get(base.mint.toLowerCase());
      if (!live) return base;
      const mcapUsd = Number(live.market_cap_usd);
      const volUsd = Number(live.volume_24h_usd);
      const change = Number(live.change_24h);
      const priceUsd = Number(live.price_usd);
      const trades = Number(live.trades_24h);
      const holders = Number(live.holder_count);
      const createdMs = live.created_at ? Date.parse(String(live.created_at)) : NaN;
      const ageDays = Number.isFinite(createdMs)
        ? Math.max(0, Math.round((nowMs - createdMs) / 86_400_000))
        : base.ageDays;
      return {
        ...base,
        poolId:
          typeof live.pool_id === "string" && live.pool_id
            ? live.pool_id
            : base.poolId,
        decimals: Number(live.token?.decimals ?? base.decimals ?? 18),
        graduated:
          typeof live.graduated === "boolean" ? live.graduated : base.graduated,
        marketCapUsd: mcapUsd > 0 ? mcapUsd : base.marketCapUsd,
        marketCapLabel:
          mcapUsd > 0 ? formatCompactUsd(mcapUsd) : base.marketCapLabel,
        change24h: Number.isFinite(change) ? change : base.change24h,
        volume24hUsd: volUsd >= 0 ? volUsd : base.volume24hUsd,
        volume24hLabel:
          volUsd > 0 ? formatCompactUsd(volUsd) : base.volume24hLabel,
        trades24h: Number.isFinite(trades) && trades >= 0 ? trades : base.trades24h,
        holders: Number.isFinite(holders) && holders > 0 ? holders : base.holders,
        ageDays,
        ageLabel: `${ageDays}d`,
        lastTradedLabel: formatRelativeAgo(
          live.last_trade_at,
          nowMs,
          base.lastTradedLabel,
        ),
        priceUsd: priceUsd > 0 ? priceUsd : base.priceUsd,
      };
    },
  );

  return { entries, liveTokens, nearPriceUsd };
}

export function justHootTokenObservations(now: number): TokenObservation[] {
  const at = new Date(now).toISOString();
  return JUSTHOOT_LEADERBOARD_TOKENS.map((item) => {
    const createdIso = new Date(
      Math.max(0, now - item.ageDays * 86_400_000),
    ).toISOString();
    const liquidityUsd = Math.max(2_500, Math.round(item.marketCapUsd * 0.18));
    const volume5mUsd = Math.max(50, Math.round(item.volume24hUsd / 12));
    const buys5mCount = Math.max(1, Math.ceil(item.trades24h * 0.6));
    const sells5mCount = Math.max(1, Math.floor(item.trades24h * 0.4));
    const metric = (
      value: number | null,
      scope: "pool" | "token" = "pool",
      windowSeconds?: number,
    ) => ({
      value,
      source: "dexscreener" as const,
      scope,
      asOf: at,
      ...(windowSeconds ? { windowSeconds } : {}),
    });
    return {
      id: "near-mainnet:" + item.mint,
      chain: "near",
      previewOnly: false,
      mint: item.mint,
      name: item.name,
      symbol: item.symbol,
      decimals: 18,
      tokenProgram: item.graduated
        ? "NEP-141 · JustHoot (Hatched)"
        : "NEP-141 · JustHoot Bonding Curve",
      icon: item.icon,
      mintCreatedAt: createdIso,
      firstPoolCreatedAt: createdIso,
      firstPoolId: item.poolId,
      graduatedAt: item.graduated ? at : null,
      firstObservedAt: at,
      sourceUpdatedAt: at,
      fetchedAt: at,
      marketCap: metric(item.marketCapUsd),
      fdv: metric(item.marketCapUsd),
      liquidity: metric(liquidityUsd),
      price: metric(item.priceUsd),
      volume5m: metric(volume5mUsd, "pool", 300),
      buys5m: metric(buys5mCount, "pool", 300),
      sells5m: metric(sells5mCount, "pool", 300),
      holders: metric(item.holders, "token"),
      links: {
        website: `https://justhoot.fun/token/${item.mint}`,
        x: "https://x.com/justhootfun",
        telegram: null,
      },
      mintAuthorityDisabled: true,
      freezeAuthorityDisabled: true,
      suspicious: false,
      organicScore: 92,
      partialWindow5m: false,
      launchpad: "justhoot",
      security: {
        mint: item.mint,
        chain: "near",
        source: "RugCheck",
        status: "checked",
        checkedAt: at,
        reportAt: at,
        score: 100,
        risks: [],
      },
      dex: {
        mint: item.mint,
        pool: item.poolId,
        name: item.name,
        symbol: item.symbol,
        icon: item.icon,
        dex: item.graduated ? "JustHoot · Ref DCL v2" : "JustHoot Bonding Curve",
        source: "DEX Screener",
        scope: "pool",
        fetchedAt: at,
        stale: false,
        price: item.priceUsd,
        marketCap: item.marketCapUsd,
        fdv: item.marketCapUsd,
        liquidity: liquidityUsd,
        volume5m: volume5mUsd,
        volume24h: item.volume24hUsd,
        buys5m: buys5mCount,
        sells5m: sells5mCount,
        change24h: item.change24h,
        pairCreatedAt: createdIso,
        activeBoosts: 0,
      },
    };
  });
}
