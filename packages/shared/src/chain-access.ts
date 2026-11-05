import { chooseChain } from "./roll-chain-selection.ts";
import type { FilterSpec } from "./market.ts";
import type { IntentsCatalog, IntentsAsset } from "./intents.ts";
import type { TokenObservation } from "./market.ts";
import { tokenChain, type DiscoveryChain } from "./token-selection.ts";
export type WalletAccounts = Partial<
  Record<"phantom" | "metamask" | "near", { address: string }>
>;
export type ChainAccess = {
  kind: "wallet" | "intents" | "unavailable";
  reason: string;
};
export function exactIntentsAsset(
  catalog: IntentsCatalog | null | undefined,
  token: Pick<TokenObservation, "chain" | "mint">,
): IntentsAsset | undefined {
  const chain = tokenChain(token),
    id = chain === "solana" ? "sol" : chain;
  return catalog?.assets.find(
    (a) =>
      a.blockchain === id &&
      typeof a.contractAddress === "string" &&
      (chain === "base" || chain === "bsc"
        ? a.contractAddress.toLowerCase() === token.mint.toLowerCase()
        : a.contractAddress === token.mint),
  );
}
export function chainAccess(
  chain: DiscoveryChain,
  accounts: WalletAccounts,
  catalog?: IntentsCatalog | null,
): ChainAccess {
  if (
    (chain === "solana" && accounts.phantom) ||
    (chain === "near" && accounts.near) ||
    ((chain === "base" || chain === "bsc") && accounts.metamask)
  )
    return {
      kind: "wallet",
      reason:
        chain === "base" || chain === "bsc"
          ? "Connected EVM wallet · MetaMask native ETH/BNB buys require a fresh quote, mainnet simulation and wallet approval"
          : chain === "near"
            ? "Connected NEAR wallet · native memecoin draws are unavailable until risk screening is connected"
            : "Connected wallet",
    };
  if (
    accounts.near &&
    catalog?.assets.some(
      (a) =>
        a.blockchain === (chain === "solana" ? "sol" : chain) &&
        a.contractAddress,
    )
  )
    return {
      kind: "intents",
      reason:
        "NEAR Intents · exact catalog assets only; a live quote and wallet approval are required. New memecoins may be unavailable.",
    };
  return {
    kind: "unavailable",
    reason: "Connect a compatible wallet, or NEAR for supported Intents assets",
  };
}
export function accessibleToken(
  token: Pick<TokenObservation, "chain" | "mint">,
  accounts: WalletAccounts,
  catalog?: IntentsCatalog | null,
): boolean {
  const access = chainAccess(tokenChain(token), accounts, catalog);
  return (
    access.kind === "wallet" ||
    (access.kind === "intents" && !!exactIntentsAsset(catalog, token))
  );
}

export function chooseAccessibleChain(
  filters: FilterSpec,
  chain: DiscoveryChain,
  multiple: boolean,
  accounts: WalletAccounts,
  catalog?: IntentsCatalog | null,
): FilterSpec {
  if (chainAccess(chain, accounts, catalog).kind === "unavailable")
    throw Error("Connect a compatible wallet for this chain");
  const next = chooseChain(filters, chain, multiple);
  return {
    ...next,
    chains: next.chains?.filter(
      (c) => chainAccess(c, accounts, catalog).kind !== "unavailable",
    ),
  };
}
