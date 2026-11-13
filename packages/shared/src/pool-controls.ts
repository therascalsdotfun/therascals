import type { FilterSpec } from "./market.ts";
export const MAX_DRAW_COINS = 32;
export function minDesiredPoolSize(filters: FilterSpec) {
  return Math.max(
    2,
    Math.min(MAX_DRAW_COINS, Math.trunc(filters.minPoolSize ?? 2)),
  );
}
export function desiredPoolSize(filters: FilterSpec) {
  return Math.max(
    minDesiredPoolSize(filters),
    Math.min(
      MAX_DRAW_COINS,
      Math.trunc(filters.maxPoolSize ?? filters.poolSize ?? 8),
    ),
  );
}
export function adjustPool(filters: FilterSpec, direction: 1 | -1): FilterSpec {
  const size = desiredPoolSize(filters),
    next = Math.max(2, Math.min(MAX_DRAW_COINS, size + direction));
  if (size === next) return { ...filters, poolSize: next };
  const factor = direction === 1 ? 0.7 : 1 / 0.7;
  const adjust = (n: number | null, ceiling: number) =>
    n === null ? null : Math.max(0, Math.min(ceiling, Math.round(n * factor)));
  return {
    ...filters,
    poolSize: next,
    minMarketCap: adjust(
      filters.minMarketCap,
      filters.maxMarketCap ?? 99999999,
    ),
    minLiquidity: adjust(filters.minLiquidity, 1e12),
    minVolume5m: adjust(filters.minVolume5m, 1e12),
    minAgeMinutes:
      direction === 1
        ? Math.max(0, Math.floor(filters.minAgeMinutes * 0.7))
        : filters.minAgeMinutes,
  };
}
