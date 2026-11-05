import { expect, it } from "vitest";

import {
  mappedDemoIndex,
  sourceRouteView,
} from "../apps/web/src/route-preview.ts";
const mint = "3SVjZ7BfT9FxiR49nZc7UdBmLgzRLJY7XBZDKhEFpump";
const route: any = {
  mint,
  ticketAtomic: "5000000",
  status: "eligible",
  checkedAt: 1000,
  expiresAt: 91000,
  buy: {
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outputMint: mint,
    inAmount: "5000000",
    outAmount: "123400",
    routeLabels: ["Raydium", "Meteora", "Raydium"],
    observedAt: 1000,
  },
  sell: {},
};
it("matches independent golden mappings retained from the two historical chain proofs", () => {
  // Public source mints and indices extracted from commit 5d4965a; no runtime
  // fixture, credentials or claim of a newly executed chain proof.
  const vectors = [
    { mint: "51SfaAyrYaR8FpibXT4TXtxEpnZSNoDwYVRojtKupump", index: 1 },
    { mint: "27Qg7EcnGfmbthfQeQXTs4qjfnvU6gXf8W1ahJiJpump", index: 2 },
  ];
  for (const v of vectors) expect(mappedDemoIndex(v.mint)).toBe(v.index);
  expect(mappedDemoIndex("invalid")).toBeNull();
});
it("shows deduplicated quoted venues without implying their order is a sequential swap route", () => {
  const view = sourceRouteView(route, mint, "5000000", 2000);
  expect(view.state).toBe("quoted");
  expect(view.venues).toEqual(["Raydium", "Meteora"]);
  expect(view.outAtomic).toBe("123400");
});
it("never presents an expired, wrong-token or wrong-amount quote as executable", () => {
  expect(sourceRouteView(route, mint, "5000000", 92000).state).toBe("stale");
  expect(sourceRouteView(route, "other", "5000000", 2000).state).toBe(
    "unavailable",
  );
  expect(sourceRouteView(route, mint, "1000000", 2000).state).toBe(
    "unavailable",
  );
  expect(
    sourceRouteView({ ...route, status: "unavailable" }, mint, "5000000", 2000)
      .state,
  ).toBe("unavailable");
  expect(sourceRouteView(null, mint, "5000000", 2000).state).toBe(
    "unavailable",
  );
});
