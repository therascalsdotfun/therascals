import type { WalletKind } from "../../../../packages/shared/src/wallet-auth.ts";
/** Single active connector; the existing WalletLifecycle guards late async responses. */
export class ExclusiveWallet {
  current: WalletKind | null;
  constructor(remembered: WalletKind[] = []) {
    this.current = remembered.at(-1) ?? null;
  }
  select(kind: WalletKind) {
    this.current = kind;
  }
  accepts(kind: WalletKind) {
    return this.current === kind;
  }
  clear(kind: WalletKind) {
    if (this.current === kind) {
      this.current = null;
    }
  }
}
