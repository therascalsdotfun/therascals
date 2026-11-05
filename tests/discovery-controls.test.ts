import { expect, it } from "vitest";
import {
  inferMemeTypes,
  MEME_TYPES,
} from "../packages/shared/src/meme-types.ts";
import {
  discoveryPreset,
  presetFor,
} from "../packages/shared/src/discovery-presets.ts";
import {
  evaluateFilters,
  normalizeJupiter,
} from "../apps/server/src/market/model.ts";
it("offers nested preset thresholds and preserves narrative choices", () => {
  const more = discoveryPreset("broad", ["politics"]),
    balanced = discoveryPreset("strict"),
    fewer = discoveryPreset("tight");
  for (const key of ["minMarketCap", "minLiquidity", "minVolume5m"] as const) {
    expect(more[key]).toBeLessThan(balanced[key]!);
    expect(fewer[key]).toBeGreaterThan(balanced[key]!);
  }
  expect(more.maxMarketCap).toBe(balanced.maxMarketCap);
  expect(fewer.maxMarketCap).toBe(balanced.maxMarketCap);
  expect(more.memeTypes).toEqual(["politics"]);
  expect(presetFor(more)).toBe("broad");
  expect(presetFor({ ...more, minLiquidity: 3333 })).toBe("custom");
});
it("infers narrative hints without substring accidents or an official identity claim", () => {
  expect(inferMemeTypes({ name: "Fight Trump", symbol: "TRUMP" })).toContain(
    "politics",
  );
  expect(inferMemeTypes({ name: "ChatGPT AI agent", symbol: "GPT" })).toContain(
    "tech",
  );
  expect(inferMemeTypes({ name: "Pepe", symbol: "PEPE" })).toContain("famous");
  expect(inferMemeTypes({ name: "Taylor Swift", symbol: "SWIFT" })).toContain(
    "celebrity",
  );
  expect(inferMemeTypes({ name: "Apple stock", symbol: "AAPL" })).toContain(
    "stocks",
  );
  expect(inferMemeTypes({ name: "Scattering", symbol: "CATALYST" })).toEqual([
    "other",
  ]);
  expect(MEME_TYPES.map((t) => t.id)).toContain("crypto-twitter");
});
it("applies OR narrative filters on the server while unknown tokens stay uncategorized", () => {
  const now = Date.now();
  const t = normalizeJupiter(
    {
      id: "So11111111111111111111111111111111111111112",
      name: "Fight Trump",
      symbol: "TRUMP",
      decimals: 6,
      mcap: 30000,
      liquidity: 10000,
      stats5m: { buyVolume: 2000, sellVolume: 1000 },
      firstPool: { createdAt: new Date(now - 600000).toISOString() },
    },
    now,
  )!;
  const f = discoveryPreset("broad");
  expect(
    evaluateFilters(t, { ...f, memeTypes: ["tech", "politics"] }, now).matches,
  ).toBe(true);
  expect(
    evaluateFilters(t, { ...f, memeTypes: ["tech"] }, now).reasons,
  ).toContain("meme_type_not_matched");
  expect(evaluateFilters(t, { ...f, memeTypes: [] }, now).matches).toBe(true);
  expect(
    evaluateFilters(
      { ...t, name: "Mystery", symbol: "???" },
      { ...f, memeTypes: ["other"] },
      now,
    ).matches,
  ).toBe(true);
});
