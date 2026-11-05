import { expect, it } from "vitest";
import { jevDailyEstimate } from "../packages/shared/src/jev-cost.ts";
it("counts hourly reviews separately from ten-minute scheduler ticks", () => {
  expect(jevDailyEstimate(1000, 5000)).toMatchObject({
    schedulerTicksPerDay: 144,
    reviewsPerDay: 24000,
    inputTokensPerDay: 120000000,
    modelUsdPerDay: 5.04,
  });
  expect(jevDailyEstimate(1000, 5000, 10).modelUsdPerDay).toBeCloseTo(30.24);
  expect(jevDailyEstimate(100, 5000).modelUsdPerDay).toBeCloseTo(0.504);
  for (const n of [NaN, Infinity, -1, 0, 1.1, 1e7])
    expect(() => jevDailyEstimate(n, 5000)).toThrow();
});
