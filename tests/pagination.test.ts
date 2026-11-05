import { it, expect } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import {
  normalizeJupiter,
  BROAD_FILTERS,
} from "../apps/server/src/market/model.ts";
import bs58 from "bs58";
it("finds matching tokens beyond the first 200 global rows and pages all records", () => {
  const store = new MarketStore(":memory:"),
    now = Date.now();
  for (let i = 0; i < 205; i++) {
    const mint = bs58.encode(
      Uint8Array.from({ length: 32 }, (_, j) => (j === 0 ? i + 1 : j)),
    );
    const raw = {
      id: mint,
      decimals: 6,
      updatedAt: new Date(now - i * 1000).toISOString(),
      firstPool: { createdAt: new Date(now - 60000).toISOString() },
      mcap: i >= 200 ? 20000 : 1,
      liquidity: 10000,
      stats5m: { buyVolume: 1000, sellVolume: 1000 },
    };
    store.upsert([normalizeJupiter(raw, now)!]);
  }
  const service = new MarketService(store);
  service.configure({ filters: BROAD_FILTERS, ticketAtomic: "5000000" });
  const global = service.snapshot();
  expect(global.matching).toBe(5);
  expect(global.rows.filter((r) => r.matches)).toHaveLength(0);
  const filtered = service.snapshot({
    matchingOnly: true,
    offset: 0,
    limit: 3,
  });
  expect(filtered.rows).toHaveLength(3);
  expect(filtered.page.nextOffset).toBe(3);
  expect(
    service.snapshot({ matchingOnly: true, offset: 3, limit: 3 }).rows,
  ).toHaveLength(2);
  store.close();
});
