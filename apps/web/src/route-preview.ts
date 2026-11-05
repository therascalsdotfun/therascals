import bs58 from "bs58";
import { sha256 } from "@noble/hashes/sha256";
import type { RoutePair } from "../../../packages/shared/src/market.ts";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Same public mapping as the deployed NEAR contract; never chooses a source. */
export function mappedDemoIndex(mint: string): number | null {
  try {
    const bytes = bs58.decode(mint);
    if (bytes.length !== 32) return null;
    const h = sha256(bytes);
    return (
      new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(0, false) % 3
    );
  } catch {
    return null;
  }
}
export function sourceRouteView(
  route: RoutePair | null | undefined,
  mint: string,
  ticket: string,
  now: number,
) {
  const buy = route?.buy;
  if (
    !route ||
    !buy ||
    route.mint !== mint ||
    route.ticketAtomic !== ticket ||
    buy.inputMint !== USDC ||
    buy.outputMint !== mint ||
    buy.inAmount !== ticket ||
    !/^\d+$/.test(buy.outAmount) ||
    BigInt(buy.outAmount) <= 0n
  )
    return {
      state: "unavailable" as const,
      venues: [] as string[],
      outAtomic: null,
      observedAt: null,
    };
  if (!["eligible", "stale"].includes(route.status))
    return {
      state: "unavailable" as const,
      venues: [] as string[],
      outAtomic: null,
      observedAt: null,
    };
  const state =
    route.status === "eligible" &&
    Number.isFinite(route.expiresAt) &&
    route.expiresAt > now
      ? ("quoted" as const)
      : ("stale" as const);
  return {
    state,
    venues: [...new Set(buy.routeLabels)].slice(0, 5),
    outAtomic: buy.outAmount,
    observedAt: buy.observedAt,
  };
}
