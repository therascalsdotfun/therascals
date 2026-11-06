import { Interface, parseUnits, toQuantity, getAddress } from "ethers";
export type EvmTradeChain = "base" | "bsc";
export const LIFI_NATIVE = "0x0000000000000000000000000000000000000000";
export const EVM_MAINNET = {
  base: {
    id: 8453,
    hex: "0x2105",
    name: "Base",
    symbol: "ETH",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    router: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  },
  bsc: {
    id: 56,
    hex: "0x38",
    name: "BNB Chain",
    symbol: "BNB",
    rpc: "https://bsc-dataseed.binance.org",
    explorer: "https://bscscan.com",
    router: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  },
} as const;
const swapTuple =
  "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)";
export const LIFI_SWAP = new Interface([
  `function swapTokensSingleV3NativeToERC20(bytes32,string,string,address,uint256,${swapTuple}) payable`,
  `function swapTokensMultipleV3NativeToERC20(bytes32,string,string,address,uint256,${swapTuple}[]) payable`,
]);
export function sameEvm(a: unknown, b: unknown): boolean {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(a) &&
    a.toLowerCase() === b.toLowerCase()
  );
}
export function nativeForDollars(amount: string, price: string): string {
  if (
    !/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/.test(amount) ||
    Number(amount) > 100 ||
    !/^\d+(?:\.\d{1,18})?$/.test(price)
  )
    throw Error("Use $1–$100 and a current native-token price");
  const scaled = parseUnits(price, 18);
  if (scaled <= 0n || Number(price) > 10000000)
    throw Error("Native price unavailable");
  const atomic = (parseUnits(amount, 18) * 10n ** 18n) / scaled;
  if (atomic <= 0n) throw Error("Native amount too small");
  return atomic.toString();
}
export type EvmUnsigned = {
  from: string;
  to: string;
  value: string;
  data: string;
  chainId: string;
};
export function validateEvmQuote(
  raw: any,
  expected: {
    chain: EvmTradeChain;
    wallet: string;
    mint: string;
    amountAtomic: string;
  },
): EvmUnsigned {
  const chain = EVM_MAINNET[expected.chain],
    a = raw?.action,
    e = raw?.estimate,
    tx = raw?.transactionRequest;
  if (
    !chain ||
    !a ||
    !e ||
    !tx ||
    !sameEvm(tx.from, expected.wallet) ||
    !sameEvm(tx.to, chain.router) ||
    Number(tx.chainId) !== chain.id ||
    a.fromChainId !== chain.id ||
    a.toChainId !== chain.id ||
    a.fromToken?.chainId !== chain.id ||
    a.toToken?.chainId !== chain.id ||
    !sameEvm(a.fromAddress, expected.wallet) ||
    !sameEvm(a.toAddress, expected.wallet) ||
    !sameEvm(a.fromToken?.address, LIFI_NATIVE) ||
    a.fromToken.decimals !== 18 ||
    !sameEvm(a.toToken?.address, expected.mint) ||
    a.fromAmount !== expected.amountAtomic ||
    e.fromAmount !== expected.amountAtomic ||
    !(a.slippage > 0 && a.slippage <= 0.01) ||
    !/^\d+$/.test(e.toAmount) ||
    !/^\d+$/.test(e.toAmountMin) ||
    !Number.isInteger(a.toToken.decimals) ||
    a.toToken.decimals < 0 ||
    a.toToken.decimals > 36 ||
    typeof tx.data !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2}){4,30000}$/.test(tx.data)
  )
    throw Error("Quote identity, chain or transaction changed");
  if (BigInt(tx.value ?? "0") !== BigInt(expected.amountAtomic))
    throw Error("Native spend changed");
  if (
    BigInt(e.toAmountMin) <= 0n ||
    BigInt(e.toAmountMin) > BigInt(e.toAmount) ||
    BigInt(e.toAmountMin) < (BigInt(e.toAmount) * 99n) / 100n
  )
    throw Error("Minimum output protection changed");
  const decoded = LIFI_SWAP.parseTransaction({ data: tx.data });
  if (
    !decoded ||
    !sameEvm(decoded.args[3], expected.wallet) ||
    decoded.args[4] !== BigInt(e.toAmountMin)
  )
    throw Error("Swap recipient or minimum changed");
  const swaps = decoded.name.includes("Multiple")
    ? [...decoded.args[5]]
    : [decoded.args[5]];
  if (
    !swaps.length ||
    swaps.length > 32 ||
    !sameEvm(swaps.at(-1).receivingAssetId, expected.mint)
  )
    throw Error("Swap destination token changed");
  const deposits = swaps.filter((s: any) => s.requiresDeposit);
  if (
    !deposits.length ||
    deposits.some((s: any) => !sameEvm(s.sendingAssetId, LIFI_NATIVE)) ||
    deposits.reduce((n: bigint, s: any) => n + s.fromAmount, 0n) !==
      BigInt(expected.amountAtomic)
  )
    throw Error("Only the exact native deposit is permitted");
  return {
    from: getAddress(expected.wallet),
    to: chain.router,
    value: toQuantity(BigInt(expected.amountAtomic)),
    data: tx.data,
    chainId: chain.hex,
  };
}
export type EvmTradeQuote = {
  id: string;
  chain: EvmTradeChain;
  wallet: string;
  mint: string;
  symbol: string;
  decimals: number;
  requestedUsd: string;
  nativePriceUsd: string;
  nativeAmount: string;
  outputAtomic: string;
  minimumOutputAtomic: string;
  createdAt: string;
  expiresAt: string;
  provider: string;
  route: string[];
  fees: { name: string; usd: string; included: boolean }[];
  transaction: EvmUnsigned;
  presetId?: string;
  /** Exact response retained for independent browser calldata validation. */
  routeQuote: any;
};
export type EvmPreflight = {
  status: "passed" | "insufficient_funds" | "failed";
  message: string;
  gas?: string;
  gasPrice?: string;
  gasCostNative?: string;
  checkedAt: string;
};
