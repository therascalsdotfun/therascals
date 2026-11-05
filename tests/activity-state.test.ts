import { it, expect } from "vitest";
import { activityCycle, activeTrades } from "../apps/web/src/activity-state.ts";
const t = (at: number, id: string) =>
  ({ id, at: new Date(at).toISOString() }) as any;
it("replaces an expired animation cycle immediately when fresh trades arrive", () => {
  expect(
    activityCycle([t(0, "old")], [t(660000, "new")], 660000).map((t) => t.id),
  ).toEqual(["new"]);
  expect(
    activityCycle([t(650000, "current")], [t(660000, "next")], 660000).map(
      (t) => t.id,
    ),
  ).toEqual(["current"]);
});
it("expires paused history using current wall time even when no new data arrives", () => {
  expect(activeTrades([t(0, "old")], 599999)).toHaveLength(1);
  expect(activeTrades([t(0, "old")], 600001)).toHaveLength(0);
});
