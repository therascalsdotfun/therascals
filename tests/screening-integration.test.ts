import { expect, it } from "vitest";
import bs58 from "bs58";
import { MarketService } from "../apps/server/src/market/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { DexData } from "../apps/server/src/market/dexscreener.ts";
import {
  normalizeJupiter,
  BROAD_FILTERS,
} from "../apps/server/src/market/model.ts";
const mint = (n: number) => bs58.encode(new Uint8Array(32).fill(n));
it("requires risk and reference evidence, removes lookalikes, and ignores paid boosts for draw odds", async () => {
  const store = new MarketStore(":memory:"),
    service: any = new MarketService(store),
    now = Date.now();
  const tokens = [1, 2, 3].map((n) =>
    normalizeJupiter(
      {
        id: mint(n),
        symbol: n === 3 ? "CAT" : "DOG",
        name: n === 3 ? "Cat" : "Doge",
        decimals: 6,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        firstPool: { createdAt: new Date(now - 60000).toISOString() },
        updatedAt: new Date(now).toISOString(),
        mcap: 100000,
        liquidity: n * 20000,
        stats5m: {
          buyVolume: 5000,
          sellVolume: 5000,
          numBuys: 10,
          numSells: 10,
        },
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
      },
      now,
    )!,
  );
  store.upsert(tokens);
  service.filters = BROAD_FILTERS;
  let checked = false,
    flagged = false,
    stale = false,
    boost = 0;
  const pair = (id: string) => ({
    mint: id,
    pool: id,
    liquidity: id === mint(2) ? 50000 : 20000,
    marketCap: 100000,
    stale: stale && id === mint(2),
    fetchedAt: new Date(now).toISOString(),
    activeBoosts: boost,
  });
  const report = (id: string) =>
    checked
      ? {
          mint: id,
          source: "RugCheck",
          status: flagged && id === mint(2) ? "flagged" : "checked",
          risks:
            flagged && id === mint(2)
              ? [{ name: "LP unlocked", level: "danger" }]
              : [],
          checkedAt: new Date(now).toISOString(),
          reportAt: new Date(now).toISOString(),
          score: 1,
        }
      : undefined;
  service.dex = { peek: pair, tokens: async (ids: string[]) => ids.map(pair) };
  service.risk = { peek: report, scan: async (id: string) => report(id) };
  for (const t of tokens)
    service.routes.set(t.mint + ":5000000", {
      mint: t.mint,
      ticketAtomic: "5000000",
      status: "eligible",
      expiresAt: now + 90000,
    });
  try {
    expect(service.snapshot().pool).toHaveLength(0);
    checked = true;
    const pool = service
      .snapshot()
      .pool.map((t: any) => t.mint)
      .sort();
    expect(pool).toEqual([mint(2), mint(3)].sort());
    const matching = service.snapshot({ matchingOnly: true });
    expect(matching.rows).toHaveLength(2);
    expect(
      service.snapshot().rows.find((r: any) => r.token.mint === mint(1))
        .admissionReasons,
    ).toContain("duplicate_name_or_ticker");
    boost = 999;
    expect(
      service
        .snapshot()
        .pool.map((t: any) => t.mint)
        .sort(),
    ).toEqual(pool);
    flagged = true;
    expect(service.snapshot().pool).toHaveLength(1);
    await expect(
      service.revalidateSelected(mint(2), "5000000", BROAD_FILTERS),
    ).rejects.toThrow(/security/);
    flagged = false;
    stale = true;
    expect(service.snapshot().pool).toHaveLength(1);
    for (let n = 0; n < 500; n++)
      service.cacheRoute("test:" + n, { expiresAt: now + 90000 });
    expect(service.routes.size).toBeLessThanOrEqual(300);
  } finally {
    store.close();
  }
});

it.each([200, 503])(
  "rotates beyond a full batch of DEX misses or failures (%s)",
  async (status) => {
    const store = new MarketStore(":memory:"),
      service: any = new MarketService(store),
      now = Date.now(),
      requested: string[][] = [];
    store.upsert(
      Array.from({ length: 31 }, (_, i) =>
        normalizeJupiter(
          {
            id: mint(i + 1),
            symbol: `C${i}`,
            name: `Coin ${i}`,
            decimals: 6,
            tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            firstPool: { createdAt: new Date(now - 60000).toISOString() },
            updatedAt: new Date(now).toISOString(),
            mcap: 100000,
            liquidity: 100000 - i * 1000,
            stats5m: {
              buyVolume: 5000,
              sellVolume: 5000,
              numBuys: 10,
              numSells: 10,
            },
            audit: {
              mintAuthorityDisabled: true,
              freezeAuthorityDisabled: true,
            },
          },
          now,
        )!,
      ),
    );
    service.filters = BROAD_FILTERS;
    service.dex = new DexData(async (url: any) => {
      requested.push(String(url).split("/").at(-1)!.split(","));
      return new Response("[]", { status });
    }, 0);
    service.risk = { peek: () => undefined, scan: async () => undefined };
    try {
      await service.warm();
      expect(requested[0]).toHaveLength(30);
      expect(requested[0]).not.toContain(mint(31));
      // Another visitor's much smaller universe must not reset this one.
      await service.warm({
        filters: { ...BROAD_FILTERS, minLiquidity: 99500 },
        ticketAtomic: "5000000",
      });
      await service.warm();
      expect(requested.flat()).toContain(mint(31));
    } finally {
      store.close();
    }
  },
);
