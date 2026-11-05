import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
import { tokenKey } from "../../../../packages/shared/src/token-selection.ts";
/** Discovery ranking changes must not reset an unchanged physical population. */
export function scenePopulation(tokens: TokenObservation[]) {
  return tokens
    .slice(0, 32)
    .sort((a, b) => tokenKey(a).localeCompare(tokenKey(b)));
}
