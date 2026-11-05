import type { PerpsNetwork } from "../../../../packages/shared/src/perps.ts";

export function perpsNetwork(
  env: Record<string, string | undefined> = process.env,
): PerpsNetwork {
  const network = env.JACKPOT_PERPS_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "mainnet")
    throw Error("JACKPOT_PERPS_NETWORK must be testnet or mainnet");
  if (network === "mainnet" && env.JACKPOT_PERPS_MAINNET !== "1")
    throw Error(
      "Mainnet perps require JACKPOT_PERPS_MAINNET=1 after explicit release approval",
    );
  return network;
}
