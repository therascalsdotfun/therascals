import { expect, it } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import { BROAD_FILTERS } from "../apps/server/src/market/model.ts";
it("isolates persisted visitor settings while sharing the catalog and route cache", () => {
  const store = new MarketStore(":memory:"),
    service = new MarketService(store);
  const a = service.scoped("wallet-a"),
    b = service.scoped("wallet-b");
  a.configure({
    ticketAtomic: "1000000",
    filters: { ...BROAD_FILTERS, poolSize: 12 },
  });
  b.configure({
    ticketAtomic: "7000000",
    filters: { ...BROAD_FILTERS, poolSize: 3 },
  });
  expect(a.snapshot().filters.poolSize).toBe(12);
  expect(a.ticketSize()).toBe("1000000");
  expect(b.snapshot().filters.poolSize).toBe(3);
  expect(service.ticketSize()).toBe("5000000");
  expect(
    new MarketService(store).scoped("wallet-a").snapshot().filters.poolSize,
  ).toBe(12);
  expect(a.snapshot().configurationHash).not.toBe(
    b.snapshot().configurationHash,
  );
  expect(a.snapshot().health).toBe(b.snapshot().health);
  expect(() => b.beginRoll(a.snapshot().configurationHash)).toThrow(/changed/i);
  store.close();
});

it("warms only the eligible identity universe without letting manual picks promote a lookalike", async () => {
  const { normalizeJupiter } =
    await import("../apps/server/src/market/model.ts");
  const store = new MarketStore(":memory:"),
    service = new MarketService(store),
    now = Date.now();
  const mints = [
    "So11111111111111111111111111111111111111112",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "11111111111111111111111111111111",
  ];
  const tokens = mints.map((id, i) =>
    normalizeJupiter(
      {
        id,
        decimals: 6,
        name: "Same",
        symbol: "SAME",
        mcap: 1000000,
        liquidity: 100000 + i * 100000,
        updatedAt: new Date(now).toISOString(),
        createdAt: new Date(now - 3600000).toISOString(),
        firstPool: {
          createdAt: new Date(
            now - (i === 2 ? 172800000 : 3600000),
          ).toISOString(),
        },
        audit: {
          mintAuthorityDisabled: true,
          freezeAuthorityDisabled: true,
          isSus: false,
        },
      },
      now,
    )!,
  );
  store.upsert(tokens);
  const cfg = {
    filters: {
      ...BROAD_FILTERS,
      minVolume5m: 0,
      minBuys5m: 0,
      minSells5m: 0,
      minHolders: 0,
      hasX: false,
      hasWebsite: false,
      minLiquidity: 0,
      tokenSelection: {
        included: [mints[0]],
        excluded: [mints[1]],
        manualOnly: true,
      },
    },
    ticketAtomic: "5000000",
  };
  const all = (service as any).candidateTokens(cfg),
    fast = (service as any).candidateTokens(cfg, true);
  expect(fast).toHaveLength(2);
  expect(fast.find((t: any) => t.mint === mints[0]).identity.winnerMint).toBe(
    mints[1],
  );
  for (const t of fast)
    expect(t.identity).toEqual(
      all.find((x: any) => x.mint === t.mint).identity,
    );
  expect(all).toHaveLength(3);
  store.close();
});
