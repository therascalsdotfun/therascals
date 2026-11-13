import { describe, it, expect } from "vitest";
import {
  normalizeJupiter,
  evaluateFilters,
  DEFAULT_FILTERS,
  admissionReasons,
} from "../apps/server/src/market/model.ts";

const now = Date.parse("2026-10-23T10:00:00Z");
const mint = "DjggwaPYk1bk1FvET7rFwDXJ9vwYNDZAAxQ9XgyMsc7y";
const raw = () => ({
  id: mint,
  name: "Bina",
  symbol: "BINA",
  decimals: 6,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  createdAt: "2026-10-22T20:00:00Z",
  firstPool: { id: "pool", createdAt: "2026-10-23T09:50:00Z" },
  updatedAt: "2026-10-23T09:59:55Z",
  mcap: 24000,
  fdv: 48000,
  liquidity: 22000,
  usdPrice: 0.000024,
  holderCount: 120,
  stats5m: { buyVolume: 1800, sellVolume: 400, numBuys: 32, numSells: 4 },
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
  twitter: "https://x.com/example",
});
const filters = {
  ...DEFAULT_FILTERS,
  minAgeMinutes: 0,
  minMarketCap: 10000,
  minLiquidity: 5000,
  minVolume5m: 1000,
};

describe("real market normalization and admission", () => {
  it("keeps mint age separate from first pool age", () => {
    const t = normalizeJupiter(raw(), now)!;
    expect(t.id).toBe("solana-mainnet:" + mint);
    expect(
      evaluateFilters(
        t,
        { ...filters, ageBasis: "first_pool", maxAgeMinutes: 30 },
        now,
      ).matches,
    ).toBe(true);
    expect(
      evaluateFilters(
        t,
        { ...filters, ageBasis: "mint", maxAgeMinutes: 30 },
        now,
      ).reasons,
    ).toContain("age_too_old");
  });
  it("does not replace missing market cap with FDV or treat missing volume as zero", () => {
    const r = raw();
    delete (r as any).mcap;
    delete (r.stats5m as any).sellVolume;
    const t = normalizeJupiter(r, now)!;
    expect(t.marketCap.value).toBeNull();
    expect(t.fdv.value).toBe(48000);
    expect(t.volume5m.value).toBeNull();
    expect(evaluateFilters(t, filters, now).reasons).toEqual(
      expect.arrayContaining(["unknown_market_cap", "unknown_volume_5m"]),
    );
  });
  it("preserves actual zero and provenance and marks a partial five-minute window", () => {
    const r = raw();
    r.firstPool.createdAt = "2026-10-23T09:59:00Z";
    r.stats5m.sellVolume = 0;
    const t = normalizeJupiter(r, now)!;
    expect(t.volume5m.value).toBe(1800);
    expect(t.volume5m.scope).toBe("token");
    expect(t.volume5m.source).toBe("jupiter");
    expect(t.partialWindow5m).toBe(true);
  });
  it("rejects stale or future observations for admission", () => {
    const r = raw();
    r.updatedAt = "2026-10-23T09:58:00Z";
    expect(admissionReasons(normalizeJupiter(r, now)!, now)).toContain(
      "stale_metadata",
    );
    r.updatedAt = "2026-10-23T10:01:00Z";
    expect(admissionReasons(normalizeJupiter(r, now)!, now)).toContain(
      "future_timestamp",
    );
  });
  it("does not require provider verification but excludes active or unknown authorities", () => {
    const r = raw();
    const t = normalizeJupiter(r, now)!;
    expect(admissionReasons(t, now)).toEqual([]);
    r.audit.mintAuthorityDisabled = false;
    expect(admissionReasons(normalizeJupiter(r, now)!, now)).toContain(
      "mint_authority_active",
    );
    delete (r.audit as any).mintAuthorityDisabled;
    expect(admissionReasons(normalizeJupiter(r, now)!, now)).toContain(
      "unknown_mint_authority",
    );
  });
  it("rejects malformed mints and nonnumeric fields, and strips unsafe URLs", () => {
    expect(normalizeJupiter({ ...raw(), id: "not-a-mint" }, now)).toBeNull();
    const t = normalizeJupiter(
      {
        ...raw(),
        mcap: "oops",
        twitter: "javascript:alert(1)",
        icon: "file:///private/key",
      },
      now,
    )!;
    expect(t.marketCap.value).toBeNull();
    expect(t.links.x).toBeNull();
    expect(t.icon).toBeNull();
  });
  it("filters measured buys and link presence without inventing social attention", () => {
    const t = normalizeJupiter(raw(), now)!;
    expect(
      evaluateFilters(t, { ...filters, minBuys5m: 40 }, now).reasons,
    ).toContain("too_few_buys");
    expect(evaluateFilters(t, { ...filters, hasX: true }, now).matches).toBe(
      true,
    );
    expect(
      evaluateFilters(t, { ...filters, hasWebsite: true }, now).reasons,
    ).toContain("no_website");
  });
});

it("keeps the cage fresh and below $100m even with unlimited saved filters", () => {
  const unrestricted = {
    ...filters,
    minMarketCap: null,
    maxMarketCap: null,
    maxAgeMinutes: 1e9,
  };
  for (const cap of [100000000, 100000001, null, 0]) {
    const t = normalizeJupiter({ ...raw(), mcap: cap }, now)!;
    expect(evaluateFilters(t, unrestricted, now).matches).toBe(false);
    expect(admissionReasons(t, now).length).toBeGreaterThan(0);
  }
  const small = normalizeJupiter({ ...raw(), mcap: 99999999 }, now)!;
  expect(evaluateFilters(small, unrestricted, now).matches).toBe(true);
  const old = normalizeJupiter(
    {
      ...raw(),
      firstPool: { createdAt: new Date(now - 86400001).toISOString() },
    },
    now,
  )!;
  expect(
    evaluateFilters(old, { ...unrestricted, maxAgeMinutes: 1440 }, now).matches,
  ).toBe(false);
  const futurePool = normalizeJupiter(
    {
      ...raw(),
      firstPool: { createdAt: new Date(now + 60000).toISOString() },
    },
    now,
  )!;
  expect(admissionReasons(futurePool, now)).toContain(
    "outside_fresh_cage_window",
  );
});

it("does not flag a token merely because isSus:false is present", () => {
  const r: any = raw();
  r.audit.isSus = false;
  expect(normalizeJupiter(r, now)!.suspicious).toBe(false);
  r.audit.isSus = true;
  expect(normalizeJupiter(r, now)!.suspicious).toBe(true);
});
