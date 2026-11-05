import { it, expect, vi } from "vitest";
import { MarketService } from "../apps/server/src/market/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import {
  normalizeJupiter,
  BROAD_FILTERS,
} from "../apps/server/src/market/model.ts";
it("paginates the persistent catalog without altering global filter or cage counts", () => {
  const store = new MarketStore(":memory:");
  const token = normalizeJupiter(
    {
      id: "So11111111111111111111111111111111111111112",
      decimals: 9,
      firstPool: { createdAt: new Date().toISOString() },
      mcap: 20000,
      liquidity: 10000,
      stats5m: { buyVolume: 1000, sellVolume: 1000 },
    },
    Date.now(),
  )!;
  store.upsert([token]);
  const service = new MarketService(store);
  service.configure({ ticketAtomic: "5000000", filters: BROAD_FILTERS });
  const page = service.snapshot({ offset: 1, limit: 10 });
  expect(page.rows).toHaveLength(0);
  expect(page.observed).toBe(1);
  expect(page.page).toEqual({
    offset: 1,
    limit: 10,
    total: 1,
    nextOffset: null,
  });
  const restarted = new MarketService(store);
  expect(restarted.snapshot().filters.minAgeMinutes).toBe(0);
  store.close();
});
it("never sends the Jupiter API key on a request that may be redirected", async () => {
  process.env.JUPITER_API_KEY = "do-not-leak";
  const seen: { url: string; init: any }[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init: any) => {
    seen.push({ url: String(url), init });
    return new Response("[]", {
      headers: { "content-type": "application/json" },
    });
  });
  const store = new MarketStore(":memory:");
  try {
    const service = new MarketService(store);
    await service.lookup(["So11111111111111111111111111111111111111112"]);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(
      "https://api.jup.ag/tokens/v2/search?query=So11111111111111111111111111111111111111112",
    );
    expect(seen[0].init.headers["x-api-key"]).toBe("do-not-leak");
    // Without this pin the key would be replayed to whatever Location: says.
    expect(seen[0].init.redirect).toBe("error");
  } finally {
    delete process.env.JUPITER_API_KEY;
    store.close();
    vi.unstubAllGlobals();
  }
});
