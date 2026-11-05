export type StepStatus =
  | "upcoming"
  | "current"
  | "complete"
  | "waiting"
  | "failed"
  | "unresolved"
  | "skipped";
export type ExecutionReceipt = {
  hash: string;
  network: "near" | "solana";
  label: string;
};
export type ProgressStep = {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
  receipts: ExecutionReceipt[];
};
export type ProgressOperation = {
  id?: string;
  phase: string;
  mode?: string;
  buy?: boolean;
  draw?: { id?: string };
  source?: unknown;
  attemptId?: string;
  attempt?: { id?: string; signature?: string };
  solanaSignature?: string;
  previousAttempts?: string[];
  nearTransactions?: { stage: string; hash: string }[];
  timeline?: { phase: string; at: number }[];
};
const rank: Record<string, number> = {
  drawing: 0,
  selected: 1,
  checking_source: 1,
  quoting_exit: 1,
  awaiting_confirmation: 1,
  authorizing: 2,
  signing: 3,
  signed: 4,
  submitted: 5,
  confirming: 5,
  settling: 6,
};
export function currentSignature(op: ProgressOperation): string | null {
  if (op.previousAttempts?.length) {
    if (
      [
        "selected",
        "checking_source",
        "quoting_exit",
        "authorizing",
        "signing",
        "awaiting_confirmation",
        "selection_failed",
        "failed_near",
      ].includes(op.phase)
    )
      return null;
    if (!op.attemptId || op.attempt?.id !== op.attemptId) return null;
    return op.attempt.signature ?? null;
  }
  if (op.attemptId && op.attempt?.id === op.attemptId)
    return op.attempt.signature ?? op.solanaSignature ?? null;
  return op.solanaSignature ?? null;
}
export function executionProgress(op: ProgressOperation) {
  const exit = op.mode === "exit" || op.buy === false;
  const definitions = [
    [
      "selection",
      exit ? "Reuse the selected source" : "Select a coin on NEAR",
      exit
        ? "Uses your position’s existing draw. No new selection transaction."
        : "Freeze the eligible tickers and record the chosen source on NEAR testnet.",
    ],
    [
      "checks",
      exit ? "Check the exit quote" : "Check routes & quote",
      exit
        ? "Read the Devnet pool and calculate the minimum output."
        : "Recheck this source’s routes and obtain the mapped Devnet quote.",
    ],
    [
      "authorize",
      exit ? "Authorize the exit on NEAR" : "Authorize the buy on NEAR",
      "The policy checks the exact asset, amount, recipient and output floor.",
    ],
    [
      "sign",
      "MPC signature & verification",
      "NEAR requests the MPC signature; the relay verifies the exact signed message.",
    ],
    [
      "broadcast",
      "Submit to Solana Devnet",
      "Relay the verified transaction. A signature is not confirmation.",
    ],
    [
      "finality",
      "Wait for Solana finality",
      "Observe the actual finalized outcome and token changes.",
    ],
    [
      "settlement",
      "Record the outcome on NEAR",
      "Settle the finalized result on NEAR and refresh the test portfolio.",
    ],
  ];
  const steps: ProgressStep[] = definitions.map(([id, title, detail]) => ({
    id,
    title,
    detail,
    status: "upcoming",
    receipts: [],
  }));
  let at = rank[op.phase] ?? 0;
  if (op.phase === "unknown") {
    const history = op.timeline ?? [];
    let start = 0;
    history.forEach((x, i) => {
      if (x.phase === "checking_source" || x.phase === "quoting_exit")
        start = i;
    });
    const observed = history
      .slice(start)
      .map((x) => rank[x.phase])
      .filter((x) => x !== undefined);
    at = observed.length
      ? Math.max(...observed)
      : currentSignature(op)
        ? 4
        : op.attemptId
          ? 2
          : op.draw
            ? 1
            : 0;
  }
  const failedAt =
    op.phase === "selection_failed"
      ? 1
      : op.phase === "signing_failed"
        ? 3
        : op.phase === "failed_near"
          ? op.draw
            ? 2
            : 0
          : op.phase === "expired"
            ? 5
            : op.phase === "finalized_failure"
              ? 5
              : null;
  if (failedAt !== null) at = failedAt;
  if (op.phase === "finalized_success") at = 7;
  for (let i = 0; i < steps.length; i++)
    steps[i].status = i < at ? "complete" : i === at ? "current" : "upcoming";
  if (op.phase === "unknown") {
    steps[at].status = "unresolved";
    steps[at].detail =
      "The outcome is not established. Waiting for reconciliation; no new trade is assumed.";
  }
  if (op.phase === "awaiting_confirmation") {
    steps[1].status = "waiting";
    steps[1].detail =
      "Coin selected. Waiting for your confirmation before quoting and authorizing.";
  }
  if (failedAt !== null) steps[failedAt].status = "failed";
  if (op.phase === "finalized_failure" || op.phase === "expired")
    steps[6].status = "complete";
  if (op.phase === "expired") {
    steps[5].detail =
      "Expiry was reconciled without a finalized fill. This is not a successful trade.";
    steps[4].status = "unresolved";
    steps[4].detail =
      "The issued transaction did not produce a finalized fill; broadcast acknowledgement is not established here.";
  }
  if (exit) steps[0].status = "skipped";
  const near = (op.nearTransactions ?? []).filter((t) => !!t.hash);
  const historyReceipts: ExecutionReceipt[] = [];
  for (const t of near) {
    if (op.previousAttempts?.length && t.stage !== "draw") {
      historyReceipts.push({
        hash: t.hash,
        network: "near",
        label: "Recorded NEAR " + t.stage,
      });
      continue;
    }
    const index =
      t.stage === "draw"
        ? 0
        : t.stage.startsWith("authorize ")
          ? 2
          : ["settlement", "expiry reconciliation"].includes(t.stage)
            ? 6
            : -1;
    if (index === 2)
      steps[3].receipts.push({
        hash: t.hash,
        network: "near",
        label: "MPC request · authorization transaction",
      });
    if (index >= 0)
      steps[index].receipts.push({
        hash: t.hash,
        network: "near",
        label: "NEAR " + t.stage,
      });
  }
  const sig = currentSignature(op);
  if (sig) {
    const receipt = {
      hash: sig,
      network: "solana" as const,
      label: "Solana Devnet transaction",
    };
    steps[4].receipts.push(receipt);
    if (steps[5].status !== "upcoming")
      steps[5].receipts.push({
        ...receipt,
        label:
          op.phase === "finalized_success" ||
          op.phase === "finalized_failure" ||
          op.phase === "settling"
            ? "Finalized Devnet transaction"
            : "Check Devnet status",
      });
  }
  const headlines: Record<string, string> = {
    drawing: "Choosing your coin",
    selected: "Coin selected",
    checking_source: "Checking the selected source",
    quoting_exit: "Checking your exit quote",
    authorizing: "Waiting for NEAR authorization",
    signing: "Waiting for the MPC signature",
    signed: "Signature verified · preparing relay",
    submitted: "Submitted · waiting for confirmation",
    confirming: "Waiting for finality",
    settling: "Recording the finalized outcome",
    awaiting_confirmation: "Your coin is ready · confirm to continue",
    selection_failed: "Route or quote check failed",
    signing_failed: "MPC signing failed",
    failed_near: "NEAR request rejected",
    unknown: "Outcome unresolved · reconciliation in progress",
    expired: "Attempt expired · no finalized fill",
    finalized_failure: "Transaction finalized with a failure",
    finalized_success: exit
      ? "Exit finalized and recorded"
      : "Test buy finalized and recorded",
  };
  return {
    steps,
    headline: headlines[op.phase] ?? "Execution state unavailable",
    current: steps.findIndex((s) =>
      ["current", "waiting", "failed", "unresolved"].includes(s.status),
    ),
    history: !!op.previousAttempts?.length,
    historyReceipts,
  };
}
