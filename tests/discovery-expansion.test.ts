import { screenedProviders } from "./screened-fixture.ts";
import { it, expect } from "vitest";
import { MarketService } from "../apps/server/src/market/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import {
  normalizeJupiter,
  BROAD_FILTERS,
} from "../apps/server/src/market/model.ts";
import bs58 from "bs58";
const mint = (n: number) => bs58.encode(new Uint8Array(32).fill(n));
it("does not let a freshly failed route starve untested candidates", async () => {
  const store = new MarketStore(":memory:"),
    service: any = new MarketService(store),
    now = Date.now();
  const tokens = [1, 2].map((n) =>
    normalizeJupiter(
      {
        id: mint(n),
        symbol: "T" + n,
        decimals: 6,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        createdAt: new Date(now - 60000).toISOString(),
        firstPool: {
          createdAt: new Date(now - 60000).toISOString(),
          id: mint(n),
        },
        mcap: 100000,
        liquidity: 20000,
        usdPrice: 1,
        stats5m: { volume: 5000, numBuys: 10, numSells: 8 },
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
        updatedAt: new Date(now).toISOString(),
      },
      now,
    )!,
  );
  for (const t of tokens) t.volume5m.value = 6000;
  screenedProviders(service, now);
  store.upsert(tokens);
  service.filters = { ...BROAD_FILTERS };
  const first = service.snapshot().rows[0].token.mint;
  service.routes.set(first + ":5000000", {
    mint: first,
    ticketAtomic: "5000000",
    status: "unavailable",
    expiresAt: now + 14000,
  });
  const requested: string[] = [];
  service.get = async (url: string) => {
    requested.push(url);
    throw Error("No route");
  };
  await service.warm();
  expect(requested[0]).not.toContain("outputMint=" + first);
  store.close();
});
