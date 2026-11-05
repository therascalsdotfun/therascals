// Regression: E2E-003 — finalized buy was published before its portfolio balance.
// Found by /qa on 2026-10-27
// Report: docs/end-to-end-journey.md
import { it, expect, vi } from "vitest";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
it("keeps settlement pending until the portfolio state has refreshed", async () => {
  const store = new MarketStore(":memory:"),
    e: any = new ExecutionService(store, {} as any);
  let release!: () => void;
  const sync = new Promise<void>((r) => (release = r));
  e.op = { id: "op", phase: "confirming", nearTransactions: [] };
  e.box.read = () => ({});
  e.rpc = {
    getSignatureStatuses: async () => ({
      value: [{ confirmationStatus: "finalized" }],
    }),
  };
  e.readFill = async () => ({
    success: true,
    input: "5",
    output: "100",
    fee: "0",
    evidenceHash: "hash",
  });
  e.settler = {
    callFunctionRaw: async () => ({ transaction: { hash: "settlement" } }),
  };
  e.config = { contractId: "policy.testnet" };
  e.provider = {
    query: vi.fn(async () => ({
      result: Array.from(
        Buffer.from(
          JSON.stringify({
            id: "1",
            status: "finalized_success",
            protocol_fee: { collected: true },
          }),
        ),
      ),
    })),
  };
  e.captureFill = async () => {};
  e.refresh = vi.fn(async () => await sync);
  e.refreshBalances = async () => {};
  const work = e.reconcile({
    id: "1",
    status: "signed",
    signature: "tx",
    last_valid: 1,
  });
  try {
    await vi.waitFor(() => expect(e.refresh).toHaveBeenCalled());
    expect(e.op.phase).toBe("settling");
  } finally {
    release();
    await work;
    store.close();
  }
  expect(e.op.phase).toBe("finalized_success");
  expect(e.op.attempt.protocol_fee.collected).toBe(true);
  expect(e.provider.query).toHaveBeenCalledWith(
    expect.objectContaining({ method_name: "get_attempt" }),
  );
});
