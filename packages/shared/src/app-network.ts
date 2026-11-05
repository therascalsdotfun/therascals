export type AppNetwork = "testnet" | "mainnet";
export function savedAppNetwork(value: string | null): AppNetwork {
  return value === "testnet" ? "testnet" : "mainnet";
}
export function executionAllowed(network: AppNetwork, action: string): boolean {
  return (
    network === "testnet" || ["exit", "recover", "revoke"].includes(action)
  );
}

export function initialReleaseNetwork(
  search: string,
  saved: string | null,
): AppNetwork {
  // Public releases ignore historical Test Mode URLs and saved browser state.
  return "mainnet";
}
