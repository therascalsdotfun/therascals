import type { FilterSpec } from "../../../packages/shared/src/market.ts";

/** Equal travel between readable milestones, with exact typing between stops. */
export const MARKET_CAP_MILESTONES = [
  0, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000,
  10000000, 99999999,
] as const;
export function filterMilestones(key: keyof FilterSpec): readonly number[] {
  if (key === "minBuyShare5m" || key === "maxBuyShare5m")
    return [0, 10, 25, 50, 75, 90, 100];
  if (key === "poolSize") return [2, 8, 16, 24, 32];
  if (key === "minAgeMinutes" || key === "maxAgeMinutes")
    return [0, 15, 60, 240, 720, 1440];
  if (key === "minMarketCap" || key === "maxMarketCap")
    return MARKET_CAP_MILESTONES;
  if (
    ["minLiquidity", "maxLiquidity", "minVolume5m", "maxVolume5m"].includes(key)
  )
    return [0, 1000, 5000, 10000, 25000, 50000, 100000, 500000, 1000000, 1e12];
  return [0, 10, 50, 100, 500, 1000, 5000, 10000, 1e12];
}
export function milestonePosition(value: number, stops: readonly number[]) {
  if (value <= stops[0]) return 0;
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i])
      return 100 * (i - 1 + (value - stops[i - 1]) / (stops[i] - stops[i - 1]));
  }
  return (stops.length - 1) * 100;
}
export function milestoneValue(position: number, stops: readonly number[]) {
  const p = Math.max(0, Math.min((stops.length - 1) * 100, position));
  const i = Math.min(stops.length - 2, Math.floor(p / 100));
  return Math.round(stops[i] + (stops[i + 1] - stops[i]) * (p / 100 - i));
}
export function milestoneLabel(key: keyof FilterSpec, value: number) {
  if (key === "minBuyShare5m" || key === "maxBuyShare5m") return `${value}%`;
  if (key === "minAgeMinutes" || key === "maxAgeMinutes")
    return value >= 60 ? `${value / 60}h` : `${value}m`;
  if (key === "minMarketCap" || key === "maxMarketCap") {
    if (value === 99999999) return "<100M";
    if (value === 10000000) return "10M+";
  }
  if (value >= 1e12) return `${value / 1e12}T`;
  if (value >= 1e6) return `${value / 1e6}M`;
  if (value >= 1000) return `${value / 1000}k`;
  return String(value);
}
