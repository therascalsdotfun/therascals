import { readFileSync } from "node:fs";
const r = await fetch("http://127.0.0.1:4317/api/markets", {
  signal: AbortSignal.timeout(10000),
});
if (!r.ok) throw new Error("Start pnpm dev");
const d = await r.json();
function evidence(name: string) {
  try {
    return JSON.parse(readFileSync(`docs/evidence/${name}.json`, "utf8"));
  } catch {
    return null;
  }
}
const mpc = evidence("mpc-transfer"),
  swap = evidence("near-cpmm-smoke"),
  config = evidence("session-config");
const e = await (
  await fetch("http://127.0.0.1:4317/api/execution", {
    signal: AbortSignal.timeout(10000),
  })
).json();
const checks = {
  liveDiscovery: d.health.state === "live" && d.observed > 0,
  twoWayQuotes: d.pool.length >= 2,
  mpcSignatureIndependentlyVerified: mpc?.signatureVerified === true,
  devnetTransferFinalized: mpc?.transferFinalized === true,
  nearControlledDevnetSwap:
    swap?.buyFinalized === true &&
    swap?.sellFinalized === true &&
    swap?.ownerExitAfterRevocation === true &&
    swap?.wasmSha256 === config?.wasmSha256,
  deployedPolicyVerified: e.verified === true,
  currentSessionReady: e.ready === true,
};
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      checks,
      historicalExecutionProved: checks.nearControlledDevnetSwap,
      demoReadyNow: Object.values(checks).every(Boolean),
      attention: Object.entries(checks)
        .filter(([, value]) => !value)
        .map(([name]) => name),
    },
    null,
    2,
  ),
);
if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
