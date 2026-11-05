import { LotteryPhysics } from "../apps/web/src/lottery/cage-physics.ts";
import {
  ReleaseClock,
  type SettleReport,
} from "../apps/web/src/lottery/release-clock.ts";
import { marketCapRadius } from "../apps/web/src/lottery/dynamics.ts";
import { tokenKey } from "../packages/shared/src/token-selection.ts";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { operatorPaths } from "../apps/server/src/execution/paths.ts";
const base = process.env.JACKPOT_API_URL ?? "http://127.0.0.1:4317";
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Verification API must be loopback");
async function get(path: string) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Local API HTTP " + r.status);
  return r.json();
}
async function post(path: string, body: any = {}) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Local action failed");
  return d;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const proximity = process.argv.includes("--proximity");
let rollId: string | null = null;
const fullDegen = process.argv.includes("--full-degen");
const ticket =
  process.argv.find((a) => a.startsWith("--ticket="))?.split("=")[1] ?? "5";
if (!/^(?:[1-9]\d?|100)$/.test(ticket))
  throw Error("Invalid verification ticket");
const minSources = Number(
  process.argv.find((a) => a.startsWith("--min-sources="))?.split("=")[1] ?? 2,
);
if (!Number.isInteger(minSources) || minSources < 2 || minSources > 32)
  throw Error("Invalid verification population");
const resume = process.argv.includes("--resume");
let markets: any;
if (resume) {
  const state = await get("/api/execution");
  if (
    !state.operation ||
    ![
      "awaiting_confirmation",
      "selection_failed",
      "finalized_success",
      "signing_failed",
      "expired",
      "finalized_failure",
    ].includes(state.operation.phase)
  )
    throw Error("No resumable original operation");
  if (fullDegen && state.operation.amountMode !== "full_degen")
    throw Error("Original operation is not Full degen");
  markets = await get("/api/markets?matchingOnly=true");
  console.log(
    "Resuming original draw",
    state.operation.draw?.id,
    state.operation.source?.mint,
    state.operation.amount,
  );
  if (proximity && state.operation.selectionPolicy !== "proximity-v1")
    throw Error("Original draw is not proximity");
  if (
    ["signing_failed", "expired", "finalized_failure"].includes(
      state.operation.phase,
    )
  )
    await post("/api/execution/retry", { id: state.operation.id });
  if (state.operation.phase === "selection_failed")
    await post("/api/execution/confirm", { id: state.operation.id });
} else {
  await post("/api/discovery", {
    ticket,
    preset: "broad",
    filters: {
      chains: ["solana"],
      poolSize: Math.max(8, minSources),
      minAgeMinutes: 15,
      minLiquidity: 5000,
      minVolume5m: 1000,
    },
  });

  for (let i = 0; i < 60; i++) {
    markets = await get("/api/markets?matchingOnly=true");
    if (markets.pool.length >= minSources) break;
    if (i % 5 === 0)
      console.log("Warming real routes", markets.matching, markets.eligible);
    await wait(3000);
  }
  if (markets.pool.length < minSources)
    throw new Error("No real eligible population at these filters");
  let state = await get("/api/execution");
  if (
    !state.session ||
    state.session.revoked ||
    Number(state.session.expires_ms) < Date.now() ||
    (fullDegen && BigInt(state.session.issued) !== 0n) ||
    BigInt(state.remainingAuthorizedAtomic ?? "0") < BigInt(ticket) * 1000000n
  ) {
    if (
      state.session &&
      !state.session.revoked &&
      Number(state.session.expires_ms) > Date.now()
    )
      await post("/api/execution/revoke");
    state = await post("/api/execution/activate");
  }
  // Activation can take longer than source evidence freshness. Read a fresh
  // population after activation; never submit the pre-activation snapshot.
  for (let i = 0; i < 60; i++) {
    markets = await get("/api/markets?matchingOnly=true");
    if (markets.pool.length >= minSources) break;
    await wait(3000);
  }
  if (markets.pool.length < minSources)
    throw Error("No fresh post-activation population");
  const roll = await post("/api/preview", {
    configurationHash: markets.configurationHash,
    poolKeys: markets.pool.map(tokenKey),
    amountMode: fullDegen ? "full_degen" : "fixed",
  });
  rollId = roll.id;
  let physics: LotteryPhysics | null = null;
  if (proximity) {
    if (fullDegen) throw Error("Choose proximity or Full Degen");
    physics = new LotteryPhysics(
      markets.pool.map((t: any) => ({
        id: tokenKey(t),
        radius: marketCapRadius(t.marketCap.value) * 1.5,
      })),
    );
    const clock = new ReleaseClock();
    physics.beginRoll();
    let settled: SettleReport | null = null;
    for (let i = 0; i < 500 && !settled; i++) {
      settled = clock.update(1 / 60, false, i === 60);
      physics.settling = clock.released;
      physics.hold = clock.submitted;
      physics.setRotation(clock.released ? 0 : 5, true);
      physics.advance(1 / 60, null, false);
    }
    if (!settled) throw Error("Cage never settled");
  }
  // The winner comes from the committed roll; the cage then guides that ball down.
  const revealed = await post("/api/preview/reveal", { rollId });
  console.log("Committed winner", revealed.selected?.mint);
  if (physics) {
    const target = tokenKey(revealed.selected);
    for (let i = 0; i < 900 && physics.stage !== "complete"; i++)
      physics.advance(1 / 60, target, false);
    if (physics.stage !== "complete")
      throw Error("Committed ball never reached the gate");
  }
  console.log("Begin real test draw from", markets.pool.length, "sources");
  await post("/api/execution/smoke-draw", { rollId, mode: "auto" });
}
async function finalized() {
  let previous = "",
    confirmed = false;
  for (let i = 0; i < 100; i++) {
    const s = await get("/api/execution"),
      o = s.operation;
    if (o?.phase !== previous) {
      console.log("Execution:", o?.phase, o?.error ?? "");
      previous = o?.phase;
    }
    if (
      fullDegen &&
      o?.amountMode === "full_degen" &&
      o.phase === "awaiting_confirmation" &&
      !confirmed
    ) {
      if (
        o.amount !== o.draw?.amount ||
        o.draw?.amount_odds_version !== "full-degen-v1"
      )
        throw Error("Missing chain-bound amount");
      confirmed = true;
      console.log(
        "Confirm chain-selected amount",
        Number(o.amount) / 1e6,
        "TEST-USDC",
      );
      await post("/api/execution/confirm", { id: o.id });
    }
    if (o?.phase === "finalized_success") return s;
    if (
      [
        "expired",
        "finalized_failure",
        "signing_failed",
        "selection_failed",
        "failed_near",
      ].includes(o?.phase)
    )
      throw new Error(
        "Real test operation did not finalize: " +
          JSON.stringify({
            phase: o.phase,
            error: o.error,
            source: o.source?.mint,
          }),
      );
    await wait(3000);
  }
  throw new Error("Execution remains unresolved; no automatic re-sign/re-roll");
}
const bought = await finalized(),
  buyOp = structuredClone(bought.operation),
  buyFill = bought.receipts.find(
    (r: any) => r.buy && r.signature === buyOp.solanaSignature,
  );
