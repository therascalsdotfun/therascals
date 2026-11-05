import {
  newRollSeed,
  rollCommitment,
  rollScalar,
  rollWinner,
} from "./roll-commit.ts";
import { tokenKey } from "../../../../packages/shared/src/token-selection.ts";
import type { MarketResponse } from "../../../../packages/shared/src/market.ts";
import { createHash, randomUUID } from "node:crypto";
import { UserError } from "../client-message.ts";
import {
  DEGEN_ODDS_VERSION,
  degenAmountForRoll,
} from "../../../../packages/shared/src/degen-amount.ts";
/**
 * A roll freezes the field and commits to a winner before anyone, including the
 * operator, learns it. The client animation follows the committed winner rather
 * than deciding it, which is what made the old browser-physics release forgeable.
 */
/** Matches the frozen-pool window so a committed field cannot outlive its freshness. */
export const ROLL_TTL_MS = 120_000;
export type RollAmountMode = "fixed" | "full_degen";
export type CommittedRoll = {
  id: string;
  scope: string;
  seed: string;
  commitment: string;
  configurationHash: string;
  poolKeys: string[];
  amountMode: RollAmountMode;
  createdAt: number;
  expiresAt: number;
};
function poolKeysOf(snapshot: MarketResponse) {
  return snapshot.pool.map(tokenKey);
}
/** Freeze the field and publish only the commitment. */
export function commitRoll(
  snapshot: MarketResponse,
  expected: string,
  amountMode: RollAmountMode = "fixed",
  scope = "operator",
): CommittedRoll {
  if (snapshot.configurationHash !== expected)
    throw new UserError("Filters or ticket changed. Refresh before drawing.");
  const keys = poolKeysOf(snapshot);
  if (keys.length < 2 || keys.length > 32)
    throw new UserError("At least two fresh, screened tokens are required");
  if (new Set(keys).size !== keys.length)
    throw new UserError("The accessible pool changed. Refresh before drawing.");
  const seed = newRollSeed(),
    now = Date.now();
  return {
    id: "roll-" + randomUUID(),
    scope,
    seed,
    commitment: rollCommitment(seed, expected, keys),
    configurationHash: expected,
    poolKeys: keys,
    amountMode,
    createdAt: now,
    expiresAt: now + ROLL_TTL_MS,
  };
}
/**
 * Re-derive the winner for a committed roll against a freshly checked snapshot.
 * Pure, so a preview shown to a user and the buy executed later can never
 * disagree, and either can be re-verified from the seed.
 */
export function settleRoll(
  snapshot: MarketResponse,
  roll: CommittedRoll,
): {
  id: string;
  seed: string;
  commitment: string;
  manifest: Record<string, unknown>;
  hash: string;
  ticketAtomic: string;
  amountMode: RollAmountMode;
  pool: MarketResponse["pool"];
  selected: MarketResponse["pool"][number];
  purchaseMade: false;
  selection: string;
} {
  if (snapshot.configurationHash !== roll.configurationHash)
    throw new UserError("Filters or ticket changed. Refresh before drawing.");
  const keys = poolKeysOf(snapshot);
  if (
    keys.length !== roll.poolKeys.length ||
    keys.some((key, index) => key !== roll.poolKeys[index])
  )
    throw new UserError("The accessible pool changed. Refresh before drawing.");
  const chosen = keys.indexOf(
    rollWinner(roll.seed, roll.configurationHash, roll.poolKeys),
  );
  if (chosen < 0) throw new UserError("Invalid selection");
  const pool = structuredClone(snapshot.pool);
  const ticketAtomic =
    roll.amountMode === "full_degen"
      ? String(
          degenAmountForRoll(
            rollScalar(
              roll.seed,
              roll.configurationHash,
              roll.poolKeys,
              "degen-amount",
              10000,
            ),
          ) * 1e6,
        )
      : snapshot.ticketAtomic;
  // Only a fixed draw carries its commitment to the contract; Full degen is
  // drawn on-chain, so its label must not imply a server-attested outcome.
  const committed = roll.amountMode !== "full_degen";
  const manifest = {
    version: 1,
    selectionPolicy: committed ? "committed-roll-v1" : "contract-drawn-v1",
    rollId: roll.id,
    commitment: roll.commitment,
    source: snapshot.filters?.chains?.some((chain) => chain !== "solana")
      ? "mixed-mainnet-preview"
      : "solana-mainnet",
    chains: [...(snapshot.filters?.chains ?? ["solana"])],
    selectedChain: pool[chosen].chain ?? "solana",
    ticketAtomic,
    amountMode: roll.amountMode,
    amountOddsVersion:
      roll.amountMode === "full_degen" ? DEGEN_ODDS_VERSION : null,
    eligibilityTicketAtomic: snapshot.ticketAtomic,
    configurationHash: roll.configurationHash,
    createdAt: snapshot.now,
    mints: keys,
  };
  return {
    id: roll.id,
    seed: roll.seed,
    commitment: roll.commitment,
    manifest,
    hash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    ticketAtomic,
    amountMode: roll.amountMode,
    pool,
    selected: pool[chosen],
    purchaseMade: false,
    selection: committed
      ? "Server-committed roll, re-derived from the seed; the browser cage animates to it."
      : "Preview only. The contract draws Full degen, so its token and amount land when the draw confirms.",
  };
}
/** What may leave the server before the winner is revealed. */
export function committedView(roll: CommittedRoll, snapshot: MarketResponse) {
  return {
    id: roll.id,
    commitment: roll.commitment,
    configurationHash: roll.configurationHash,
    amountMode: roll.amountMode,
    ticketAtomic: snapshot.ticketAtomic,
    pool: structuredClone(snapshot.pool),
    createdAt: new Date(roll.createdAt).toISOString(),
    expiresAt: new Date(roll.expiresAt).toISOString(),
  };
}
