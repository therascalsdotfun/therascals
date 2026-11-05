import type { TradeActivity } from "../../../packages/shared/src/token-media.ts";
export function activeTrades(items: TradeActivity[], now: number) {
  return items.filter((t) => now - Date.parse(t.at) <= 600000);
}
export function activityCycle(
  current: TradeActivity[],
  incoming: TradeActivity[],
  now: number,
) {
  return activeTrades(current, now).length
    ? current
    : activeTrades(incoming, now);
}
