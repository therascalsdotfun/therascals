import { expect, it } from "vitest";
import type { FilterSpec } from "../packages/shared/src/market.ts";
import {
  adjustPool,
  desiredPoolSize,
  minDesiredPoolSize,
} from "../packages/shared/src/pool-controls.ts";
import { validFilterRanges } from "../packages/shared/src/filter-schema.ts";
import { discoveryPreset } from "../packages/shared/src/discovery-presets.ts";
it("increments/decrements on every press and preserves narrative and chosen maximum cap", () => {
  let f: FilterSpec = { ...discoveryPreset("strict", ["tech"]), poolSize: 4 };
  const caps = [];
  for (let i = 0; i < 3; i++) {
    f = adjustPool(f, 1);
    caps.push(desiredPoolSize(f));
  }
  expect(caps).toEqual([5, 6, 7]);
  expect(f.memeTypes).toEqual(["tech"]);
  expect(f.maxMarketCap).toBe(5000000);
  expect(f.minMarketCap).toBeLessThan(50000);
  f = adjustPool(f, -1);
  expect(f.poolSize).toBe(6);
});
it("does not re-enable filters explicitly disabled by the user and stops at the signed pool bounds", () => {
  const f = {
    ...discoveryPreset("strict"),
    minMarketCap: null,
    minVolume5m: null,
    hasX: true,
    minHolders: 100,
    poolSize: 2,
  };
  expect(adjustPool(f, -1).poolSize).toBe(2);
  expect(adjustPool(f, 1).minMarketCap).toBeNull();
  expect(adjustPool(f, 1).hasX).toBe(true);
  expect(adjustPool(f, 1).minHolders).toBe(100);
});
it("supports minPoolSize and maxPoolSize bounds in cage configuration", () => {
  const f: FilterSpec = {
    ...discoveryPreset("strict"),
    minPoolSize: 4,
    maxPoolSize: 16,
  };
  expect(minDesiredPoolSize(f)).toBe(4);
  expect(desiredPoolSize(f)).toBe(16);
  expect(validFilterRanges(f)).toBe(true);
  expect(
    validFilterRanges({ ...f, minPoolSize: 20, maxPoolSize: 8 }),
  ).toBe(false);
});
