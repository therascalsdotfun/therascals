import type { TokenObservation } from "../../../packages/shared/src/market.ts";
export function displayPrice(token: TokenObservation) {
  const dex = token.dex;
  return dex && dex.price !== null
    ? {
        value: dex.price,
        source: "DEX Screener",
        at: dex.fetchedAt,
        stale: dex.stale,
      }
    : {
        value: token.price.value,
        source: "Jupiter",
        at: token.price.asOf,
        stale: false,
      };
}
