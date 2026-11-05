import { it, expect } from "vitest";
import bs58 from "bs58";
import { createApp } from "../apps/server/src/http/app.ts";
import { UserError } from "../apps/server/src/client-message.ts";
it("rejects malformed token identities and exposes cached external activity independently from execution", async () => {
  const mint = bs58.encode(new Uint8Array(32).fill(12));
  let reads = 0;
  const app = await createApp({
    tokenInfo: async (m: string) => {
      reads++;
      return { mint: m, name: "Real", source: "DEX Screener" };
    },
    activitySnapshot: () => ({
      items: [],
      status: "quiet",
      source: "GeckoTerminal",
    }),
    snapshot: () => ({ pool: [] }),
  });
  expect((await app.inject("/api/tokens/not-a-mint")).statusCode).toBe(400);
  expect(reads).toBe(0);
  expect((await app.inject("/api/tokens/" + mint)).json()).toMatchObject({
    mint,
    source: "DEX Screener",
  });
  expect((await app.inject("/api/activity")).json()).toMatchObject({
    items: [],
    status: "quiet",
    source: "GeckoTerminal",
  });
  await app.close();
});
it("never answers a provider fault with the provider's own words", async () => {
  const mint = bs58.encode(new Uint8Array(32).fill(12));
  const leaky = await createApp({
    tokenInfo: async () => {
      throw Error(
        "fetch failed https://api.dexscreener.com.internal:8443/pairs -> 502 upstream",
      );
    },
    snapshot: () => ({ pool: [] }),
  });
  const r = await leaky.inject("/api/tokens/" + mint);
  expect(r.statusCode).toBe(503);
  expect(r.json()).toEqual({ error: "Token data unavailable." });
  expect(JSON.stringify(r.body)).not.toContain("dexscreener");
  await leaky.close();

  const curated = await createApp({
    tokenInfo: async () => {
      throw new UserError("DEX Screener cooling down after rate limit");
    },
    snapshot: () => ({ pool: [] }),
  });
  expect((await curated.inject("/api/tokens/" + mint)).json()).toEqual({
    error: "DEX Screener cooling down after rate limit",
  });
  await curated.close();
});
