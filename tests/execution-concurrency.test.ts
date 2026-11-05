import { it, expect } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
import { commitRoll, settleRoll } from "../apps/server/src/routes/manifest.ts";
it("accepts only one concurrent user draw while NEAR readiness is awaited", async () => {
  const store = new MarketStore(":memory:"),
    field = {
      configurationHash: "a".repeat(64),
      pool: [{ mint: "A" }, { mint: "B" }],
      filters: {},
      ticketAtomic: "5000000",
      now: new Date().toISOString(),
    } as any,
    committed = commitRoll(field, field.configurationHash, "fixed"),
    market: any = {
      ticketSize: () => "5000000",
      snapshot: () => field,
      settleForExecution: () => ({
        roll: committed,
        snapshot: field,
        preview: settleRoll(field, committed),
      }),
    },
    service: any = new ExecutionService(store, market);
  let release!: () => void, finish!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    inflight = new Promise<void>((r) => (finish = r));
  service.verified = () => true;
  service.refresh = async () => {
    await gate;
    service.chain = {
      next_draw: "1",
      selection_modes: ["proximity-v1"],
      session: {
        id: "1",
        issued: "0",
        expires_ms: String(Date.now() + 60000),
        revoked: false,
        pending: null,
      },
    };
  };
  service.runDraw = () => inflight;
  const a = service.draw(committed.id, "auto"),
    b = service.draw(committed.id, "auto");
  release();
  const results = await Promise.allSettled([a, b]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  finish();
  await Promise.resolve();
  store.close();
});
