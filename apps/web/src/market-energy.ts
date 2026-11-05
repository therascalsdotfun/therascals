import type { MarketRow } from "../../../packages/shared/src/market.ts";
export function activityChanges(
  before: MarketRow[],
  after: MarketRow[],
): string[] {
  const prior = new Map(before.map((r) => [r.token.mint, r.token]));
  return after
    .filter((r) => {
      const p = prior.get(r.token.mint);
      return (
        p &&
        ((p.buys5m.value !== null &&
          r.token.buys5m.value !== null &&
          r.token.buys5m.value > p.buys5m.value) ||
          (p.sells5m.value !== null &&
            r.token.sells5m.value !== null &&
            r.token.sells5m.value > p.sells5m.value))
      );
    })
    .map((r) => r.token.mint);
}
export function rankActivity(rows: MarketRow[], recent: string[]): MarketRow[] {
  const order = new Map(recent.map((mint, i) => [mint, i]));
  return [...rows].sort(
    (a, b) =>
      (order.get(a.token.mint) ?? 1e9) - (order.get(b.token.mint) ?? 1e9),
  );
}
export function simulatedPop(
  rows: MarketRow[],
  random: () => number = Math.random,
) {
  return rows.length
    ? rows[
        Math.min(
          rows.length - 1,
          Math.max(0, Math.floor(random() * rows.length)),
        )
      ].token.mint
    : null;
}
