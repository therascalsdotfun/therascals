/** Explicitly authorized testnet-only, state-preserving capacity upgrade. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, actions } from "near-api-js";
import bs58 from "bs58";
import {
  NEAR_RPC,
  assertTestnetAccount,
  devnetConnection,
  assertDevnetGenesis,
} from "../apps/server/src/execution/network.ts";
import { nearView } from "../apps/server/src/execution/setup.ts";
const configPath = "docs/evidence/session-config.json";
const configBytes = readFileSync(configPath, "utf8"),
  cfg = JSON.parse(configBytes);
assertTestnetAccount(cfg.contractId);
assertTestnetAccount(cfg.ownerAccount);
const provider = new JsonRpcProvider({ url: NEAR_RPC });
const network: any = await provider.sendJsonRpc("status", []);
if (network.chain_id !== "testnet") throw Error("Only NEAR testnet");
const sol = devnetConnection();
assertDevnetGenesis(await sol.getGenesisHash());
const state = await nearView(provider, cfg.contractId, "get_state");
if (state.session?.pending) throw Error("Pending attempt blocks upgrade");
if (state.session?.balances?.some((n: string) => BigInt(n) !== 0n))
  throw Error("Close all held positions before upgrade");
if (state.session?.token_atas)
  for (const ata of state.session.token_atas) {
    const { PublicKey } = await import("@solana/web3.js");
    const b = await sol.getTokenAccountBalance(new PublicKey(ata), "finalized");
    if (BigInt(b.value.amount) !== 0n)
      throw Error("Actual Devnet token holding blocks upgrade");
  }
const recoveredTransaction = process.argv
  .find((a) => a.startsWith("--reconcile="))
  ?.split("=")[1];
const accountInfo: any = await provider.query({
  request_type: "view_account",
  account_id: cfg.contractId,
  finality: "final",
});
if (
  !recoveredTransaction &&
  accountInfo.code_hash !== bs58.encode(Buffer.from(cfg.wasmSha256, "hex"))
)
  throw Error("Unrecognized deployed code");
const wasm = readFileSync(
    "target/wasm32-unknown-unknown/release/jackpot_session.wasm",
  ),
  sha = createHash("sha256").update(wasm).digest("hex");
if (sha === cfg.wasmSha256) throw Error("No capacity change");
if (
  recoveredTransaction &&
  accountInfo.code_hash !== bs58.encode(Buffer.from(sha, "hex"))
)
  throw Error("Reconcile requires expected new code already finalized");
const previous: any = await provider.query({
  request_type: "view_code",
  account_id: cfg.contractId,
  finality: "final",
});
mkdirSync(".data", { recursive: true });
if (!recoveredTransaction)
  writeFileSync(
    ".data/capacity-prior.wasm",
    Buffer.from(previous.code_base64, "base64"),
  );
const archive = "docs/evidence/session-config-before-capacity32.json";
if (!existsSync(archive)) writeFileSync(archive, configBytes);
if (existsSync("docs/evidence/near-cpmm-smoke.json")) {
  const archive = `docs/evidence/near-cpmm-smoke-${cfg.wasmSha256.slice(0, 8)}.json`;
  if (!existsSync(archive))
    writeFileSync(archive, readFileSync("docs/evidence/near-cpmm-smoke.json"));
}
const wallet = JSON.parse(readFileSync(".credentials/wallets.json", "utf8"));
if (wallet.near.accountId !== cfg.ownerAccount)
  throw Error("Dedicated owner mismatch");
const account = new Account(cfg.contractId, provider, wallet.near.secretKey);
const deploy = recoveredTransaction
  ? ((await provider.sendJsonRpc("tx", {
      tx_hash: recoveredTransaction,
      sender_account_id: cfg.contractId,
      wait_until: "FINAL",
    })) as any)
  : await account.signAndSendTransaction({
      receiverId: cfg.contractId,
      actions: [actions.deployContract(wasm)],
      waitUntil: "FINAL",
    });
if (
  deploy.transaction?.signer_id !== cfg.contractId ||
  deploy.transaction?.receiver_id !== cfg.contractId ||
  !deploy.transaction?.actions?.some((a: any) => a.DeployContract) ||
  !deploy.status ||
  !Object.hasOwn(deploy.status, "SuccessValue")
)
  throw Error("Expected successful self-deploy transaction");
writeFileSync(
  ".data/capacity-deploy-receipt.json",
  JSON.stringify(
    { transaction: deploy.transaction.hash, wasmSha256: sha, before: state },
    null,
    2,
  ),
);
for (let i = 0; i < 12; i++) {
  const observed: any = await provider.query({
    request_type: "view_account",
    account_id: cfg.contractId,
    finality: "final",
  });
  if (observed.code_hash === bs58.encode(Buffer.from(sha, "hex"))) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const after = await nearView(provider, cfg.contractId, "get_state");
if (JSON.stringify(state) !== JSON.stringify(after))
  throw Error("Unexpected state change: stop and restore saved prior code");
const info: any = await provider.query({
  request_type: "view_account",
  account_id: cfg.contractId,
  finality: "final",
});
if (info.code_hash !== bs58.encode(Buffer.from(sha, "hex")))
  throw Error("New code hash not observed");
const evidence = {
  checkedAt: new Date().toISOString(),
  contractId: cfg.contractId,
  transaction: deploy.transaction.hash,
  priorSha256: cfg.wasmSha256,
  wasmSha256: sha,
  stateUnchanged: true,
  reconciliation: !!recoveredTransaction,
  priorMaxCoins: 8,
  maxCoins: 32,
  mainnet: false,
  purpose:
    "Only draw population bound changes from 8 to 32. Storage, signing, recipients and spend caps unchanged.",
};
writeFileSync(
  configPath,
  JSON.stringify(
    {
      ...cfg,
      wasmSha256: sha,
      capacityUpdateTransaction: deploy.transaction.hash,
    },
    null,
    2,
  ),
);
writeFileSync(
  "docs/evidence/policy-capacity32-update.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
