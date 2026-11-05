import { expect, it } from "vitest";
import { portfolioSummary } from "../apps/web/src/portfolio-summary.ts";
it("combines actual demo cash with complete exit quotes, never treats missing quotes as zero", () => {
  expect(
    portfolioSummary("5000000", [{ exitQuoteAtomic: "3000000" }], [])
      .estimatedValue,
  ).toBe(8);
  expect(
    portfolioSummary("5000000", [{ exitQuoteAtomic: null }], []).estimatedValue,
  ).toBeNull();
  expect(portfolioSummary(null, [], []).estimatedValue).toBeNull();
  expect(
    portfolioSummary(
      "5000000",
      [],
      [
        { success: true, buy: true },
        { success: true, buy: false },
        { success: false, buy: true },
      ],
    ),
  ).toEqual({
    estimatedValue: 5,
    successfulBuys: 1,
    successfulSells: 1,
    realizedPnl: null,
  });
});
it("computes realized USDC PnL only for successful exits with an actual recorded cost basis", () => {
  expect(
    portfolioSummary("0", [], [
      {
        success: true,
        buy: false,
        output: "7000000",
        costBasisAtomic: "5000000",
      },
      { success: false, buy: false, output: "9000000", costBasisAtomic: "1" },
    ] as any).realizedPnl,
  ).toBe(2);
  expect(
    portfolioSummary("0", [], [
      { success: true, buy: false, output: "7000000", costBasisAtomic: null },
    ] as any).realizedPnl,
  ).toBeNull();
});
