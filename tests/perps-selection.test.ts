import { describe, expect, it } from "vitest";
import { perpsNetwork } from "../apps/server/src/perps/config.ts";
import {
  PERPS_AMOUNT_TIERS,
  PERPS_LEVERAGE_TIERS,
  PERPS_MIN_NOTIONAL,
  classifyPerpsMarkets,
  drawPerpsSpin,
  perpsAgentApproval,
  perpsAmountChoices,
  perpsCommit,
  perpsCommitValid,
  perpsConfigHash,
  perpsExpectedLeverage,
  perpsLeverageChoices,
  perpsLimitPrice,
  perpsLiquidationPrice,
  perpsOrderSize,
  perpsPriceString,
  perpsRolls,
  perpsSeedHash,
  weightedChoice,
  type PerpsMarket,
} from "../packages/shared/src/perps.ts";

const meta = [
  { name: "BTC", maxLeverage: 40, szDecimals: 5 },
  { name: "ETH", maxLeverage: 25, szDecimals: 4 },
  { name: "SOL", maxLeverage: 20, szDecimals: 2 },
  { name: "WIF", maxLeverage: 5, szDecimals: 0 },
  { name: "kPEPE", maxLeverage: 10, szDecimals: 0 },
  { name: "POPCAT", maxLeverage: 3, szDecimals: 0 },
  { name: "NOTLISTED", maxLeverage: 50, szDecimals: 2 },
];

function markets(): PerpsMarket[] {
  return classifyPerpsMarkets(meta);
}

describe("Hyperliquid perps market catalog", () => {
  it("classifies curated majors and memes, dropping markets that are not listed", () => {
    const list = markets();
    expect(list.map((market) => market.name)).toEqual([
      "BTC",
      "ETH",
      "SOL",
      "kPEPE",
      "WIF",
      "POPCAT",
    ]);
    expect(list.find((market) => market.name === "kPEPE")?.display).toBe(
      "PEPE",
    );
    expect(list.find((market) => market.name === "WIF")?.universe).toBe("meme");
    expect(list.find((market) => market.name === "BTC")?.universe).toBe("perp");
    expect(list.some((market) => market.name === "NOTLISTED")).toBe(false);
  });

  it("filters leverage tiers to the market maximum and keeps the average near 10x", () => {
    expect(perpsLeverageChoices(5).map((choice) => choice.leverage)).toEqual([
      3, 5,
    ]);
    expect(perpsLeverageChoices(25).map((choice) => choice.leverage)).toEqual([
      3, 5, 8, 10, 15, 20, 25,
    ]);
    expect(perpsLeverageChoices(2)).toEqual([{ leverage: 2, weight: 10_000 }]);
    expect(perpsExpectedLeverage(50)).toBeCloseTo(10.25, 4);
    expect(perpsExpectedLeverage(5)).toBeCloseTo(3.889, 3);
    const total = PERPS_LEVERAGE_TIERS.reduce(
      (sum, choice) => sum + choice.weight,
      0,
    );
    expect(total).toBe(10_000);
  });

  it("filters amount tiers by the configured cap", () => {
    expect(perpsAmountChoices(5).map((choice) => choice.amount)).toEqual([5]);
    expect(perpsAmountChoices(10).map((choice) => choice.amount)).toEqual([
      5, 10,
    ]);
    expect(perpsAmountChoices(25).map((choice) => choice.amount)).toEqual([
      5, 10, 25,
    ]);
    expect(() => perpsAmountChoices(4)).toThrow("at least $5");
    const total = PERPS_AMOUNT_TIERS.reduce(
      (sum, choice) => sum + choice.weight,
      0,
    );
    expect(total).toBe(10_000);
  });
});

