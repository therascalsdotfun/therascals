import type {
  TokenObservation,
  DrawdownEvidence,
} from "../../../../packages/shared/src/market.ts";
import { tokenKey } from "../../../../packages/shared/src/token-selection.ts";
import { MarketStore } from "./store.ts";

const DAY = 86400000,
  BUCKET = 600000;
type Point = { at: number; price: number };
type History = {
  key: string;
  source: string;
  points: Point[];
  quarantine?: DrawdownEvidence;
};

/** Locally observed USD drawdown, not a fraud verdict or a complete market history. */
export class DrawdownGuard {
  private history = new Map<string, History>();
  constructor(
    private store: MarketStore,
    private now = () => Date.now(),
  ) {
    for (const record of store.records<History>("drawdown:")) {
      if (
        !record.quarantine &&
        !record.points.some((p) => p.at > this.now() - DAY)
      ) {
        if (!store.readOnly) store.deleteRecord("drawdown:" + record.key);
      } else this.history.set(record.key, record);
    }
  }
  evidence(key: string) {
    return this.history.get(key)?.quarantine;
  }
  readEvidence() {
    return Object.fromEntries(
      [...this.history].flatMap(([key, value]) =>
        value.quarantine ? [[key, value.quarantine]] : [],
      ),
    );
  }
  observe(tokens: TokenObservation[]) {
    const now = this.now();
    for (const token of tokens) {
      const key = tokenKey(token),
        previous = this.history.get(key);
      if (previous?.quarantine) continue; // Recovery or restart cannot silently clear a quarantine.
      const price = token.price.value,
        at = Date.parse(token.price.asOf ?? "");
      if (
        price === null ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(at) ||
        at > now ||
        now - at > 120000
      )
        continue;
      const pool =
        token.price.scope === "pool" ? token.dex?.pool : "token-wide";
      if (!pool) continue;
      const source = `${token.price.source}:${token.price.scope}:${pool}:USD`;
      // Do not compare a new provider/pool with an old pool's price.
      const record: History =
        previous?.source === source ? previous : { key, source, points: [] };
      if (record.points.some((p) => p.at > at)) continue; // Ignore out-of-order data.
      const points = record.points.filter((p) => at - p.at < DAY);
      const peak = points.reduce<Point | undefined>(
        (best, p) => (!best || p.price > best.price ? p : best),
        undefined,
      );
      if (peak && at > peak.at && price <= peak.price * 0.1) {
        record.quarantine = {
          key,
          source,
          peak,
          observed: { at, price },
          dropFraction: 1 - price / peak.price,
          quarantinedAt: new Date(now).toISOString(),
        };
      }
      // One peak per ten-minute bucket. Check every fresh ingestion before sampling,
      // so a fall within a bucket can still quarantine the exact token.
      const bucket = Math.floor(at / BUCKET),
        last = points.at(-1);
      if (last && Math.floor(last.at / BUCKET) === bucket) {
        if (price > last.price) points[points.length - 1] = { at, price };
        else if (!record.quarantine) continue;
      } else points.push({ at, price });
      record.points = points.slice(-145);
      this.history.set(key, record);
      this.store.putRecord("drawdown:" + key, record);
    }
    // Histories expire after inactivity, while disqualification evidence persists.
    for (const [key, record] of this.history)
      if (!record.quarantine && (record.points.at(-1)?.at ?? 0) < now - DAY) {
        this.history.delete(key);
        this.store.deleteRecord("drawdown:" + key);
      }
  }
}
