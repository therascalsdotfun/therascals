/** External token art is display-only. Never proxy an arbitrary token URL. */
export function tokenImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value),
      h = u.hostname.toLowerCase();
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      !h.includes(".") ||
      h.includes(":") ||
      h.endsWith(".local") ||
      h.endsWith(".localhost") ||
      h.endsWith(".test") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(h)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
export interface DexToken {
  mint: string;
  pool: string;
  name: string;
  symbol: string;
  icon: string | null;
  dex: string;
  source: "DEX Screener";
  scope: "pool";
  fetchedAt: string;
  stale: boolean;
  price: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidity: number | null;
  volume5m: number | null;
  volume24h: number | null;
  buys5m: number | null;
  sells5m: number | null;
  change24h: number | null;
  pairCreatedAt: string | null;
  activeBoosts?: number;
}
export interface TradeActivity {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  wallet: string;
  signature: string;
  pool: string;
  side: "buy" | "sell";
  usd: number;
  at: string;
  observedAt: string;
  source: "GeckoTerminal";
}
export interface ActivitySnapshot {
  items: TradeActivity[];
  status: "starting" | "live" | "quiet" | "stale" | "error";
  fetchedAt: string | null;
  error: string | null;
  source: "GeckoTerminal";
}
