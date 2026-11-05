/** Authorized faucet-only upgrade. Contract Borsh layout is unchanged. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, actions } from "near-api-js";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { operatorPaths } from "../apps/server/src/execution/paths.ts";
import { nearView } from "../apps/server/src/execution/setup.ts";
import {
  NEAR_RPC,
  assertTestnetAccount,
  devnetConnection,
  assertDevnetGenesis,
} from "../apps/server/src/execution/network.ts";
const cfg = JSON.parse(readFileSync(operatorPaths.publicConfig, "utf8"));
assertTestnetAccount(cfg.contractId);
assertTestnetAccount(cfg.ownerAccount);
const provider = new JsonRpcProvider({ url: NEAR_RPC });
if (((await provider.sendJsonRpc("status", [])) as any).chain_id !== "testnet")
  throw Error("Testnet only");
const sol = devnetConnection();
assertDevnetGenesis(await sol.getGenesisHash());
const before = await nearView(provider, cfg.contractId, "get_state");
if (
  before.session?.pending ||
  before.session?.balances.some((n: string) => BigInt(n) !== 0n)
)
  throw Error("Resolve and exit before upgrading");
for (const ata of before.session?.token_atas ?? []) {
  const b = await sol.getTokenAccountBalance(new PublicKey(ata), "finalized");
  if (BigInt(b.value.amount) !== 0n)
    throw Error("Actual holdings block upgrade");
}
const wasm = readFileSync(
    "target/wasm32-unknown-unknown/release/jackpot_session.wasm",
  ),
  sha = createHash("sha256").update(wasm).digest("hex");
const info: any = await provider.query({
  request_type: "view_account",
  account_id: cfg.contractId,
  finality: "final",
});
const tag = process.env.JACKPOT_SLOT ?? "operator",
  dir = `.data/proximity-upgrade/${tag}`;
mkdirSync(dir, { recursive: true });
const record = `${dir}/deployment.json`;
const previousRecord = existsSync(record)
  ? JSON.parse(readFileSync(record, "utf8"))
  : null;
const baseline =
  previousRecord?.wasmSha256 === sha ? previousRecord.before : before;
let deployHash: string | null = null;
if (info.code_hash === bs58.encode(Buffer.from(sha, "hex"))) {
  if (cfg.wasmSha256 !== sha && previousRecord?.wasmSha256 !== sha)
    throw Error(
      "New code without matching local upgrade record; reconcile manually",
    );
  deployHash = previousRecord?.transaction ?? null;
} else {
  if (info.code_hash !== bs58.encode(Buffer.from(cfg.wasmSha256, "hex")))
    throw Error("Unrecognized deployed code");
  const old: any = await provider.query({
    request_type: "view_code",
    account_id: cfg.contractId,
    finality: "final",
  });
  if (!existsSync(`${dir}/prior-config.json`))
    writeFileSync(
      `${dir}/prior-config.json`,
      readFileSync(operatorPaths.publicConfig),
    );
  writeFileSync(`${dir}/prior.wasm`, Buffer.from(old.code_base64, "base64"));
  writeFileSync(
    record,
    JSON.stringify(
      {
        contractId: cfg.contractId,
        oldSha: cfg.wasmSha256,
        wasmSha256: sha,
        before,
      },
      null,
      2,
    ),
  );
  const wallet = JSON.parse(
    readFileSync(
      operatorPaths.ownerWallet ?? ".credentials/wallets.json",
      "utf8",
    ),
  );
  const near = operatorPaths.ownerWallet ? wallet : wallet.near;
  if (near.accountId !== cfg.ownerAccount)
    throw Error("Dedicated owner mismatch");
  const contract = new Account(cfg.contractId, provider, near.secretKey);
  const tx = await contract.signAndSendTransaction({
    receiverId: cfg.contractId,
    actions: [actions.deployContract(wasm)],
    waitUntil: "FINAL",
  });
  if (
    !tx.status ||
    typeof tx.status !== "object" ||
    !Object.hasOwn(tx.status, "SuccessValue")
  )
    throw Error("Deploy not finalized successfully");
  deployHash = tx.transaction.hash;
  writeFileSync(
    record,
    JSON.stringify(
      {
        contractId: cfg.contractId,
        oldSha: cfg.wasmSha256,
        wasmSha256: sha,
        before,
        transaction: deployHash,
      },
      null,
      2,
    ),
  );
}
const after = await nearView(provider, cfg.contractId, "get_state");
const core = (s: any) =>
  Object.fromEntries(
    [
      "owner",
      "settler",
      "mapping_hash",
      "next_session",
      "next_draw",
      "next_attempt",
      "session",
    ].map((k) => [k, s[k]]),
  );
if (JSON.stringify(core(baseline)) !== JSON.stringify(core(after)))
  throw Error("Unexpected state mutation; stop and reconcile");
if (
  after.policy_version !== "full-degen-v1" ||
  !after.selection_modes?.includes("proximity-v1") ||
  after.max_buy !== "100000000" ||
  after.session_limit !== "100000000"
)
  throw Error("Wrong policy after upgrade");
const deployed: any = await provider.query({
  request_type: "view_account",
  account_id: cfg.contractId,
  finality: "final",
});
if (deployed.code_hash !== bs58.encode(Buffer.from(sha, "hex")))
  throw Error("Code hash not final");
if (existsSync(operatorPaths.proof) && !existsSync(`${dir}/prior-proof.json`))
  writeFileSync(`${dir}/prior-proof.json`, readFileSync(operatorPaths.proof));
writeFileSync(
  operatorPaths.publicConfig,
  JSON.stringify(
    { ...cfg, wasmSha256: sha, proximityUpgradeTransaction: deployHash },
    null,
    2,
  ),
);
const walletForKey = JSON.parse(
  readFileSync(
    operatorPaths.ownerWallet ?? ".credentials/wallets.json",
    "utf8",
  ),
);
const ownerKey = operatorPaths.ownerWallet ? walletForKey : walletForKey.near;
if (ownerKey.accountId !== cfg.ownerAccount)
  throw Error("Dedicated owner mismatch");
const privateConfig = JSON.parse(
  readFileSync(operatorPaths.privateConfig, "utf8"),
);
if (privateConfig.sessionPublic !== cfg.scopedPublicKey)
  throw Error("Scoped key configuration mismatch");
const ownerAccount = new Account(
  cfg.ownerAccount,
  provider,
  ownerKey.secretKey,
);
const access: any = await provider.query({
  request_type: "view_access_key",
  account_id: cfg.ownerAccount,
  public_key: privateConfig.sessionPublic,
  finality: "final",
});
const permission = access.permission?.FunctionCall;
if (permission?.receiver_id !== cfg.contractId)
  throw Error("Unexpected scoped receiver");
if (!permission.method_names?.includes("begin_proximity_draw")) {
  await ownerAccount.deleteKey(privateConfig.sessionPublic);
  await ownerAccount.addFunctionCallAccessKey({
    publicKey: privateConfig.sessionPublic,
    contractId: cfg.contractId,
    methodNames: [
      "begin_draw",
      "begin_degen_draw",
      "begin_proximity_draw",
      "authorize_attempt",
      "request_exit",
      "revoke_session",
    ],
    allowance: 10n ** 24n,
  });
}
const evidence = {
  checkedAt: new Date().toISOString(),
  contractId: cfg.contractId,
  wasmSha256: sha,
  transaction: deployHash,
  statePreserved: true,
  policyVersion: after.policy_version,
  selectionModes: after.selection_modes,
  maxBuyAtomic: after.max_buy,
  sessionLimitAtomic: after.session_limit,
  mainnet: false,
};
mkdirSync("docs/evidence/proximity", { recursive: true });
writeFileSync(
  `docs/evidence/proximity/${tag}-upgrade.json`,
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
