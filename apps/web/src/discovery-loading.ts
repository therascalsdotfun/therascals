import type { MarketResponse } from "../../../packages/shared/src/market.ts";
import { selectedChains } from "../../../packages/shared/src/token-selection.ts";
export type DiscoveryRequest = "discovery" | "draw" | null;
export function discoveryLoading(
  data: MarketResponse | null,
  request: DiscoveryRequest,
  requestFailed = false,
) {
  if (request === "draw" && data) return false;
  if (requestFailed) return false;
  if (!data || request === "discovery") return true;
  // An outcome request is not a token reload. Keep the already visible machine
  // and its frozen pool mounted even if a background poll expires a route.
  if (request === "draw") return false;
  if (data.pool.length >= 2) return false;
  const chains = selectedChains(data.filters);
  const usableLoading = chains.some((c) => {
    const state = data.coverage.chainSources?.[c];
    return (
      state?.loading &&
      !state.error &&
      (c !== "solana" || !["error", "rate_limited"].includes(data.health.state))
    );
  });
  if (
    !usableLoading &&
    ((chains.includes("solana") &&
      ["error", "rate_limited"].includes(data.health.state)) ||
      chains.every((c) => !!data.coverage.chainSources?.[c]?.error))
  )
    return false;
  if (data.health.state === "starting") return true;
  if (usableLoading) return true;
  return data.rows.some(
    (r) =>
      r.matches &&
      r.admissionReasons.some((reason) =>
        ["security_pending", "reference_pair_pending"].includes(reason),
      ),
  );
}
