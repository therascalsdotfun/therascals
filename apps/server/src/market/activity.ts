import bs58 from "bs58";
import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
import type {
  ActivitySnapshot,
  TradeActivity,
} from "../../../../packages/shared/src/token-media.ts";
import { tokenImageUrl } from "../../../../packages/shared/src/token-media.ts";
import { GeckoData, validMint } from "./gecko.ts";
import { clientMessage } from "../client-message.ts";
const maxAge = 600000;
function validSignature(x: unknown) {
  try {
    return (
      typeof x === "string" &&
      bs58.decode(x).length === 64 &&
      bs58.encode(bs58.decode(x)) === x
    );
  } catch {
    return false;
  }
}
export function parseTrades(
  raw: unknown,
  token: TokenObservation,
  pool: string,
  now: number,
): TradeActivity[] {
  if (!Array.isArray(raw) || !validMint(token.mint) || !validMint(pool))
    return [];
  return raw.flatMap((row: any) => {
    const a = row?.attributes;
    if (
      !a ||
      a.is_anomalous === true ||
      !validSignature(a.tx_hash) ||
      !validMint(a.tx_from_address ?? "")
    )
      return [];
    const time =
      typeof a.block_timestamp === "string"
        ? Date.parse(a.block_timestamp)
        : NaN;
    const usd =
      typeof a.volume_in_usd === "number" || typeof a.volume_in_usd === "string"
        ? Number(a.volume_in_usd)
        : NaN;
    if (
      !Number.isFinite(time) ||
      time > now + 30000 ||
      now - time > maxAge ||
      !Number.isFinite(usd) ||
      usd <= 1
    )
      return [];
    const side =
      a.to_token_address === token.mint && a.from_token_address !== token.mint
        ? "buy"
        : a.from_token_address === token.mint &&
            a.to_token_address !== token.mint
          ? "sell"
          : null;
    if (!side || typeof row.id !== "string" || row.id.length > 240) return [];
    return [
      {
        id: a.tx_hash + ":" + token.mint + ":" + row.id,
        mint: token.mint,
        symbol: token.symbol.slice(0, 24),
        name: token.name.slice(0, 100),
        icon: tokenImageUrl(token.dex?.icon ?? token.icon),
        wallet: a.tx_from_address,
        signature: a.tx_hash,
        pool,
        side,
        usd,
        at: new Date(time).toISOString(),
        observedAt: new Date(now).toISOString(),
        source: "GeckoTerminal" as const,
      },
    ];
  });
}
export class ActivityFeed {
  private items = new Map<string, TradeActivity>();
  private busy = false;
  private success: number | null = null;
  private error: string | null = null;
  constructor(
    private gecko: GeckoData,
    private now = () => Date.now(),
  ) {}
  async refresh(token: TokenObservation | null) {
    if (this.busy || !token) return;
    this.busy = true;
    try {
      const { pool, rows } = await this.gecko.trades(token.mint);
      for (const t of parseTrades(rows, token, pool, this.now()))
        this.items.set(t.id, t);
      this.success = this.now();
      this.error = null;
    } catch (e) {
      this.error = clientMessage(e, "Activity unavailable.", "activity feed");
    } finally {
      this.busy = false;
      this.trim();
    }
  }
  private trim() {
    const sorted = [...this.items.values()]
      .filter((t) => this.now() - Date.parse(t.at) <= maxAge)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 40);
    this.items = new Map(sorted.map((t) => [t.id, t]));
  }
  snapshot(): ActivitySnapshot {
    this.trim();
    const items = [...this.items.values()],
      stale =
        this.error !== null ||
        (this.success !== null && this.now() - this.success > 120000);
    return {
      items,
      status: stale
        ? items.length
          ? "stale"
          : this.error
            ? "error"
            : "quiet"
        : this.success === null
          ? "starting"
          : items.length
            ? "live"
            : "quiet",
      fetchedAt:
        this.success === null ? null : new Date(this.success).toISOString(),
      error: this.error,
      source: "GeckoTerminal",
    };
  }
}
