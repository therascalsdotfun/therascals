import { it, expect } from "vitest";
import bs58 from "bs58";
import { GeckoData, parseCandles } from "../apps/server/src/market/gecko.ts";
const mint = bs58.encode(new Uint8Array(32).fill(12)),
  pool = bs58.encode(new Uint8Array(32).fill(13));
const pools = {
  data: [
    {
      attributes: { address: pool, reserve_in_usd: "1000" },
      relationships: {
        base_token: { data: { id: "solana_" + mint } },
        quote_token: {
          data: { id: "solana_So11111111111111111111111111111111111111112" },
        },
      },
    },
  ],
};
it("normalizes only genuine coherent candles, deduplicating and sorting timestamps", () => {
  const rows = [
    [120, 2, 3, 1, 2.5, 20],
    [60, 1, 2, 0.5, 1.5, 10],
    [60, 1, 2, 0.5, 1.5, 10],
    [180, 4, 2, 1, 4, 9],
    [240, 1, 2, 0, 1, 2],
  ];
  expect(parseCandles(rows, 300000).map((c) => c.time)).toEqual([60, 120]);
  expect(parseCandles([], 300000)).toEqual([]);
});
it("resolves actual source membership and requests price candles for that exact mint", async () => {
  const urls: string[] = [];
  const g = new GeckoData(
    async (url: any) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify(
          urls.length === 1
            ? pools
            : {
                data: {
                  attributes: { ohlcv_list: [[60, 1, 2, 0.5, 1.5, 10]] },
                },
              },
        ),
      );
    },
    0,
    () => 300000,
  );
  const c = await g.chart(mint, "1m");
  expect(c.pool).toBe(pool);
  expect(c.mint).toBe(mint);
  expect(c.candles).toHaveLength(1);
  expect(urls[1]).toContain("token=" + mint);
  expect(urls[1]).toContain("include_empty_intervals=false");
  await g.chart(mint, "1m");
  expect(urls).toHaveLength(2);
});
it("rejects unrelated pools and does not manufacture candles", async () => {
  const g = new GeckoData(async () => new Response(JSON.stringify(pools)), 0);
  await expect(
    g.chart(bs58.encode(new Uint8Array(32).fill(14)), "1m"),
  ).rejects.toThrow("No indexed pool");
});
it("backs off after 429 without retrying the next chart immediately", async () => {
  let count = 0;
  const g = new GeckoData(async () => {
    count++;
    return new Response("{}", { status: 429 });
  }, 0);
  await expect(g.newMints()).rejects.toThrow("429");
  await expect(g.newMints()).rejects.toThrow("cooling down");
  expect(count).toBe(1);
});

it("uses the chosen DEX reference pool and verifies exact mint membership before candles", async () => {
  const urls: string[] = [];
  const g = new GeckoData(
    async (url: any) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify(
          urls.length === 1
            ? { data: pools.data[0] }
            : {
                data: {
                  attributes: { ohlcv_list: [[60, 1, 2, 0.5, 1.5, 10]] },
                },
              },
        ),
      );
    },
    0,
    () => 300000,
  );
  expect((await g.chart(mint, "1m", pool)).pool).toBe(pool);
  expect(urls[0]).toContain("/pools/" + pool + "?");
  expect(urls[1]).toContain("/pools/" + pool + "/ohlcv/");
  const bad = new GeckoData(
    async () =>
      new Response(
        JSON.stringify({
          data: { ...pools.data[0], attributes: { address: mint } },
        }),
      ),
    0,
    () => 300000,
  );
  await expect(bad.chart(mint, "1m", pool)).rejects.toThrow(/reference pool/);
});
