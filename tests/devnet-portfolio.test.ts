import { expect, it, vi } from "vitest";
import { PortfolioService } from "../apps/server/src/portfolio/service.ts";
// Self-contained test manifest; never load private runtime evidence.
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: (path: any, ...args: any[]) => {
      if (String(path) === "docs/evidence/devnet-market-manifest.json")
        return JSON.stringify({
          usdcMint: "test-usdc",
          markets: [
            {
              mintToken: "8annnPucZjzaZEVaxJPPPvFLrhKbN4iQWakGBVTALTQu",
              symbol: "DEMO-1",
            },
          ],
        });
      return (fs.readFileSync as any)(path, ...args);
    },
  };
});
const address = "DAdypvRLi4KSR9VjKUmkXxCTbynQ7gBEL6J6mDEkcWBm",
  mint = "8annnPucZjzaZEVaxJPPPvFLrhKbN4iQWakGBVTALTQu";
it("reads Devnet holdings through a fixed endpoint and never gives test assets mainnet prices", async () => {
  const urls: string[] = [];
  let prices = 0;
  const p = new PortfolioService(
    {
      lookup: async () => {
        prices++;
        return [];
      },
    } as any,
    async (url, method, params: any) => {
      urls.push(url);
      if (method === "getBalance") return { value: 20000000 };
      return {
        value: params[1].programId.startsWith("Tokenkeg")
          ? [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint,
                        tokenAmount: { amount: "10000000000", decimals: 6 },
                      },
                    },
                  },
                },
              },
            ]
          : [],
      };
    },
  );
  const r = await p.read("solana-devnet", address);
  expect(r.network).toBe("Solana Devnet");
  expect(r.assets[0].symbol).toBe("DEMO-1");
  expect(r.assets.find((a) => a.mint === mint)?.symbol).toBe("DEMO-1");
  expect(r.assets.every((a) => a.valueUsd == null)).toBe(true);
  expect(prices).toBe(0);
  expect(urls.every((u) => u === "https://api.devnet.solana.com")).toBe(true);
});
it("keeps mainnet and Devnet caches separate for the same address", async () => {
  const p = new PortfolioService(
    { lookup: async () => [] } as any,
    async (url, method) =>
      method === "getBalance"
        ? { value: url.includes("devnet") ? 20 : 50 }
        : { value: [] },
  );
  expect((await p.read("solana", address)).assets[0].raw).toBe("50");
  expect((await p.read("solana-devnet", address)).assets[0].raw).toBe("20");
});
