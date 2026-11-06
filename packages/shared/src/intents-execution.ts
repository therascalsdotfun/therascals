import type { IntentsAsset } from "./intents.ts";
export type IntentsSwapPhase =
  | "prepared"
  | "awaiting_wallet"
  | "deposit_submitted"
  | "processing"
  | "success"
  | "refunded"
  | "needs_attention"
  | "unknown"
  | "funding_failed";
export type IntentsSwapOperation = {
  id: string;
  owner: string;
  requestId: string;
  /** Missing on historical public quotes. */
  confidentiality?: "public" | "basic";
  createdAt: string;
  origin: IntentsAsset;
  destination: IntentsAsset;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  recipient: string;
  refundTo: string;
  depositAddress: string;
  fundBefore: string;
  refundDeadline: string;
  quoteHash: string;
  quoteResponse: any;
  appFeeBps: number;
  phase: IntentsSwapPhase;
  providerStatus: string;
  fundingRequestedAt?: string;
  fundingSignature?: string;
  nearCandidateHash?: string;
  fundingChainStatus?: string;
  presetId?: string;
  swapDetails?: any;
  error?: string;
};
export function intentsPhase(status: string): IntentsSwapPhase {
  if (status === "SUCCESS") return "success";
  if (status === "REFUNDED") return "refunded";
  if (status === "FAILED") return "needs_attention";
  if (status === "INCOMPLETE_DEPOSIT") return "needs_attention";
  if (status === "PROCESSING") return "processing";
  if (status === "KNOWN_DEPOSIT_TX") return "deposit_submitted";
  return status === "PENDING_DEPOSIT" ? "prepared" : "unknown";
}

// Funding ownership survives provider status changes and quote expiry. Only a
// terminal settlement or a proven source failure releases a claimed attempt.
export function intentsFundingPending(op: IntentsSwapOperation): boolean {
  return (
    !["success", "refunded", "funding_failed"].includes(op.phase) &&
    !!(
      op.fundingRequestedAt ||
      op.fundingSignature ||
      op.nearCandidateHash ||
      op.phase === "awaiting_wallet" ||
      op.phase === "deposit_submitted" ||
      op.phase === "processing" ||
      op.providerStatus === "INCOMPLETE_DEPOSIT"
    )
  );
}
