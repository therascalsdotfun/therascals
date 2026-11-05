import { expect, it, vi } from "vitest";
import {
  PageCache,
  projectionDeadline,
} from "../apps/server/src/market/page-cache.ts";
const now = 1793630000000;
function fixture() {
  const token = {
    mint: "a",
    sourceUpdatedAt: new Date(now - 1000).toISOString(),
    firstPoolCreatedAt: new Date(now - 3600000).toISOString(),
    mintCreatedAt: new Date(now - 3600000).toISOString(),
    security: { checkedAt: new Date(now - 1000).toISOString() },
    dex: { fetchedAt: new Date(now - 1000).toISOString() },
  };
  const view: any = {
    now: new Date(now).toISOString(),
    filters: { ageBasis: "first_pool", minAgeMinutes: 0, maxAgeMinutes: 1440 },
    rows: [
      { token, matches: true },
      { token: { ...token, mint: "b" }, matches: true },
    ],
    manualRows: [],
    pool: [],
    coverage: {},
    configurationHash: "hash",
  };
  const state: any = { routes: [], dex: {} };
  return { view, state, token };
}
it("shares one immutable catalog projection across page offsets while preserving as-of time and caller slices", () => {
  const { view, state } = fixture(),
    cache = new PageCache(),
    compute = vi.fn(() => view);
  const a = cache.read(
    "same-evidence",
    { offset: 0, limit: 1 },
    state,
    compute,
    now,
  );
  const b = cache.read(
    "same-evidence",
    { offset: 1, limit: 1 },
    state,
    compute,
    now + 50,
  );
  expect(compute).toHaveBeenCalledTimes(1);
  expect(a.rows[0].token.mint).toBe("a");
  expect(b.rows[0].token.mint).toBe("b");
  expect(b.now).toBe(view.now);
  a.rows.pop();
  expect(view.rows).toHaveLength(2);
  cache.read("changed-evidence", { limit: 1 }, state, compute, now + 60);
  expect(compute).toHaveBeenCalledTimes(2);
});
it("invalidates before route, source, risk, age or reference-pair freshness boundaries including off-page manual rows", () => {
  for (const mutate of [
    (x: any) => (x.view.rows[0].route = { expiresAt: now + 100 }),
    (x: any) => (x.token.sourceUpdatedAt = new Date(now - 59900).toISOString()),
    (x: any) =>
      (x.token.security.checkedAt = new Date(now - 299900).toISOString()),
    (x: any) =>
      (x.token.firstPoolCreatedAt = new Date(
        now - 86400000 + 100,
      ).toISOString()),
    (x: any) => (x.token.dex.fetchedAt = new Date(now - 59900).toISOString()),
    (x: any) => (x.state.dex = { a: { at: now - 59900 } }),
    (x: any) =>
      (x.view.manualRows = [
        {
          matches: true,
          token: {
            ...x.token,
            sourceUpdatedAt: new Date(now - 59900).toISOString(),
          },
        },
      ]),
  ]) {
    const f = fixture();
    mutate(f);
    expect(projectionDeadline(f.view, f.state)).toBe(now + 100);
    const cache = new PageCache(),
      compute = vi.fn(() => f.view);
    cache.read("key", {}, f.state, compute, now);
    cache.read("key", {}, f.state, compute, now + 99);
    expect(compute).toHaveBeenCalledTimes(1);
    cache.read("key", {}, f.state, compute, now + 100);
    expect(compute).toHaveBeenCalledTimes(2);
  }
});
it("does not serve projections through a clock rollback and caps evidence reuse at five seconds", () => {
  const { view, state } = fixture(),
    cache = new PageCache(),
    compute = vi.fn(() => view);
  cache.read("key", {}, state, compute, now);
  cache.read("key", {}, state, compute, now + 5000);
  cache.read("key", {}, state, compute, now - 1);
  expect(compute).toHaveBeenCalledTimes(3);
});
it("invalidates identity boundaries for manually excluded lookalikes", () => {
  const f = fixture();
  f.view.rows[0].matches = false;
  f.view.rows[0].reasons = ["removed_from_pool"];
  f.token.sourceUpdatedAt = new Date(now - 59900).toISOString();
  expect(projectionDeadline(f.view, f.state)).toBe(now + 100);
});
it("rechecks visible old rows while shared pool projection remains valid", async () => {
  const { MarketStore } = await import("../apps/server/src/market/store.ts");
  const { MarketService } =
    await import("../apps/server/src/market/service.ts");
  const { normalizeJupiter, BROAD_FILTERS } =
    await import("../apps/server/src/market/model.ts");
  const store = new MarketStore(":memory:"),
    service = new MarketService(store);
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const token = normalizeJupiter(
      {
        id: "So11111111111111111111111111111111111111112",
        decimals: 6,
        name: "History",
        symbol: "H",
        updatedAt: new Date(now - 59900).toISOString(),
        createdAt: new Date(now - 172800000).toISOString(),
        firstPool: { createdAt: new Date(now - 172800000).toISOString() },
        mcap: 100000,
        liquidity: 50000,
      },
      now,
    )!;
    store.upsert([token]);
    const view = service.snapshot(
      { limit: 20 },
      { filters: BROAD_FILTERS, ticketAtomic: "5000000" },
    );
    const state = service.snapshotReadState();
    expect(projectionDeadline(view, state)).toBe(now + 5000);
    expect(view.rows[0].admissionReasons).not.toContain("stale_metadata");
    clock.mockReturnValue(now + 101);
    expect(service.refreshPageRows(view).rows[0].admissionReasons).toContain(
      "stale_metadata",
    );
  } finally {
    clock.mockRestore();
    service.stop();
    store.close();
  }
});
