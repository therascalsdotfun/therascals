import { expect, it } from "vitest";
import {
  demoCandles,
  testReferenceEntry,
} from "../apps/web/src/trade-chart-model.ts";
const operation = {
  phase: "finalized_success",
  buy: true,
  session: "11",
  draw: { id: "12" },
  source: {
    mint: "SOURCE",
    price: { value: 0.0002, asOf: "2026-10-27T09:00:00Z" },
  },
  solanaSignature: "sig",
};
const fill = {
  success: true,
  buy: true,
  signature: "sig",
  session: "11",
  drawId: "12",
  source: { mint: "SOURCE" },
  input: "5000000",
};
it("only marks a confirmed matching fill, at the source-reference price with an explicit label", () => {
  const entry = testReferenceEntry("SOURCE", operation, [fill]);
  expect(entry).toMatchObject({
    kind: "test-reference",
    price: 0.0002,
    amount: 5,
    signature: "sig",
  });
  expect(entry?.label).toContain("SOURCE REF");
});
it.each([
  "awaiting_confirmation",
  "authorizing",
  "submitted",
  "settling",
  "selection_failed",
  "unknown",
])("never shows an entry before a successful fill: %s", (phase) => {
  expect(
    testReferenceEntry("SOURCE", { ...operation, phase }, [fill]),
  ).toBeNull();
});
it("never borrows a prior fill, another wallet session, or an exit", () => {
  for (const changed of [
    { signature: "old" },
    { session: "other" },
    { drawId: "other" },
    { source: { mint: "other" } },
    { success: false },
  ])
    expect(
      testReferenceEntry("SOURCE", operation, [{ ...fill, ...changed }]),
    ).toBeNull();
  expect(
    testReferenceEntry("SOURCE", { ...operation, buy: false, mode: "exit" }, [
      fill,
    ]),
  ).toBeNull();
  expect(testReferenceEntry("OTHER", operation, [fill])).toBeNull();
  expect(testReferenceEntry("SOURCE", operation, [])).toBeNull();
});
it("generates bounded deterministic demo candles, separately from market data", () => {
  const a = demoCandles("SOURCE", 0.0002, 1800000000, "1m");
  expect(a).toEqual(demoCandles("SOURCE", 0.0002, 1800000000, "1m"));
  expect(a).toHaveLength(60);
  expect(a.at(-1)?.close).toBeCloseTo(0.0002, 10);
  expect(
    a.every(
      (c) =>
        c.low > 0 &&
        c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close),
    ),
  ).toBe(true);
  expect(a[1].time - a[0].time).toBe(60);
});
