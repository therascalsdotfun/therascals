import { expect, it } from "vitest";
import {
  evaluateFilters,
  normalizeJupiter,
} from "../apps/server/src/market/model.ts";
import {
  discoveryPreset,
  presetFor,
} from "../packages/shared/src/discovery-presets.ts";
import { filterInput } from "../apps/web/src/filter-input.ts";
import {
  filterMilestones,
  milestoneLabel,
} from "../apps/web/src/filter-milestones.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import { createApp } from "../apps/server/src/http/app.ts";

const now = Date.parse("2026-11-03T00:00:00Z");
const token = () =>
  normalizeJupiter(
    {
      id: "So11111111111111111111111111111111111111112",
      name: "Coin",
      symbol: "COIN",
      decimals: 6,
      mcap: 100000,
      liquidity: 10000,
      holderCount: 100,
      createdAt: new Date(now - 3600000).toISOString(),
      firstPool: { createdAt: new Date(now - 3600000).toISOString() },
      stats5m: { buyVolume: 2000, sellVolume: 1000, numBuys: 30, numSells: 10 },
      updatedAt: new Date(now).toISOString(),
    },
    now,
  )!;
const base = discoveryPreset("broad");

it("keeps legacy presets unchanged and identifies active new constraints as custom", () => {
  expect(evaluateFilters(token(), base, now).matches).toBe(true);
  expect(presetFor(base)).toBe("broad");
  expect(presetFor({ ...base, maxLiquidity: null, hasTelegram: false })).toBe(
    "broad",
  );
  expect(presetFor({ ...base, maxLiquidity: 10000 })).toBe("custom");
  expect(presetFor({ ...base, hasTelegram: true })).toBe("custom");
});

it("enforces inclusive maximum boundaries and excludes unavailable metrics", () => {
  for (const [field, metric, boundary, reason, missing] of [
    [
      "maxLiquidity",
      "liquidity",
      10000,
      "liquidity_too_high",
      "unknown_liquidity",
    ],
    ["maxVolume5m", "volume5m", 3000, "volume_too_high", "unknown_volume_5m"],
    ["maxBuys5m", "buys5m", 30, "too_many_buys", "unknown_buys"],
    ["maxSells5m", "sells5m", 10, "too_many_sells", "unknown_sells"],
    ["maxHolders", "holders", 100, "too_many_holders", "unknown_holders"],
  ] as const) {
    const t = token();
    expect(
      evaluateFilters(t, { ...base, [field]: boundary }, now).matches,
    ).toBe(true);
    expect(
      evaluateFilters(t, { ...base, [field]: boundary - 1 }, now).reasons,
    ).toContain(reason);
    t[metric] = { ...t[metric], value: null };
    expect(
      evaluateFilters(t, { ...base, [field]: boundary }, now).reasons,
    ).toContain(missing);
  }
});

it("uses transaction counts for buy share and rejects missing, zero-activity and partial windows", () => {
  const t = token(),
    f = { ...base, minBuyShare5m: 75, maxBuyShare5m: 75 };
  // Dollar buy share is 66.7%, but transaction buy share is exactly 75%.
  expect(evaluateFilters(t, f, now).matches).toBe(true);
  expect(
    evaluateFilters(t, { ...f, minBuyShare5m: 76 }, now).reasons,
  ).toContain("buy_share_too_low");
  expect(
    evaluateFilters(t, { ...f, maxBuyShare5m: 74 }, now).reasons,
  ).toContain("buy_share_too_high");
  expect(
    evaluateFilters({ ...t, partialWindow5m: true }, f, now).reasons,
  ).toContain("incomplete_activity_window");
  for (const buys of [null, 0]) {
    const x = {
      ...t,
      buys5m: { ...t.buys5m, value: buys },
      sells5m: { ...t.sells5m, value: 0 },
    };
    expect(evaluateFilters(x, f, now).reasons).toContain(
      "unknown_buy_share_5m",
    );
  }
});

it("requires an observed Telegram link only when selected", () => {
  const t = token();
  expect(
    evaluateFilters(t, { ...base, hasTelegram: true }, now).reasons,
  ).toContain("no_telegram");
  t.links.telegram = "https://t.me/example";
  expect(evaluateFilters(t, { ...base, hasTelegram: true }, now).matches).toBe(
    true,
  );
});

it("keeps cleared advanced limits unbounded and labels the percentage scale", () => {
  expect(filterInput("maxLiquidity", "")).toBeNull();
  expect(filterInput("minBuyShare5m", "")).toBeNull();
  expect(filterInput("maxHolders", "0")).toBe(0);
  expect(filterMilestones("minBuyShare5m")).toEqual([
    0, 10, 25, 50, 75, 90, 100,
  ]);
  expect(milestoneLabel("maxBuyShare5m", 75)).toBe("75%");
});

it("persists advanced constraints independently and binds them to the configuration hash", () => {
  const store = new MarketStore(":memory:");
  try {
    const root = new MarketService(store),
      a = root.scoped("a"),
      b = root.scoped("b");
    const cfg = { filters: base, ticketAtomic: "5000000" };
    a.configure(cfg);
    b.configure(cfg);
    const hash = a.snapshot().configurationHash;
    a.configure({
      ...cfg,
      filters: {
        ...base,
        maxLiquidity: 50000,
        minBuyShare5m: 50,
        hasTelegram: true,
      },
    });
    expect(a.snapshot().configurationHash).not.toBe(hash);
    expect(b.snapshot().filters.maxLiquidity).toBeUndefined();
    expect(
      new MarketService(store).scoped("a").snapshot().filters.minBuyShare5m,
    ).toBe(50);
  } finally {
    store.close();
  }
});

it("rejects inverted and out-of-range advanced settings before configuration changes", async () => {
  const calls: unknown[] = [];
  const app = await createApp({
    configure: (x: unknown) => calls.push(x),
  } as any);
  try {
    for (const f of [
      { minLiquidity: 10000, maxLiquidity: 9999 },
      { minVolume5m: 1000, maxVolume5m: 999 },
      { minBuys5m: 20, maxBuys5m: 19 },
      { minSells5m: 20, maxSells5m: 19 },
      { minHolders: 20, maxHolders: 19 },
      { minBuyShare5m: 80, maxBuyShare5m: 70 },
      { minBuyShare5m: 101 },
      { maxBuyShare5m: -1 },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/discovery",
            payload: { ticket: "5", preset: "broad", filters: f },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(calls).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/discovery",
          payload: {
            ticket: "5",
            preset: "broad",
            filters: {
              maxLiquidity: 10000,
              minBuyShare5m: 50,
              maxBuyShare5m: 100,
              hasTelegram: true,
            },
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls).toHaveLength(1);
  } finally {
    await app.close();
  }
});
