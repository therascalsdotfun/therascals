/** Fresh faucet-only NEAR testnet demo. No mainnet or existing session upgrade. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, actions } from "near-api-js";
import bs58 from "bs58";
const credentialPath = ".credentials/fee-vault-testnet.json";
if (!existsSync(credentialPath))
  throw Error("Provision a dedicated faucet-only testnet account first");
const wallet = JSON.parse(readFileSync(credentialPath, "utf8"));
if (!/^rascals-fees-[a-f0-9]{8}\.testnet$/.test(wallet.accountId))
  throw Error("Unexpected dedicated demo account");
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
if (((await provider.sendJsonRpc("status", [])) as any).chain_id !== "testnet")
  throw Error("Testnet required");
const owner = new Account(wallet.accountId, provider, wallet.secretKey);
const tokenId = `usdc.${wallet.accountId}`,
  vaultId = `vault.${wallet.accountId}`;
const output = "docs/evidence/fee-vault-testnet-2026-11-01.json";
mkdirSync("docs/evidence", { recursive: true });
const evidence: any = existsSync(output)
  ? JSON.parse(readFileSync(output, "utf8"))
  : {
      network: "testnet",
      owner: wallet.accountId,
      tokenId,
      vaultId,
      demoOnly: true,
      transactions: [],
    };
if (evidence.owner !== wallet.accountId) throw Error("Evidence owner mismatch");
function save() {
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
}
async function view(id: string, method: string, args: object = {}) {
  const response: any = await provider.query({
    request_type: "call_function",
    account_id: id,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(response.result).toString());
}
async function send(
  account: Account,
  receiverId: string,
  txActions: any[],
  label: string,
) {
  // Record intent before submission. On an uncertain error, inspect chain state before resuming.
  evidence.pending = { label, receiverId };
  save();
  const result: any = await account.signAndSendTransaction({
    receiverId,
    actions: txActions,
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  evidence.transactions.push({
    label,
    hash: result.transaction.hash,
    receiverId,
    status: result.status,
  });
  delete evidence.pending;
  save();
  if (result.status?.Failure) throw Error(`Transaction failed: ${label}`);
  return result;
}
async function call(
  account: Account,
  id: string,
  method: string,
  args: object,
  deposit = 0n,
) {
  return send(
    account,
    id,
    [actions.functionCall(method, args, 100_000_000_000_000n, deposit)],
    method,
  );
}
async function ensureContract(id: string, file: string, init: object) {
  const wasm = readFileSync(file),
    hash = createHash("sha256").update(wasm).digest();
  let info: any;
  try {
    info = await provider.query({
      request_type: "view_account",
      account_id: id,
      finality: "final",
    });
  } catch (error) {
    if (!/does not exist|UNKNOWN_ACCOUNT/.test(String(error))) throw error;
    await send(
      owner,
      id,
      [
        actions.createAccount(),
        actions.transfer(3_000_000_000_000_000_000_000_000n),
        actions.addFullAccessKey(
          KeyPair.fromString(wallet.secretKey).getPublicKey(),
        ),
      ],
      `create ${id}`,
    );
    info = await provider.query({
      request_type: "view_account",
      account_id: id,
      finality: "final",
    });
  }
  const expected = bs58.encode(hash);
  if (info.code_hash !== expected) {
    if (info.code_hash !== "11111111111111111111111111111111")
      throw Error("Refusing to overwrite existing different contract code");
    const account = new Account(id, provider, wallet.secretKey);
    await send(
      account,
      id,
      [
        actions.deployContract(wasm),
        actions.functionCall("new", init, 30_000_000_000_000n, 0n),
      ],
      `deploy ${id}`,
    );
  }
  evidence[id] = { wasmSha256: hash.toString("hex") };
  save();
}
if (evidence.pending)
  throw Error(
    "An earlier submission is unresolved. Reconcile evidence.pending before rerunning.",
  );
await ensureContract(
  tokenId,
  "target/wasm32-unknown-unknown/release/rascals_demo_usdc.wasm",
  { owner_id: wallet.accountId },
);
await ensureContract(
  vaultId,
  "target/wasm32-unknown-unknown/release/rascals_fee_vault.wasm",
  {
    owner: wallet.accountId,
    usdc_token: tokenId,
    settlement_router: wallet.accountId,
  },
);
const vaultAccount = new Account(vaultId, provider, wallet.secretKey);
if (!(await view(tokenId, "storage_balance_of", { account_id: vaultId })))
  await call(
    owner,
    tokenId,
    "storage_deposit",
    { account_id: vaultId, registration_only: true },
    10_000_000_000_000_000_000_000n,
  );
const metadata = await view(tokenId, "ft_metadata");
if (metadata.decimals !== 6 || metadata.symbol !== "TEST-USDC")
  throw Error("Wrong demo token metadata");
const config = await view(vaultId, "get_vault");
if (
  config.usdc_token !== tokenId ||
  config.settlement_router !== wallet.accountId ||
  config.fee_bps !== 50
)
  throw Error("Vault config mismatch");
function equal(actual: unknown, expected: unknown, name: string) {
  if (String(actual) !== String(expected))
    throw Error(`Failed ${name}: ${actual} != ${expected}`);
}
async function deposit(amount: string, roll: string) {
  return call(
    owner,
    tokenId,
    "ft_transfer_call",
    {
      receiver_id: vaultId,
      amount,
      msg: JSON.stringify({
        roll_id: roll,
        payer: wallet.accountId,
        gross_usdc: "5000000",
      }),
    },
    1n,
  );
}
if (!evidence.smokeComplete) {
  if (await view(vaultId, "get_fee", { roll_id: "faucet-smoke-5-usdc" }))
    throw Error(
      "Smoke already started. Reconcile receipts instead of replaying it.",
    );
  await deposit("25000", "faucet-smoke-5-usdc");
  equal(
    (await view(vaultId, "get_vault")).available_usdc,
    "25000",
    "0.5% collection",
  );
  equal(
    await view(tokenId, "ft_balance_of", { account_id: vaultId }),
    "25000",
    "token custody",
  );
  await deposit("25000", "faucet-smoke-5-usdc");
  equal(
    (await view(vaultId, "get_vault")).receipt_count,
    1,
    "duplicate refund",
  );
  await deposit("25001", "wrong-fee");
  equal(
    await view(tokenId, "ft_balance_of", { account_id: vaultId }),
    "25000",
    "wrong fee refunded",
  );
  await call(owner, vaultId, "set_paused", { paused: true }, 1n);
  await deposit("25000", "paused-fee");
  equal((await view(vaultId, "get_vault")).receipt_count, 1, "paused refund");
  await call(owner, vaultId, "set_paused", { paused: false }, 1n);
  await call(
    owner,
    vaultId,
    "withdraw",
    { receiver_id: `unregistered.${wallet.accountId}`, amount: "10000" },
    1n,
  );
  equal(
    (await view(vaultId, "get_vault")).available_usdc,
    "25000",
    "failed withdrawal restores balance",
  );
  equal(
    (await view(vaultId, "get_vault")).pending_withdrawal_usdc,
    "0",
    "failed callback clears reservation",
  );
  await call(
    owner,
    vaultId,
    "withdraw",
    { receiver_id: wallet.accountId, amount: "10000" },
    1n,
  );
  equal(
    (await view(vaultId, "get_vault")).available_usdc,
    "15000",
    "confirmed withdrawal",
  );
  equal(
    await view(tokenId, "ft_balance_of", { account_id: vaultId }),
    "15000",
    "custody after withdrawal",
  );
  evidence.smokeComplete = true;
}
evidence.vault = await view(vaultId, "get_vault");
evidence.receipt = await view(vaultId, "get_fee", {
  roll_id: "faucet-smoke-5-usdc",
});
evidence.tokenMetadata = metadata;
evidence.actualVaultBalance = await view(tokenId, "ft_balance_of", {
  account_id: vaultId,
});
evidence.limits = [
  "Faucet TEST-USDC has no value and is not Circle USDC",
  "No actual roll or Solana swap was executed by this smoke",
  "NEAR vault not yet wired to Solana Devnet roll settlement",
  "Trusted settlement router; owner controls withdrawals and account code keys",
  "Not a wallet-extension test",
];
save();
console.log(
  JSON.stringify({
    vaultId,
    tokenId,
    smokeComplete: evidence.smokeComplete,
    balance: evidence.actualVaultBalance,
    transactions: evidence.transactions.length,
  }),
);
