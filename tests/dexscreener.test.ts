import { it, expect } from "vitest";
import bs58 from "bs58";
import {
  DexData,
  parseDexPairs,
} from "../apps/server/src/market/dexscreener.ts";
import { tokenImageUrl } from "../packages/shared/src/token-media.ts";
const mint = bs58.encode(new Uint8Array(32).fill(12)),
  other = bs58.encode(new Uint8Array(32).fill(13)),
  pool = bs58.encode(new Uint8Array(32).fill(14));
const pair = (extra: any = {}) => ({
  chainId: "solana",
  pairAddress: pool,
  dexId: "pumpswap",
  baseToken: { address: mint, name: "Real token", symbol: "REAL" },
  quoteToken: { address: other },
  priceUsd: "0.001",
  marketCap: null,
  fdv: 999999,
  liquidity: { usd: 1000 },
  volume: { m5: 200, h24: 5000 },
  txns: { m5: { buys: 3, sells: 2 } },
  info: { imageUrl: "https://cdn.dexscreener.com/icon.png" },
  ...extra,
});
it("selects exact Solana base mint and keeps pair scope without replacing missing MC by FDV", () => {
  const result = parseDexPairs(
    [
      pair({ chainId: "ethereum", liquidity: { usd: 999999 } }),
      pair({ baseToken: { address: other }, liquidity: { usd: 999999 } }),
      pair(),
      pair({ pairAddress: other, marketCap: 0, liquidity: { usd: 2000 } }),
    ],
    [mint],
    300000,
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    mint,
    pool: other,
    name: "Real token",
    symbol: "REAL",
    marketCap: 0,
    volume5m: 200,
    volume24h: 5000,
    scope: "pool",
  });
  expect(parseDexPairs([pair()], [mint], 300000)[0].marketCap).toBeNull();
});
it("permits only public HTTPS media and strips unsafe image candidates", () => {
  expect(tokenImageUrl("https://cdn.dexscreener.com/icon.png")).toBe(
    "https://cdn.dexscreener.com/icon.png",
  );
  for (const url of [
    "javascript:alert(1)",
    "http://host/a",
    "https://127.0.0.1/a",
    "https://localhost/a",
    "https://user:pass@host.com/a",
    "https://192.168.1.2/a",
    "https://[::1]/a",
    "https://host.local/a",
  ]) {
    expect(tokenImageUrl(url)).toBeNull();
  }
  expect(
    parseDexPairs(
      [pair({ info: { imageUrl: "data:image/svg+xml,bad" } })],
      [mint],
      300000,
    )[0].icon,
  ).toBeNull();
});
it("deduplicates and bounds batches, caches and returns marked stale results after refresh failure", async () => {
  let now = 300000,
    fail = false;
  const urls: string[] = [];
  const d = new DexData(
    async (url: any) => {
      urls.push(String(url));
      return fail
        ? new Response("{}", { status: 429 })
        : new Response(JSON.stringify([pair()]));
    },
    0,
    () => now,
  );
  const rows = await d.tokens([mint, mint]);
  expect(rows[0].symbol).toBe("REAL");
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("/tokens/v1/solana/" + mint);
  await d.tokens([mint]);
  expect(urls).toHaveLength(1);
  now += 61000;
  fail = true;
  expect((await d.tokens([mint]))[0].stale).toBe(true);
  await d.tokens([mint]);
  expect(urls).toHaveLength(2);
  await expect(
    d.tokens(
      Array.from({ length: 31 }, (_, i) =>
        bs58.encode(new Uint8Array(32).fill(i + 1)),
      ),
    ),
  ).rejects.toThrow("30");
});

it("breaks liquidity ties by market cap deterministically and promotion never changes the reference pair", () => {
  const high = pair({
    pairAddress: other,
    marketCap: 2000,
    liquidity: { usd: 5000 },
  });
  const low = pair({
    marketCap: 1000,
    liquidity: { usd: 5000 },
    boosts: { active: 500 },
  });
  const result = parseDexPairs([low, high], [mint], 300000)[0];
  expect(result.pool).toBe(other);
  expect(result.activeBoosts).toBe(500);
  expect(parseDexPairs([high, low], [mint], 300000)[0].pool).toBe(other);
  expect(
    parseDexPairs([pair({ boosts: { active: -1 } })], [mint], 300000)[0]
      .activeBoosts,
  ).toBe(0);
});
