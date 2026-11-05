import { it, expect } from "vitest";
import {
  executionProgress,
  currentSignature,
} from "../apps/web/src/execution-progress.ts";
const op = (phase: string, extra: any = {}) => ({
  id: "op",
  phase,
  mode: "auto",
  nearTransactions: [],
  ...extra,
});
it("marks current phase and places real receipts at their owning steps", () => {
  const p = executionProgress(
    op("confirming", {
      source: { mint: "m" },
      draw: { id: "9" },
      attemptId: "2",
      solanaSignature: "sol-tx",
      nearTransactions: [
        { stage: "draw", hash: "draw-tx" },
        { stage: "authorize buy", hash: "auth-tx" },
      ],
    }),
  );
  expect(p.steps).toHaveLength(7);
  expect(p.steps.map((x) => x.status)).toEqual([
    "complete",
    "complete",
    "complete",
    "complete",
    "complete",
    "current",
    "upcoming",
  ]);
  expect(p.steps[0].receipts[0].hash).toBe("draw-tx");
  expect(p.steps[2].receipts[0].hash).toBe("auth-tx");
  expect(p.steps[4].receipts[0]).toMatchObject({
    hash: "sol-tx",
    network: "solana",
  });
  expect(p.steps[1].receipts).toEqual([]);
  expect(p.steps[6].receipts).toEqual([]);
});
it("shows a confirmation pause and never invents transactions for local checks", () => {
  const p = executionProgress(
    op("awaiting_confirmation", { draw: { id: "9" }, source: { mint: "m" } }),
  );
  expect(p.steps.map((x) => x.status)).toEqual([
    "complete",
    "waiting",
    "upcoming",
    "upcoming",
    "upcoming",
    "upcoming",
    "upcoming",
  ]);
  expect(p.steps.flatMap((x) => x.receipts)).toEqual([]);
});
it("keeps an unknown outcome unresolved rather than implying finality from its signature", () => {
  const p = executionProgress(
    op("unknown", {
      attemptId: "2",
      solanaSignature: "signed-only",
      timeline: [{ phase: "signed", at: 1 }],
    }),
  );
  expect(p.steps[4].status).toBe("unresolved");
  expect(p.steps[5].status).toBe("upcoming");
  expect(p.steps[6].status).toBe("upcoming");
});
it("shows a failed finalized transaction as failed and reconciliation separately", () => {
  const p = executionProgress(
    op("finalized_failure", {
      solanaSignature: "sol-tx",
      nearTransactions: [{ stage: "settlement", hash: "settle-tx" }],
    }),
  );
  expect(p.steps[5].status).toBe("failed");
  expect(p.steps[6].status).toBe("complete");
  expect(p.steps[6].receipts[0].hash).toBe("settle-tx");
  expect(p.headline).not.toContain("success");
});
it("handles exit quoting, signing failure, source failure, expiry and failed draws", () => {
  expect(
    executionProgress(
      op("quoting_exit", { mode: "exit", buy: false, draw: { id: "9" } }),
    ).steps.map((x) => x.status),
  ).toEqual([
    "skipped",
    "current",
    "upcoming",
    "upcoming",
    "upcoming",
    "upcoming",
    "upcoming",
  ]);
  expect(executionProgress(op("signing_failed")).steps[3].status).toBe(
    "failed",
  );
  expect(executionProgress(op("selection_failed")).steps[1].status).toBe(
    "failed",
  );
  expect(
    executionProgress(
      op("expired", {
        nearTransactions: [
          { stage: "expiry reconciliation", hash: "expiry-tx" },
        ],
      }),
    ).steps[6].receipts[0].hash,
  ).toBe("expiry-tx");
  expect(executionProgress(op("failed_near")).steps[0].status).toBe("failed");
});
it("does not reuse a prior signature or completed timeline during retry source checks", () => {
  const o = op("checking_source", {
    previousAttempts: ["1"],
    attemptId: "2",
    attempt: { id: "1", signature: "old" },
    solanaSignature: "old",
    timeline: [
      { phase: "finalized_failure", at: 1 },
      { phase: "checking_source", at: 2 },
    ],
  });
  expect(currentSignature(o)).toBeNull();
  const p = executionProgress(o);
  expect(p.steps[4].receipts).toEqual([]);
  expect(p.steps[1].status).toBe("current");
  expect(p.steps[5].status).toBe("upcoming");
});
it("does not show an old Solana receipt when the matching retry failed before signing", () => {
  const o: any = {
    phase: "signing_failed",
    previousAttempts: ["1"],
    attemptId: "2",
    attempt: { id: "2", status: "signing_failed" },
    solanaSignature: "previous-signed-tx",
  };
  expect(currentSignature(o)).toBeNull();
  expect(executionProgress(o).steps[4].receipts).toEqual([]);
});
it("shows the verified first-attempt signature before relay acknowledgment without implying broadcast completion", () => {
  const o: any = {
    phase: "signed",
    attemptId: "1",
    attempt: { id: "1", signature: "verified-first-signature" },
  };
  expect(currentSignature(o)).toBe("verified-first-signature");
  expect(executionProgress(o).steps[4]).toMatchObject({
    status: "current",
    receipts: [{ hash: "verified-first-signature", network: "solana" }],
  });
});
it("keeps untagged retry authorization and settlement receipts in history rather than current steps", () => {
  const p = executionProgress({
    phase: "checking_source",
    previousAttempts: ["1"],
    nearTransactions: [
      { stage: "draw", hash: "original-draw" },
      { stage: "authorize buy", hash: "old-authorization" },
      { stage: "settlement", hash: "old-settlement" },
    ],
  });
  expect(p.steps[0].receipts[0].hash).toBe("original-draw");
  expect(p.steps[2].receipts).toEqual([]);
  expect(p.steps[6].receipts).toEqual([]);
  expect(p.historyReceipts.map((x) => x.hash)).toEqual([
    "old-authorization",
    "old-settlement",
  ]);
});
