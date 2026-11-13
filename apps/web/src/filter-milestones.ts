import type { FilterSpec } from "../../../packages/shared/src/market.ts";

/** Equal travel between readable milestones, with exact typing between stops. */
export const MARKET_CAP_MILESTONES = [
  0, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 1000000, 5000000,
  10000000, 99999999,
] as const;
export const MAX_AGE_THREE_MONTHS = 129600;
export const MAX_AGE_ANY_STOP = 172800;
export function filterMilestones(key: keyof FilterSpec): readonly number[] {
  if (key === "minBuyShare5m" || key === "maxBuyShare5m")
    return [0, 10, 25, 50, 75, 90, 100];
  if (key === "poolSize" || key === "minPoolSize" || key === "maxPoolSize")
    return [2, 8, 16, 24, 32];
  if (key === "minAgeMinutes")
    return [0, 15, 60, 360, 1440, 10080, 43200, MAX_AGE_THREE_MONTHS];
  if (key === "maxAgeMinutes")
    return [
      0,
      15,
      60,
      360,
      1440,
      10080,
      43200,
      MAX_AGE_THREE_MONTHS,
      MAX_AGE_ANY_STOP,
    ];
  if (key === "minMarketCap" || key === "maxMarketCap")
    return MARKET_CAP_MILESTONES;
  if (
    ["minLiquidity", "maxLiquidity", "minVolume5m", "maxVolume5m"].includes(key)
  )
    return [0, 500, 2000, 5000, 10000, 25000, 50000, 100000, 500000, 1000000, 1e12];
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
  if (key === "minAgeMinutes" || key === "maxAgeMinutes") {
    if (key === "maxAgeMinutes" && value >= MAX_AGE_ANY_STOP) return "Any";
    if (value >= 43200) return `${Math.round(value / 43200)}mo`;
    if (value >= 1440) return `${Math.round(value / 1440)}d`;
    return value >= 60 ? `${value / 60}h` : `${value}m`;
  }
  if (key === "minMarketCap" || key === "maxMarketCap") {
    if (value === 99999999) return "<100M";
    if (value === 10000000) return "10M+";
  }
  if (value >= 1e12) return `${value / 1e12}T`;
  if (value >= 1e6) return `${value / 1e6}M`;
  if (value >= 1000) return `${value / 1000}k`;
  return String(value);
}
