import { expect, it } from "vitest";
import {
  MARKET_CAP_MILESTONES,
  filterMilestones,
  milestoneLabel,
  milestonePosition,
  milestoneValue,
} from "../apps/web/src/filter-milestones.ts";
it("maps each named market-cap stop exactly, including the exclusive hard ceiling", () => {
  for (const [i, value] of MARKET_CAP_MILESTONES.entries()) {
    expect(milestonePosition(value, MARKET_CAP_MILESTONES)).toBe(i * 100);
    expect(milestoneValue(i * 100, MARKET_CAP_MILESTONES)).toBe(value);
  }
  expect(
    MARKET_CAP_MILESTONES.map((n) => milestoneLabel("minMarketCap", n)),
  ).toEqual([
    "0",
    "2k",
    "5k",
    "10k",
    "25k",
    "50k",
    "100k",
    "250k",
    "1M",
    "5M",
    "10M+",
    "<100M",
  ]);
});
it("interpolates custom values in order without escaping the selected domain", () => {
  for (const key of [
    "poolSize",
    "minAgeMinutes",
    "maxAgeMinutes",
    "maxMarketCap",
    "minLiquidity",
    "minHolders",
  ] as const) {
    const stops = filterMilestones(key);
    let previous = stops[0];
    for (let p = 0; p <= (stops.length - 1) * 100; p++) {
      const n = milestoneValue(p, stops);
      expect(n).toBeGreaterThanOrEqual(previous);
      expect(n).toBeLessThanOrEqual(stops.at(-1)!);
      expect(Number.isInteger(n)).toBe(true);
      previous = n;
    }
    for (const value of [
      stops[0],
      stops.at(-1)!,
      Math.floor((stops[0] + stops[1]) / 2),
    ])
      expect(milestoneValue(milestonePosition(value, stops), stops)).toBe(
        value,
      );
    expect(milestoneValue(-10, stops)).toBe(stops[0]);
    expect(milestoneValue(9999, stops)).toBe(stops.at(-1));
  }
  expect(milestoneValue(350, MARKET_CAP_MILESTONES)).toBe(17500);
  expect(
    filterMilestones("maxAgeMinutes").map((n) =>
      milestoneLabel("maxAgeMinutes", n),
    ),
  ).toEqual(["0m", "15m", "1h", "6h", "1d", "7d", "1mo", "3mo", "Any"]);
});
