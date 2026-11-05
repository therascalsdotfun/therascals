import { it, expect } from "vitest";
import { fireworkParticles } from "../apps/web/src/lottery/fireworks.ts";
it("fireworks start only after reveal and end with a bounded particle count", () => {
  expect(fireworkParticles(-1)).toEqual([]);
  expect(fireworkParticles(2500)).toEqual([]);
  const first = fireworkParticles(300),
    later = fireworkParticles(1000);
  expect(first.length).toBeGreaterThan(0);
  expect(first.length).toBeLessThanOrEqual(96);
  expect(later.length).toBeLessThanOrEqual(96);
  expect(
    first.every(
      (p) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.alpha >= 0 &&
        p.alpha <= 1,
    ),
  ).toBe(true);
  expect(first).not.toEqual(later);
});
