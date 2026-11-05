import { it, expect } from "vitest";
import bs58 from "bs58";
import { PortfolioService } from "../apps/server/src/portfolio/service.ts";
const address = bs58.encode(new Uint8Array(32).fill(16)),
  mint = bs58.encode(new Uint8Array(32).fill(17));
it("aggregates classic and Token-2022 balances by mint without losing integer precision", async () => {
  const p = new PortfolioService(
    {
      lookup: async () => [
        {
          id: mint,
          symbol: "TEST",
          icon: "https://example.com/exact-mint.png",
        },
        { id: "unrelated", icon: "https://example.com/wrong.png" },
      ],
    } as any,
    async (_url, method) => {
      if (method === "getBalance") return { value: 1234567890 };
      return {
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: {
                    mint,
                    tokenAmount: { amount: "9007199254740993", decimals: 6 },
                  },
                },
              },
            },
          },
        ],
      };
    },
  );
  const result = await p.read("solana", address);
  expect(result.assets[0].raw).toBe("1234567890");
  expect(result.assets.find((a) => a.mint === mint)?.icon).toBe(
    "https://example.com/exact-mint.png",
  );
  expect(result.assets[0].icon).toBeUndefined();
  expect(result.assets.find((a) => a.mint === mint)?.raw).toBe(
    "18014398509481986",
  );
});
it("rejects malformed addresses before any public RPC request", async () => {
  let called = false;
  const p = new PortfolioService({} as any, async () => {
    called = true;
    return {};
  });
  await expect(p.read("solana", "not-an-address")).rejects.toThrow("Invalid");
  await expect(p.read("near", "name.testnet")).rejects.toThrow("mainnet");
  expect(called).toBe(false);
});
it("reports NEAR native coverage without inventing fungible-token balances", async () => {
  const p = new PortfolioService({} as any, async () => ({
    amount: "1000000000000000000000001",
    locked: "0",
  }));
  const r = await p.read("near", "example.near");
  expect(r.assets).toHaveLength(1);
  expect(r.assets[0].raw).toBe("1000000000000000000000001");
  expect(r.coverage).toContain("native");
});
it("keeps native SOL and wrapped SOL as distinct holdings", async () => {
  const sol = "So11111111111111111111111111111111111111112";
  const p = new PortfolioService(
    { lookup: async () => [] } as any,
    async (_url, method, params: any) =>
      method === "getBalance"
        ? { value: 1 }
        : params[1].programId.startsWith("Tokenkeg")
          ? {
              value: [
                {
                  account: {
                    data: {
                      parsed: {
                        info: {
                          mint: sol,
                          tokenAmount: { amount: "2", decimals: 9 },
                        },
                      },
                    },
                  },
                },
              ],
            }
          : { value: [] },
  );
  const r = await p.read("solana", address);
  expect(new Set(r.assets.map((a) => a.mint)).size).toBe(r.assets.length);
  expect(r.assets[0].mint).toBe("native");
});
