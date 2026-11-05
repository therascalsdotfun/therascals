/** Surfpool mainnet fork only. Synthetic balances never reach mainnet. */
import { mkdirSync, writeFileSync } from "node:fs";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  AccountLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { fittingJupiterSimulation } from "./jupiter-simulation-message.ts";
import { fundingInstructions } from "../apps/server/src/mainnet/funding.ts";
const LOCAL = "http://127.0.0.1:18999";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const allowed = new Set([
  "getVersion",
  "getBalance",
  "getSlot",
  "getBlockTime",
  "getLatestBlockhash",
  "simulateTransaction",
  "surfnet_setAccount",
  "surfnet_setTokenAccount",
  "surfnet_timeTravel",
]);
async function local(method: string, params: unknown[] = []) {
  if (!allowed.has(method)) throw Error(`Forbidden method ${method}`);
  const r = await fetch(LOCAL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(60000),
  });
  const j = (await r.json()) as any;
  if (j.error) throw Error(JSON.stringify(j.error));
  return j.result;
}
async function provider(url: string, body?: unknown) {
  const r = await fetch(url, {
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error(`Jupiter HTTP ${r.status}`);
  return (await r.json()) as any;
}
const owner = Keypair.generate().publicKey.toBase58();
const report: any = {
  checkedAt: new Date().toISOString(),
  simulator: "Surfpool 1.7.0",
  datasource: "https://api.mainnet-beta.solana.com",
  localEndpoint: LOCAL,
  signed: false,
  broadcast: false,
  mainnetBalancesChanged: false,
  owner,
  tests: [],
};
async function attempt(name: string, action: () => Promise<unknown>) {
  try {
    const result = await action();
    report.tests.push({ name, result });
    const v = (result as any)?.simulation?.value ?? (result as any)?.value;
    console.log(
      JSON.stringify({
        name,
        err: v?.err,
        unitsConsumed: v?.unitsConsumed,
        logs: v?.logs?.slice(-9),
      }),
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    report.tests.push({ name, error });
    console.log(JSON.stringify({ name, error }));
  }
}
const config = {
  encoding: "base64",
  sigVerify: false,
  replaceRecentBlockhash: true,
  commitment: "confirmed",
  innerInstructions: true,
};
await local("getVersion");
await local("surfnet_setAccount", [
  owner,
  {
    lamports: 100000000000,
    owner: "11111111111111111111111111111111",
    executable: false,
    data: "",
  },
]);
await local("surfnet_setTokenAccount", [
  owner,
  USDC,
  { amount: 25000000 },
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
]);
report.simulatedBalances = { SOL: 100, USDC: 25 };
for (const [label, asset, contract, amount] of [
  ["native-sol", "nep141:sol.omft.near", undefined, "1000000"],
  ["usdc", "nep141:solana-usdc", USDC, "1000000"],
] as const) {
  await attempt(`intents:app-${label}-deposit-instructions`, async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const hash = (await local("getLatestBlockhash")).value.blockhash;
    const tx = new Transaction({
      feePayer: new PublicKey(owner),
      recentBlockhash: hash,
    }).add(...fundingInstructions(owner, recipient, asset, contract, amount));
    const raw = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
    return {
      recipient,
      amountAtomic: amount,
      simulation: await local("simulateTransaction", [raw, config]),
    };
  });
}
const targets: {
  name: string;
  mint: string;
  tokenProgram?: string;
  dexes?: string;
}[] = [{ name: "USDC-to-SOL", mint: SOL, dexes: "Raydium CLMM" }];
try {
  const j = (await (
    await fetch("http://127.0.0.1:4317/api/markets", {
      signal: AbortSignal.timeout(5000),
    })
  ).json()) as any;
  const row = j.rows?.find(
    (r: any) =>
      r.token?.id?.startsWith("solana-mainnet:") &&
      r.token.mint !== SOL &&
      r.token.mint !== USDC,
  );
  if (row)
    targets.push({
      name: `USDC-to-${row.token.symbol}`,
      mint: row.token.mint,
      tokenProgram: row.token.tokenProgram,
      dexes:
        "Raydium CLMM,Raydium CP,Raydium,Pump.fun Amm,Meteora DAMM v2,Meteora DLMM,Whirlpool",
    });
} catch {
  /* App discovery optional; baseline still runs. */
}
for (const target of targets) {
  await attempt(`jupiter:${target.name}`, async () => {
    const { quote, raw, attempts } = await fittingJupiterSimulation(
      (maxAccounts) =>
        provider(
          `https://api.jup.ag/swap/v2/build?${new URLSearchParams({ inputMint: USDC, outputMint: target.mint, amount: "1000000", slippageBps: "300", taker: owner, maxAccounts: String(maxAccounts), ...(target.dexes ? { dexes: target.dexes } : {}) })}`,
        ),
      owner,
      (await local("getLatestBlockhash")).value.blockhash,
    );
    // Just-in-time remote pools can have newer timestamps than the fork's clock.
    // Advance ONLY localhost's clock; record the override with the simulation.
    const clockBefore = await local("getBlockTime", [await local("getSlot")]);
    const clockOverrideMs = Math.max(
      Date.now() + 5000,
      (clockBefore + 1) * 1000,
    );
    await local("surfnet_timeTravel", [{ absoluteTimestamp: clockOverrideMs }]);
    const addresses = [
      getAssociatedTokenAddressSync(
        new PublicKey(USDC),
        new PublicKey(owner),
      ).toBase58(),
      getAssociatedTokenAddressSync(
        new PublicKey(target.mint),
        new PublicKey(owner),
        false,
        target.tokenProgram
          ? new PublicKey(target.tokenProgram)
          : TOKEN_PROGRAM_ID,
      ).toBase58(),
    ];
    const simulation = await local("simulateTransaction", [
      raw,
      { ...config, accounts: { encoding: "base64", addresses } },
    ]);
    const tokenBalancesAfter = simulation.value.accounts?.map(
      (a: any, index: number) => {
        const data = a ? Buffer.from(a.data[0], "base64") : undefined;
        return {
          account: addresses[index],
          amount:
            data && data.length >= AccountLayout.span
              ? AccountLayout.decode(data).amount.toString()
              : null,
          closedOrMissing: !data || data.length === 0,
        };
      },
    );
    return {
      builder: "/swap/v2/build",
      buildAttempts: attempts,
      routingRestriction: target.dexes,
      clockBeforeSeconds: clockBefore,
      clockOverrideMs,
      inputMint: USDC,
      outputMint: target.mint,
      inputAtomic: quote.inAmount,
      quotedOutputAtomic: quote.outAmount,
      routes: quote.routePlan.map((p: any) => p.swapInfo.label),
      tokenBalancesAfter,
      simulation,
    };
  });
}
report.localBalanceAfter = await local("getBalance", [owner]);
const publicBalance = await fetch(report.datasource, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getBalance",
    params: [owner],
  }),
  signal: AbortSignal.timeout(15000),
});
report.realMainnetBalanceAfter = await publicBalance.json();
report.finishedAt = new Date().toISOString();
report.unexpectedFailures = report.tests.filter(
  (t: any) => t.error || t.result?.simulation?.value?.err,
);
if (report.realMainnetBalanceAfter?.result?.value !== 0)
  report.unexpectedFailures.push({
    name: "public-mainnet-wallet-remains-empty",
    error: "Could not verify zero real balance",
  });
if (report.unexpectedFailures.length) process.exitCode = 1;
mkdirSync("docs/evidence/mainnet-simulation-2026-10-29", { recursive: true });
writeFileSync(
  "docs/evidence/mainnet-simulation-2026-10-29/solana-fork.json",
  JSON.stringify(report, null, 2) + "\n",
);
