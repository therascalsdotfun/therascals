import {
  sameWallet,
  type WalletIdentity,
} from "../../../../packages/shared/src/wallet-auth.ts";
export function responseMatchesWallet(
  response: { viewer?: { identity: WalletIdentity | null } },
  expected: WalletIdentity | null,
) {
  if (!response.viewer) return true; // Local operator mode has no private viewer context.
  return expected
    ? sameWallet(expected, response.viewer.identity)
    : response.viewer.identity === null;
}
