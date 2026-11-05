import { expect, it } from "vitest";
import {
  IntentsService,
  nearQuoteAmount,
  parseIntentsCatalog,
} from "../apps/server/src/intents/service.ts";
import { createApp } from "../apps/server/src/http/app.ts";
import { formatAtomic } from "../packages/shared/src/intents.ts";
import { HYPERLIQUID_PERPS_USDC } from "../packages/shared/src/intents.ts";
import {
  executionAllowed,
  savedAppNetwork,
} from "../packages/shared/src/app-network.ts";
const now = Date.now(),
  destination = "nep141:sol-usdc.omft.near";
const tokens = [
  {
    assetId: "nep141:wrap.near",
    symbol: "wNEAR",
    blockchain: "near",
    decimals: 24,
  },
  {
    assetId: destination,
    symbol: "USDC",
    blockchain: "sol",
    decimals: 6,
    contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
];
const hyper = {
  assetId: HYPERLIQUID_PERPS_USDC,
  blockchain: "hypercore",
  symbol: "USDC",
  decimals: 8,
  contractAddress: "0x6d1e7cde53ba9467b783cb7c530ce054",
};
it("keeps exact HyperCore perps collateral separate from spot and rejects decimal/identity confusion", async () => {
  const catalog = parseIntentsCatalog(
    [
      ...tokens,
      hyper,
      { ...hyper, assetId: "1cs_v1:hypercore:erc20:other", decimals: 6 },
    ],
    now,
  );
  expect(catalog.perpsCollateral?.assetId).toBe(HYPERLIQUID_PERPS_USDC);
  expect(catalog.assets.some((a) => a.assetId === HYPERLIQUID_PERPS_USDC)).toBe(
    false,
  );
  expect(() =>
    parseIntentsCatalog([...tokens, { ...hyper, decimals: 6 }], now),
  ).toThrow();
  let sent: any;
  const service = new IntentsService(
    async (url: any, init: any) => {
      if (url.endsWith("/tokens")) return Response.json([...tokens, hyper]);
      sent = JSON.parse(init.body);
      return Response.json({
        quoteRequest: { ...sent, appFees: [] },
        timestamp: new Date(now).toISOString(),
        quote: {
          amountIn: sent.amount,
          amountOut: "123000000",
          minAmountOut: "121770000",
        },
      });
    },
    () => now,
  );
  const app = await createApp({}, undefined, { intents: service });
  try {
    const r = await app.inject({
      method: "POST",
      url: "/api/perps/funding-quote",
      payload: { amount: "1" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      dry: true,
      network: "mainnet",
      destination: hyper,
    });
    expect(sent).toMatchObject({
      dry: true,
      recipientType: "DESTINATION_CHAIN",
      destinationAsset: HYPERLIQUID_PERPS_USDC,
    });
    expect(sent.recipient).toMatch(/^0x[0-9a-f]{40}$/);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/perps/funding-quote",
          payload: { amount: "1", recipient: "0xwrong" },
        })
      ).statusCode,
    ).toBe(400);
    await expect(service.quote(HYPERLIQUID_PERPS_USDC, "1")).rejects.toThrow(
      "supported",
    );
  } finally {
    await app.close();
  }
});
it("keeps mainnet quote mode separate from testnet buying and never rounds tiny positive quotes to zero", () => {
  expect(savedAppNetwork("mainnet")).toBe("mainnet");
  expect(savedAppNetwork("unknown")).toBe("mainnet");
  for (const action of ["draw", "activate", "confirm", "smoke-draw", "retry"])
    expect(executionAllowed("mainnet", action)).toBe(false);
  for (const action of ["exit", "recover", "revoke"])
    expect(executionAllowed("mainnet", action)).toBe(true);
  expect(executionAllowed("testnet", "draw")).toBe(true);
  expect(formatAtomic("1234", 12)).toBe("0.000000001234");
  expect(formatAtomic("4500000", 6)).toBe("4.5");
});
it("converts NEAR amounts exactly, bounds input and rejects unknown catalogs", () => {
  expect(nearQuoteAmount("1.000001")).toBe("1000001000000000000000000");
  for (const value of [
    "0",
    "0.09",
    "100.01",
    "1e1",
    "01",
    "1.0000001",
    "-1",
    "NaN",
  ])
    expect(() => nearQuoteAmount(value)).toThrow();
  expect(parseIntentsCatalog(tokens, now).defaultDestination).toBe(destination);
  expect(() => parseIntentsCatalog([tokens[0]], now)).toThrow();
});
function fixture(patch: (result: any) => any = (x) => x) {
  const requests: any[] = [];
  const service = new IntentsService(
    async (url: any, init: any) => {
      requests.push({ url, init });
      if (url.endsWith("/tokens")) return Response.json(tokens);
      const echo = JSON.parse(init.body);
      return Response.json(
        patch({
          quoteRequest: { ...echo, appFees: [{ fee: 20 }] },
          timestamp: new Date(now).toISOString(),
          quote: {
            amountIn: echo.amount,
            amountOut: "4500000",
            minAmountOut: "4455000",
            timeEstimate: 17,
          },
        }),
      );
    },
    () => now,
    undefined,
  );
  return { service, requests };
}
it("only requests dry mainnet quotes with fixed preview addresses and no user wallet or deposit output", async () => {
  const { service, requests } = fixture();
  const quote = await service.quote(destination, "1");
  expect(quote).toMatchObject({
    dry: true,
    network: "mainnet",
    amountOut: "4500000",
    minAmountOut: "4455000",
    appFeeBps: 20,
  });
  expect((quote as any).depositAddress).toBeUndefined();
  const payload = JSON.parse(requests[1].init.body);
  expect(payload).toMatchObject({
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
  });
  expect(requests[1].url).toBe("https://1click.chaindefuser.com/v0/quote");
  expect(requests[1].init.redirect).toBe("error");
  await service.catalog();
  expect(requests).toHaveLength(2);
  await expect(service.quote("https://evil.example", "1")).rejects.toThrow(
    "supported",
  );
});
it.each([
  (r: any) => ({ ...r, quoteRequest: { ...r.quoteRequest, dry: false } }),
  (r: any) => ({ ...r, quote: { ...r.quote, depositAddress: "do-not-fund" } }),
  (r: any) => ({
    ...r,
    quoteRequest: { ...r.quoteRequest, destinationAsset: "other" },
  }),
  (r: any) => ({ ...r, quote: { ...r.quote, amountIn: "99" } }),
  (r: any) => ({ ...r, quote: { ...r.quote, minAmountOut: "999999999" } }),
  (r: any) => ({ ...r, timestamp: new Date(now - 300000).toISOString() }),
])(
  "rejects non-dry, mismatched and expired provider responses",
  async (patch) => {
    await expect(
      fixture(patch).service.quote(destination, "1"),
    ).rejects.toThrow();
  },
);
it("backs off on provider429 without exposing keys or stale quotes", async () => {
  let calls = 0;
  const service = new IntentsService(
    async (url: any) => {
      calls++;
      return url.endsWith("/tokens")
        ? Response.json(tokens)
        : new Response("private-provider-text", { status: 429 });
    },
    () => now,
    "test-provider-key",
  );
  await expect(service.quote(destination, "1")).rejects.toThrow("rate limited");
  await expect(service.quote(destination, "1")).rejects.toThrow();
  expect(calls).toBe(2);
});
it("HTTP accepts quote preferences only, enforces origin and never calls the executor", async () => {
  const { service } = fixture();
  const app = await createApp(
    {},
    {
      draw: () => {
        throw Error("Executor must not run");
      },
    },
    { intents: service },
  );
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/intents/quote",
          headers: { origin: "https://evil.example" },
          payload: { destinationAsset: destination, amount: "1" },
        })
      ).statusCode,
    ).toBe(403);
    for (const extra of [
      { dry: false },
      { recipient: "some-wallet" },
      { network: "testnet" },
      { url: "https://evil.example" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/intents/quote",
            payload: { destinationAsset: destination, amount: "1", ...extra },
          })
        ).statusCode,
      ).toBe(400);
    const response = await app.inject({
      method: "POST",
      url: "/api/intents/quote",
      payload: { destinationAsset: destination, amount: "1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().dry).toBe(true);
  } finally {
    await app.close();
  }
});

