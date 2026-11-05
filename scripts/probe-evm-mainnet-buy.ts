/** Native mainnet buy builder diagnostics. No wallet signing or broadcast. */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { EvmMainnet } from "../apps/server/src/mainnet/evm.ts";
import { EVM_MAINNET } from "../packages/shared/src/evm-mainnet.ts";
const wallet = "0x" + randomBytes(20).toString("hex"),
  service = new EvmMainnet();
const report: any = {
  checkedAt: new Date().toISOString(),
  signed: false,
  broadcast: false,
  wallet,
  note: "Stablecoin venue baselines, not the live-discovery risk-admission endpoint",
  tests: [],
};
for (const [chain, mint, symbol] of [
  ["base", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC"],
  ["bsc", "0x55d398326f99059ff775485246999027b3197955", "USDT"],
] as const) {
  try {
    const q = await service.quote({ chain, mint, symbol, wallet, amount: "1" });
    const preflight = await service.simulate(q);
    const { chainId, ...tx } = q.transaction;
    const r = await fetch(EVM_MAINNET[chain].rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          { ...tx, gas: "0x2dc6c0" },
          "latest",
          { [wallet]: { balance: "0x56bc75e2d63100000" } },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const synthetic = await r.json();
    const balance = await service.rpc(chain, "eth_getBalance", [
      wallet,
      "latest",
    ]);
    const pass =
      preflight.status === "insufficient_funds" &&
      !synthetic.error &&
      typeof synthetic.result === "string" &&
      BigInt(balance) === 0n;
    report.tests.push({
      chain,
      nativeAmount: q.nativeAmount,
      minimumOutputAtomic: q.minimumOutputAtomic,
      route: q.route,
      fees: q.fees,
      actualWalletPreflight: preflight,
      temporaryBalanceOverride: synthetic,
      realBalanceAfter: balance,
      pass,
    });
  } catch (e) {
    report.tests.push({
      chain,
      pass: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
mkdirSync("docs/evidence/mainnet-wallet", { recursive: true });
writeFileSync(
  "docs/evidence/mainnet-wallet/live-evm-probe.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
if (report.tests.some((t: any) => !t.pass)) process.exitCode = 1;
