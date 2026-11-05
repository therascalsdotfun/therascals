// Regression: E2E-002 — slow NEAR reads age the source check before authorization.
// Found by /qa on 2026-10-27
// Report: docs/end-to-end-journey.md
import { it, expect, vi } from "vitest";
vi.mock("../apps/server/src/execution/cpmm.ts", () => ({
  verifyAndQuote: async () => ({ minOut: 1n, slot: 1 }),
}));
vi.mock("../apps/server/src/execution/policy-wire.ts", () => ({
  quoteBytes: () => Buffer.alloc(1),
}));
import { ExecutionService } from "../apps/server/src/execution/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
it.each([false, true])(
  "refreshes the session before acquiring source evidence, still rejecting stale data: %s",
  async (stale) => {
    let clock = Date.now(),
      calls = 0;
    const date = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const store = new MarketStore(":memory:"),
      e: any = new ExecutionService(store, {
        revalidateSelected: async () => ({
          token: {
            sourceUpdatedAt: new Date(
              clock - (stale ? 20000 : 0),
            ).toISOString(),
          },
          pair: { buy: { observedAt: clock }, sell: { observedAt: clock } },
        }),
      } as any);
    e.op = {
      id: "op",
      session: "1",
      source: { mint: "same-source" },
      amount: "5000000",
      marketIndex: 0,
      manifest: { filters: {} },
      draw: { id: "1" },
      nearTransactions: [],
    };
    e.refresh = async () => {
      clock += 20000;
      e.chain = {
        session: { id: "1", pending: null },
        next_attempt: "2",
        mapping_hash: "hash",
      };
    };
    e.config = { contractId: "policy.testnet", markets: [{}] };
    e.rpc = {
      getLatestBlockhash: async () => ({
        blockhash: "hash",
        lastValidBlockHeight: 1,
      }),
    };
    e.privateConfig = { quoteSecret: Array(64).fill(1) };
    e.scoped = {
      callFunctionRaw: async () => {
        calls++;
        throw { transactionResult: { status: { Failure: {} } } };
      },
    };
    try {
      await e.authorize(true);
      expect(calls).toBe(stale ? 0 : 1);
    } finally {
      date.mockRestore();
      store.close();
    }
  },
);
