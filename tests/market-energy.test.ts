import { expect, it } from "vitest";
import {
  activityChanges,
  rankActivity,
  simulatedPop,
} from "../apps/web/src/market-energy.ts";
const r = (mint: string, buy: number, sell: number) =>
  ({
    token: { mint, buys5m: { value: buy }, sells5m: { value: sell } },
  }) as any;
it("only rising transaction counts trigger activity; first load and rolling-window falls do not", () => {
  expect(activityChanges([], [r("a", 4, 2)])).toEqual([]);
  expect(activityChanges([r("a", 4, 2)], [r("a", 5, 2)])).toEqual(["a"]);
  expect(activityChanges([r("a", 4, 2)], [r("a", 3, 1)])).toEqual([]);
});
it("lifts active mints without duplicates or changing the source rows", () => {
  const rows = [r("a", 1, 1), r("b", 1, 1), r("c", 1, 1)];
  const ranked = rankActivity(rows, ["c"]);
  expect(ranked.map((r) => r.token.mint)).toEqual(["c", "a", "b"]);
  expect(rows.map((r) => r.token.mint)).toEqual(["a", "b", "c"]);
});
it("simulated events choose a real visible mint and never alter market numbers", () => {
  const rows = [r("a", 1, 1), r("b", 2, 2)],
    before = JSON.stringify(rows);
  expect(simulatedPop(rows, () => 0.9)).toBe("b");
  expect(JSON.stringify(rows)).toBe(before);
  expect(simulatedPop([], () => 0)).toBeNull();
});
