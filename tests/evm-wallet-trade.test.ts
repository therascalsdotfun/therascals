import { expect, it, vi } from "vitest";
import { quoteFixture } from "./fixtures/evm-quote.ts";
import {
  validateEvmQuote,
  type EvmTradeQuote,
  type EvmPreflight,
} from "../packages/shared/src/evm-mainnet.ts";
import {
  submitReviewedEvmTrade,
  switchEvmTradeNetwork,
} from "../apps/web/src/wallets/evm-trade.ts";
const owner = "0x" + "1".repeat(40),
  mint = "0x" + "2".repeat(40);
function quote(): EvmTradeQuote {
  const raw = quoteFixture();
  return {
    id: "quote",
    chain: "base",
    wallet: owner,
    mint,
    symbol: "TINY",
    decimals: 6,
    requestedUsd: "5",
    nativePriceUsd: "2500",
    nativeAmount: raw.action.fromAmount,
    outputAtomic: "1000000",
    minimumOutputAtomic: "990000",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 45000).toISOString(),
    provider: "LI.FI",
    route: [],
    fees: [],
    transaction: validateEvmQuote(raw, {
      chain: "base",
      wallet: owner,
      mint,
      amountAtomic: raw.action.fromAmount,
    }),
    routeQuote: raw,
  };
}
const simulation = (): EvmPreflight => ({
  status: "passed",
  message: "passed",
  gas: "0x493e0",
  gasPrice: "0x989680",
  checkedAt: new Date().toISOString(),
});
it("checks the exact wallet and real-state call before one wallet-approved submission", async () => {
  const calls: string[] = [],
    before = vi.fn(() => calls.push("persist-lock"));
  const p = {
    request: async ({ method }: any) => {
      calls.push(method);
      return method === "eth_accounts"
        ? [owner]
        : method === "eth_chainId"
          ? "0x2105"
          : method === "eth_sendTransaction"
            ? "0x" + "a".repeat(64)
            : "0x";
    },
  };
  expect(
    await submitReviewedEvmTrade(p, quote(), simulation(), () => true, before),
  ).toBe("0x" + "a".repeat(64));
  expect(calls).toEqual([
    "eth_accounts",
    "eth_chainId",
    "eth_call",
    "eth_accounts",
    "eth_chainId",
    "persist-lock",
    "eth_sendTransaction",
  ]);
});
it.each([
  "account",
  "chain",
  "expired",
  "preflight",
  "changed",
  "storage",
  "calldata",
])("blocks %s failures without asking the wallet to send", async (kind) => {
  const q = quote(),
    s = simulation(),
    sent = vi.fn();
  if (kind === "expired") q.expiresAt = new Date(0).toISOString();
  if (kind === "calldata") q.transaction.value = "0x1";
  const p = {
    request: async ({ method }: any) => {
      if (method === "eth_sendTransaction") sent();
      if (method === "eth_call" && kind === "preflight")
        throw Error("execution reverted");
      return method === "eth_accounts"
        ? [kind === "account" ? mint : owner]
        : method === "eth_chainId"
          ? kind === "chain"
            ? "0x38"
            : "0x2105"
          : "0x";
    },
  };
  await expect(
    submitReviewedEvmTrade(
      p,
      q,
      s,
      () => kind !== "changed",
      () => {
        if (kind === "storage") throw Error("storage full");
      },
    ),
  ).rejects.toThrow();
  expect(sent).not.toHaveBeenCalled();
});
it("preserves a rejected network switch without sending or adding another chain", async () => {
  const calls: string[] = [];
  await expect(
    switchEvmTradeNetwork(
      {
        request: async ({ method }) => {
          calls.push(method);
          if (method === "eth_chainId") return "0x1";
          throw { code: 4001 };
        },
      },
      "base",
    ),
  ).rejects.toMatchObject({ code: 4001 });
  expect(calls).toEqual(["eth_chainId", "wallet_switchEthereumChain"]);
});
