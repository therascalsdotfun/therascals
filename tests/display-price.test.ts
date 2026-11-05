import { it, expect } from "vitest";
import { displayPrice } from "../apps/web/src/display-price.ts";
it("attributes a missing Dex price fallback to Jupiter and retains actual zero prices", () => {
  expect(
    displayPrice({
      price: { value: 2, asOf: "jup-time" },
      dex: { price: null, fetchedAt: "dex-time", stale: false },
    } as any),
  ).toMatchObject({ value: 2, source: "Jupiter", at: "jup-time" });
  expect(
    displayPrice({
      price: { value: 2, asOf: "jup-time" },
      dex: { price: 0, fetchedAt: "dex-time", stale: true },
    } as any),
  ).toMatchObject({
    value: 0,
    source: "DEX Screener",
    at: "dex-time",
    stale: true,
  });
});
