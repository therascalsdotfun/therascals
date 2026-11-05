import { expect, it } from "vitest";
import {
  CrankDrive,
  MAX_CRANK_SPEED,
} from "../apps/web/src/lottery/crank-drive.ts";
import { LotteryPhysics } from "../apps/web/src/lottery/cage-physics.ts";
it("turns continuously across the pointer angle seam and bounds fast input", () => {
  const d = new CrankDrive();
  d.grab(Math.PI - 0.1, 0);
  d.turn(-Math.PI + 0.1, 20);
  d.advance(1 / 60, 0, false);
  expect(d.angle).toBeCloseTo(0.2);
  expect(d.speed).toBeGreaterThan(0);
  d.turn(0, 21);
  d.advance(1 / 60, 0, false);
  expect(Math.abs(d.speed)).toBeLessThanOrEqual(MAX_CRANK_SPEED);
});
it("coasts after release, and brakes to an upright gate before extraction", () => {
  const d = new CrankDrive();
  d.boost(8);
  for (let i = 0; i < 20; i++) d.advance(1 / 60, 0, false);
  const angle = d.angle,
    speed = d.speed;
  d.release();
  d.advance(0.1, 0, false);
  expect(d.angle).toBeGreaterThan(angle);
  expect(d.speed).toBeLessThan(speed);
  for (let i = 0; i < 300; i++) d.advance(1 / 60, 0, true);
  expect(d.aligned).toBe(true);
  expect(Math.abs(d.speed)).toBeLessThan(0.03);
  expect(Math.abs(Math.sin(d.angle))).toBeLessThan(0.005);
});
it("higher crank speed gives the balls more kinetic energy without escaping the cage", () => {
  const meanSpeed = (omega: number) => {
    const p = new LotteryPhysics(
      Array.from({ length: 16 }, (_, i) => ({ id: "t" + i, radius: 0.19 })),
    );
    p.setRotation(omega, true);
    let total = 0;
    for (let i = 0; i < 360; i++) {
      p.advance(1 / 60, null, false);
      if (i > 180)
        total += p.balls.reduce((s, b) => s + b.body.velocity.length(), 0);
      for (const b of p.balls)
        expect(b.body.position.length() + b.radius).toBeLessThanOrEqual(1.505);
    }
    return total;
  };
  expect(meanSpeed(8)).toBeGreaterThan(meanSpeed(1.5) * 1.3);
});
it("waits for drum alignment, then releases the exact selected token through the bottom", () => {
  const p = new LotteryPhysics([
    { id: "a", radius: 0.2 },
    { id: "b", radius: 0.2 },
  ]);
  p.beginRoll();
  p.setRotation(7, false);
  for (let i = 0; i < 400; i++) p.advance(1 / 60, "b", false);
  expect(p.captured).toBe(false);
  expect(p.stage).toBe("capturing");
  p.setRotation(0, true);
  for (let i = 0; i < 600; i++) {
    p.advance(1 / 60, "b", false);
    if (p.stage === "complete") break;
  }
  expect(p.stage).toBe("complete");
  expect(p.selectedId).toBe("b");
  expect(p.balls[1].body.position.y).toBeLessThan(-1.5);
});

it("brakes a fast manual drum before capture and completes dense draws without changing the winner", () => {
  for (const count of [2, 8, 32]) {
    const drive = new CrankDrive(),
      p = new LotteryPhysics(
        Array.from({ length: count }, (_, i) => ({
          id: "m" + i,
          radius: 0.15 + (i % 4) * 0.045,
        })),
      );
    drive.boost(MAX_CRANK_SPEED);
    p.beginRoll();
    let sawAlignment = false;
    for (let i = 0; i < 1000; i++) {
      const braking = ["capturing", "extracting", "complete"].includes(p.stage);
      drive.advance(1 / 60, braking ? 0 : 1.8, braking);
      p.setRotation(drive.speed, drive.aligned);
      p.advance(1 / 60, "m0", false);
      if (p.captured) {
        expect(drive.aligned).toBe(true);
        sawAlignment = true;
      }
      if (p.stage === "complete") break;
    }
    expect(sawAlignment).toBe(true);
    expect(p.stage).toBe("complete");
    expect(p.selectedId).toBe("m0");
  }
});

it("keeps the grip under the pointer on a fast quarter turn while capping energy input", () => {
  const d = new CrankDrive();
  d.grab(0, 0);
  d.turn(Math.PI / 2, 10);
  expect(d.angle).toBeCloseTo(Math.PI / 2);
  expect(Math.abs(d.speed)).toBeLessThanOrEqual(MAX_CRANK_SPEED);
});
