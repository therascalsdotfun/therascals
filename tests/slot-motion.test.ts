import { expect, it } from "vitest";
import { ThreeReelMotion } from "../apps/web/src/rolling/slot-motion.ts";
import { caseTokenAt } from "../apps/web/src/rolling/case-motion.ts";
const ids = [
  ["solana", "base"],
  ["A", "B", "C"],
  ["1", "5", "100"],
];
it("lands the actual chain, token and amount in order, completing only when all stop", () => {
  const m = new ThreeReelMotion(...(ids as [string[], string[], string[]]));
  const stops = [0, 0, 0];
  let last: any;
  for (let now = 0; now <= 7000; now += 20) {
    last = m.sample(now, ["base", "B", "5"], false);
    last.frames.forEach((f: any, i: number) => {
      if (f.stage === "complete" && !stops[i]) stops[i] = now;
    });
    if (last.complete)
      expect(last.frames.every((f: any) => f.stage === "complete")).toBe(true);
  }
  expect(stops[0]).toBeLessThan(stops[1]);
  expect(stops[1]).toBeLessThan(stops[2]);
  expect(last.complete).toBe(true);
  expect(
    last.frames.map((f: any, i: number) => caseTokenAt(ids[i], f.position)),
  ).toEqual(["base", "B", "5"]);
});
it("never completes if any result is unknown or outside its population", () => {
  const m = new ThreeReelMotion(...(ids as [string[], string[], string[]]));
  for (const t of [0, 1000, 10000])
    expect(m.sample(t, ["base", "NOPE", null], false).complete).toBe(false);
});
it("settles exact outcomes without prolonged spinning in reduced motion", () => {
  const m = new ThreeReelMotion(...(ids as [string[], string[], string[]]));
  m.sample(0, ["solana", "C", "100"], true);
  const last = m.sample(500, ["solana", "C", "100"], true);
  expect(last.complete).toBe(true);
  expect(last.frames.map((f, i) => caseTokenAt(ids[i], f.position))).toEqual([
    "solana",
    "C",
    "100",
  ]);
});