if (
  proximity &&
  (buyOp.draw.selection_policy !== "proximity-v1" ||
    buyOp.draw.release_hash !== buyOp.commitment ||
    buyOp.source?.mint !== buyOp.selectedMint)
)
  throw Error("Wrong on-chain committed winner");
if (!buyFill?.success) throw new Error("Missing finalized actual buy deltas");
console.log(
  "BUY FINALIZED",
  buyFill.signature,
  "actual token output",
  buyFill.output,
);
if (process.argv.includes("--policy-rejections"))
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/smoke-policy-rejections.ts"],
    { stdio: "inherit" },
  );
await post("/api/execution/revoke");
const rejected = await fetch(base + "/api/execution/smoke-draw", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    rollId: buyOp.rollId,
    mode: "auto",
  }),
});
const rejection = await rejected.json();
if (
  rejected.status !== 409 ||
  !/Activate a fresh bounded test session|revoked/i.test(rejection.error ?? "")
)
  throw new Error("Revocation did not block new buy");
await post("/api/execution/exit", { marketIndex: buyOp.marketIndex });
const sold = await finalized(),
  sellOp = sold.operation,
  sellFill = sold.receipts.find(
    (r: any) => !r.buy && r.signature === sellOp.solanaSignature,
  );
if (!sellFill?.success) throw new Error("Missing finalized actual exit deltas");
const evidence = {
  checkedAt: new Date().toISOString(),
  contractId: sold.contractId,
  wasmSha256: JSON.parse(readFileSync(operatorPaths.publicConfig, "utf8"))
    .wasmSha256,
  sessionId: buyOp.session,
  drawId: buyOp.draw.id,
  sourceMainnetMint: buyOp.source.mint,
  amountMode: buyOp.amountMode ?? "fixed",
  actualBuyAmountAtomic: buyOp.amount,
  amountOddsVersion: buyOp.draw.amount_odds_version ?? null,
  selectionSeed: buyOp.draw.selection_seed,
  selectionPolicy: buyOp.draw.selection_policy,
  releaseHash: buyOp.draw.release_hash ?? null,
  committedRoll: buyOp.commitment
    ? {
        rollId: buyOp.rollId ?? null,
        commitment: buyOp.commitment,
        selectedMint: buyOp.selectedMint ?? null,
        revealedSeed: buyOp.seed ?? null,
      }
    : null,
  eligibilityTicketAtomic: String(Number(ticket) * 1e6),
  drawPopulation: buyOp.manifest.pool.length,
  drawMints: buyOp.manifest.pool.map((t: any) => t.mint),
  actualTestMint: sold.markets[buyOp.marketIndex].mintToken,
  marketId: sold.markets[buyOp.marketIndex].id,
  buyFinalized: true,
  sellFinalized: true,
  ownerExitAfterRevocation: true,
  newBuyAfterRevocationRejected: true,
  buy: buyFill,
  sell: sellFill,
  buyNearTransactions: buyOp.nearTransactions,
  sellNearTransactions: sellOp.nearTransactions,
  buyTimeline: buyOp.timeline,
  sellTimeline: sellOp.timeline,
  sourceMemecoinWasNotPurchased: true,
};
mkdirSync(dirname(operatorPaths.proof), { recursive: true });
writeFileSync(operatorPaths.proof, JSON.stringify(evidence, null, 2));
console.log(
  "REAL NEAR/MPC/DEVNET BUY AND REVOKED-SESSION EXIT VERIFIED",
  sellFill.signature,
);
