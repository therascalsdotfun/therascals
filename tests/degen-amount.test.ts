import { describe, expect, it } from "vitest";
import {
  DEGEN_AMOUNTS,
  DEGEN_ODDS_VERSION,
  degenAmountForRoll,
  degenExpectedAmount,
} from "../packages/shared/src/degen-amount.ts";
import { commitRoll, settleRoll } from "../apps/server/src/routes/manifest.ts";

describe("transparent weighted buy amounts", () => {
  it("has20 ascending dollar outcomes with strictly decreasing odds totaling100%", () => {
    expect(DEGEN_AMOUNTS).toHaveLength(20);
    expect(DEGEN_AMOUNTS[0]).toEqual({ dollars: 1, weight: 2000 });
    expect(DEGEN_AMOUNTS.at(-1)).toEqual({ dollars: 100, weight: 20 });
    expect(DEGEN_AMOUNTS.reduce((n, a) => n + a.weight, 0)).toBe(10000);
    for (let i = 1; i < DEGEN_AMOUNTS.length; i++) {
      expect(DEGEN_AMOUNTS[i].dollars).toBeGreaterThan(
        DEGEN_AMOUNTS[i - 1].dollars,
      );
      expect(DEGEN_AMOUNTS[i].weight).toBeLessThan(DEGEN_AMOUNTS[i - 1].weight);
    }
    const counts = new Map<number, number>();
    for (let n = 0; n < 10000; n++)
      counts.set(
        degenAmountForRoll(n),
        (counts.get(degenAmountForRoll(n)) ?? 0) + 1,
      );
    for (const choice of DEGEN_AMOUNTS)
      expect(counts.get(choice.dollars)).toBe(choice.weight);
    expect(degenExpectedAmount()).toBeCloseTo(
      DEGEN_AMOUNTS.reduce((sum, a) => sum + (a.dollars * a.weight) / 10000, 0),
      8,
    );
  });
  it("rejects invalid entropy rather than clamps or biases it", () => {
    for (const n of [-1, 10000, NaN, Infinity, 1.5])
      expect(() => degenAmountForRoll(n)).toThrow();
    expect(degenAmountForRoll(0)).toBe(1);
    expect(degenAmountForRoll(1999)).toBe(1);
    expect(degenAmountForRoll(2000)).toBe(2);
    expect(degenAmountForRoll(9999)).toBe(100);
  });
  it("freezes an independently selected coin and amount in a preview", () => {
    const snapshot: any = {
      ticketAtomic: "5000000",
      configurationHash: "c".repeat(64),
      pool: [{ mint: "A" }, { mint: "B" }],
      filters: { chains: ["solana"] },
      now: "2026-10-26T00:00:00Z",
    };
    const roll = commitRoll(snapshot, snapshot.configurationHash, "full_degen"),
      result = settleRoll(snapshot, roll);
    expect(["A", "B"]).toContain(result.selected.mint);
    expect(DEGEN_AMOUNTS.map((a) => a.dollars * 1e6)).toContain(
      Number(result.ticketAtomic),
    );
    expect(result.amountMode).toBe("full_degen");
    expect(result.manifest.amountOddsVersion).toBe(DEGEN_ODDS_VERSION);
    expect(result.manifest.ticketAtomic).toBe(result.ticketAtomic);
    expect(result.manifest.eligibilityTicketAtomic).toBe("5000000");
    expect(result.purchaseMade).toBe(false);
    expect(() =>
      commitRoll(snapshot, "wrong", "full_degen"),
    ).toThrow();
    // The coin and the amount come from separate labelled draws on the same
    // seed, so one never pins the other: the same winner shows up at several
    // amounts across rolls.
    const amountsPerWinner: Record<string, Set<number>> = {};
    for (let n = 0; n < 200; n++) {
      const r = settleRoll(snapshot, commitRoll(snapshot, snapshot.configurationHash, "full_degen"));
      (amountsPerWinner[r.selected.mint as string] ??= new Set()).add(
        Number(r.ticketAtomic),
      );
    }
    for (const mint of ["A", "B"])
      expect(amountsPerWinner[mint]?.size).toBeGreaterThan(1);
  });
});

