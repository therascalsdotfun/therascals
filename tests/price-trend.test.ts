import { expect, it } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
const mint = "So11111111111111111111111111111111111111112";
function token(time: number, price: number) {
  return {
    id: "solana-mainnet:" + mint,
    mint,
    firstObservedAt: new Date(time).toISOString(),
    fetchedAt: new Date(time).toISOString(),
    sourceUpdatedAt: new Date(time).toISOString(),
    mintCreatedAt: null,
    firstPoolCreatedAt: null,
    firstPoolId: null,
    price: {
      value: price,
      source: "jupiter",
      asOf: new Date(time).toISOString(),
    },
  } as any;
}
it("samples real observations once per minute, separates mints and rejects stale/future prices", () => {
  const s = new MarketStore(":memory:");
  const time = 1793000000000;
  try {
    s.upsert([token(time, 100)]);
    expect(s.priceTrend(mint, time).points).toEqual([{ time, price: 100 }]);
    expect(s.priceTrend(mint, time + 1).points).toHaveLength(1);
    s.upsert([token(time + 60000, 110)]);
    expect(s.priceTrend(mint, time + 60000).points).toEqual([
      { time, price: 100 },
      { time: time + 60000, price: 110 },
    ]);
    expect(s.priceTrend("1".repeat(32), time + 60000).points).toEqual([]);
    expect(s.priceTrend(mint, time + 700000).stale).toBe(true);
    s.upsert([token(time + 900000, 500)]);
    expect(s.priceTrend(mint, time + 700000).points).toHaveLength(2);
  } finally {
    s.close();
  }
});
