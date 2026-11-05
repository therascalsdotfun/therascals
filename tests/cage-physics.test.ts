import { expect, it } from "vitest";
import {
  LotteryPhysics,
  CAGE_RADIUS,
  OUTLET,
} from "../apps/web/src/lottery/cage-physics.ts";
const seeds = Array.from({ length: 16 }, (_, i) => ({
  id: "token" + i,
  radius: 0.16 + (i % 3) * 0.035,
}));
it("lets an untouched cage settle without injecting energy or selecting a token", () => {
  const p = new LotteryPhysics(seeds);
  // Even with simulation running, an untouched crank supplies no mixing force.
  for (let i = 0; i < 600; i++) p.advance(1 / 60, null, false);
  expect(p.balls.every((b) => b.body.position.y < -0.7)).toBe(true);
  expect(
    p.balls.reduce((s, b) => s + b.body.velocity.length(), 0) / seeds.length,
  ).toBeLessThan(0.1);
  expect(p.stage).toBe("idle");
  expect(p.selectedId).toBeNull();
});

it("mixes from manual crank energy and returns to rest after the crank stops", () => {
  const p = new LotteryPhysics(seeds);
  p.setRotation(6);
  let lifted = false;
  for (let i = 0; i < 240; i++) {
    p.advance(1 / 60, null, false);
    if (i > 60 && p.balls.some((b) => b.body.position.y > 0)) lifted = true;
  }
  expect(lifted).toBe(true);
  expect(p.stage).toBe("idle");
  expect(p.selectedId).toBeNull();
  p.setRotation(0);
  for (let i = 0; i < 480; i++) p.advance(1 / 60, null, false);
  expect(
    p.balls.reduce((s, b) => s + b.body.velocity.length(), 0) / seeds.length,
  ).toBeLessThan(0.1);
});

it("sends most mixing balls above the bottom cluster before settling disables the jets", () => {
  for (const count of [4, 8, 32]) {
    const p = new LotteryPhysics(
      Array.from({ length: count }, (_, i) => ({
        id: "mix" + i,
        radius: 0.22,
      })),
    );
    p.beginRoll();
    p.setRotation(2.4, true);
    const lifted = new Set<string>();
    for (let i = 0; i < 300; i++) {
      p.advance(1 / 60, null, false);
      if (i > 60)
        for (const b of p.balls) if (b.body.position.y > 0) lifted.add(b.id);
    }
    expect(lifted.size).toBeGreaterThanOrEqual(Math.ceil(count * 0.7));
    p.settling = true;
    p.setRotation(0, true);
    for (let i = 0; i < 240; i++) p.advance(1 / 60, null, false);
    expect(
      p.balls.reduce((s, b) => s + b.body.velocity.length(), 0) / count,
    ).toBeLessThan(0.15);
  }
});
it("resolves wall collisions at every physics substep rather than after a rendered frame", () => {
  const p = new LotteryPhysics([{ id: "fast", radius: 0.2 }]);
  p.world.gravity.setZero();
  const ball = p.balls[0].body;
  ball.position.set(1.27, 0, 0);
  ball.velocity.set(12, 0, 0);
  p.world.step(1 / 120);
  expect(ball.position.length() + 0.2).toBeLessThanOrEqual(CAGE_RADIUS + 1e-6);
  expect(ball.velocity.x).toBeLessThan(0);
});

it("transfers momentum between colliding balls without adding energy to a resting drum", () => {
  const p = new LotteryPhysics([
    { id: "left", radius: 0.2 },
    { id: "right", radius: 0.2 },
  ]);
  p.world.gravity.setZero();
  const [a, b] = p.balls.map((x) => x.body);
  a.position.set(-0.5, 0, 0);
  b.position.set(0.5, 0, 0);
  a.velocity.set(5, 0, 0);
  b.velocity.set(-5, 0, 0);
  const energy = () =>
    a.velocity.lengthSquared() * a.mass + b.velocity.lengthSquared() * b.mass;
  const before = energy();
  for (let i = 0; i < 35; i++) p.advance(1 / 240, null, false);
  expect(a.velocity.x).toBeLessThan(0);
  expect(b.velocity.x).toBeGreaterThan(0);
  expect(energy()).toBeLessThan(before);
  expect(a.position.distanceTo(b.position)).toBeGreaterThan(0.39);
});
it("uses rigid-body collisions, gravity and spherical containment for all live balls", () => {
  const p = new LotteryPhysics(seeds);
  p.beginRoll();
  let travel = 0,
    last = p.balls[0].body.position.clone();
  for (let i = 0; i < 600; i++) {
    p.advance(1 / 60, null, false);
    const pos = p.balls[0].body.position;
    travel += pos.distanceTo(last);
    last.copy(pos);
    for (const b of p.balls) {
      expect(b.body.position.length() + b.radius).toBeLessThanOrEqual(
        CAGE_RADIUS + 0.005,
      );
      expect(
        [b.body.position.x, b.body.position.y, b.body.position.z].every(
          Number.isFinite,
        ),
      ).toBe(true);
    }
  }
  expect(travel).toBeGreaterThan(10);
  expect(p.stage).toBe("mixing");
});
it("cannot finish without the exact selected ball reaching the intake and the physical outlet", () => {
  const p = new LotteryPhysics(seeds);
  p.beginRoll();
  for (let i = 0; i < 240; i++) p.advance(1 / 60, "missing", false);
  expect(p.stage).toBe("mixing");
  let sawCapture = false,
    sawTube = false,
    complete = false;
  for (let i = 0; i < 1200; i++) {
    p.advance(1 / 60, "token15", false);
    if (p.stage === "capturing") sawCapture = true;
    if (p.stage === "extracting") {
      sawTube = true;
      expect(p.captured).toBe(true);
    }
    if (p.stage === "complete") {
      complete = true;
      break;
    }
  }
  expect(sawCapture).toBe(true);
  expect(sawTube).toBe(true);
  expect(complete).toBe(true);
  expect(p.selectedId).toBe("token15");
  expect(p.balls[15].body.position.distanceTo(OUTLET)).toBeLessThan(0.001);
});
it("separates overlapping balls and pauses without simulating elapsed background time", () => {
  const p = new LotteryPhysics(seeds.slice(0, 2));
  p.balls[0].body.position.set(0, 0, 0);
  p.balls[1].body.position.set(0.1, 0, 0);
  for (let i = 0; i < 80; i++) p.advance(1 / 120, null, false);
  expect(
    p.balls[0].body.position.distanceTo(p.balls[1].body.position),
  ).toBeGreaterThan(0.33);
  const before = p.balls[0].body.position.clone();
  p.advance(0, null, false);
  expect(p.balls[0].body.position.distanceTo(before)).toBe(0);
});

