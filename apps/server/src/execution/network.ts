export const NEAR_RPC = "https://test.rpc.fastnear.com";
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const SECONDARY_DEVNET_RPC =
  "https://solana-devnet.api.onfinality.io/public";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
import { Connection } from "@solana/web3.js";
import { RequestScheduler } from "../routes/eligibility.ts";
const rpcRequests = new RequestScheduler(650);
const secondaryRequests = new RequestScheduler(3500);
export function secondaryDevnetConnection() {
  return new Connection(SECONDARY_DEVNET_RPC, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (url, init) =>
      secondaryRequests.run(() =>
        fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        }),
      ),
  });
}
export function devnetConnection() {
  return new Connection(DEVNET_RPC, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (url, init) =>
      rpcRequests.run(() =>
        fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        }),
      ),
  });
}
export function assertTestnetAccount(id: string) {
  if (!/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.testnet$/.test(id))
    throw new Error("Only dedicated NEAR testnet accounts are allowed");
}
export function assertDevnetGenesis(hash: string) {
  if (hash !== DEVNET_GENESIS)
    throw new Error("Signing disabled: RPC is not Solana Devnet");
}
