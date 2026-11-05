import type { MarketStore } from "./store.ts";

const HOUR = 3_600_000,
  DAY = 24 * HOUR;

/**
 * Records that exist to serve one in-flight flow and are worthless afterwards.
 * Anything naming money, an issued signature or a spent note is history and
 * stays, so this is an allowlist of throwaway prefixes, not a cache policy:
 *
 * - `roll:` is what an anonymous visitor creates, up to 30 per minute per
 *   source, and each row holds a frozen pool. Leaving it is the cheapest way to
 *   fill the state volume.
 * - `preview-` is a throwaway preview prefix from older runtime versions.
 *   Completed previews are not settlement or receipt evidence.
 * - `perps-spin:` is a reel awaiting its reveal; it is dead after two minutes.
 * - `beta-claims:` and `beta-funding:` are daily counters.
 *
 * Deliberately absent: `op:`, `fill:` and `outbox:` are position history, spend
 * evidence and replay protection for signatures already broadcast; `drawdown:`
 * keeps its own one-day activity window and must retain quarantine evidence
 * indefinitely, so age-based deletion would silently un-disqualify a token.
 */
export const ephemeralRecords: { prefix: string; ttlMs: number }[] = [
  { prefix: "price-trend:", ttlMs: 2 * DAY },
  { prefix: "roll:", ttlMs: 2 * HOUR },
  { prefix: "preview-", ttlMs: 2 * HOUR },
  { prefix: "perps-spin:", ttlMs: DAY },
  { prefix: "beta-claims:", ttlMs: 35 * DAY },
  { prefix: "beta-funding:", ttlMs: 35 * DAY },
];

export const SWEEP_INTERVAL_MS = HOUR;

/**
 * Sweeps once at boot, then hourly. Deletion caps how big the database grows;
 * SQLite does not shrink the file without a VACUUM, and blocking a live volume
 * on one is a worse trade than reusing the freed pages.
 */
export function startRecordRetention(
  store: MarketStore,
  report?: (removed: number, remaining: number) => void,
) {
  const sweep = () => {
    const removed = store.sweepRecords(ephemeralRecords);
    if (removed) report?.(removed, store.recordCount());
  };
  sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