it("completes a full 32-ball draw and a reduced-motion draw without substituting the chosen ball", () => {
  for (const reduced of [false, true]) {
    const p = new LotteryPhysics(
      Array.from({ length: 32 }, (_, i) => ({ id: "c" + i, radius: 0.285 })),
    );
    p.beginRoll();
    let frames = 0;
    for (; frames < 720; frames++) {
      p.advance(1 / 60, "c31", reduced);
      if (p.stage === "complete") break;
    }
    expect(p.stage).toBe("complete");
    expect(p.selectedId).toBe("c31");
    expect(p.balls[31].body.position.distanceTo(OUTLET)).toBeLessThan(0.001);
    if (reduced) expect(frames).toBeLessThan(60);
  }
});

it("uses a bottom gate and an entirely downhill path to a catch tray below the cage", async () => {
  const { bottomExitPath } =
    await import("../apps/web/src/lottery/cage-physics.ts");
  expect(OUTLET.y).toBeLessThan(-CAGE_RADIUS);
  for (const radius of [0.13, 0.2, 0.3]) {
    const path = bottomExitPath(radius);
    expect(path[0].y).toBeLessThan(-1);
    expect(path.at(-1)!.distanceTo(OUTLET)).toBe(0);
    for (let i = 1; i < path.length; i++)
      expect(path[i].y).toBeLessThan(path[i - 1].y);
  }
});
it("the chosen ball drops through the bottom and never rises while travelling down the exit", () => {
  const p = new LotteryPhysics(seeds);
  p.beginRoll();
  let lastY = Infinity,
    samples = 0;
  for (let i = 0; i < 1200; i++) {
    p.advance(1 / 60, "token7", false);
    if (["extracting", "complete"].includes(p.stage)) {
      const y = p.balls[7].body.position.y;
      expect(y).toBeLessThan(-1);
      expect(y).toBeLessThanOrEqual(lastY + 1e-8);
      lastY = y;
      samples++;
    }
    if (p.stage === "complete") break;
  }
  expect(samples).toBeGreaterThan(20);
  expect(p.stage).toBe("complete");
});

it("lets gravity lower a captured candidate instead of applying an upward attraction", () => {
  const p = new LotteryPhysics([{ id: "chosen", radius: 0.2 }]);
  p.beginRoll();
  for (let i = 0; i < 300 && p.stage !== "capturing"; i++)
    p.advance(1 / 60, "chosen", false);
  expect(p.stage).toBe("capturing");
  p.balls[0].body.position.set(0, 0.9, 0);
  p.balls[0].body.velocity.setZero();
  p.advance(1 / 120, "chosen", false);
  expect(p.balls[0].body.velocity.y).toBeLessThan(0);
  expect(p.balls[0].body.position.y).toBeLessThan(0.9);
});

it("does not lift a ball resting on the bottom when handing it from gravity to the exit path", () => {
  const p = new LotteryPhysics([{ id: "chosen", radius: 0.2 }]);
  p.beginRoll();
  for (let i = 0; i < 240 && p.stage !== "capturing"; i++)
    p.advance(1 / 60, "chosen", false);
  const ball = p.balls[0];
  ball.body.position.set(0, -CAGE_RADIUS + ball.radius, 0);
  ball.body.velocity.setZero();
  const y = ball.body.position.y;
  p.advance(1 / 120, "chosen", false);
  expect(p.captured).toBe(true);
  expect(ball.body.position.y).toBeLessThanOrEqual(y);
});
