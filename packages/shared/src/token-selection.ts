import type { FilterSpec, TokenObservation } from "./market.ts";
export type DiscoveryChain = "solana" | "base" | "bsc" | "near";
export const DISCOVERY_CHAINS = ["solana", "base", "bsc", "near"] as const;
export const chainName = (chain: DiscoveryChain) =>
  ({ solana: "Solana", base: "Base", bsc: "BNB", near: "NEAR" })[chain];
export type TokenSelection = {
  included: string[];
  excluded: string[];
  manualOnly: boolean;
};
export const EMPTY_SELECTION: TokenSelection = {
  included: [],
  excluded: [],
  manualOnly: false,
};
export const selectedChains = (filters: FilterSpec): DiscoveryChain[] =>
  filters.chains ?? ["solana"];
export const tokenChain = (
  token: Pick<TokenObservation, "chain">,
): DiscoveryChain => token.chain ?? "solana";
export const tokenKey = (token: Pick<TokenObservation, "chain" | "mint">) =>
  tokenChain(token) === "solana"
    ? token.mint
    : tokenChain(token) + ":" + token.mint.toLowerCase();
export const tokenExplorer = (
  token: Pick<TokenObservation, "chain" | "mint">,
) =>
  tokenChain(token) === "base"
    ? "https://basescan.org/token/" + token.mint
    : tokenChain(token) === "bsc"
      ? "https://bscscan.com/token/" + token.mint
      : tokenChain(token) === "near"
        ? "https://nearblocks.io/token/" + encodeURIComponent(token.mint)
        : "https://solscan.io/token/" + token.mint;
export function updateTokenSelection(
  value: TokenSelection | undefined,
  key: string,
  action: "add" | "remove" | "restore",
): TokenSelection {
  const next = {
    ...(value ?? EMPTY_SELECTION),
    included: [...new Set(value?.included ?? [])].filter((x) => x !== key),
    excluded: [...new Set(value?.excluded ?? [])].filter((x) => x !== key),
  };
  if (action === "add") {
    if (next.included.length >= 32) throw Error("At most 32 manual picks.");
    next.included.push(key);
  }
  if (action === "remove") {
    if (next.excluded.length >= 256)
      throw Error("Restore removed tokens before excluding more.");
    next.excluded.push(key);
  }
  return next;
}
export function selectionReasons(
  token: TokenObservation,
  filters: FilterSpec,
): string[] {
  const key = tokenKey(token),
    selection = filters.tokenSelection;
  if (!selectedChains(filters).includes(tokenChain(token)))
    return ["chain_not_selected"];
  if (selection?.excluded.includes(key)) return ["removed_from_pool"];
  if (selection?.manualOnly && !selection.included.includes(key))
    return ["not_in_manual_pool"];
  return [];
}
export function prioritizePicks(
  tokens: TokenObservation[],
  filters: FilterSpec,
): TokenObservation[] {
  const picks = filters.tokenSelection?.included ?? [];
  return [...tokens].sort((a, b) => {
    const x = picks.indexOf(tokenKey(a)),
      y = picks.indexOf(tokenKey(b));
    return (x < 0 ? 1000 : x) - (y < 0 ? 1000 : y);
  });
}
