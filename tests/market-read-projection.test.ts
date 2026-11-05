import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import {
  normalizeJupiter,
  BROAD_FILTERS,
} from "../apps/server/src/market/model.ts";
it("matches the full catalog projection, counts and manual identities without decorating rejected history", () => {
  const store = new MarketStore(":memory:"),
    service: any = new MarketService(store),
    now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const tokens = Array.from({ length: 300 }, (_, i) =>
      normalizeJupiter(
        {
          id: bs58.encode(
            createHash("sha256")
              .update("projection" + i)
              .digest(),
          ),
          decimals: 6,
          name: "Coin" + i,
          symbol: "C" + i,
          updatedAt: new Date(now).toISOString(),
          createdAt: new Date(now - 3600000).toISOString(),
          firstPool: { createdAt: new Date(now - 3600000).toISOString() },
          mcap: i < 4 ? 100000 : 1000000000,
          liquidity: 30000,
          holderCount: 500,
          stats5m: {
            buyVolume: 4000,
            sellVolume: 2000,
            numBuys: 50,
            numSells: 20,
          },
          audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
        },
        now,
      )!,
    );
    store.upsert(tokens);
    const configuration = {
      ticketAtomic: "5000000",
      filters: {
        ...BROAD_FILTERS,
        tokenSelection: {
          included: [tokens[290].mint],
          excluded: [tokens[0].mint],
          manualOnly: false,
        },
      },
    };
    const full = service.snapshot({ limit: 1000 }, configuration);
    const decorated = vi.spyOn(service, "decorate");
    const fast = service.snapshot(
      { limit: 1000, matchingOnly: true },
      configuration,
    );
    expect(fast.rows).toEqual(
      full.rows.filter(
        (r: any) =>
          r.matches &&
          (!r.token.identity || r.token.identity.winnerMint === r.token.mint),
      ),
    );
    expect(fast.manualRows).toEqual(full.manualRows);
    for (const key of [
      "configurationHash",
      "pool",
      "coverage",
      "observed",
      "matching",
      "eligible",
    ])
      expect(fast[key]).toEqual(full[key]);
    expect(decorated.mock.calls.length).toBeLessThan(10);
    clock.mockReturnValue(now + 86400000);
    expect(
      service.snapshot({ matchingOnly: true }, configuration).rows,
    ).toHaveLength(0);
  } finally {
    clock.mockRestore();
    service.stop();
    store.close();
  }
});
it("does not consume another visitor turn while warming is busy and deduplicates equal configurations", async () => {
  const store = new MarketStore(":memory:"),
    service: any = new MarketService(store);
  try {
    const cfg = (ticket: string) => ({
      ticketAtomic: ticket,
      filters: BROAD_FILTERS,
    });
    service.visitors.set("a", {
      seen: Date.now(),
      configuration: cfg("1000000"),
    });
    service.visitors.set("b", {
      seen: Date.now(),
      configuration: cfg("2000000"),
    });
    service.visitors.set("c", {
      seen: Date.now(),
      configuration: cfg("1000000"),
    });
    const tickets: string[] = [];
    service.warm = async (c: any) => {
      tickets.push(c.ticketAtomic);
    };
    service.checking = true;
    await service.warmVisitors();
    expect(service.warmCursor).toBe(0);
    service.checking = false;
    await service.warmVisitors();
    await service.warmVisitors();
    expect(tickets).toEqual(["1000000", "2000000"]);
    service.checking = true;
    await service.warmVisitors();
    expect(service.warmCursor).toBe(2);
    service.checking = false;
    await service.warmVisitors();
    expect(tickets[2]).toBe("1000000");
  } finally {
    service.stop();
    store.close();
  }
});
