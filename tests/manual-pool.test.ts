import { expect, it } from "vitest";
import bs58 from "bs58";
import { MarketService } from "../apps/server/src/market/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import {
  BROAD_FILTERS,
  normalizeJupiter,
} from "../apps/server/src/market/model.ts";
import { commitRoll, settleRoll } from "../apps/server/src/routes/manifest.ts";
import { screenedProviders } from "./screened-fixture.ts";
import { updateTokenSelection } from "../packages/shared/src/token-selection.ts";
const mint = (n: number) => bs58.encode(new Uint8Array(32).fill(n));
function fixture() {
  const store = new MarketStore(":memory:"),
    service: any = new MarketService(store),
    now = Date.now();
  store.upsert(
    [1, 2, 3, 4].map((n) =>
      normalizeJupiter(
        {
          id: mint(n),
          symbol: `C${n}`,
          name: `Coin ${n}`,
          decimals: 6,
          tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          firstPool: { createdAt: new Date(now - n * 60000).toISOString() },
          updatedAt: new Date(now).toISOString(),
          mcap: 100000,
          liquidity: 20000,
          stats5m: { buyVolume: 10000, sellVolume: 10000 },
          audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
        },
        now,
      )!,
    ),
  );
  screenedProviders(service, now);
  for (const n of [1, 2, 3, 4])
    service.routes.set(mint(n) + ":5000000", {
      mint: mint(n),
      ticketAtomic: "5000000",
      status: "eligible",
      expiresAt: now + 90000,
    });
  return { store, service };
}
it("keeps removals out and prioritizes explicit picks before automatic fill", () => {
  const { store, service } = fixture();
  try {
    service.configure({
      ticketAtomic: "5000000",
      filters: {
        ...BROAD_FILTERS,
        poolSize: 2,
        tokenSelection: {
          included: [mint(4)],
          excluded: [mint(1)],
          manualOnly: false,
        },
      },
    });
    const s = service.snapshot();
    expect(s.pool.map((t: any) => t.mint)).toEqual([mint(4), mint(2)]);
    expect(s.rows.find((r: any) => r.token.mint === mint(1)).reasons).toContain(
      "removed_from_pool",
    );
  } finally {
    store.close();
  }
});
it("does not refill a manual pool, binds edits to the hash, and isolates visitors", () => {
  const { store, service } = fixture();
  try {
    const a = service.scoped("a"),
      b = service.scoped("b");
    const before = a.snapshot().configurationHash;
    a.configure({
      ticketAtomic: "5000000",
      filters: {
        ...BROAD_FILTERS,
        tokenSelection: { included: [mint(4)], excluded: [], manualOnly: true },
      },
    });
    expect(a.snapshot().pool.map((t: any) => t.mint)).toEqual([mint(4)]);
    expect(a.snapshot().configurationHash).not.toBe(before);
    expect(() => a.beginRoll(before)).toThrow(/changed/i);
    expect(b.snapshot().filters.tokenSelection).toBeUndefined();
    expect(
      new MarketService(store).scoped("a").snapshot().filters.tokenSelection!
        .included,
    ).toEqual([mint(4)]);
  } finally {
    store.close();
  }
});
it("manual inclusion never bypasses failed authority, risk, route or numeric filters", () => {
  const { store, service } = fixture();
  try {
    service.configure({
      ticketAtomic: "5000000",
      filters: {
        ...BROAD_FILTERS,
        tokenSelection: {
          included: [mint(3), mint(4)],
          excluded: [],
          manualOnly: true,
        },
      },
    });
    service.routes.delete(mint(3) + ":5000000");
    const prior = service.risk.peek;
    service.risk.peek = (id: string) =>
      id === mint(4)
        ? {
            ...prior(id),
            status: "flagged",
            risks: [{ name: "Risk", level: "danger" }],
          }
        : prior(id);
    expect(service.snapshot().pool).toHaveLength(0);
    service.configure({
      ticketAtomic: "5000000",
      filters: {
        ...BROAD_FILTERS,
        minLiquidity: 50000,
        tokenSelection: { included: [mint(1)], excluded: [], manualOnly: true },
      },
    });
    expect(service.snapshot().pool).toHaveLength(0);
  } finally {
    store.close();
  }
});
it("re-adding clears exclusion, removing clears inclusion, and selection deduplicates", () => {
  let s = updateTokenSelection(undefined, mint(1), "add");
  s = updateTokenSelection(s, mint(1), "add");
  expect(s.included).toEqual([mint(1)]);
  s = updateTokenSelection(s, mint(1), "remove");
  expect(s.included).toEqual([]);
  expect(s.excluded).toEqual([mint(1)]);
  s = updateTokenSelection(s, mint(1), "add");
  expect(s.excluded).toEqual([]);
});
it("manual-only picks and exclusions cannot promote a weaker lookalike", () => {
  const { store, service } = fixture();
  try {
    const tokens = store.all();
    store.upsert(
      tokens.map((t) => ({ ...t, symbol: "SAME", name: "Same identity" })),
    );
    service.dex.peek = (id: string) => ({
      mint: id,
      liquidity: id === mint(1) ? 90000 : 10000,
      marketCap: 100000,
      stale: false,
      fetchedAt: new Date().toISOString(),
    });
    service.configure({
      ticketAtomic: "5000000",
      filters: {
        ...BROAD_FILTERS,
        tokenSelection: {
          included: [mint(4)],
          excluded: [mint(1)],
          manualOnly: true,
        },
      },
    });
    expect(service.snapshot().pool).toHaveLength(0);
    expect(
      service.snapshot().manualRows.find((r: any) => r.token.mint === mint(4))
        .admissionReasons,
    ).toContain("duplicate_name_or_ticker");
  } finally {
    store.close();
  }
});
it("imports only the requested exact mint and rejects a provider mismatch", async () => {
  const { store, service } = fixture();
  try {
    service.lookup = async () => [{ id: mint(9), symbol: "FAKE", decimals: 6 }];
    await expect(service.importToken(mint(8))).rejects.toThrow(/not found/i);
    expect(
      service.snapshot().rows.some((r: any) => r.token.mint === mint(9)),
    ).toBe(false);
  } finally {
    store.close();
  }
});

