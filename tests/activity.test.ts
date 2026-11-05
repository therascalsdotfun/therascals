import { it, expect } from "vitest";
import bs58 from "bs58";
import {
  parseTrades,
  ActivityFeed,
} from "../apps/server/src/market/activity.ts";
import { GeckoData } from "../apps/server/src/market/gecko.ts";
import { UserError } from "../apps/server/src/client-message.ts";
const mint = bs58.encode(new Uint8Array(32).fill(12)),
  other = bs58.encode(new Uint8Array(32).fill(13)),
  pool = bs58.encode(new Uint8Array(32).fill(14)),
  wallet = bs58.encode(new Uint8Array(32).fill(15)),
  sig = bs58.encode(new Uint8Array(64).fill(16)),
  now = Date.parse("2026-10-23T12:00:00Z");
const token: any = { mint, name: "Token", symbol: "TK", icon: null };
const trade = (extra: any = {}) => ({
  id: "trade-1",
  attributes: {
    tx_hash: sig,
    tx_from_address: wallet,
    kind: "sell",
    from_token_address: other,
    to_token_address: mint,
    block_timestamp: "2026-10-23T11:59:30Z",
    volume_in_usd: "42.50",
    is_anomalous: false,
    ...extra,
  },
});
it("attributes actual buys by mint direction, requiring actor/signature, finite USD and recent timestamps", () => {
  const good = parseTrades(
    [
      trade(),
      trade({ from_token_address: mint, to_token_address: other }),
      trade({ volume_in_usd: "NaN" }),
      trade({ tx_hash: wallet }),
      trade({ tx_from_address: "username" }),
      trade({ block_timestamp: "2026-10-23T12:01:00Z" }),
      trade({ block_timestamp: "2026-10-23T11:40:00Z" }),
      trade({ is_anomalous: true }),
      trade({ from_token_address: other, to_token_address: other }),
    ],
    token,
    pool,
    now,
  );
  expect(good).toHaveLength(2);
  expect(good[0]).toMatchObject({
    side: "buy",
    wallet,
    signature: sig,
    usd: 42.5,
    mint,
    source: "GeckoTerminal",
  });
  expect(good[1].side).toBe("sell");
});
it("deduplicates replayed trades, expires history and labels failed polling instead of inventing activity", async () => {
  let at = now,
    fail: Error | false = false;
  const feed = new ActivityFeed(
    {
      trades: async () => {
        if (fail) throw fail;
        return { pool, rows: [trade(), trade()] };
      },
    } as any,
    () => at,
  );
  await feed.refresh(token);
  expect(feed.snapshot().items).toHaveLength(1);
  await feed.refresh(token);
  expect(feed.snapshot().items).toHaveLength(1);
  at += 130000;
  fail = Error("Rate limited https://internal-node-3:8443 failed");
  await feed.refresh(token);
  expect(feed.snapshot().status).toBe("stale");
  // The panel learns that polling failed, never the provider's own words.
  expect(feed.snapshot().error).toBe("Activity unavailable.");
  at += 600000;
  expect(feed.snapshot().items).toHaveLength(0);
  expect(feed.snapshot().status).toBe("error");
  fail = new UserError("GeckoTerminal cooling down after rate limit");
  at += 130000;
  await feed.refresh(token);
  expect(feed.snapshot().error).toBe(
    "GeckoTerminal cooling down after rate limit",
  );
});
it("resolves exact pool membership for trades and supplies the chosen mint to the provider", async () => {
  const urls: string[] = [];
  const g = new GeckoData(
    async (url: any) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify(
          urls.length === 1
            ? {
                data: [
                  {
                    attributes: { address: pool, reserve_in_usd: "1000" },
                    relationships: {
                      base_token: { data: { id: "solana_" + mint } },
                      quote_token: { data: { id: "solana_" + other } },
                    },
                  },
                ],
              }
            : { data: [trade()] },
        ),
      );
    },
    0,
    () => now,
  );
  const result = await g.trades(mint);
  expect(result.pool).toBe(pool);
  expect(result.rows).toHaveLength(1);
  expect(urls[1]).toContain("/pools/" + pool + "/trades?");
  expect(urls[1]).toContain("token=" + mint);
  expect(urls[1]).toContain("include_anomalous=false");
});
