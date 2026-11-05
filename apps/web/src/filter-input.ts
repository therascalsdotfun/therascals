import type { FilterSpec } from "../../../packages/shared/src/market.ts";
export function filterChangeAllowed(phase: string) {
  return phase !== "mixing" && phase !== "extracting";
}
export function filterInput(
  key: keyof FilterSpec,
  value: string,
): number | null {
  if (value === "")
    return [
      "minMarketCap",
      "maxMarketCap",
      "minLiquidity",
      "minVolume5m",
      "maxLiquidity",
      "maxVolume5m",
      "maxBuys5m",
      "maxSells5m",
      "maxHolders",
      "minBuyShare5m",
      "maxBuyShare5m",
    ].includes(key)
      ? null
      : 0;
  return Number(value);
}
export function filterRangeLabel(min: number, max: number) {
  const age = (n: number) => (n >= 60 && n % 60 === 0 ? n / 60 + "h" : n + "m");
  return age(min) + "–" + age(max);
}

/** A normalized slider keeps small thresholds usable across large catalogs. */
export function filterSliderPosition(
  value: number,
  min: number,
  max: number,
  logarithmic = false,
) {
  if (max <= min) return 0;
  const delta = Math.max(0, Math.min(max - min, value - min));
  return Math.round(
    1000 *
      (logarithmic
        ? Math.log1p(delta) / Math.log1p(max - min)
        : delta / (max - min)),
  );
}
export function filterSliderValue(
  position: number,
  min: number,
  max: number,
  logarithmic = false,
) {
  if (max <= min) return min;
  const ratio = Math.max(0, Math.min(1000, position)) / 1000;
  return Math.max(
    min,
    Math.min(
      max,
      Math.round(
        min +
          (logarithmic
            ? Math.expm1(ratio * Math.log1p(max - min))
            : ratio * (max - min)),
      ),
    ),
  );
}
