import bs58 from "bs58";
export const SOURCE_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export function selectedPairLinks(mint: string) {
  try {
    if (
      bs58.decode(mint).length !== 32 ||
      bs58.encode(bs58.decode(mint)) !== mint
    )
      return null;
  } catch {
    return null;
  }
  return {
    jupiter: `https://jup.ag/swap?buy=${mint}&sell=${SOURCE_USDC}`,
    near: "https://near.com/home",
    dexscreener: `https://dexscreener.com/solana/${mint}`,
  };
}
