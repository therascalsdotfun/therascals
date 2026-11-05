export type IntentsAsset = {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: "near" | "sol" | "base" | "bsc";
  contractAddress?: string;
  icon?: string | null;
};
export type IntentsCatalog = {
  assets: IntentsAsset[];
  fetchedAt: string;
  originAsset: string;
  defaultDestination: string;
  /** Separate destination: not an executable spot asset or HyperEVM USDC. */
  perpsCollateral?: HyperliquidCollateral;
};
export const HYPERLIQUID_PERPS_USDC =
  "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054";
export type HyperliquidCollateral = Omit<IntentsAsset, "blockchain"> & {
  blockchain: "hypercore";
};
export type HyperliquidFundingQuote = Omit<IntentsDryQuote, "destination"> & {
  destination: HyperliquidCollateral;
};
export type IntentsDryQuote = {
  dry: true;
  network: "mainnet";
  origin: IntentsAsset;
  destination: IntentsAsset;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  observedAt: string;
  refreshAfter: string;
  providerAt: string;
  timeEstimateSeconds: number | null;
  appFeeBps: number;
  slippageBps: number;
};
export function formatAtomic(value: string, decimals: number): string {
  const amount = value.padStart(decimals + 1, "0");
  const whole = decimals ? amount.slice(0, -decimals) : amount;
  const rawFraction = decimals ? amount.slice(-decimals) : "";
  // Keep small quoted amounts visible instead of truncating a positive value
  // below one millionth to "0". Never convert atomic amounts through float.
  const leadingZeros =
    whole === "0" ? (rawFraction.match(/^0*/)?.[0].length ?? 0) : 0;
  const fraction = rawFraction.slice(0, leadingZeros + 6).replace(/0+$/, "");
  return whole + (fraction ? "." + fraction : "");
}
