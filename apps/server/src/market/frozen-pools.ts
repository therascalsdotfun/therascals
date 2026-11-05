import type { MarketResponse } from "../../../../packages/shared/src/market.ts";
import { tokenKey } from "../../../../packages/shared/src/token-selection.ts";
type Snapshot = Pick<
  MarketResponse,
  "configurationHash" | "filters" | "ticketAtomic" | "pool" | "now"
>;
/** Short-lived presentation membership, never a replacement for pre-buy risk/route checks. */
export class FrozenPools {
  private entries: Snapshot[] = [];
  constructor(
    private now = () => Date.now(),
    private ttl = 120000,
    private capacity = 256,
  ) {}
  remember(value: MarketResponse) {
    this.entries = this.entries.filter(
      (e) => Date.parse(e.now) >= this.now() - this.ttl,
    );
    if (value.pool.length < 2) return;
    const keys = value.pool.map(tokenKey).sort().join("|");
    this.entries = this.entries.filter(
      (e) =>
        e.configurationHash !== value.configurationHash ||
        e.pool.map(tokenKey).sort().join("|") !== keys,
    );
    this.entries.push(
      structuredClone({
        configurationHash: value.configurationHash,
        filters: value.filters,
        ticketAtomic: value.ticketAtomic,
        pool: value.pool,
        now: value.now,
      }),
    );
    this.entries = this.entries.slice(-this.capacity);
  }
  resolve(current: MarketResponse, keys: string[]): MarketResponse {
    if (
      keys.length < 2 ||
      keys.length > 32 ||
      new Set(keys).size !== keys.length
    )
      throw Error("Invalid frozen population");
    const found = [...this.entries]
      .reverse()
      .find(
        (e) =>
          e.configurationHash === current.configurationHash &&
          Date.parse(e.now) >= this.now() - this.ttl &&
          keys.every((k) => e.pool.some((t) => tokenKey(t) === k)),
      );
    if (!found)
      throw Error(
        "The frozen pool expired. Start a new roll; no buy was sent.",
      );
    return {
      ...current,
      now: found.now,
      pool: keys.map((k) =>
        structuredClone(found.pool.find((t) => tokenKey(t) === k)!),
      ),
    };
  }
}
