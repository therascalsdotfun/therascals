/** Public evidence only. Never serialize a complete execution/config object. */
export type StepArtifact = { title: string; evidence: Record<string, unknown> };
const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 500) : null);
const hash = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{64}$/i.test(v) ? v : null;
export function transactionArtifacts(op: any): Record<string, StepArtifact[]> {
  const result: Record<string, StepArtifact[]> = {
    selection: [],
    checks: [],
    authorize: [],
    sign: [],
    broadcast: [],
    finality: [],
    settlement: [],
  };
  if (!op) return result;
  if (op.draw?.id)
    result.selection.push({
      title: "Frozen draw manifest",
      evidence: {
        operationId: text(op.id),
        drawId: text(op.draw.id),
        session: text(op.draw.session ?? op.session),
        sourceMint: text(op.draw.source_mint ?? op.source?.mint),
        manifestHash: hash(op.draw.manifest_hash),
        configurationHash: hash(op.manifest?.configurationHash),
        eligibleMints: Array.isArray(op.manifest?.pool)
          ? op.manifest.pool.slice(0, 32).map((t: any) => text(t.mint))
          : [],
        selectionPolicy: text(op.draw.selection_policy ?? op.selectionPolicy),
        releaseHash: hash(op.draw.release_hash),
        committedRoll: op.commitment
          ? {
              rollId: text(op.rollId),
              commitment: hash(op.commitment),
              selectedMint: text(op.selectedMint),
              revealedSeed: typeof op.seed === "string" ? op.seed : null,
            }
          : null,
        selectionSeed:
          op.draw.selection_policy === "proximity-v1"
            ? null
            : hash(op.draw.selection_seed),
        amountMode: text(op.amountMode),
        amountAtomic: text(op.amount),
        provenance: op.commitment
          ? "Server-committed roll: the winner is derived from a seed committed before the cage settled, signed by the quote authority and bound to NEAR by the commitment hash. Anyone holding the revealed seed can re-derive the same winner."
          : "NEAR draw + frozen server manifest; selection is not an audited VRF",
      },
    });
  const aid = op.attemptId;
  const checks = op.checkEvidence;
  if (aid && checks?.attemptId === aid)
    result.checks.push({
      title: "Quote & risk checks",
      evidence: {
        attemptId: text(aid),
        checkedAt: text(checks.checkedAt),
        sourceMint: text(checks.sourceMint),
        sourceUpdatedAt: text(checks.sourceUpdatedAt),
        sourceBuyObservedAt: checks.sourceBuyObservedAt ?? null,
        sourceSellObservedAt: checks.sourceSellObservedAt ?? null,
        riskProvider: text(checks.riskProvider),
        riskStatus: text(checks.riskStatus),
        amountAtomic: text(checks.amountAtomic),
        minimumOutputAtomic: text(checks.minimumOutputAtomic),
        observedDevnetSlot: checks.observedDevnetSlot ?? null,
        quoteExpiresMs: text(checks.quoteExpiresMs),
        provenance: "Local provider checks; no separate blockchain transaction",
      },
    });
  if (op.phase === "selection_failed" && !result.checks.length)
    result.checks.push({
      title: "Failed check report",
      evidence: {
        operationId: text(op.id),
        sourceMint: text(op.source?.mint),
        amountAtomic: text(op.amount),
        error: text(op.error),
        recordedAt: text(op.updatedAt),
        signatureRequested: false,
        provenance:
          "Backend check failure. No claim of a valid quote or successful buy.",
      },
    });
  const attempt = op.attempt?.id === aid ? op.attempt : null;
  if (attempt)
    result.authorize.push({
      title: "NEAR policy attempt",
      evidence: {
        attemptId: text(aid),
        status: text(attempt.status),
        session: text(attempt.session),
        drawId: text(attempt.draw),
        amountAtomic: text(attempt.amount),
        minimumOutputAtomic: text(attempt.min_out),
        messageHash: hash(attempt.message_hash),
        signature: text(attempt.signature),
        provenance:
          "Returned NEAR policy attempt; verify against its authorization transaction",
      },
    });
  const verification = op.verification;
  if (
    aid &&
    verification?.attemptId === aid &&
    verification?.signatureVerified === true &&
    verification?.messageMatchesPolicy === true
  )
    result.sign.push({
      title: "Signature verification report",
      evidence: {
        attemptId: text(aid),
        verifiedAt: text(verification.verifiedAt),
        messageHash: hash(verification.messageHash),
        signature: text(verification.signature),
        signer: text(verification.signer),
        signatureVerified: true,
        messageMatchesPolicy: true,
        provenance:
          "Relay verified Ed25519 signature and exact policy bytes locally; verify using the NEAR attempt and Solana signature",
      },
    });
  const broadcast = op.broadcastEvidence;
  if (aid && broadcast?.attemptId === aid)
    result.broadcast.push({
      title: "Broadcast acknowledgement",
      evidence: {
        attemptId: text(aid),
        signature: text(broadcast.signature),
        messageHash: hash(broadcast.messageHash),
        state: text(broadcast.state),
        broadcasts: broadcast.broadcasts ?? null,
        lastBroadcast: broadcast.lastBroadcast ?? null,
        error: text(broadcast.error),
        provenance: "RPC/outbox record; submission is not finality",
      },
    });
  const fill = op.fillEvidence;
  const sig =
    attempt?.signature ??
    (!op.previousAttempts?.length ? op.solanaSignature : null);
  if (fill && sig && fill.signature === sig)
    result.finality.push({
      title: "Finalized token balance changes",
      evidence: {
        signature: text(fill.signature),
        success: fill.success === true,
        slot: fill.slot ?? null,
        inputAtomic: text(fill.input),
        outputAtomic: text(fill.output),
        feeLamports: text(fill.fee),
        evidenceHash: hash(fill.evidenceHash),
        provenance:
          "Finalized Devnet transaction metadata; hash covers the observed signature, slot and metadata",
      },
    });
  if (
    attempt &&
    ["finalized_success", "finalized_failure", "expired"].includes(
      attempt.status,
    )
  )
    result.settlement.push({
      title: "NEAR settlement state",
      evidence: {
        attemptId: text(aid),
        outcome: text(attempt.status),
        messageHash: hash(attempt.message_hash),
        signature: text(attempt.signature),
        provenance:
          "NEAR attempt status; inspect the settlement transaction for the on-chain result",
      },
    });
  return result;
}
