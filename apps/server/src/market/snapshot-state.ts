import type {
  TokenObservation,
  RoutePair,
  ProviderHealth,
  DrawdownEvidence,
} from "../../../../packages/shared/src/market.ts";
import type { DexData } from "./dexscreener.ts";
import type { RiskData } from "./security.ts";
export type SnapshotOptions = {
  offset?: number;
  limit?: number;
  matchingOnly?: boolean;
};
export type SnapshotReadState = {
  dex: ReturnType<DexData["readCache"]>;
  risk: ReturnType<RiskData["readCache"]>;
  drawdowns: Record<string, DrawdownEvidence>;
  routes: [string, RoutePair][];
  chains: Record<
    "base" | "bsc" | "near",
    { tokens: TokenObservation[]; loading: boolean; error: string | null }
  >;
  health: ProviderHealth;
  collecting: boolean;
  startedAt: string;
  expansion: { lastSuccess: string | null; error: string | null };
};
