import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  ROLL_LABEL,
  newRollSeed,
  rollCommitment,
  rollScalar,
  rollWinner,
  verifyRollReveal,
} from "../apps/server/src/routes/roll-commit.ts";
const CONFIG = "a".repeat(64);
const POOL = Array.from({ length: 8 }, (_, i) => `TOKEN${i}`);
it("binds a seed to one frozen configuration and token set", () => {
  expect(ROLL_LABEL).toBe("JACKPOT_ROLL_V1");
  const seed = newRollSeed(),
    other = newRollSeed();
  expect(rollCommitment(seed, CONFIG, POOL)).toMatch(/^[0-9a-f]{64}$/);
  expect(rollCommitment(seed, CONFIG, POOL)).toBe(
    rollCommitment(seed, CONFIG, POOL),
  );
  expect(rollCommitment(seed, CONFIG, POOL)).not.toBe(
    rollCommitment(other, CONFIG, POOL),
  );
  expect(rollCommitment(seed, "b".repeat(64), POOL)).not.toBe(
    rollCommitment(seed, CONFIG, POOL),
  );
  expect(rollCommitment(seed, CONFIG, POOL.slice(0, 7))).not.toBe(
    rollCommitment(seed, CONFIG, POOL),
  );
});
it("derives the same winner regardless of pool ordering", () => {
  const seed = newRollSeed(),
    reversed = [...POOL].reverse();
  expect(rollWinner(seed, CONFIG, POOL)).toBe(
    rollWinner(seed, CONFIG, reversed),
  );
  expect(rollCommitment(seed, CONFIG, POOL)).toBe(
    rollCommitment(seed, CONFIG, reversed),
  );
});
it("only ever selects a member of the frozen pool", () => {
  for (let n = 0; n < 500; n++)
    expect(POOL).toContain(rollWinner(newRollSeed(), CONFIG, POOL));
});
it("spreads winners evenly so no token is favoured by construction", () => {
  const counts = Object.fromEntries(POOL.map((key) => [key, 0]));
  const runs = 16000;
  for (let n = 0; n < runs; n++)
    counts[rollWinner(newRollSeed(), CONFIG, POOL)]++;
  const expected = runs / POOL.length;
  for (const key of POOL)
    expect(Math.abs(counts[key] - expected)).toBeLessThan(expected * 0.15);
});
it("rejects a revealed seed that does not match the published commitment", () => {
  const seed = newRollSeed(),
    commitment = rollCommitment(seed, CONFIG, POOL);
  expect(verifyRollReveal(commitment, seed, CONFIG, POOL)).toBe(true);
  expect(verifyRollReveal(commitment, newRollSeed(), CONFIG, POOL)).toBe(false);
  expect(verifyRollReveal(commitment, seed, CONFIG, [...POOL, "EXTRA"])).toBe(
    false,
  );
  expect(verifyRollReveal("zz", seed, CONFIG, POOL)).toBe(false);
});
it("refuses pools that cannot carry a fair roll", () => {
  const seed = newRollSeed();
  for (const pool of [
    [],
    ["ONLY"],
    Array.from({ length: 33 }, (_, i) => `T${i}`),
    ["dup", "dup"],
    ["x".repeat(121), "y"],
  ])
    expect(() => rollWinner(seed, CONFIG, pool)).toThrow();
  expect(() => rollWinner("not-hex", CONFIG, POOL)).toThrow();
  expect(() => rollWinner(seed, "short", POOL)).toThrow();
});
it("keeps the winner unknowable from the published commitment", () => {
  // The commitment goes to every client at begin-roll, so it must not double as
  // the derivation input. An earlier version sampled from it directly and a
  // reviewer predicted 1,000 of 1,000 winners without ever seeing a seed.
  const span = POOL.length,
    bucket = Math.floor(0x1_0000_0000 / span) * span,
    guess = (commitment: string) => {
      let digest = createHash("sha256")
        .update(`${ROLL_LABEL}|winner|${commitment}`)
        .digest();
      for (let guard = 0; guard < 64; guard++) {
        const value = digest.readUInt32BE(0);
        if (value < bucket) return [...POOL].sort()[value % span];
        digest = createHash("sha256").update(digest).digest();
      }
      throw Error("roll sampling failed to terminate");
    };
  const runs = 4000;
  let hits = 0;
  for (let n = 0; n < runs; n++) {
    const seed = newRollSeed();
    if (
      guess(rollCommitment(seed, CONFIG, POOL)) ===
      rollWinner(seed, CONFIG, POOL)
    )
      hits++;
  }
  // Beating chance by this much means the commitment still carries the answer.
  expect(hits).toBeLessThan(runs * 0.18);
});
it("draws the winner and the amount from independent domains of one seed", () => {
  const seed = newRollSeed(),
    amount = rollScalar(seed, CONFIG, POOL, "degen-amount", 10000),
    winner = POOL.indexOf(rollWinner(seed, CONFIG, POOL));
  expect(amount).not.toBe(winner);
  expect(rollScalar(seed, CONFIG, POOL, "degen-amount", 10000)).toBe(amount);
  expect(rollScalar(seed, CONFIG, POOL, "winner", POOL.length)).toBe(winner);
});
it("seeds are 32 fresh random bytes and never repeat", () => {
  const seen = new Set<string>();
  for (let n = 0; n < 2000; n++) {
    const s = newRollSeed();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    seen.add(s);
  }
  expect(seen.size).toBe(2000);
});
