import { expect, it } from "vitest";
import { quoteFixture } from "./fixtures/evm-quote.ts";
import {
  EVM_MAINNET,
  LIFI_NATIVE,
  nativeForDollars,
  validateEvmQuote,
  LIFI_SWAP,
} from "../packages/shared/src/evm-mainnet.ts";
const owner = "0x" + "1".repeat(40),
  mint = "0x" + "2".repeat(40);

it("converts dollars to native units with integer arithmetic and a $100 cap", () => {
  expect(nativeForDollars("5", "2500")).toBe("2000000000000000");
  expect(() => nativeForDollars("100.01", "2500")).toThrow();
  expect(() => nativeForDollars("5", "0")).toThrow();
});
it("accepts an exact native-input same-chain quote with decoded recipient protection", () => {
  expect(
    validateEvmQuote(quoteFixture(), {
      chain: "base",
      wallet: owner,
      mint,
      amountAtomic: "2000000000000000",
    }).to,
  ).toBe(EVM_MAINNET.base.router);
});
it.each([
  "router",
  "recipient",
  "chain",
  "value",
  "minimum",
  "token",
  "selector",
])("rejects a substituted %s", (field) => {
  const q = quoteFixture();
  if (field === "router") q.transactionRequest.to = mint;
  if (field === "chain") q.transactionRequest.chainId = 56;
  if (field === "value") q.transactionRequest.value = "0x1";
  if (field === "minimum") q.estimate.toAmountMin = "1";
  if (field === "token") q.action.toToken.address = owner;
  if (field === "selector") q.transactionRequest.data = "0x095ea7b3";
  if (field === "recipient") {
    const args = LIFI_SWAP.decodeFunctionData(
      "swapTokensMultipleV3NativeToERC20",
      q.transactionRequest.data,
    );
    q.transactionRequest.data = LIFI_SWAP.encodeFunctionData(
      "swapTokensMultipleV3NativeToERC20",
      [args[0], args[1], args[2], mint, args[4], args[5]],
    );
  }
  expect(() =>
    validateEvmQuote(q, {
      chain: "base",
      wallet: owner,
      mint,
      amountAtomic: "2000000000000000",
    }),
  ).toThrow();
});
