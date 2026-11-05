import type { DexToken } from "./token-media.ts";
import type { MemeType } from "./meme-types.ts";
import type { TokenRisk, TokenIdentity } from "./token-security.ts";
export interface Metric {
  value: number | null;
  source: "jupiter" | "dexscreener";
  scope: "token" | "pool";
  asOf: string | null;
  windowSeconds?: number;
}
export interface TokenObservation {
  drawdown?: DrawdownEvidence;
  chain?: import("./token-selection.ts").DiscoveryChain;
  previewOnly?: boolean;
  id: string;
  mint: string;
  name: string;
  symbol: string;
  decimals: number | null;
  tokenProgram: string;
  icon: string | null;
  mintCreatedAt: string | null;
  firstPoolCreatedAt: string | null;
  firstPoolId: string | null;
  graduatedAt: string | null;
  firstObservedAt: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  marketCap: Metric;
  fdv: Metric;
  liquidity: Metric;
  price: Metric;
  volume5m: Metric;
  buys5m: Metric;
  sells5m: Metric;
  holders: Metric;
  links: { x: string | null; website: string | null; telegram: string | null };
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  suspicious: boolean;
  organicScore: number | null;
  partialWindow5m: boolean;
  launchpad: string | null;
  dex?: DexToken;
  security?: TokenRisk;
  identity?: TokenIdentity;
}
export type DrawdownEvidence = {
  key: string;
  source: string;
  peak: { at: number; price: number };
  observed: { at: number; price: number };
  dropFraction: number;
  quarantinedAt: string;
};
export interface FilterSpec {
  chains?: import("./token-selection.ts").DiscoveryChain[];
  tokenSelection?: import("./token-selection.ts").TokenSelection;
  poolSize?: number;
  memeTypes?: MemeType[];
  ageBasis: "mint" | "first_pool";
  minAgeMinutes: number;
  maxAgeMinutes: number;
  minMarketCap: number | null;
  maxMarketCap: number | null;
  minLiquidity: number | null;
  minVolume5m: number | null;
  minBuys5m: number;
  minSells5m: number;
  minHolders: number;
  maxLiquidity?: number | null;
  maxVolume5m?: number | null;
  maxBuys5m?: number | null;
  maxSells5m?: number | null;
  maxHolders?: number | null;
  minBuyShare5m?: number | null;
  maxBuyShare5m?: number | null;
  hasTelegram?: boolean;
  hasX: boolean;
  hasWebsite: boolean;
}
export interface ProviderHealth {
  state: "starting" | "live" | "error" | "rate_limited";
  lastSuccess: string | null;
  error: string | null;
  observed: number;
  requests: number;
}
export interface RouteQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  router: string;
  routeLabels: string[];
  feeBps: number | null;
  priceImpactPct: string | null;
  observedAt: number;
}
export interface RoutePair {
  mint: string;
  ticketAtomic: string;
  status: "pending" | "eligible" | "unavailable" | "stale" | "error";
  buy: RouteQuote | null;
  sell: RouteQuote | null;
  checkedAt: number;
  expiresAt: number;
  error: string | null;
}
export interface MarketRow {
  token: TokenObservation;
  matches: boolean;
  reasons: string[];
  admissionReasons: string[];
  route: RoutePair | null;
}
export interface MarketResponse {
  viewer?: { identity: import("./wallet-auth.ts").WalletIdentity | null };
  now: string;
  filters: FilterSpec;
  ticketAtomic: string;
  configurationHash: string;
  rows: MarketRow[];
  manualRows?: MarketRow[];
  page: {
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
  };
  matching: number;
  observed: number;
  eligible: number;
  pool: TokenObservation[];
  health: ProviderHealth;
  coverage: {
    startedAt: string;
    oldestObservation: string | null;
    description: string;
    expansion?: { lastSuccess: string | null; error: string | null };
    chainSources?: Partial<
      Record<
        import("./token-selection.ts").DiscoveryChain,
        {
          observed: number;
          loading?: boolean;
          error: string | null;
          previewOnly: boolean;
          matching?: number;
          eligible?: number;
          inDraw?: number;
          blockers?: Record<string, number>;
        }
      >
    >;
  };
  execution: {
    state: "setup" | "ready" | "blocked";
    message: string;
    nearAccount?: string;
    solanaAddress?: string;
    nearBalance?: string;
    solBalance?: number;
    mpcSignatureVerified?: boolean;
    mpcNearTransaction?: string;
    mpcAddress?: string;
    transferFinalized?: boolean;
  };
}
