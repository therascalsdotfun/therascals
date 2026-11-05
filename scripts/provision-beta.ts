import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { JsonRpcProvider, KeyPair } from "near-api-js";
import { executionPaths } from "../apps/server/src/execution/paths.ts";
import { setupSession } from "../apps/server/src/execution/setup.ts";
import {
  NEAR_RPC,
  assertTestnetAccount,
  assertDevnetGenesis,
  devnetConnection,
} from "../apps/server/src/execution/network.ts";
const slot = process.argv.find((x) => x.startsWith("--slot="))?.slice(7);
if (!slot)
  throw Error(
    "Usage: pnpm beta:provision --slot=beta01 (beta01 through beta08)",
  );
const paths = executionPaths(slot),
  ownerFile = paths.ownerWallet!;
assertDevnetGenesis(await devnetConnection().getGenesisHash());
mkdirSync(dirname(ownerFile), { recursive: true, mode: 0o700 });
chmodSync(dirname(ownerFile), 0o700);
if (!existsSync(ownerFile)) {
  const key = KeyPair.fromRandom("ed25519");
  writeFileSync(
    ownerFile,
    JSON.stringify({
      accountId:
        "jackpot-" + slot + "-" + randomBytes(4).toString("hex") + ".testnet",
      publicKey: key.getPublicKey().toString(),
      secretKey: key.toString(),
    }),
    { flag: "wx", mode: 0o600 },
  );
}
const near = JSON.parse(readFileSync(ownerFile, "utf8"));
assertTestnetAccount(near.accountId);
const rpc = new JsonRpcProvider({ url: NEAR_RPC });
let account: any;
try {
  account = await rpc.query({
    request_type: "view_account",
    account_id: near.accountId,
    finality: "final",
  });
} catch (e) {
  // Do not ask a faucet to create a second identity after a transient lookup failure.
  if (!/does not exist|UNKNOWN_ACCOUNT/i.test(String(e))) throw e;
  const response = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      newAccountId: near.accountId,
      newAccountPublicKey: near.publicKey,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(
      "NEAR testnet faucet unavailable: HTTP " +
        response.status +
        ". Retry this same slot later; keep its existing credentials.",
    );
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      account = await rpc.query({
        request_type: "view_account",
        account_id: near.accountId,
        finality: "final",
      });
      break;
    } catch (e) {
      if (!/does not exist|UNKNOWN_ACCOUNT/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!account)
    throw Error(
      "Faucet account creation is not finalized yet. Retry this same slot later.",
    );
}
if (BigInt(account.amount) < 500000000000000000000000n)
  throw Error(
    "Slot owner lacks faucet NEAR for provisioning. Top up this same testnet account.",
  );
const config = await setupSession(false, paths);
console.log(
  JSON.stringify({
    slot,
    contractId: config.contractId,
    ownerAccount: config.ownerAccount,
    wasmSha256: config.wasmSha256,
    next: "Run the local verification server and smoke-session-swap for this slot before public admission.",
  }),
);
