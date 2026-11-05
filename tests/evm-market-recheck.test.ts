import { expect, it } from "vitest";
import { MarketService } from "../apps/server/src/market/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { parseBasePairs } from "../apps/server/src/market/base.ts";
import { discoveryPreset } from "../packages/shared/src/discovery-presets.ts";
const mint = "0x" + "1".repeat(40),
  now = Date.now();
it.each(["clean", "flagged", "missing", "stale", "quarantined", "above-cap"])(
  "fresh EVM recheck: %s",
  async (kind) => {
    const store = new MarketStore(":memory:"),
      market = new MarketService(store),
      filters = {
        ...discoveryPreset("broad"),
        chains: ["base" as const],
        minMarketCap: null,
        minLiquidity: null,
        minVolume5m: null,
        minHolders: 0,
        minAgeMinutes: 0,
      };
    const token = parseBasePairs(
      [
        {
          chainId: "base",
          pairAddress: "0x" + "2".repeat(40),
          baseToken: { address: mint, name: "Tiny", symbol: "TINY" },
          pairCreatedAt: now - 3600000,
          marketCap: kind === "above-cap" ? 100000001 : 100000,
          liquidity: { usd: 20000 },
          priceUsd: ".001",
          volume: { m5: 1000 },
          txns: { m5: { buys: 20, sells: 20 } },
        },
      ],
      now,
    )[0];
    token.security =
      kind === "missing"
        ? undefined
        : {
            mint,
            chain: "base",
            source: "GoPlus",
            status: kind === "flagged" ? "flagged" : "checked",
            risks: [],
            checkedAt: new Date(
              now - (kind === "stale" ? 360000 : 0),
            ).toISOString(),
            score: null,
            reportAt: null,
          };
    (market as any).base.restore([token]);
    (market as any).importToken = async () => token;
    if (kind === "quarantined")
      (market as any).drawdowns.evidence = () => ({ dropFraction: 0.99 });
    try {
      const result = market.revalidateEvmSelected("base", mint, filters);
      if (kind === "clean") expect((await result).mint).toBe(mint);
      else await expect(result).rejects.toThrow(/failed/);
    } finally {
      store.close();
    }
  },
);