it("quotes exact Base and BNB assets with EVM preview recipients, without funding or deposit addresses", async () => {
  for (const blockchain of ["base", "bsc"] as const) {
    const asset = {
      assetId: `nep141:${blockchain}-coin.omft.near`,
      symbol: "MEME",
      blockchain,
      decimals: 18,
      contractAddress: "0x" + "a".repeat(40),
    };
    let payload: any;
    const service = new IntentsService(
      async (url: any, init: any) => {
        if (url.endsWith("/tokens")) return Response.json([...tokens, asset]);
        payload = JSON.parse(init.body);
        return Response.json({
          quoteRequest: { ...payload, appFees: [] },
          timestamp: new Date(now).toISOString(),
          quote: {
            amountIn: payload.amount,
            amountOut: "1000000000000000000",
            minAmountOut: "990000000000000000",
            timeEstimate: 20,
          },
        });
      },
      () => now,
      undefined,
    );
    const result = await service.quote(asset.assetId, "1");
    expect(result.destination.blockchain).toBe(blockchain);
    expect(result.dry).toBe(true);
    expect(payload.recipient).toMatch(/^0x[1-9a-f0-9]{40}$/);
    expect(payload.dry).toBe(true);
    expect(JSON.stringify(result)).not.toContain("depositAddress");
  }
});
