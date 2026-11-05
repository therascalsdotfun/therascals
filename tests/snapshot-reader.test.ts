import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import { SnapshotReader } from "../apps/server/src/market/snapshot-client.ts";
import {
  normalizeJupiter,
  BROAD_FILTERS,
} from "../apps/server/src/market/model.ts";
const mints = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
];
it("computes file-backed market views off-thread with matching security and selected-token state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rascals-snapshot-")),
    store = new MarketStore(join(dir, "market.sqlite")),
    service = new MarketService(store),
    now = Date.now();
  try {
    store.upsert(
      mints.map((id, i) =>
        normalizeJupiter(
          {
            id,
            decimals: 6,
            name: "Coin " + i,
            symbol: "C" + i,
            mcap: 100000,
            liquidity: 100000,
            updatedAt: new Date(now).toISOString(),
            createdAt: new Date(now - 3600000).toISOString(),
            firstPool: { createdAt: new Date(now - 3600000).toISOString() },
            audit: {
              mintAuthorityDisabled: true,
              freezeAuthorityDisabled: true,
              isSus: false,
            },
          },
          now,
        )!,
      ),
    );
    const configuration = {
      filters: {
        ...BROAD_FILTERS,
        minVolume5m: 0,
        minBuys5m: 0,
        minSells5m: 0,
        minHolders: 0,
        hasX: false,
        hasWebsite: false,
      },
      ticketAtomic: "5000000",
    };
    const baseline = service.snapshot({ matchingOnly: true }, configuration);
    const sync = vi.spyOn(service, "snapshot").mockImplementation(() => {
      throw Error("Parent snapshot must not run");
    });
    const [a, b] = await Promise.all([
      service.snapshotAsync({ matchingOnly: true }, configuration),
      service.snapshotAsync({ matchingOnly: true }, configuration),
    ]);
    expect(sync).not.toHaveBeenCalled();
    expect(a.configurationHash).toBe(baseline.configurationHash);
    expect(
      a.rows.map((r) => ({
        mint: r.token.mint,
        reasons: r.admissionReasons,
        matches: r.matches,
      })),
    ).toEqual(
      baseline.rows.map((r) => ({
        mint: r.token.mint,
        reasons: r.admissionReasons,
        matches: r.matches,
      })),
    );
    expect(a.eligible).toBe(0); // Missing security/routes never become eligible in the worker.
    a.rows.pop();
    expect(b.rows).toHaveLength(2);
    sync.mockRestore();
    const internal = service as any;
    for (const mint of mints) {
      internal.dex.cache.set(mint, {
        at: now,
        data: {
          mint,
          pool: mint,
          stale: false,
          fetchedAt: new Date(now).toISOString(),
          liquidity: 100000,
          marketCap: 100000,
        },
      });
      internal.risk.cache.set(mint, {
        mint,
        source: "RugCheck",
        status: "checked",
        checkedAt: new Date(now).toISOString(),
        reportAt: new Date(now).toISOString(),
        risks: [],
        score: 0,
      });
      internal.routes.set(mint + ":5000000", {
        mint,
        ticketAtomic: "5000000",
        status: "eligible",
        expiresAt: now + 90000,
      });
    }
    const compare = async () => {
      const expected = service.snapshot({}, configuration);
      const actual = await service.snapshotAsync({}, configuration);
      expect(actual.pool).toEqual(expected.pool);
      expect(actual.rows).toEqual(expected.rows);
      expect(actual.coverage.chainSources).toEqual(
        expected.coverage.chainSources,
      );
      return actual;
    };
    expect((await compare()).pool).toHaveLength(2);
    internal.risk.cache.get(mints[0]).checkedAt = new Date(
      now - 900000,
    ).toISOString();
    expect((await compare()).pool).toHaveLength(1);
    internal.risk.cache.get(mints[0]).checkedAt = new Date(now).toISOString();
    internal.routes.get(mints[0] + ":5000000").expiresAt = now - 1;
    expect((await compare()).pool).toHaveLength(1);
    internal.routes.get(mints[0] + ":5000000").expiresAt = now + 90000;
    internal.drawdowns.history.set(mints[0], {
      key: mints[0],
      points: [],
      quarantine: {
        key: mints[0],
        source: "jupiter:token:token-wide:USD",
        peak: { at: now - 1000, price: 1 },
        observed: { at: now, price: 0.05 },
        dropFraction: 0.95,
        quarantinedAt: new Date(now).toISOString(),
      },
    });
    expect((await compare()).pool).toHaveLength(1);
    store.upsert([
      {
        ...store.all()[0],
        symbol: "REFRESHED",
        sourceUpdatedAt: new Date().toISOString(),
      },
    ]);
    const next = await service.snapshotAsync(
      { matchingOnly: true },
      configuration,
    );
    expect(next.rows.some((r) => r.token.symbol === "REFRESHED")).toBe(true);
  } finally {
    service.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
it("opens worker stores read-only and cannot write through that connection", () => {
  const dir = mkdtempSync(join(tmpdir(), "rascals-read-only-")),
    path = join(dir, "market.sqlite"),
    writer = new MarketStore(path);
  writer.putRecord("unchanged", { value: 1 });
  const reader = new MarketStore(path, true);
  try {
    expect(reader.getRecord("unchanged")).toEqual({ value: 1 });
    expect(() => reader.putRecord("unchanged", { value: 2 })).toThrow();
    expect(writer.getRecord("unchanged")).toEqual({ value: 1 });
  } finally {
    reader.close();
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("bounds queued views, deduplicates concurrent reads and recovers after a worker startup failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rascals-worker-recovery-")),
    file = join(dir, "market.sqlite"),
    memory = new MarketStore(":memory:"),
    service = new MarketService(memory),
    reader = new SnapshotReader(file),
    configuration = { filters: BROAD_FILTERS, ticketAtomic: "5000000" };
  let store: MarketStore | undefined;
  try {
    const state = service.snapshotReadState();
    await expect(reader.read(state, {}, configuration)).rejects.toThrow(
      /unavailable/,
    );
    store = new MarketStore(file);
    const first = reader.read(state, {}, configuration);
    expect(reader.read(state, {}, configuration)).toBe(first);
    const pending = [
      first,
      ...Array.from({ length: 7 }, (_, i) =>
        reader.read(state, { offset: i + 1 }, configuration),
      ),
    ];
    await expect(
      reader.read(state, { offset: 99 }, configuration),
    ).rejects.toThrow(/busy/);
    expect((await Promise.all(pending)).every((x) => x.observed === 0)).toBe(
      true,
    );
    expect(
      (await reader.read(state, { offset: 99 }, configuration)).page.offset,
    ).toBe(99);
  } finally {
    reader.close();
    service.stop();
    store?.close();
    memory.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);

it("plans route-warming candidates in the shared read worker without invoking parent catalog scans", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rascals-warm-worker-")),
    store = new MarketStore(join(dir, "market.sqlite")),
    service = new MarketService(store),
    now = Date.now();
  try {
    store.upsert([
      normalizeJupiter(
        {
          id: mints[0],
          name: "Warm candidate",
          symbol: "WARM",
          decimals: 6,
          mcap: 100000,
          liquidity: 100000,
          holderCount: 500,
          stats5m: {
            buyVolume: 4000,
            sellVolume: 2000,
            numBuys: 50,
            numSells: 20,
          },
          createdAt: new Date(now - 3600000).toISOString(),
          firstPool: { createdAt: new Date(now - 3600000).toISOString() },
          updatedAt: new Date(now).toISOString(),
          audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
        },
        now,
      )!,
    ]);
    const configuration = {
      filters: {
        ...BROAD_FILTERS,
        minVolume5m: 0,
        minBuys5m: 0,
        minSells5m: 0,
        minHolders: 0,
        hasX: false,
        hasWebsite: false,
      },
      ticketAtomic: "5000000",
    };
    const expected = service
      .warmingCandidates(configuration)
      .map((t) => t.mint);
    expect(expected).toHaveLength(1);
    vi.spyOn(service, "warmingCandidates").mockImplementation(() => {
      throw Error("Parent candidate scan forbidden");
    });
    const actual = await (service as any).warmCandidates(configuration);
    expect(actual.map((t: any) => t.mint)).toEqual(expected);
    expect(actual[0].security).toBeUndefined();
  } finally {
    service.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("does not deduplicate requests across changed evidence or catalog revisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rascals-evidence-flight-")),
    store = new MarketStore(join(dir, "market.sqlite")),
    service = new MarketService(store),
    reader = new SnapshotReader(store.file);
  try {
    const state = service.snapshotReadState(),
      configuration = { filters: BROAD_FILTERS, ticketAtomic: "5000000" };
    const a = reader.read(state, {}, configuration, 0);
    expect(reader.read(state, {}, configuration, 0)).toBe(a);
    const b = reader.read(
      {
        ...state,
        health: { ...state.health, error: "Changed provider evidence" },
      },
      {},
      configuration,
      0,
    );
    expect(b).not.toBe(a);
    const c = reader.read(state, {}, configuration, 1);
    expect(c).not.toBe(a);
    const [old, current] = await Promise.all([a, b, c]);
    expect(old.health.error).toBeNull();
    expect(current.health.error).toBe("Changed provider evidence");
  } finally {
    reader.close();
    service.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
