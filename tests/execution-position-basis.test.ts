import { expect, it } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
it("retains proportional acquisition cost after a partial exit and a later buy", () => {
  const store = new MarketStore(":memory:");
  try {
    const service: any = new ExecutionService(store, {} as any);
    service.config = { markets: [{ mintToken: "controlled-test-mint" }] };
    service.chain = {
      session: { id: "1", issued: "30000000", balances: ["125"] },
    };
    const base = {
      session: "1",
      marketIndex: 0,
      success: true,
      source: { mint: "source" },
      drawId: "1",
    };
    for (const [i, f] of [
      { buy: true, input: "20000000", output: "100" },
      { buy: false, input: "25", output: "9000000" },
      { buy: true, input: "10000000", output: "50" },
    ].entries())
      store.putRecord("fill:" + i, { ...base, ...f, slot: i + 1 });
    expect(service.snapshot().positions[0]).toMatchObject({
      quantityAtomic: "125",
      costAtomic: "25000000",
    });
    service.chain.session.balances = ["126"];
    expect(service.snapshot().positions[0].costAtomic).toBeNull();
  } finally {
    store.close();
  }
});
it("bounds partial exits to the reconciled balance before authorizing a transaction", async () => {
  const store = new MarketStore(":memory:");
  try {
    const service: any = new ExecutionService(store, {} as any);
    service.refresh = async () => {};
    service.chain = {
      session: { id: "1", issued: "5000000", pending: null, balances: ["100"] },
    };
    service.positions = () => [
      { marketIndex: 0, drawId: "1", quantityAtomic: "100", sources: [] },
    ];
    let authorized = 0;
    service.authorize = async () => {
      authorized++;
    };
    service.provider = {
      query: async () => ({
        result: Array.from(
          Buffer.from(JSON.stringify({ id: "1", source_mint: "source" })),
        ),
      }),
    };
    service.config = { contractId: "policy.testnet" };
    for (const invalid of ["0", "101", "-1", "1.5", "1e2", "01"])
      await expect(service.exit(0, invalid)).rejects.toThrow(
        "within the reconciled",
      );
    expect(authorized).toBe(0);
    expect(service.op).toBeNull();
    await service.exit(0, "25");
    expect(service.op.amount).toBe("25");
    expect(service.op.buy).toBe(false);
    expect(authorized).toBe(1);
  } finally {
    store.close();
  }
});
