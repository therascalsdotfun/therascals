import { expect, it } from "vitest";
import { runtimeOptions } from "../apps/server/src/http/runtime.ts";
import { initialReleaseNetwork } from "../packages/shared/src/app-network.ts";
import { jupiterForm } from "../apps/web/src/JupiterTrade.tsx";
import { createApp } from "../apps/server/src/http/app.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
it("keeps public journeys on mainnet despite old Test Mode links or saved preferences", () => {
  expect(initialReleaseNetwork("", null)).toBe("mainnet");
  expect(
    initialReleaseNetwork(
      "?test=1&designPreview=1&previewWallet=warmisland6465.near",
      "testnet",
    ),
  ).toBe("mainnet");
  expect(initialReleaseNetwork("", "testnet")).toBe("mainnet");
  expect(initialReleaseNetwork("?test=1", null)).toBe("mainnet");
  expect(initialReleaseNetwork("?test=0", "testnet")).toBe("mainnet");
  expect(
    jupiterForm("So11111111111111111111111111111111111111112", "5.25")
      .initialAmount,
  ).toBe("5250000");
  expect(() =>
    jupiterForm("So11111111111111111111111111111111111111112", "100.01"),
  ).toThrow();
});
it("runs public discovery and executable route guards without sponsored credentials or slots", async () => {
  const runtime = runtimeOptions({
    JACKPOT_MODE: "public",
    JACKPOT_PUBLIC_ORIGIN: "https://jackpot.example",
  });
  expect(runtime.slots).toEqual([]);
  const store = new MarketStore(":memory:");
  const app = await createApp(new MarketService(store), undefined, {
    runtime,
    store,
  });
  try {
    expect((await app.inject("/api/runtime")).json()).toMatchObject({
      defaultMode: "mainnet",
      sponsored: false,
      mainnet: { intentsExecutable: true },
      perps: { enabled: false, testnetEnabled: false },
    });
    expect((await app.inject("/api/intents/operations")).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/intents/operations",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/intents/operations",
          headers: { origin: "https://jackpot.example" },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject("/api/execution")).statusCode).toBe(404);
    for (const url of [
      "/api/perps/catalog",
      "/api/perps/testnet/catalog",
      "/api/rewards/leaderboard?lane=practice",
      "/api/portfolio/solana-devnet/11111111111111111111111111111111",
    ]) {
      expect((await app.inject(url)).statusCode, url).toBe(404);
    }
    for (const [url, payload] of [
      ["/api/execution/draw", {}],
      ["/api/rewards/practice-starter", {}],
      ["/api/rewards/claim", { lane: "practice" }],
      ["/api/rewards/promotions", { lane: "practice" }],
    ] as const) {
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            payload,
            headers: { origin: "https://jackpot.example" },
          })
        ).statusCode,
        url,
      ).toBe(404);
    }
  } finally {
    await app.close();
    store.close();
  }
});
it("exposes only configured mainnet perps in a public runtime", async () => {
  const store = new MarketStore(":memory:");
  const service = new MarketService(store);
  const runtime = runtimeOptions({
    JACKPOT_MODE: "public",
    JACKPOT_PUBLIC_ORIGIN: "https://jackpot.example",
  });
  const perps = {
    network: "mainnet",
    catalog: async () => ({ network: "mainnet", markets: [] }),
  };
  const app = await createApp(service, undefined, {
    runtime,
    store,
    perps: perps as any,
  });
  try {
    expect((await app.inject("/api/runtime")).json().perps).toMatchObject({
      enabled: true,
      network: "mainnet",
    });
    expect((await app.inject("/api/perps/catalog")).json().network).toBe(
      "mainnet",
    );
    expect((await app.inject("/api/perps/agent")).statusCode).toBe(401);
  } finally {
    await app.close();
    store.close();
  }
});
