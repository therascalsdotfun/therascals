/** Read-only mainnet diagnostics. No signing, private keys, or broadcast RPCs. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Interface, id, toQuantity } from "ethers";
import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import { SOLANA_MAINNET_GENESIS } from "../packages/shared/src/solana-network.ts";
import { assertSolanaMainnet } from "../apps/server/src/mainnet/funding.ts";
import { fittingJupiterSimulation } from "./jupiter-simulation-message.ts";

const allowed = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
  "getGenesisHash",
  "getBalance",
  "getLatestBlockhash",
  "simulateTransaction",
]);
async function rpc(url: string, method: string, params: unknown[] = []) {
  if (!allowed.has(method)) throw Error(`Forbidden RPC method: ${method}`);
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    return { error: { code: `HTTP_${r.status}`, message: "RPC unavailable" } };
  const j = (await r.json()) as any;
  return j.error ? { error: j.error } : { result: j.result };
}
async function json(url: string, body?: unknown) {
  const r = await fetch(url, {
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error(`Provider HTTP ${r.status}`);
  return (await r.json()) as any;
}
const report: any = {
  checkedAt: new Date().toISOString(),
  signed: false,
  broadcast: false,
  balanceOverridesPersisted: false,
  tests: [],
};
const sender = `0x${id(`rascals-mainnet-simulation-${report.checkedAt}`).slice(-40)}`;
const record = (name: string, data: any) => {
  report.tests.push({ name, ...data });
  console.log(JSON.stringify({ name, ...data }));
};

async function evm(chain: "base" | "bnb") {
  const url =
    chain === "base"
      ? "https://mainnet.base.org"
      : "https://bsc-dataseed.binance.org";
  const identity = await rpc(url, "eth_chainId");
  if (identity.result !== (chain === "base" ? "0x2105" : "0x38"))
    throw Error(`Wrong ${chain} chain`);
  const block = (await rpc(url, "eth_blockNumber")).result;
  const balance = await rpc(url, "eth_getBalance", [sender, block]);
  if (balance.result !== "0x0")
    throw Error("Synthetic wallet unexpectedly funded");
  const overrides = { [sender]: { balance: toQuantity(10n ** 20n) } };
  const call = async (tx: any, funded: boolean) =>
    rpc(url, "eth_call", [tx, block, ...(funded ? [overrides] : [])]);
  let tx: any, quote: string, decode: (result: string) => string;
  const amount = chain === "base" ? 10n ** 14n : 10n ** 15n;
  if (chain === "bnb") {
    const router = new Interface([
      "function WETH() view returns(address)",
      "function getAmountsOut(uint amountIn,address[] path) view returns(uint[])",
      "function swapExactETHForTokens(uint amountOutMin,address[] path,address to,uint deadline) payable returns(uint[])",
    ]);
    const to = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
    const wrapped = await call(
      { to, data: router.encodeFunctionData("WETH") },
      false,
    );
    if (wrapped.error) throw Error(JSON.stringify(wrapped.error));
    const path = [
      router.decodeFunctionResult("WETH", wrapped.result)[0],
      "0x55d398326f99059ff775485246999027b3197955",
    ];
    const q = await call(
      { to, data: router.encodeFunctionData("getAmountsOut", [amount, path]) },
      false,
    );
    if (q.error) throw Error(JSON.stringify(q.error));
    quote = router
      .decodeFunctionResult("getAmountsOut", q.result)[0][1]
      .toString();
    tx = {
      from: sender,
      to,
      value: toQuantity(amount),
      gas: "0x1e8480",
      data: router.encodeFunctionData("swapExactETHForTokens", [
        (BigInt(quote) * 99n) / 100n,
        path,
        sender,
        Math.floor(Date.now() / 1000) + 600,
      ]),
    };
    decode = (r) =>
      router.decodeFunctionResult("swapExactETHForTokens", r)[0][1].toString();
    record(`${chain}:negative-control-expired`, {
      block,
      ...(await call(
        {
          ...tx,
          data: router.encodeFunctionData("swapExactETHForTokens", [
            0,
            path,
            sender,
            1,
          ]),
        },
        true,
      )),
    });
  } else {
    const input = "0x4200000000000000000000000000000000000006",
      output = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const quoter = new Interface([
      "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160,uint32,uint256)",
    ]);
    const q = await call(
      {
        to: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
        data: quoter.encodeFunctionData("quoteExactInputSingle", [
          [input, output, amount, 500, 0],
        ]),
      },
      false,
    );
    if (q.error) throw Error(JSON.stringify(q.error));
    quote = quoter
      .decodeFunctionResult("quoteExactInputSingle", q.result)[0]
      .toString();
    const router = new Interface([
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256 amountOut)",
    ]);
    const args = [
      input,
      output,
      500,
      sender,
      amount,
      (BigInt(quote) * 99n) / 100n,
      0,
    ];
    tx = {
      from: sender,
      to: "0x2626664c2603336E57B271c5C0b26F421741e481",
      value: toQuantity(amount),
      gas: "0x1e8480",
      data: router.encodeFunctionData("exactInputSingle", [args]),
    };
    decode = (r) =>
      router.decodeFunctionResult("exactInputSingle", r)[0].toString();
    record(`${chain}:negative-control-min-output`, {
      block,
      ...(await call(
        {
          ...tx,
          data: router.encodeFunctionData("exactInputSingle", [
            [...args.slice(0, 5), 10n ** 30n, 0],
          ]),
        },
        true,
      )),
    });
  }
  record(`${chain}:empty-wallet-swap`, {
    block,
    sender,
    inputAtomic: amount.toString(),
    quoteOutputAtomic: quote,
    transaction: tx,
    ...(await call(tx, false)),
  });
  const funded = await call(tx, true);
  record(`${chain}:synthetic-funded-swap`, {
    block,
    sender,
    simulatedNativeBalance: "100",
    outputAtomic: funded.result ? decode(funded.result) : undefined,
    ...funded,
  });
  record(`${chain}:balance-after-simulation`, {
    block,
    ...(await rpc(url, "eth_getBalance", [sender, "latest"])),
  });
}
async function solana() {
  const url =
    process.env.SOLANA_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
  const genesis = await rpc(url, "getGenesisHash");
  if (genesis.result !== SOLANA_MAINNET_GENESIS)
    throw Error("Wrong Solana chain");
  assertSolanaMainnet(genesis.result);
  record("solana:app-mainnet-guard", {
    genesis: genesis.result,
    accepted: true,
  });
  const owner = Keypair.generate().publicKey;
  const latest = await rpc(url, "getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  if (latest.error) throw Error(JSON.stringify(latest.error));
  const transfer = new Transaction({
    feePayer: owner,
    recentBlockhash: latest.result.value.blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: new PublicKey("11111111111111111111111111111111"),
      lamports: 1000000,
    }),
  );
  const config = {
    encoding: "base64",
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    innerInstructions: true,
  };
  const raw = transfer
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  record("solana:empty-wallet-transfer", {
    sender: owner.toBase58(),
    ...(await rpc(url, "simulateTransaction", [raw, config])),
  });
  const params = {
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: "10000000",
    taker: owner.toBase58(),
  };
  const order = await json(
    `https://api.jup.ag/swap/v2/order?${new URLSearchParams(params)}`,
  );
  record("solana:jupiter-v2-empty-wallet-builder", {
    sender: params.taker,
    error: order.error,
    errorCode: order.errorCode,
    errorMessage: order.errorMessage,
    transactionBuilt: !!order.transaction,
    outAmount: order.outAmount,
  });
  const {
    quote,
    raw: swap,
    attempts,
  } = await fittingJupiterSimulation(
    (maxAccounts) =>
      json(
        `https://api.jup.ag/swap/v2/build?${new URLSearchParams({ ...params, slippageBps: "100", maxAccounts: String(maxAccounts) })}`,
      ),
    params.taker,
    latest.result.value.blockhash,
  );
  record("solana:unsigned-jupiter-swap", {
    sender: params.taker,
    route: quote.routePlan?.map((p: any) => p.swapInfo.label),
    builder: "/swap/v2/build",
    buildAttempts: attempts,
    ...(await rpc(url, "simulateTransaction", [swap, config])),
  });
}
for (const chain of ["base", "bnb", "solana"] as const) {
  try {
    if (chain === "solana") await solana();
    else await evm(chain);
  } catch (e) {
    record(`${chain}:probe-error`, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
report.finishedAt = new Date().toISOString();
report.unexpectedFailures = report.tests.filter(
  (t: any) =>
    t.name.endsWith(":probe-error") ||
    (t.name.endsWith(":synthetic-funded-swap") &&
      (t.error || !t.outputAtomic || BigInt(t.outputAtomic) <= 0n)) ||
    (t.name.endsWith(":balance-after-simulation") && t.result !== "0x0") ||
    (t.name === "base:negative-control-min-output" &&
      !/Too little received/.test(t.error?.message ?? "")) ||
    (t.name === "bnb:negative-control-expired" &&
      !/EXPIRED/.test(t.error?.message ?? "")) ||
    (t.name.includes(":empty-wallet-swap") &&
      !/OutOfFunds|insufficient funds/i.test(t.error?.message ?? "")) ||
    (t.name === "solana:jupiter-v2-empty-wallet-builder" &&
      t.errorCode !== 1) ||
    (["solana:empty-wallet-transfer", "solana:unsigned-jupiter-swap"].includes(
      t.name,
    ) &&
      t.result?.value?.err !== "AccountNotFound"),
);
if (report.unexpectedFailures.length) process.exitCode = 1;
const folder = resolve("docs/evidence/mainnet-simulation-2026-10-29");
mkdirSync(folder, { recursive: true });
writeFileSync(
  resolve(folder, "rpc-simulations.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(`Evidence: ${folder}/rpc-simulations.json`);
