import { describe, it, expect } from "vitest";
import {
  trackedPositions,
  positionMetrics,
  percentageAtomic,
  atomicAmount,
  decimalAmount,
  type TrackedFill,
} from "../packages/shared/src/portfolio-position.ts";
import { sellForm } from "../apps/web/src/portfolio/PortfolioSell.tsx";
const mint = "So11111111111111111111111111111111111111112";
const fill = (extra: Partial<TrackedFill> = {}): TrackedFill => ({
  signature: "buy1",
  wallet: "wallet",
  mint,
  decimals: 6,
  time: 1700000000,
  slot: 1,
  before: "0",
  after: "100000000",
  usdcDelta: "-20000000",
  ...extra,
});
describe("tracked portfolio basis", () => {
  it("derives weighted entry and both PnL units from remaining verified cost", () => {
    const [p] = trackedPositions([
      fill(),
      fill({
        signature: "buy2",
        slot: 2,
        before: "100000000",
        after: "200000000",
        usdcDelta: "-40000000",
      }),
    ]);
    expect(p.costUsdcAtomic).toBe("60000000");
    expect(positionMetrics("200000000", 6, 90, p)).toEqual({
      cost: 60,
      entry: 0.3,
      pnl: 30,
      percent: 50,
    });
  });
  it("allocates cost proportionally on a partial sale, without treating proceeds as remaining cost", () => {
    const [p] = trackedPositions([
      fill(),
      fill({
        signature: "sell1",
        slot: 2,
        before: "100000000",
        after: "75000000",
        usdcDelta: "10000000",
      }),
    ]);
    expect(p.costUsdcAtomic).toBe("15000000");
    expect(positionMetrics("75000000", 6, 30, p).pnl).toBe(15);
  });
  it("deduplicates replayed receipts before deciding slot ambiguity", () => {
    expect(trackedPositions([fill(), fill()])).toEqual(
      trackedPositions([fill()]),
    );
  });
  it("does not guess ordering within the same slot", () => {
    expect(
      trackedPositions([
        fill(),
        fill({ signature: "buy2", before: "100000000", after: "200000000" }),
      ])[0].costUsdcAtomic,
    ).toBeNull();
  });
  it("leaves imported balances and gaps unknown", () => {
    expect(
      trackedPositions([fill({ before: "50000000" })])[0].costUsdcAtomic,
    ).toBeNull();
    const [p] = trackedPositions([
      fill(),
      fill({
        signature: "buy2",
        slot: 2,
        before: "150000000",
        after: "200000000",
      }),
    ]);
    expect(p.costUsdcAtomic).toBeNull();
  });
  it("does not show PnL for a balance mismatch or unpriced holding", () => {
    const [p] = trackedPositions([fill()]);
    expect(positionMetrics("200000000", 6, 90, p).pnl).toBeNull();
    expect(positionMetrics("100000000", 6, null, p)).toEqual({
      cost: 20,
      entry: 0.2,
      pnl: null,
      percent: null,
    });
  });
  it("reports losses in dollars and percent without treating missing basis as zero", () => {
    const [p] = trackedPositions([fill()]);
    expect(positionMetrics("100000000", 6, 10, p)).toEqual({
      cost: 20,
      entry: 0.2,
      pnl: -10,
      percent: -50,
    });
    expect(positionMetrics("100000000", 6, 10)).toEqual({
      cost: null,
      entry: null,
      pnl: null,
      percent: null,
    });
  });
});
describe("sell quantities", () => {
  it("floors partial percentages in integer units and uses exact full balance for 100%", () => {
    const balance = "900719925474099312345";
    for (const percent of [10, 25, 50, 75, 100])
      expect(percentageAtomic(balance, percent)).toBe(
        String((BigInt(balance) * BigInt(percent)) / 100n),
      );
  });
  it("converts token amounts without floating point rounding and rejects excess precision", () => {
    expect(atomicAmount("9007199254.740993", 6)).toBe("9007199254740993");
    expect(decimalAmount("9007199254740993", 6)).toBe("9007199254.740993");
    for (const v of ["1e3", "-1", "0", "0.0000001", "Infinity"])
      expect(() => atomicAmount(v, 6)).toThrow();
  });
  it("locks the exact input token, output USDC and amount, with no buy-dollar cap on a sale", () => {
    expect(sellForm(mint, "100000000000")).toMatchObject({
      initialInputMint: mint,
      initialOutputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      initialAmount: "100000000000",
      fixedAmount: true,
      fixedMint: mint,
    });
    expect(() => sellForm(mint, "0")).toThrow();
  });
});