it("preserves amount mode through public visitor-scoped discovery", async () => {
  const { MarketStore } = await import("../apps/server/src/market/store.ts");
  const { MarketService } =
    await import("../apps/server/src/market/service.ts");
  const store = new MarketStore(":memory:");
  const service = new MarketService(store);
  const snapshot: any = {
    ticketAtomic: "5000000",
    configurationHash: "d".repeat(64),
    pool: [{ mint: "A" }, { mint: "B" }],
    filters: { chains: ["solana"] },
    now: new Date().toISOString(),
  };
  service.snapshot = () => snapshot;
  try {
    const begun = service
        .scoped("visitor-a")
        .beginRoll(snapshot.configurationHash, "full_degen"),
      result = service.scoped("visitor-a").revealRoll(begun.id);
    expect(begun).not.toHaveProperty("selected");
    expect(result.amountMode).toBe("full_degen");
    expect(result.manifest.amountOddsVersion).toBe(DEGEN_ODDS_VERSION);
    expect(result.purchaseMade).toBe(false);
    expect(["A", "B"]).toContain(result.selected.mint);
    // A different visitor cannot settle somebody else's roll.
    expect(() =>
      service.scoped("visitor-b").revealRoll(begun.id),
    ).toThrow(/unknown roll/i);
  } finally {
    store.close();
  }
});

it("requires the entire100 test session allowance before a full-degen execution", async () => {
  const { MarketStore } = await import("../apps/server/src/market/store.ts");
  const { ExecutionService } =
    await import("../apps/server/src/execution/service.ts");
  const store = new MarketStore(":memory:");
  const field = {
    configurationHash: "a".repeat(64),
    ticketAtomic: "5000000",
    pool: [{ mint: "A" }, { mint: "B" }],
    filters: {},
    now: new Date().toISOString(),
  } as any;
  const degenRoll = commitRoll(field, field.configurationHash, "full_degen"),
    market: any = {
      ticketSize: () => "5000000",
      snapshot: () => field,
      settleForExecution: () => ({
        roll: degenRoll,
        snapshot: field,
        preview: settleRoll(field, degenRoll),
      }),
    };
  const service: any = new ExecutionService(store, market);
  service.verified = () => true;
  service.refresh = async () => {};
  service.chain = {
    next_draw: "1",
    policy_version: DEGEN_ODDS_VERSION,
    selection_modes: ["proximity-v1"],
    session: {
      id: "1",
      issued: "1000000",
      revoked: false,
      pending: null,
      expires_ms: String(Date.now() + 60000),
    },
  };
  service.cash = "100000000";
  let draws = 0;
  service.runDraw = async () => {
    draws++;
  };
  try {
    await expect(
      service.draw(degenRoll.id, "auto", false),
    ).rejects.toThrow(/100 unused/);
    expect(draws).toBe(0);
    service.chain.session.issued = "0";
    const result = await service.draw(degenRoll.id, "auto", false);
    expect(result.operation.amountMode).toBe("full_degen");
    expect(result.operation.amount).toBeNull();
    expect(draws).toBe(1);
  } finally {
    store.close();
  }
});

it("recovers the original chain amount and requires explicit confirmation after interruption", async () => {
  const { MarketStore } = await import("../apps/server/src/market/store.ts");
  const { ExecutionService } =
    await import("../apps/server/src/execution/service.ts");
  const { degenAmountFromSeed } =
    await import("../apps/server/src/execution/policy-wire.ts");
  const store = new MarketStore(":memory:");
  const service: any = new ExecutionService(store, {
    ticketSize: () => "5000000",
  } as any);
  const seed = "00".repeat(32),
    amount = degenAmountFromSeed(seed);
  service.refresh = async () => {};
  service.refreshBalances = async () => {};
  service.chain = { next_draw: "2", session: { pending: null } };
  service.op = {
    id: "recovered",
    phase: "unknown",
    mode: "auto",
    amountMode: "full_degen",
    amount: null,
    draw: {
      id: "1",
      source_mint: "A",
      market_index: 0,
      selection_seed: seed,
      amount_mode: "full_degen",
      amount_odds_version: DEGEN_ODDS_VERSION,
      amount,
    },
    manifest: {
      pool: [
        { mint: "A", symbol: "A" },
        { mint: "B", symbol: "B" },
      ],
    },
  };
  try {
    await service.tick();
    expect(service.op.amount).toBe(amount);
    expect(service.op.phase).toBe("awaiting_confirmation");
    expect(service.op.mode).toBe("reveal");
    service.op.phase = "unknown";
    service.op.draw.amount = amount === "1000000" ? "2000000" : "1000000";
    await service.tick();
    expect(service.op.phase).toBe("unknown");
    expect(service.op.error).toMatch(/amount/);
  } finally {
    store.close();
  }
});
