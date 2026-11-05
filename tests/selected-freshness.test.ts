import { screenedProviders } from "./screened-fixture.ts";
import { it, expect } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import {
  normalizeJupiter,
  BROAD_FILTERS,
} from "../apps/server/src/market/model.ts";
const mint = "So11111111111111111111111111111111111111112";
it("reuses a selected token only when metadata and both size-specific quotes are under 15 seconds old", async () => {
  const store = new MarketStore(":memory:"),
    now = Date.now();
  store.upsert([
    normalizeJupiter(
      {
        id: mint,
        decimals: 6,
        updatedAt: new Date(now - 1000).toISOString(),
        firstPool: { createdAt: new Date(now - 60000).toISOString() },
        mcap: 20000,
        liquidity: 10000,
        stats5m: { buyVolume: 1000, sellVolume: 1000 },
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
      },
      now,
    )!,
  ]);
  const s: any = new MarketService(store),
    r: any = {
      mint,
      ticketAtomic: "5000000",
      status: "eligible",
      checkedAt: now - 1000,
      expiresAt: now + 89000,
      buy: { observedAt: now - 1000 },
      sell: { observedAt: now - 1000 },
    };
  screenedProviders(s, now);
  s.routes.set(mint + ":5000000", r);
  let calls = 0;
  s.get = async () => {
    calls++;
    throw new Error("network should not be used for a still-fresh pair");
  };
  expect(
    (await s.revalidateSelected(mint, "5000000", BROAD_FILTERS)).pair,
  ).toBe(r);
  expect(calls).toBe(0);
  r.buy.observedAt = now - 16000;
  await expect(
    s.revalidateSelected(mint, "5000000", BROAD_FILTERS),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  store.close();
});
