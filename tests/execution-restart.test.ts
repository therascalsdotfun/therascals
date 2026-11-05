import { it, expect } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
import { degenAmountFromSeed } from "../apps/server/src/execution/policy-wire.ts";
import { DEGEN_ODDS_VERSION } from "../packages/shared/src/degen-amount.ts";

/** A recovered op mid-draw, driven through the same tick a restart would run. */
async function recovered(op: Record<string, unknown>) {
  const store = new MarketStore(":memory:");
  const service: any = new ExecutionService(store, {} as any);
  service.config = { contractId: "policy.testnet" };
  service.refresh = async () => {
    service.chain = { next_draw: "2", session: { pending: null } };
  };
  service.refreshBalances = async () => {};
  service.authorize = async () => {
    throw new Error("Must not automatically authorize");
  };
  service.op = { id: "recovered", phase: "unknown", expectedDraw: "1", ...op };
  await service.tick();
  store.close();
  return service.op;
}

it("does not demand a proximity receipt from a Full degen draw", async () => {
  // The contract draws Full degen itself, so its receipt is never commitment-
  // attested; keying the check on a held commitment broke every degen recovery.
  const seed = "00".repeat(32),
    amount = degenAmountFromSeed(seed),
    op = await recovered({
      mode: "auto",
      amountMode: "full_degen",
      committed: false,
      commitment: "roll-commitment-still-held",
      selectedMint: null,
      amount: null,
      draw: {
        id: "1",
        source_mint: "A",
        market_index: 0,
        selection_policy: "random-v1",
        release_hash: null,
        selection_seed: seed,
        amount_mode: "full_degen",
        amount_odds_version: DEGEN_ODDS_VERSION,
        amount,
      },
      manifest: { pool: [{ mint: "A", symbol: "A" }] },
    });
  expect(op.error ?? "").not.toMatch(/committed roll/);
  expect(op.phase).toBe("awaiting_confirmation");
  expect(op.amount).toBe(amount);
});

it.each([
  {
    label: "a release hash that is not the commitment",
    release: "not-the-commitment",
    source: "A",
  },
  {
    label: "a source the commitment did not select",
    release: "roll-commit",
    source: "B",
  },
])(
  "refuses to resume a committed roll against $label",
  async ({ release, source }) => {
    const op = await recovered({
      mode: "auto",
      amountMode: "fixed",
      committed: true,
      commitment: "roll-commit",
      selectedMint: "A",
      amount: "5000000",
      draw: {
        id: "1",
        source_mint: source,
        market_index: 0,
        selection_policy: "proximity-v1",
        release_hash: release,
      },
      manifest: { pool: [{ mint: "A", symbol: "A" }] },
    });
    expect(op.phase).toBe("unknown");
    expect(op.error ?? "").toMatch(/committed roll/);
  },
);

it("resumes a committed roll whose receipt matches the commitment", async () => {
  const op = await recovered({
    mode: "auto",
    amountMode: "fixed",
    committed: true,
    commitment: "roll-commitment",
    selectedMint: "A",
    amount: "5000000",
    draw: {
      id: "1",
      source_mint: "A",
      market_index: 0,
      selection_policy: "proximity-v1",
      release_hash: "roll-commitment",
    },
    manifest: { pool: [{ mint: "A", symbol: "A" }] },
  });
  expect(op.error ?? "").not.toMatch(/committed roll/);
  expect(op.phase).toBe("awaiting_confirmation");
});

it("restores the actual transaction link from the accepted attempt after restart", async () => {
  const store = new MarketStore(":memory:");
  const e: any = new ExecutionService(store, {} as any);
  e.op = { id: "recovered", phase: "unknown" };
  e.captureFill = async () => {};
  await e.reconcile({
    status: "finalized_success",
    signature: "accepted-signature",
  });
  expect(e.op.solanaSignature).toBe("accepted-signature");
  store.close();
});

it.each(["drawing", "selected", "checking_source", "quoting_exit"])(
  "recovers interrupted %s without drawing or authorizing again",
  async (phase) => {
    const store = new MarketStore(":memory:");
    const draw = {
      id: "1",
      session: "1",
      source_mint: "source",
      market_index: 0,
    };
    store.putRecord("execution-current", {
      id: "op",
      phase,
      expectedDraw: "1",
      session: "1",
      buy: phase !== "quoting_exit",
      draw: phase === "drawing" ? undefined : draw,
      source: { mint: "source" },
      manifest: { pool: [{ mint: "source" }] },
    });
    const e: any = new ExecutionService(store, {} as any);
    e.config = { contractId: "policy.testnet" };
    e.provider = {
      query: async () => ({
        result: Array.from(Buffer.from(JSON.stringify(draw))),
      }),
    };
    e.refresh = async () => {
      e.chain = { next_draw: "2", session: { pending: null } };
    };
    e.refreshBalances = async () => {};
    e.authorize = async () => {
      throw new Error("Must not automatically authorize");
    };
    await e.tick();
    expect(e.op.phase).toBe("awaiting_confirmation");
    expect(e.op.draw.id).toBe("1");
    expect(e.op.source.mint).toBe("source");
    expect(e.op.attemptId).toBeUndefined();
    expect(store.getRecord<any>("execution-current").draw.id).toBe("1");
    store.close();
  },
);

it("confirmation of a recovered exit preserves the sell direction", async () => {
  const store = new MarketStore(":memory:");
  store.putRecord("execution-current", {
    id: "exit",
    phase: "awaiting_confirmation",
    buy: false,
  });
  const e: any = new ExecutionService(store, {} as any);
  let direction: boolean | undefined;
  e.authorize = async (buy: boolean) => {
    direction = buy;
  };
  e.snapshot = () => ({});
  await e.confirm("exit");
  await Promise.resolve();
  expect(direction).toBe(false);
  store.close();
});
