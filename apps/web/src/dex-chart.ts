import type { DiscoveryChain } from "../../../packages/shared/src/token-selection.ts";
/** Only exact, supported pair identities may create an executable embed URL. */
export function dexChartUrl(chain: DiscoveryChain, pair: string, embed = true) {
  if (
    !pair ||
    !(chain === "solana"
      ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pair)
      : (chain === "base" || chain === "bsc") && /^0x[0-9a-f]{40}$/i.test(pair))
  )
    return null;
  const url = new URL(`https://dexscreener.com/${chain}/${pair}`);
  if (embed)
    for (const [key, value] of Object.entries({
      embed: "1",
      loadChartSettings: "0",
      trades: "0",
      info: "0",
      tabs: "0",
      chartTheme: "light",
      theme: "light",
    }))
      url.searchParams.set(key, value);
  return url.href;
}
