import {
  EVM_MAINNET,
  LIFI_NATIVE,
  LIFI_SWAP,
} from "../../packages/shared/src/evm-mainnet.ts";
const owner = "0x" + "1".repeat(40),
  mint = "0x" + "2".repeat(40);
export function quoteFixture() {
  const amount = "2000000000000000",
    min = "990000";
  const data = LIFI_SWAP.encodeFunctionData(
    "swapTokensMultipleV3NativeToERC20",
    [
      "0x" + "0".repeat(64),
      "",
      "",
      owner,
      min,
      [
        [
          "0x" + "3".repeat(40),
          "0x" + "3".repeat(40),
          LIFI_NATIVE,
          mint,
          amount,
          "0x1234",
          true,
        ],
      ],
    ],
  );
  return {
    action: {
      fromChainId: 8453,
      toChainId: 8453,
      fromAddress: owner,
      toAddress: owner,
      fromAmount: amount,
      fromToken: { address: LIFI_NATIVE, chainId: 8453, decimals: 18 },
      toToken: { address: mint, chainId: 8453, decimals: 6 },
      slippage: 0.01,
    },
    estimate: { fromAmount: amount, toAmount: "1000000", toAmountMin: min },
    transactionRequest: {
      from: owner,
      to: String(EVM_MAINNET.base.router),
      chainId: 8453,
      value: "0x71afd498d0000",
      data,
    },
  };
}
