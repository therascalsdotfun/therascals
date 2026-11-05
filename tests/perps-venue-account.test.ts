import { describe, expect, it, vi } from "vitest";
import { HyperliquidClient } from "../apps/server/src/perps/hyperliquid.ts";

const master = "0x" + "11".repeat(20);

function state(over: Record<string, unknown> = {}) {
  return {
    marginSummary: { accountValue: "250.5" },
    withdrawable: "100",
    assetPositions: [],
    ...over,
  } as any;
}

describe("Hyperliquid venue account read", () => {
  it("maps a funded account and never-seen-a-trade account alike", async () => {
    const client = new HyperliquidClient("testnet");
    vi.spyOn(client.info, "clearinghouseState").mockResolvedValue(state());
    expect(await client.account(master)).toEqual({
      accountValue: 250.5,
      withdrawable: 100,
      positions: [],
    });

    vi.spyOn(client.info, "clearinghouseState").mockResolvedValue(
      state({ marginSummary: { accountValue: "0" }, withdrawable: "0" }),
    );
    expect(await client.account(master)).toEqual({
      accountValue: 0,
      withdrawable: 0,
      positions: [],
    });
  });

  it("keeps a zero-size position out of the position list", async () => {
    const client = new HyperliquidClient("testnet");
    vi.spyOn(client.info, "clearinghouseState").mockResolvedValue(
      state({
        assetPositions: [
          {
            position: {
              coin: "BTC",
              szi: "0",
              entryPx: "1",
              liquidationPx: null,
              unrealizedPnl: "0",
              marginUsed: "0",
              leverage: { value: 5 },
            },
          },
          {
            position: {
              coin: "ETH",
              szi: "0.5",
              entryPx: "3000",
              liquidationPx: "2000",
              unrealizedPnl: "10",
              marginUsed: "5",
              leverage: { value: 10 },
            },
          },
        ],
      }),
    );
    expect((await client.account(master)).positions).toEqual([
      {
        coin: "ETH",
        size: 0.5,
        entryPx: 3000,
        liquidationPx: 2000,
        unrealizedPnl: 10,
        marginUsed: 5,
        leverage: 10,
      },
    ]);
  });

  // Callers decide from this read whether a position still exists and whether
  // funds are available, so a lost request must not look like a flat account.
  it("propagates a failed read instead of reporting an empty account", async () => {
    const client = new HyperliquidClient("testnet");
    vi.spyOn(client.info, "clearinghouseState").mockRejectedValue(
      Error("clearinghouseState request failed"),
    );
    await expect(client.account(master)).rejects.toThrow("request failed");
  });

  it("propagates a malformed read instead of reporting an empty account", async () => {
    const client = new HyperliquidClient("testnet");
    vi.spyOn(client.info, "clearinghouseState").mockResolvedValue({
      marginSummary: {},
    } as any);
    await expect(client.account(master)).rejects.toThrow();
  });
});
