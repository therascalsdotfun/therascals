import { it, expect } from "vitest";
import {
  commitRoll,
  committedView,
  settleRoll,
} from "../apps/server/src/routes/manifest.ts";
import { ROLL_TTL_MS } from "../apps/server/src/routes/manifest.ts";
const HASH = "f".repeat(64);
const snap = (pool: any[], over: any = {}) =>
  ({
    ticketAtomic: "5000000",
    configurationHash: HASH,
    pool,
    now: new Date().toISOString(),
    filters: { chains: ["solana"] },
    ...over,
  }) as any;
const two = snap([{ mint: "A" }, { mint: "B" }]);
it("freezes real eligible mints and refuses a stale or thin field", () => {
  expect(() => commitRoll(snap([{ mint: "A" }]), HASH)).toThrow();
  expect(() => commitRoll(two, "e".repeat(64))).toThrow();
  const roll = commitRoll(two, HASH);
  expect(roll.id).toMatch(
    /^roll-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(roll.poolKeys).toEqual(["A", "B"]);
  expect(roll.expiresAt - roll.createdAt).toBe(ROLL_TTL_MS);
});
it("publishes only the commitment before a winner is revealed", () => {
  const roll = commitRoll(two, HASH),
    view = committedView(roll, two);
  expect(Object.keys(view).sort()).toEqual(
    [
      "amountMode",
      "commitment",
      "configurationHash",
      "createdAt",
      "expiresAt",
      "id",
      "pool",
      "ticketAtomic",
    ].sort(),
  );
  expect(view.commitment).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(view)).not.toContain(roll.seed);
  expect(JSON.stringify(view)).not.toContain("selected");
});
it("labels a Full degen preview as unattested, since the contract draws it", () => {
  // begin_degen_draw takes no commitment or amount: the chain seeds from
  // env::random_seed(), so nothing the preview showed is an attested outcome
  // until the draw confirms. Labelling it committed invited a mismatch between
  // the reels and the executed trade.
  const roll = commitRoll(two, HASH, "full_degen"),
    settled = settleRoll(two, roll);
  expect(settled.manifest.selectionPolicy).toBe("contract-drawn-v1");
  expect(settled.selection).toMatch(/Preview only/);
  expect(settled.manifest.commitment).toBe(roll.commitment);
});
it("settles the same roll to the same winner, and freezes size and identity", () => {
  const roll = commitRoll(two, HASH),
    first = settleRoll(two, roll),
    second = settleRoll(two, roll);
  expect(first.selected.mint).toBe(second.selected.mint);
  expect(first.hash).toBe(second.hash);
  expect(first.manifest.selectionPolicy).toBe("committed-roll-v1");
  expect(first.manifest.commitment).toBe(roll.commitment);
  expect(first.ticketAtomic).toBe("5000000");
  expect(first.purchaseMade).toBe(false);
  expect(first.pool).toHaveLength(2);
  expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  const wide = snap(
    Array.from({ length: 32 }, (_, i) => ({ mint: "mint" + i })),
  );
  expect(settleRoll(wide, commitRoll(wide, HASH)).pool).toHaveLength(32);
  expect(() =>
    commitRoll(
      snap(Array.from({ length: 33 }, (_, i) => ({ mint: "m" + i }))),
      HASH,
    ),
  ).toThrow();
});
it("settles the field in observed order and follows the selected chain", () => {
  const mixed = snap(
    [
      { mint: "A", chain: "solana" },
      { mint: "0x" + "1".repeat(40), chain: "base" },
    ],
    { configurationHash: HASH, filters: { chains: ["solana", "base"] } },
  );
  const roll = commitRoll(mixed, HASH, "fixed");
  const result = settleRoll(mixed, roll);
  expect(result.pool.map((t: any) => t.mint)).toEqual([
    "A",
    "0x" + "1".repeat(40),
  ]);
  expect(result.manifest.selectedChain).toBe(result.selected.chain);
  expect(result.manifest.chains).toEqual(["solana", "base"]);
});
it("refuses to settle a roll whose field or configuration moved", () => {
  const roll = commitRoll(two, HASH);
  expect(() => settleRoll(snap([{ mint: "A" }, { mint: "C" }]), roll)).toThrow(
    /changed/i,
  );
  expect(() => settleRoll(snap([{ mint: "B" }, { mint: "A" }]), roll)).toThrow(
    /changed/i,
  );
  expect(() =>
    settleRoll(snap([{ mint: "A" }, { mint: "B" }, { mint: "C" }]), roll),
  ).toThrow(/changed/i);
  expect(() =>
    settleRoll(
      snap([{ mint: "A" }], { configurationHash: "a".repeat(64) }),
      roll,
    ),
  ).toThrow();
});
it("cannot be steered: the winner is a member of the field and evenly spread", () => {
  const pool = snap(Array.from({ length: 8 }, (_, i) => ({ mint: "T" + i })));
  const counts: Record<string, number> = {};
  const runs = 8000;
  for (let n = 0; n < runs; n++) {
    const won = settleRoll(pool, commitRoll(pool, HASH)).selected
      .mint as string;
    expect(won).toMatch(/^T[0-7]$/);
    counts[won] = (counts[won] ?? 0) + 1;
  }
  expect(Object.keys(counts)).toHaveLength(8);
  const expected = runs / 8;
  for (const key of Object.keys(counts))
    expect(Math.abs(counts[key] - expected)).toBeLessThan(expected * 0.2);
});
it("a caller naming extra or duplicate keys cannot shrink or spoof the field", () => {
  const roll = commitRoll(two, HASH);
  expect(roll.poolKeys).toEqual(["A", "B"]);
  expect(() =>
    commitRoll(snap([{ mint: "A" }, { mint: "A" }]), HASH),
  ).toThrow();
});
