import { expect, it } from "vitest";
import { ballMarkProjection } from "../apps/web/src/lottery/ball-surface.ts";
it("centers markings on opposite sides of the sphere without touching its poles or seam", () => {
  expect(ballMarkProjection(0.25, 0.5)?.x).toBeCloseTo(0.5);
  expect(ballMarkProjection(0.25, 0.5)?.y).toBeCloseTo(0.5);
  expect(ballMarkProjection(0.75, 0.5)?.x).toBeCloseTo(0.5);
  for (const [u, v] of [
    [0, 0.5],
    [1, 0.5],
    [0.5, 0.5],
    [0.25, 0],
    [0.25, 1],
  ])
    expect(ballMarkProjection(u, v)).toBeNull();
});
it("keeps the rear marking readable and bends both patches with spherical coordinates", () => {
  const a = ballMarkProjection(0.3, 0.4)!,
    b = ballMarkProjection(0.8, 0.4)!;
  expect(a.x).toBeCloseTo(b.x);
  expect(a.y).toBeCloseTo(b.y);
  expect(a.x).toBeGreaterThan(0.5);
  expect(a.y).toBeLessThan(0.5);
  for (let y = 0; y <= 100; y++)
    for (let x = 0; x <= 100; x++) {
      const p = ballMarkProjection(x / 100, y / 100);
      if (p) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
});
