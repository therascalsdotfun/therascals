// Red-team verification for the proximity-draw findings. Read-only against a
// throwaway DB in /tmp; makes no network calls and sends nothing on-chain.
// Run: npx tsx scripts/redteam-proximity-rig.ts
//
// Before the fix this script rigged the winner 1000/1000 times. It now asserts
// the opposite: a caller-supplied winner is invalid input.
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import { createApp } from "../apps/server/src/http/app.ts";
import { rollCommitment, rollWinner } from "../apps/server/src/routes/roll-commit.ts";
import { rmSync } from "node:fs";

const HASH = "a".repeat(64);
const ORIGIN = "https://jackpot.example.com";
const KEYS = Array.from({ length: 8 }, (_, i) => `TOKEN${String(i).padStart(2, "0")}`);
const TARGET = KEYS[7];
const DB = "/tmp/jackpot-redteam.sqlite";
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
const store = new MarketStore(DB);
const snapshot = () =>
  ({
    configurationHash: HASH,
    now: new Date().toISOString(),
    ticketAtomic: "1000000",
    filters: { chains: ["solana"] },
    pool: KEYS.map((mint) => ({ chain: "solana", mint, symbol: mint, name: mint })),
  }) as any;
const service = new MarketService(store);
service.snapshot = snapshot as never;
const app = await createApp(service, undefined, {
  runtime: { mode: "public", origins: new Set([ORIGIN]), slots: ["beta01"] },
  store,
  intents: { catalog: async () => ({}), quote: async () => ({}) } as any,
  beta: {
    snapshot: () => null,
    claim: () => ({}),
    activate: async () => ({}),
    forIdentity: () => null,
  } as any,
});
await app.ready();
const post = (url: string, payload: any) =>
  app.inject({
    method: "POST",
    url,
    headers: { origin: ORIGIN },
    payload,
  });
let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

// The exact payload that used to win every roll.
const rig = {
  version: 1,
  elapsedMs: 3000,
  selectedKey: TARGET,
  positions: KEYS.map((key, i) =>
    key === TARGET
      ? { key, x: 0, y: -1.26, z: 0, radius: 0.3 }
      : { key, x: 0, y: 1.26 - i * 0.001, z: 0, radius: 0.13 },
  ),
};

console.log("1) a caller-named winner is now invalid input");
check(
  "POST /api/preview with a rigged release is rejected",
  (await post("/api/preview", { configurationHash: HASH, release: rig })).statusCode === 400,
);
check(
  "POST /api/preview with a named selectedKey is rejected",
  (await post("/api/preview", { configurationHash: HASH, selectedKey: TARGET })).statusCode === 400,
);
check(
  "POST /api/execution/draw with a chosen mint is rejected",
  (
    await post("/api/execution/draw", {
      configurationHash: HASH,
      selectedKey: TARGET,
      release: rig,
    })
  ).statusCode === 401, // no session at all, and no accepted winner field either
);
check(
  "revealing an unknown roll is rejected",
  (
    await post("/api/preview/reveal", {
      rollId: "roll-00000000-0000-0000-0000-000000000000",
    })
  ).statusCode === 409,
);

console.log("\n2) the committed winner is the only winner");
const begun = service.beginRoll(HASH, "fixed");
check("begin exposes a commitment", /^[0-9a-f]{64}$/.test(begun.commitment));
check("begin hides the winner", !("selected" in begun) && !("seed" in begun));
const revealed = service.revealRoll(begun.id);
check(
  "reveal matches the published commitment",
  rollCommitment(revealed.seed, HASH, KEYS) === begun.commitment,
);
check(
  "reveal is re-derivable from the seed alone",
  revealed.selected.mint === rollWinner(revealed.seed, HASH, KEYS),
);
const again = service.revealRoll(begun.id);
check("settling twice gives the same winner", again.selected.mint === revealed.selected.mint);

console.log("\n3) forcing TARGET still requires ~1 roll in 8, not every roll");
const counts: Record<string, number> = {};
const runs = 1000;
for (let n = 0; n < runs; n++) {
  const b = service.beginRoll(HASH, "fixed"),
    won = service.revealRoll(b.id).selected.mint as string;
  counts[won] = (counts[won] ?? 0) + 1;
}
console.log(
  `   distribution ${KEYS.map((k) => `${k}:${counts[k] ?? 0}`).join(" ")}`,
);
check(`TARGET won ${(counts[TARGET] ?? 0)}/${runs}, inside an unbiased band`, Math.abs((counts[TARGET] ?? 0) - runs / 8) < (runs / 8) * 0.35);

console.log("\n4) preview writes are throttled per subject (finding 7)");
let blocked = 0;
for (let n = 0; n < 60; n++)
  if ((await post("/api/preview", { configurationHash: HASH })).statusCode === 429) blocked++;
check("sustained preview spam hits a 429", blocked > 0, `${blocked}/60 blocked`);

await app.close();
store.close();
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
