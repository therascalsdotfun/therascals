import { expect, it } from "vitest";
import { ReleaseClock, SETTLE_MS } from "../apps/web/src/lottery/release-clock.ts";
import {
  LotteryPhysics,
  exitPose,
} from "../apps/web/src/lottery/cage-physics.ts";
/** Runs a roll and settles it, returning the clock's report. */
function settle(count: number, radius: (i: number) => number, spin: number) {
  const p = new LotteryPhysics(
      Array.from({ length: count }, (_, i) => ({ id: `c${i}`, radius: radius(i) })),
    ),
    clock = new ReleaseClock();
  p.beginRoll();
  let report = null;
  for (let i = 0; i < 600 && !report; i++) {
    report = clock.update(1 / 60, false, i === 60);
    p.settling = clock.released;
    p.hold = clock.submitted;
    p.setRotation(clock.released ? 0 : spin, true);
    p.advance(1 / 60, null, false);
  }
  return { p, report };
}
it("waits four visible seconds after release, resets on re-grab and emits only once", () => {
  const clock = new ReleaseClock(),
    p = new LotteryPhysics([
      { id: "a", radius: 0.2 },
      { id: "b", radius: 0.2 },
    ]);
  p.beginRoll();
  let report = null;
  for (let i = 0; i < 239; i++) expect(clock.update(1 / 60, false, true)).toBeNull();
  report = clock.update(1 / 60, false, true);
  if (!report) report = clock.update(1 / 60, false, true);
  expect(report?.elapsedMs).toBeGreaterThanOrEqual(SETTLE_MS);
  expect(report?.elapsedMs).toBeLessThanOrEqual(SETTLE_MS + 50);
  expect(report?.version).toBe(2);
  expect(clock.update(0.05, false, true)).toBeNull();
  clock.reset();
  for (let i = 0; i < 70; i++) clock.update(0.05, false, true);
  clock.update(0.01, true, false);
  expect(clock.elapsedMs).toBe(0);
  expect(clock.released).toBe(false);
  expect(clock.update(0, false, false)).toBeNull();
});
it("reports no winner: the settle payload cannot name a ball", () => {
  const { report } = settle(8, () => 0.2, 5);
  expect(Object.keys(report!).sort()).toEqual(["elapsedMs", "version"]);
});
/**
 * Guiding a ball to the gate measured at 147-335 steps for 32-ball cages, so
 * 600 is roughly twice the worst case. Keeping the budget tight also keeps this
 * file well inside vitest's 5s per-test timeout under worker contention.
 */
const LANDING_BUDGET = 600;
it("guides whichever ball the server committed to through the gate", () => {
  // Any ball can be the committed winner, so every one of them has to land —
  // and land inside a bounded time, because the reveal cannot wait on luck.
  for (const count of [2, 8, 32]) {
    for (const target of [0, Math.floor(count / 2), count - 1]) {
      const { p } = settle(count, (i) => 0.16 + (i % 4) * 0.035, 5),
        id = p.balls[target].id;
      let steps = 0;
      for (; steps < LANDING_BUDGET && p.stage !== "complete"; steps++)
        p.advance(1 / 60, id, false);
      expect(p.stage).toBe("complete");
      expect(p.selectedId).toBe(id);
      expect(steps).toBeLessThan(LANDING_BUDGET);
    }
  }
});
it("freezes the settled snapshot while the reveal is being fetched", () => {
  const { p, report } = settle(8, () => 0.2, 0);
  expect(report).not.toBeNull();
  const snap = p.observations();
  p.advance(0.05, null, false);
  expect(p.observations()).toEqual(snap);
});
it("keeps the ball directly under the opening until below it and makes the route continuously downhill", () => {
  for (const r of [0.13, 0.2, 0.3]) {
    let last = Infinity;
    for (let i = 0; i <= 100; i++) {
      const p = exitPose(r, i / 100);
      expect(p.y).toBeLessThanOrEqual(last);
      last = p.y;
      if (i <= 55) {
        expect(p.x).toBe(0);
        expect(p.z).toBe(0);
      }
    }
  }
});
it("clears the one-ball outlet for varied dense settled populations", () => {
  for (let variation = 0; variation < 4; variation++) {
    const { p } = settle(
      32,
      (i) => 0.14 + ((i + variation) % 5) * 0.035,
      2 + variation,
    );
    const id = p.balls[(variation * 7) % 32].id;
    let steps = 0;
    for (; steps < LANDING_BUDGET && p.stage !== "complete"; steps++)
      p.advance(1 / 60, id, false);
    expect(p.stage).toBe("complete");
    expect(p.selectedId).toBe(id);
    expect(steps).toBeLessThan(LANDING_BUDGET);
  }
});
