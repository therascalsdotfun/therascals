// Regression: E2E-001 — queued route checks can age otherwise fresh metadata.
// Found by /qa on 2026-10-27
// Report: docs/end-to-end-journey.md
import { expect, it, vi } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import {
  BROAD_FILTERS,
  normalizeJupiter,
} from "../apps/server/src/market/model.ts";
import { screenedProviders } from "./screened-fixture.ts";
const mint = "So11111111111111111111111111111111111111112";
it.each(["fresh", "changed-filters", "old-quotes"])(
  "rechecks metadata after queued quotes, preserving all gates: %s",
  async (scenario) => {
    let clock = Date.parse("2026-10-27T09:00:00Z"),
      searches = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const store = new MarketStore(":memory:"),
      service: any = new MarketService(store);
    const raw = () => ({
      id: mint,
      name: "Fresh source",
      symbol: "FRESH",
      decimals: 6,
      updatedAt: new Date(clock - 10000).toISOString(),
      firstPool: { createdAt: new Date(clock - 3600000).toISOString() },
      mcap: 100000,
      liquidity: 20000,
      stats5m: { buyVolume: 1000, sellVolume: 1000 },
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
    });
    store.upsert([normalizeJupiter(raw(), clock)!]);
    screenedProviders(service, clock);
    service.get = async (url: string) => {
      if (url.includes("/search?")) {
        searches++;
        if (searches > 1 && scenario === "old-quotes") clock += 16000;
        const data = raw();
        if (searches > 1) data.updatedAt = new Date(clock).toISOString();
        if (searches > 1 && scenario === "changed-filters") data.liquidity = 0;
        return [data];
      }
      clock += 4000;
      const q = new URL(url).searchParams;
      return {
        transaction: null,
        inputMint: q.get("inputMint"),
        outputMint: q.get("outputMint"),
        inAmount: q.get("amount"),
        outAmount: "1000",
        routePlan: [{ swapInfo: { label: "fixture" } }],
      };
    };
    try {
      const result = service.revalidateSelected(mint, "5000000", BROAD_FILTERS);
      if (scenario === "fresh") {
        const admitted = await result;
        expect(admitted.token.mint).toBe(mint);
        expect(searches).toBe(2);
        expect(
          clock - Date.parse(admitted.token.sourceUpdatedAt),
        ).toBeLessThanOrEqual(15000);
        expect(
          clock -
            Math.min(
              admitted.pair.buy.observedAt,
              admitted.pair.sell.observedAt,
            ),
        ).toBeLessThanOrEqual(15000);
      } else await expect(result).rejects.toThrow();
    } finally {
      spy.mockRestore();
      store.close();
    }
  },
);
