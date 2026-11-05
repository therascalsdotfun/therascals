import { createHash } from "node:crypto";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import { AuthError } from "../auth/service.ts";
import { MarketStore } from "../market/store.ts";
import type { BetaClaimPolicy } from "../http/runtime.ts";
export function subjectFor(identity: WalletIdentity) {
  return createHash("sha256")
    .update(
      identity.kind +
        ":" +
        (identity.kind === "metamask"
          ? identity.address.toLowerCase()
          : identity.address),
    )
    .digest("hex");
}

/**
 * Groups an address the way rate limiters should: one subscriber, one budget.
 * IPv4 collapses to its /24 and IPv6 to its /64, so rotating within a home or
 * carrier prefix does not buy a sybil more claims. Anything that is not a
 * parsable address gets its own bucket rather than sharing one.
 */
export function claimNetwork(address: string | null | undefined): string {
  if (!address) return "unknown";
  const text = address.trim(),
    v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4 && v4.slice(1, 5).every((part) => Number(part) <= 255))
    return `v4:${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(text);
  if (mapped) return claimNetwork(mapped[1]);
  if (!text.includes(":")) return `other:${text.toLowerCase()}`;
  const hex = /^[0-9a-f]{1,4}$/;
  // Compression fills the gap, so an address with "::" may carry fewer groups.
  const lower = text.toLowerCase(),
    compressed = lower.split("::");
  if (compressed.length > 2) return `other:${lower}`;
  const head = compressed[0] ? compressed[0].split(":") : [],
    tail =
      compressed.length === 2 && compressed[1] ? compressed[1].split(":") : [],
    groups = [
      ...head,
      ...Array(8 - head.length - tail.length).fill("0"),
      ...tail,
    ];
  if (
    head.concat(tail).some((group) => !hex.test(group)) ||
    (compressed.length === 1
      ? head.length !== 8
      : head.length + tail.length > 7)
  )
    return `other:${lower}`;
  return `v6:${groups
    .slice(0, 4)
    .map((g) => g.padStart(4, "0"))
    .join(":")}/64`;
}
export class BetaAccess {
  private allowlist: string[] | null;
  constructor(
    private store: MarketStore,
    private slots: string[],
    private now = Date.now,
    private policy: BetaClaimPolicy = {
      allowlist: null,
      perNetworkPerDay: 2,
    },
  ) {
    // NEAR accounts are lowercase and EVM addresses are checksummed, so matching
    // an operator's list must not depend on how they typed it.
    this.allowlist = policy.allowlist
      ? policy.allowlist.map((entry) => entry.trim().toLowerCase())
      : null;
  }
  owner(slot: string) {
    const record = this.store.getRecord<
      string | { subject: string; claimedAt: number }
    >("beta-owner:" + slot);
    return typeof record === "string"
      ? { subject: record, claimedAt: 0 }
      : record;
  }
  slot(identity: WalletIdentity) {
    const subject = subjectFor(identity);
    return (
      this.slots.find((slot) => this.owner(slot)?.subject === subject) ?? null
    );
  }
  available() {
    return this.slots.filter(
      (slot) => !this.store.getRecord("beta-owner:" + slot),
    ).length;
  }
  claim(identity: WalletIdentity, origin?: string | null) {
    // An owner who already holds a slot always gets it back: none of these
    // guards may strand a funded test account.
    const owned = this.slot(identity);
    if (owned) return owned;
    this.requireClaimable(identity, origin ?? null);
    const subject = subjectFor(identity);
    for (const slot of this.slots) {
      if (
        this.store.putRecordIfAbsent("beta-owner:" + slot, {
          subject,
          claimedAt: this.now(),
        })
      )
        return slot;
    }
    throw new AuthError(
      "BETA_FULL",
      "The testnet beta is full. All sponsored slots are claimed. Discovery, previews and wallet balances are still available.",
      409,
    );
  }

  /**
   * Slots are free to claim and each one costs the sponsor a daily activation,
   * so a scripted wallet farm is the whole threat. Signatures are not a
   * barrier, therefore the barrier is allocation policy: an optional invite
   * list, and a per-network daily claim budget that survives restarts.
   */
  private requireClaimable(identity: WalletIdentity, origin: string | null) {
    const { perNetworkPerDay } = this.policy;
    if (
      this.allowlist &&
      !this.allowlist.includes(identity.address.toLowerCase())
    )
      throw new AuthError(
        "BETA_INVITE_ONLY",
        "This beta only gives slots to invited wallets. Free previews, discovery and your own wallet-funded trading are still available.",
        403,
      );
    if (perNetworkPerDay <= 0)
      throw new AuthError(
        "BETA_CLAIMS_CLOSED",
        "New sponsored slot claims are paused. Free previews stay available.",
        429,
      );
    const network = claimNetwork(origin);
    // An unattributed claim has no network to budget against. Only a transport
    // that reports no peer address gets here, so charging a shared bucket would
    // rate-limit unrelated clients as if they were one sybil farm.
    if (network === "unknown") return;
    const day = new Date(this.now()).toISOString().slice(0, 10),
      key = `beta-claims:${network}:${day}`,
      used = this.store.getRecord<{ count: number }>(key)?.count ?? 0;
    if (used >= perNetworkPerDay)
      throw new AuthError(
        "BETA_CLAIM_LIMIT",
        "This network has claimed its daily share of sponsored slots. Try again tomorrow; free previews stay available.",
        429,
      );
    this.store.putRecord(key, { count: used + 1 });
  }

  inviteOnly() {
    return !!this.allowlist;
  }
  reserveActivation(identity: WalletIdentity) {
    const slot = this.slot(identity);
    if (!slot)
      throw new AuthError("CLAIM_REQUIRED", "Claim a testnet slot first.", 403);
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (
      !this.store.putRecordIfAbsent("beta-funding:" + slot + ":" + day, {
        reservedAt: this.now(),
      })
    )
      throw new AuthError(
        "DAILY_FUNDING_LIMIT",
        "Daily sponsored activation has been used or is awaiting reconciliation. Your existing positions, exits and recovery remain available.",
        429,
      );
  }
}