describe("weighted selection", () => {
  const choices = [
    { value: "low", weight: 7000 },
    { value: "mid", weight: 2000 },
    { value: "high", weight: 1000 },
  ];

  it("maps the full roll range without biasing the boundaries", () => {
    expect(weightedChoice(choices, 0)).toBe("low");
    expect(weightedChoice(choices, 6999)).toBe("low");
    expect(weightedChoice(choices, 7000)).toBe("mid");
    expect(weightedChoice(choices, 8999)).toBe("mid");
    expect(weightedChoice(choices, 9000)).toBe("high");
    expect(weightedChoice(choices, 9999)).toBe("high");
  });

  it("rejects invalid rolls and empty or negative distributions", () => {
    expect(() => weightedChoice(choices, -1)).toThrow("0..9999");
    expect(() => weightedChoice(choices, 10_000)).toThrow("0..9999");
    expect(() => weightedChoice([], 0)).toThrow("No eligible choices");
    expect(() => weightedChoice([{ value: "x", weight: -1 }], 0)).toThrow(
      "Invalid choice weights",
    );
  });
});

describe("perps spin", () => {
  const base = {
    markets: markets(),
    universe: "perp" as const,
    amountCap: 10,
    closeSeconds: 60,
  };

  it("draws only from the selected universe and respects every cap", () => {
    for (let roll = 0; roll < 10_000; roll += 137) {
      const result = drawPerpsSpin({
        ...base,
        rolls: {
          market: roll,
          side: roll,
          leverage: roll,
          amount: roll,
        },
      });
      expect(result.market.universe).toBe("perp");
      expect(result.leverage).toBeLessThanOrEqual(result.market.maxLeverage);
      expect(result.amount).toBeLessThanOrEqual(10);
      expect(result.notional).toBe(result.amount * result.leverage);
      expect(result.notional).toBeGreaterThanOrEqual(PERPS_MIN_NOTIONAL);
      expect(["long", "short"]).toContain(result.side);
    }
  });

  it("never emits meme leverage above the market maximum", () => {
    for (let roll = 0; roll < 10_000; roll += 53) {
      const result = drawPerpsSpin({
        ...base,
        universe: "meme",
        rolls: {
          market: roll,
          side: 0,
          leverage: roll,
          amount: 0,
        },
      });
      expect(result.market.universe).toBe("meme");
      expect(result.leverage).toBeLessThanOrEqual(result.market.maxLeverage);
    }
  });

  it("fails closed when a universe has no listed markets", () => {
    expect(() =>
      drawPerpsSpin({
        ...base,
        markets: markets().filter((market) => market.universe === "perp"),
        universe: "meme",
        rolls: { market: 0, side: 0, leverage: 0, amount: 0 },
      }),
    ).toThrow("No markets");
  });
});

describe("commit and reveal", () => {
  const serverSeed = "a".repeat(64);
  const clientSeed = "b".repeat(64);
  const spinId = "spin-1";
  const configHash = perpsConfigHash({
    universe: "perp",
    amountCap: 10,
    closeSeconds: 60,
    markets: markets(),
  });

  it("commits before the result and verifies the reveal", () => {
    const commit = perpsCommit(serverSeed, spinId);
    expect(commit).toMatch(/^[0-9a-f]{64}$/);
    expect(perpsCommitValid({ serverSeed, spinId, commit })).toBe(true);
    expect(
      perpsCommitValid({ serverSeed: "c".repeat(64), spinId, commit }),
    ).toBe(false);
  });

  it("derives four bounded rolls deterministically", () => {
    const first = perpsRolls({ serverSeed, clientSeed, spinId, configHash });
    expect(perpsRolls({ serverSeed, clientSeed, spinId, configHash })).toEqual(
      first,
    );
    for (const roll of Object.values(first))
      expect(Number.isInteger(roll) && roll >= 0 && roll < 10_000).toBe(true);
    const changed = perpsRolls({
      serverSeed,
      clientSeed: "d".repeat(64),
      spinId,
      configHash,
    });
    expect(changed).not.toEqual(first);
  });

  it("rejects malformed server seeds", () => {
    expect(() => perpsCommit("not-hex", spinId)).toThrow("32 bytes");
  });

  it("commits to the client seed before either side reveals", () => {
    const hash = perpsSeedHash(clientSeed);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(perpsSeedHash("d".repeat(64))).not.toBe(hash);
    expect(() => perpsSeedHash("not-hex")).toThrow("32 bytes");
  });
});

