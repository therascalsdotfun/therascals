export type WalletKind = "near" | "metamask" | "phantom";
export type WalletIdentity = {
  kind: WalletKind;
  address: string;
  chainId?: string;
  expiresAt: string;
};
export type AuthChallenge = {
  id: string;
  kind: WalletKind;
  address: string;
  chainId?: string;
  message: string;
  nonce: string;
  recipient: string;
  expiresAt: string;
};
export type WalletProof = { id: string; signature: string; publicKey?: string };
export function sameWallet(
  a: Pick<WalletIdentity, "kind" | "address" | "chainId"> | null | undefined,
  b: Pick<WalletIdentity, "kind" | "address" | "chainId"> | null | undefined,
) {
  if (!a || !b || a.kind !== b.kind) return false;
  return (
    (a.kind === "metamask"
      ? a.address.toLowerCase() === b.address.toLowerCase()
      : a.address === b.address) &&
    (a.chainId?.toLowerCase() ?? "") === (b.chainId?.toLowerCase() ?? "")
  );
}
