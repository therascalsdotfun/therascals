import type { FilterSpec } from "./market.ts";
import { selectedChains, type DiscoveryChain } from "./token-selection.ts";
export type RollStyle = "lottery" | "case" | "degen" | "perps";
export function chainsForRoll(
  filters: FilterSpec,
  style: RollStyle,
): FilterSpec {
  return filters;
}
export function chooseChain(
  filters: FilterSpec,
  chain: DiscoveryChain,
  multiple: boolean,
): FilterSpec {
  const chains = selectedChains(filters);
  return {
    ...filters,
    chains: !multiple
      ? [chain]
      : chains.includes(chain)
        ? chains.length === 1
          ? chains
          : chains.filter((c) => c !== chain)
        : [...chains, chain],
  };
}
