import { SOLANA_SELL_OUTPUTS } from "../../../../packages/shared/src/sell-output.ts";
/** Fallback branding is based on network + contract, never an arbitrary ticker. */
export function assetBrand(
  mint: string,
  network: string,
  chainId?: string,
): string | undefined {
  if (network === "Solana mainnet") {
    if (mint === "native" || mint === SOLANA_SELL_OUTPUTS.SOL.mint)
      return "SOL";
    if (mint === SOLANA_SELL_OUTPUTS.USDC.mint) return "USDC";
  }
  if (network === "NEAR mainnet" && mint === "native") return "NEAR";
  const chain = chainId?.toLowerCase();
  if (chain === "0x38") {
    if (mint === "native") return "BNB";
    if (mint.toLowerCase() === "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d")
      return "USDC";
    if (mint.toLowerCase() === "0x55d398326f99059ff775485246999027b3197955")
      return "USDT";
  }
  if (chain === "0x2105") {
    if (mint === "native") return "ETH";
    if (mint.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")
      return "USDC";
  }
  return undefined;
}
