import { it, expect } from "vitest";
import {
  filterInput,
  filterRangeLabel,
  filterChangeAllowed,
  filterSliderPosition,
  filterSliderValue,
} from "../apps/web/src/filter-input.ts";
it("blank optional thresholds are unset while required numeric counts remain valid", () => {
  expect(filterInput("minMarketCap", "")).toBeNull();
  expect(filterInput("minHolders", "")).toBe(0);
  expect(filterInput("minAgeMinutes", "")).toBe(0);
  expect(filterInput("minLiquidity", "12345")).toBe(12345);
});
it("keeps wide sliders within the actual filter bounds, including the hard cap", () => {
  for (const [min, max] of [
    [0, 99999999],
    [5000, 5000000],
    [0, 1000000000000],
    [10, 10],
  ]) {
    expect(filterSliderValue(0, min, max, true)).toBe(min);
    expect(filterSliderValue(1000, min, max, true)).toBe(max);
    for (let position = -10; position <= 1010; position += 10) {
      const value = filterSliderValue(position, min, max, true);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
      expect(Number.isInteger(value)).toBe(true);
    }
  }
});
it("keeps low thresholds selectable on a wide scale and preserves order", () => {
  const values = [0, 250, 1000, 5000, 50000, 5000000, 99999999];
  const positions = values.map((value) =>
    filterSliderPosition(value, 0, 99999999, true),
  );
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(new Set(positions).size).toBe(values.length);
  for (const value of values) {
    const back = filterSliderValue(
      filterSliderPosition(value, 0, 99999999, true),
      0,
      99999999,
      true,
    );
    expect(Math.abs(back - value)).toBeLessThanOrEqual(
      Math.max(1, value * 0.011),
    );
  }
});
it("blocks all filter entry points while a ball is mixing or being extracted", () => {
  expect(filterChangeAllowed("mixing")).toBe(false);
  expect(filterChangeAllowed("extracting")).toBe(false);
  expect(filterChangeAllowed("idle")).toBe(true);
  expect(filterChangeAllowed("reveal")).toBe(true);
});
it("displays exact custom age limits instead of rounding 90 minutes to two hours", () => {
  expect(filterRangeLabel(0, 90)).toBe("0m–90m");
  expect(filterRangeLabel(15, 1440)).toBe("15m–24h");
});
