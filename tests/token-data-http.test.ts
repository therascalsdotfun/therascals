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

it("serves validated observed token art safely and supports JustHoot chart metadata", async () => {
  const solMint = bs58.encode(new Uint8Array(32).fill(15));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as typeof fetch;

  const app = await createApp({
    observedIconUrl: (mint: string) =>
      mint === solMint ? "https://cdn.dexscreener.com/icon.png" : null,
    snapshot: () => ({ pool: [] }),
  });

  try {
    expect((await app.inject("/api/token-art/bad%2Fmint")).statusCode).toBe(400);
    expect((await app.inject("/api/token-art/unobserved123")).statusCode).toBe(
      404,
    );
    const artRes = await app.inject("/api/token-art/" + solMint);
    expect(artRes.statusCode).toBe(200);
    expect(artRes.headers["content-type"]).toContain("image/png");

    const jhChart = await app.inject(
      "/api/charts/hoot-8ecf65.launchpad.justhoot.near?range=1m",
    );
    expect(jhChart.statusCode).toBe(200);
    expect(jhChart.json()).toMatchObject({
      source: "JustHoot",
      chain: "near",
      symbol: "HOOT",
    });
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
