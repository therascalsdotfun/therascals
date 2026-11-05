import { it, expect } from "vitest";
import {
  marketCapRadius,
  stepBlower,
} from "../apps/web/src/lottery/dynamics.ts";
it("scales market cap monotonically while keeping small-token labels readable", () => {
  const sizes = [10000, 100000, 1000000, 10000000, 99999999].map(
    marketCapRadius,
  );
  expect(sizes[0]).toBeGreaterThanOrEqual(0.105);
  expect(sizes[4]).toBeLessThanOrEqual(0.19);
  sizes.slice(1).forEach((s, i) => expect(s).toBeGreaterThan(sizes[i]));
  expect(marketCapRadius(null)).toBe(sizes[0]);
  expect(marketCapRadius(Infinity)).toBe(sizes[0]);
});
it("sustains vigorous blower movement without escaping the cage at either ball size", () => {
  for (const r of [0.105, 0.19]) {
    let b = { x: -0.1, y: 0.5, z: 0.1, vx: 0, vy: 0, vz: 0, r, seed: 13 };
    let travel = 0;
    for (let i = 0; i < 600; i++) {
      const next = stepBlower(b, i / 60, 1 / 60);
      travel += Math.hypot(next.x - b.x, next.y - b.y, next.z - b.z);
      expect(Math.hypot(next.x, next.y, next.z) + r).toBeLessThanOrEqual(0.981);
      expect(Object.values(next).every(Number.isFinite)).toBe(true);
      b = next;
    }
    expect(travel).toBeGreaterThan(15);
  }
});
