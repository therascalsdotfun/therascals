import { spawn, type ChildProcess } from "node:child_process";
import { openSync, writeFileSync, closeSync, readFileSync } from "node:fs";
const base = "http://127.0.0.1:4317";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(path: string) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return r.json();
}
async function post(path: string, body: unknown = {}) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `POST ${path}: ${r.status}`);
  return d;
}
async function start(): Promise<ChildProcess> {
  const fd = openSync(".superpowers/restart-server.log", "a");
  const env = { ...process.env };
  delete env.JACKPOT_VERIFY_EXECUTION;
  const p = spawn(
    process.execPath,
    ["--import", "tsx", "apps/server/src/main.ts"],
    { cwd: process.cwd(), env, detached: true, stdio: ["ignore", fd, fd] },
  );
  closeSync(fd);
  p.unref();
  for (let i = 0; i < 100; i++) {
    if (p.exitCode !== null) throw new Error("Owned backend failed to start");
    try {
      await get("/api/execution");
      return p;
    } catch {
      await wait(200);
    }
  }
  throw new Error("Owned backend startup timed out");
}
let issuedBefore: bigint, interrupted: any;
if (!process.argv.includes("--resume")) {
  // Do not stop any unrelated listener. The operator must first stop the demo API.
  try {
    await get("/api/execution");
    throw new Error(
      "Stop the existing API before this owned-process restart test",
    );
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
  }
  let server = await start();
  await post("/api/discovery", {
    ticket: "5",
    preset: process.argv.includes("--strict") ? "strict" : "broad",
  });
  let markets: any;
  for (let i = 0; i < 100; i++) {
    markets = await get("/api/markets?matchingOnly=true");
    if (markets.pool.length >= 2) break;
    await wait(3000);
  }
  if (markets.pool.length < 2) throw new Error("Wait for two real routes");
  let before = await get("/api/execution");
  if (!before.ready) before = await post("/api/execution/activate");
  issuedBefore = BigInt(before.session.issued);
  await post("/api/execution/draw", {
    configurationHash: markets.configurationHash,
    mode: "auto",
  });
  for (let i = 0; i < 1200; i++) {
    const s = await get("/api/execution"),
      o = s.operation;
    if (
      ["signed", "submitted", "unknown"].includes(o?.phase) &&
      o.attempt?.signature
    ) {
      interrupted = structuredClone(o);
      break;
    }
    if (
      [
        "selection_failed",
        "failed_near",
        "signing_failed",
        "expired",
        "finalized_failure",
        "finalized_success",
      ].includes(o?.phase)
    )
      throw new Error("Did not reach interrupt boundary: " + o.phase);
    await wait(250);
  }
  if (!interrupted) throw new Error("No signed attempt observed");
  console.log(
    "Interrupt owned backend",
    server.pid,
    "at",
    interrupted.phase,
    "attempt",
    interrupted.attemptId,
  );
  const exited = new Promise<void>((resolve) =>
    server.once("exit", () => resolve()),
  );
  writeFileSync(
    ".superpowers/restart-interrupted.json",
    JSON.stringify({ interrupted, issuedBefore: String(issuedBefore) }),
  );
  server.ref();
  server.kill("SIGINT");
  await exited;
  server = await start();
} else {
  const saved = JSON.parse(
    readFileSync(".superpowers/restart-interrupted.json", "utf8"),
  );
  interrupted = saved.interrupted;
  issuedBefore = BigInt(saved.issuedBefore);
}
let final: any;
for (let i = 0; i < 100; i++) {
  const s = await get("/api/execution"),
    o = s.operation;
  if (o?.attemptId !== interrupted.attemptId || o?.id !== interrupted.id)
    throw new Error("Restart replaced operation/attempt");
  if (o.phase === "finalized_success") {
    final = s;
    break;
  }
  if (["expired", "finalized_failure", "signing_failed"].includes(o.phase))
    throw new Error("Recovered attempt did not finalize: " + o.phase);
  await wait(3000);
}
if (!final)
  throw new Error(
    "Recovery remains unresolved; backend left running for reconciliation",
  );
const expectedSignature = interrupted.attempt.signature;
if (
  final.operation.attempt.signature !== expectedSignature ||
  final.operation.attempt.message_hash !== interrupted.attempt.message_hash
)
  throw new Error("Restart changed signed message");
if (BigInt(final.session.issued) !== issuedBefore + 5000000n)
  throw new Error("Restart changed cumulative authorization");
if (
  final.receipts.filter((x: any) => x.signature === expectedSignature)
    .length !== 1
)
  throw new Error("Duplicate or missing fill");
writeFileSync(
  "docs/evidence/restart-recovery.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      contractId: final.contractId,
      session: final.session.id,
      interruptedPhase: interrupted.phase,
      attemptId: interrupted.attemptId,
      operationId: interrupted.id,
      signature: expectedSignature,
      messageHash: interrupted.attempt.message_hash,
      issuedBefore: String(issuedBefore),
      issuedAfter: final.session.issued,
      sameSignature: true,
      sameMessage: true,
      singleFill: true,
      finalized: true,
      timeline: final.operation.timeline,
    },
    null,
    2,
  ),
);
console.log("Actual restart recovery finalized once", expectedSignature);
