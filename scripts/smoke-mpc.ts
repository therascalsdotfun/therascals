import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider } from "near-api-js";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  SystemProgram,
  VersionedTransaction,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  NEAR_RPC,
  DEVNET_RPC,
  assertDevnetGenesis,
  assertTestnetAccount,
} from "../apps/server/src/execution/network.ts";
const c = JSON.parse(readFileSync(".credentials/wallets.json", "utf8")),
  contractId = "probe." + c.near.accountId,
  path = "jackpot/probe/v1";
assertTestnetAccount(contractId);
const near = new JsonRpcProvider({ url: NEAR_RPC }),
  owner = new Account(c.near.accountId, near, c.near.secretKey),
  probe = new Account(contractId, near, c.near.secretKey),
  sol = new Connection(DEVNET_RPC, "finalized");
assertDevnetGenesis(await sol.getGenesisHash());
async function view(account_id: string, method_name: string, args: unknown) {
  const r: any = await near.query({
    request_type: "call_function",
    account_id,
    method_name,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
}
const derived = await view("v1.signer-prod.testnet", "derived_public_key", {
  path,
  predecessor: contractId,
  domain_id: 1,
});
if (typeof derived !== "string" || !derived.startsWith("ed25519:"))
  throw new Error("Unexpected MPC derived key");
const source = new PublicKey(derived.slice(8)),
  recipient = new PublicKey(c.solana.publicKey);
console.log("Probe", contractId, "MPC Solana address", source.toBase58());
let exists = true;
try {
  await probe.getState();
} catch {
  exists = false;
}
if (!exists) {
  const r = await owner.createSubAccount({
    accountOrPrefix: "probe",
    publicKey: c.near.publicKey,
    nearToTransfer: 2n * 10n ** 24n,
  });
  console.log("NEAR create probe", r.transaction.hash);
}
const wasm = readFileSync(
  "target/wasm32-unknown-unknown/release/mpc_probe.wasm",
);
const state = await probe.getState();
if (state.codeHash === "11111111111111111111111111111111") {
  const balanceRequired = BigInt(wasm.length + 50000) * 10n ** 19n;
  if (state.balance.total < balanceRequired) {
    const funding = await owner.transfer({
      receiverId: contractId,
      amount: balanceRequired - state.balance.total,
    });
    console.log("NEAR probe storage funding", funding.transaction.hash);
  }
  const deploy = await probe.deployContract(wasm);
  console.log("NEAR deploy", deploy.transaction.hash);
  const init = await owner.callFunctionRaw({
    contractId,
    methodName: "new",
    args: {
      owner: c.near.accountId,
      source: source.toBase58(),
      recipient: recipient.toBase58(),
      path,
    },
    gas: 30000000000000n,
  });
  console.log("NEAR init", init.transaction.hash);
}
const config = await view(contractId, "config", {});
if (
  config.source !== source.toBase58() ||
  config.recipient !== recipient.toBase58()
)
  throw new Error("Probe configuration mismatch");
let balance = await sol.getBalance(source, "finalized");
const setupSigner = Keypair.fromSecretKey(Uint8Array.from(c.solana.secretKey));
if (
  balance < 15000 &&
  (await sol.getBalance(setupSigner.publicKey, "finalized")) >= 30000000
) {
  const funding = await sendAndConfirmTransaction(
    sol,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: setupSigner.publicKey,
        toPubkey: source,
        lamports: 20000000,
      }),
    ),
    [setupSigner],
    { commitment: "finalized" },
  );
  console.log("Dedicated Devnet wallet funded MPC address", funding);
  balance = await sol.getBalance(source, "finalized");
}
if (balance < 15000) {
  try {
    const sig = await sol.requestAirdrop(source, 100000000);
    console.log("Devnet faucet request", sig);
    await new Promise((r) => setTimeout(r, 3500));
    balance = await sol.getBalance(source, "confirmed");
  } catch (e) {
    console.log(
      "Devnet faucet unavailable:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
mkdirSync("docs/evidence", { recursive: true });
const publicSetup = {
  contractId,
  source: source.toBase58(),
  recipient: recipient.toBase58(),
  balance,
  wasmSha256: createHash("sha256").update(wasm).digest("hex"),
  observedAt: new Date().toISOString(),
};
writeFileSync(
  "docs/evidence/mpc-probe-setup.json",
  JSON.stringify(publicSetup, null, 2),
);
// Obtain the real signature even if the faucet is down; do not claim transfer success without finality.
const block = await sol.getLatestBlockhash("finalized"),
  amount = 10000;
const msg = new TransactionMessage({
    payerKey: source,
    recentBlockhash: block.blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: source,
        toPubkey: recipient,
        lamports: amount,
      }),
    ],
  }).compileToLegacyMessage(),
  bytes = msg.serialize();
const outcome: any = await owner.callFunctionRaw({
  contractId,
  methodName: "sign_transfer",
  args: { blockhash: block.blockhash, amount },
  gas: 150000000000000n,
  waitUntil: "FINAL",
});
const status = outcome.status;
if (!status || !("SuccessValue" in status))
  throw new Error(
    "NEAR MPC call did not return a successful signature: " +
      JSON.stringify(status),
  );
const result = JSON.parse(
  Buffer.from(status.SuccessValue, "base64").toString(),
);
if (
  result.scheme !== "Ed25519" ||
  !Array.isArray(result.signature) ||
  result.signature.length !== 64
)
  throw new Error("Unexpected MPC signature ABI");
const signature = Uint8Array.from(result.signature);
if (!nacl.sign.detached.verify(bytes, signature, source.toBytes()))
  throw new Error("MPC signature failed independent verification");
const tx = new VersionedTransaction(msg);
tx.signatures = [signature];
const wire = tx.serialize(),
  sig = bs58.encode(signature),
  evidence = {
    ...publicSetup,
    nearTransaction: outcome.transaction.hash,
    solanaSignature: sig,
    messageSha256: createHash("sha256").update(bytes).digest("hex"),
    blockhash: block.blockhash,
    lastValidBlockHeight: block.lastValidBlockHeight,
    signatureVerified: true,
    transferFinalized: false,
    blocker:
      balance < 15000 ? "Devnet faucet has not funded MPC address" : null,
  };
// Persist exact bytes before send. Never obtain a replacement signature automatically.
mkdirSync(".data", { recursive: true });
writeFileSync(
  ".data/probe-signed.json",
  JSON.stringify({ ...evidence, wire: Buffer.from(wire).toString("base64") }),
  { mode: 0o600 },
);
writeFileSync(
  "docs/evidence/mpc-transfer.json",
  JSON.stringify(evidence, null, 2),
);
console.log("Verified real MPC signature; NEAR tx", evidence.nearTransaction);
if (balance < 15000) {
  console.log(
    "TRANSFER BLOCKED: no faucet SOL. Signature is real; no Devnet transfer has finalized.",
  );
  process.exitCode = 2;
} else {
  const sent = await sol.sendRawTransaction(wire, {
    skipPreflight: false,
    maxRetries: 3,
  });
  if (sent !== sig) throw new Error("RPC signature differs");
  const final = await sol.confirmTransaction(
    { ...block, signature: sig },
    "finalized",
  );
  if (final.value.err)
    throw new Error(
      "Finalized Devnet transfer failed: " + JSON.stringify(final.value.err),
    );
  writeFileSync(
    "docs/evidence/mpc-transfer.json",
    JSON.stringify(
      { ...evidence, transferFinalized: true, blocker: null },
      null,
      2,
    ),
  );
  console.log("Finalized MPC transfer", sig);
}
