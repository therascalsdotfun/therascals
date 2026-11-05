import { it, expect } from "vitest";
import { projectPoint } from "../apps/web/src/lottery/depth.ts";
it("projects depth with larger near objects and rotates the world without changing its radius", () => {
  expect(projectPoint({ x: 1, y: 0, z: 0 }, 0, 0)).toEqual({
    x: 1,
    y: 0,
    z: 0,
    scale: 1,
  });
  const near = projectPoint({ x: 0.4, y: 0.2, z: 0.5 }, 0, 0),
    far = projectPoint({ x: 0.4, y: 0.2, z: -0.5 }, 0, 0);
  expect(near.scale).toBeGreaterThan(far.scale);
  expect(near.x).toBeGreaterThan(far.x);
  const turn = projectPoint({ x: 1, y: 0, z: 0 }, Math.PI / 2, 0);
  expect(turn.x).toBeCloseTo(0);
  expect(turn.z).toBeCloseTo(-1);
  expect(turn.scale).toBeGreaterThan(0);
});