it("supports Base-only and mixed pools without crossing chain identities", () => {
  const { store, service } = fixture();
  const now = Date.now(),
    baseAddress = "0x" + "a".repeat(40);
  const sol = service.snapshot().rows[0].token;
  const base = {
    ...sol,
    id: "base-mainnet:" + baseAddress,
    mint: baseAddress,
    chain: "base",
    previewOnly: true,
    symbol: "BASEONLY",
    name: "Base only",
    dex: { ...sol.dex, mint: baseAddress },
    security: {
      mint: baseAddress,
      source: "GoPlus",
      status: "checked",
      checkedAt: new Date(now).toISOString(),
      reportAt: null,
      score: null,
      risks: [],
    },
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
  };
  service.base = { tokens: () => [base], collect: async () => {} };
  try {
    service.configure({
      ticketAtomic: "5000000",
      filters: { ...BROAD_FILTERS, chains: ["base"] },
    });
    expect(service.snapshot().pool.map((t: any) => t.chain)).toEqual(["base"]);
    service.configure({
      ticketAtomic: "5000000",
      filters: {
        ...BROAD_FILTERS,
        chains: ["base", "solana"],
        poolSize: 2,
        tokenSelection: {
          included: ["base:" + baseAddress],
          excluded: [],
          manualOnly: false,
        },
      },
    });
    const pool = service.snapshot().pool;
    expect(pool[0].chain).toBe("base");
    expect(pool[1].chain ?? "solana").toBe("solana");
  } finally {
    store.close();
  }
});

it("exposes actual per-chain eligibility and lets every admitted chain win the mixed draw", () => {
  const { store, service } = fixture();
  const now = Date.now(),
    sol = service.snapshot().rows[0].token;
  const make = (chain: string, n: string, checked = true) => {
    const mint = "0x" + n.repeat(40);
    return {
      ...sol,
      id: chain + "-mainnet:" + mint,
      chain,
      mint,
      name: chain + n,
      symbol: chain + n,
      previewOnly: true,
      dex: { ...sol.dex, mint },
      security: {
        mint,
        chain,
        source: "GoPlus",
        status: checked ? "checked" : "unavailable",
        risks: [],
        checkedAt: new Date(now).toISOString(),
      },
      mintAuthorityDisabled: null,
      freezeAuthorityDisabled: null,
    };
  };
  service.base = { tokens: () => [make("base", "a")], error: null };
  service.bsc = {
    tokens: () => [make("bsc", "b"), make("bsc", "c", false)],
    error: null,
  };
  service.near = { tokens: () => [], error: null };
  try {
    const snapshot = service.snapshot(
      {},
      {
        ticketAtomic: "5000000",
        filters: {
          ...BROAD_FILTERS,
          poolSize: 8,
          chains: ["solana", "base", "bsc", "near"],
        },
      },
    );
    expect(snapshot.coverage.chainSources.base).toMatchObject({
      observed: 1,
      matching: 1,
      eligible: 1,
      inDraw: 1,
    });
    expect(snapshot.coverage.chainSources.bsc).toMatchObject({
      observed: 2,
      matching: 2,
      eligible: 1,
      inDraw: 1,
      blockers: { security_unavailable: 1 },
    });
    expect(snapshot.coverage.chainSources.near.inDraw).toBe(0);
    // The committed winner decides the chain rather than the other way round, so
    // assert the report always follows the winner and every chain in the field
    // stays reachable.
    for (const chain of ["solana", "base", "bsc"])
      expect(
        snapshot.pool.findIndex((t: any) => (t.chain ?? "solana") === chain),
      ).toBeGreaterThanOrEqual(0);
    const winners = new Set<string>();
    for (let n = 0; n < 400; n++) {
      const draw = settleRoll(
        snapshot,
        commitRoll(snapshot, snapshot.configurationHash),
      );
      expect(draw.manifest.selectedChain).toBe(draw.selected.chain ?? "solana");
      expect(draw.purchaseMade).toBe(false);
      winners.add(String(draw.selected.chain ?? "solana"));
    }
    expect([...winners].sort()).toEqual(["base", "bsc", "solana"]);
  } finally {
    store.close();
  }
});
