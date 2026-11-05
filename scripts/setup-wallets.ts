import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { KeyPair, JsonRpcProvider } from "near-api-js";
import {
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  NEAR_RPC,
  DEVNET_RPC,
  assertDevnetGenesis,
  assertTestnetAccount,
} from "../apps/server/src/execution/network.ts";
mkdirSync(".credentials", { recursive: true, mode: 0o700 });
chmodSync(".credentials", 0o700);
const file = ".credentials/wallets.json";
if (!existsSync(file)) {
  const near = KeyPair.fromRandom("ed25519"),
    sol = Keypair.generate();
  writeFileSync(
    file,
    JSON.stringify(
      {
        near: {
          accountId:
            "jackpot-demo-" + randomBytes(4).toString("hex") + ".testnet",
          publicKey: near.getPublicKey().toString(),
          secretKey: near.toString(),
        },
        solana: {
          publicKey: sol.publicKey.toBase58(),
          secretKey: Array.from(sol.secretKey),
        },
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
}
const c = JSON.parse(readFileSync(file, "utf8"));
assertTestnetAccount(c.near.accountId);
const provider = new JsonRpcProvider({ url: NEAR_RPC }),
  sol = new Connection(DEVNET_RPC, "finalized");
await assertDevnetGenesis(await sol.getGenesisHash());
let nearReady = false;
try {
  await provider.query({
    request_type: "view_account",
    account_id: c.near.accountId,
    finality: "final",
  });
  nearReady = true;
} catch {}
if (!nearReady) {
  const r = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      newAccountId: c.near.accountId,
      newAccountPublicKey: c.near.publicKey,
    }),
    signal: AbortSignal.timeout(30000),
  });
  console.log("NEAR testnet faucet HTTP", r.status);
  if (!r.ok) console.log((await r.text()).slice(0, 400));
  await provider.query({
    request_type: "view_account",
    account_id: c.near.accountId,
    finality: "final",
  });
  nearReady = true;
}
let solBalance = await sol.getBalance(
  new PublicKey(c.solana.publicKey),
  "finalized",
);
if (solBalance < LAMPORTS_PER_SOL / 2) {
  try {
    const sig = await sol.requestAirdrop(
      new PublicKey(c.solana.publicKey),
      LAMPORTS_PER_SOL,
    );
    console.log("Devnet airdrop submitted", sig);
    await new Promise((r) => setTimeout(r, 3000));
    solBalance = await sol.getBalance(
      new PublicKey(c.solana.publicKey),
      "confirmed",
    );
  } catch (e) {
    console.log(
      "Devnet faucet unavailable:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
mkdirSync(".data", { recursive: true });
const status = {
  nearAccount: c.near.accountId,
  nearReady,
  solanaAddress: c.solana.publicKey,
  solBalance: solBalance / LAMPORTS_PER_SOL,
  checkedAt: new Date().toISOString(),
};
writeFileSync(".data/setup-status.json", JSON.stringify(status, null, 2));
console.log(JSON.stringify(status));