describe("position math", () => {
  it("computes indicative liquidation prices", () => {
    expect(perpsLiquidationPrice("long", 100, 10)).toBe(90);
    expect(perpsLiquidationPrice("short", 100, 10)).toBeCloseTo(110, 10);
    expect(perpsLiquidationPrice("long", 1, 2)).toBe(0.5);
    expect(() => perpsLiquidationPrice("long", 0, 10)).toThrow("positive");
  });

  it("rounds size down to the lot and enforces the $10 minimum", () => {
    expect(perpsOrderSize(15, 150, 2)).toEqual({
      size: "0.10",
      notional: 15,
    });
    expect(() => perpsOrderSize(10, 100_000, 0)).toThrow("rounds to zero");
    expect(() => perpsOrderSize(10, 300_000, 5)).toThrow(
      "below Hyperliquid's $10 minimum",
    );
  });

  it("builds aggressive limit prices with five significant figures", () => {
    expect(perpsLimitPrice(100, "long", 100)).toBe("101");
    expect(perpsLimitPrice(100, "short", 100)).toBe("99");
    expect(perpsLimitPrice(100000.55, "long", 100, 5)).not.toMatch(/\.\d{2,}/);
    expect(perpsLimitPrice(0.0000001, "long", 100, 0)).not.toBe("0");
    expect(perpsPriceString(0.001234567)).toBe("0.0012346");
    expect(perpsPriceString(0.000000001234567)).toBe("0.0000000012346");
    expect(perpsPriceString(12345.678)).toBe("12346");
    expect(perpsPriceString(100)).toBe("100");
    expect(() => perpsLimitPrice(0, "long")).toThrow("Invalid mark");
  });
});

describe("Hyperliquid agent approval", () => {
  it("builds the documented testnet typed data for MetaMask", () => {
    const approval = perpsAgentApproval({
      network: "testnet",
      agentAddress: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      nonce: 1_793_000_000_000,
    });
    expect(approval.action.signatureChainId).toBe("0x66eee");
    expect(approval.action.hyperliquidChain).toBe("Testnet");
    expect(approval.action.agentAddress).toBe(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
    expect(approval.typedData.domain.chainId).toBe(421614);
    expect(approval.typedData.primaryType).toBe(
      "HyperliquidTransaction:ApproveAgent",
    );
    expect(
      approval.typedData.types["HyperliquidTransaction:ApproveAgent"],
    ).toHaveLength(4);
    expect(approval.typedData.message.agentName).toBe("jackpot");
  });

  it("builds mainnet chain identifiers and validates input", () => {
    const approval = perpsAgentApproval({
      network: "mainnet",
      agentAddress: "0x1111111111111111111111111111111111111111",
      nonce: 1,
      agentName: "jackpot-main",
    });
    expect(approval.action.signatureChainId).toBe("0xa4b1");
    expect(approval.typedData.domain.chainId).toBe(42161);
    expect(() =>
      perpsAgentApproval({
        network: "testnet",
        agentAddress: "0x123",
        nonce: 1,
      }),
    ).toThrow("20-byte");
    expect(() =>
      perpsAgentApproval({
        network: "testnet",
        agentAddress: "0x1111111111111111111111111111111111111111",
        nonce: 1,
        agentName: "x".repeat(17),
      }),
    ).toThrow("1..16");
  });
});

describe("perps network configuration", () => {
  it("defaults to testnet and requires an explicit mainnet flag", () => {
    expect(perpsNetwork({})).toBe("testnet");
    expect(perpsNetwork({ JACKPOT_PERPS_NETWORK: "testnet" })).toBe("testnet");
    expect(() => perpsNetwork({ JACKPOT_PERPS_NETWORK: "mainnet" })).toThrow(
      "JACKPOT_PERPS_MAINNET=1",
    );
    expect(
      perpsNetwork({
        JACKPOT_PERPS_NETWORK: "mainnet",
        JACKPOT_PERPS_MAINNET: "1",
      }),
    ).toBe("mainnet");
    expect(() => perpsNetwork({ JACKPOT_PERPS_NETWORK: "devnet" })).toThrow(
      "testnet or mainnet",
    );
  });
});
