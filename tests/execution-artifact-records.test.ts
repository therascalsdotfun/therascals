import { expect, it } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
import { transactionArtifacts } from "../apps/web/src/transaction-artifacts.ts";
it("persists finalized evidence in the operation and restores it from an existing receipt", async () => {
  const store = new MarketStore(":memory:"),
    service: any = new ExecutionService(store, {} as any);
  const fill = {
    success: true,
    slot: 123,
    input: "5000000",
    output: "1000",
    fee: "5000",
    evidenceHash: "a".repeat(64),
  };
  service.op = {
    id: "op",
    attemptId: "2",
    phase: "settling",
    source: { mint: "SOURCE" },
    nearTransactions: [],
  };
  service.positions = () => [];
  const attempt = {
    id: "2",
    session: "1",
    draw: "3",
    market_index: 0,
    signature: "sig",
    buy: true,
  };
  try {
    await service.captureFill(attempt, fill);
    expect(service.op.fillEvidence).toEqual({ ...fill, signature: "sig" });
    expect(store.getRecord<any>("fill:sig").evidenceHash).toBe(
      fill.evidenceHash,
    );
    delete service.op.fillEvidence;
    await service.captureFill(attempt);
    expect(service.op.fillEvidence).toEqual({ ...fill, signature: "sig" });
    const proof = transactionArtifacts({
      ...service.op,
      attempt: { ...attempt },
      solanaSignature: "sig",
    });
    expect(proof.finality[0].evidence.outputAtomic).toBe("1000");
  } finally {
    store.close();
  }
});
it("a failed source check has an inspectable failure report, never a fake transaction", () => {
  const proof = transactionArtifacts({
    id: "op",
    phase: "selection_failed",
    source: { mint: "SOURCE" },
    error: "Provider data expired",
    amount: "5000000",
  });
  expect(proof.checks[0].title).toBe("Failed check report");
  expect(proof.checks[0].evidence.signatureRequested).toBe(false);
  expect(proof.checks[0].evidence.error).toBe("Provider data expired");
  expect(proof.sign).toEqual([]);
  expect(proof.broadcast).toEqual([]);
});
it("legacy snapshots expose a matching recorded fill without fabricating missing verification", () => {
  const store = new MarketStore(":memory:"),
    service: any = new ExecutionService(store, {
      ticketSize: () => "5000000",
    } as any);
  service.verified = () => false;
  service.positions = () => [];
  service.op = {
    id: "old",
    phase: "finalized_success",
    session: "1",
    draw: { id: "3" },
    marketIndex: 0,
    solanaSignature: "sig",
  };
  const fill = {
    session: "1",
    drawId: "3",
    marketIndex: 0,
    signature: "sig",
    success: true,
    slot: 123,
    input: "5",
    output: "1000",
    fee: "5000",
    evidenceHash: "a".repeat(64),
  };
  try {
    store.putRecord("fill:sig", fill);
    expect(service.snapshot().operation.fillEvidence.output).toBe("1000");
    expect(service.snapshot().operation.verification).toBeUndefined();
    expect(service.op.fillEvidence).toBeUndefined();
    store.putRecord("fill:sig", { ...fill, session: "other" });
    expect(service.snapshot().operation.fillEvidence).toBeUndefined();
  } finally {
    store.close();
  }
});
