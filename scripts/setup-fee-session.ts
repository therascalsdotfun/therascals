/** Dedicated faucet-only Solana Devnet / NEAR testnet fee acceptance lane. */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { executionPaths } from "../apps/server/src/execution/paths.ts";
import { setupSession } from "../apps/server/src/execution/setup.ts";
import {
  assertDevnetGenesis,
  devnetConnection,
} from "../apps/server/src/execution/network.ts";
const paths = executionPaths("beta08");
mkdirSync(".credentials/beta/beta08", { recursive: true, mode: 0o700 });
mkdirSync(".data/beta/beta08", { recursive: true });
const wallet = JSON.parse(readFileSync(".credentials/wallets.json", "utf8"));
if (!/^jackpot-demo-[a-f0-9]{8}\.testnet$/.test(wallet.near.accountId))
  throw Error("Fresh demo owner required");
if (!existsSync(paths.ownerWallet!))
  writeFileSync(paths.ownerWallet!, JSON.stringify(wallet.near), {
    mode: 0o600,
    flag: "wx",
  });
if (
  JSON.parse(readFileSync(paths.ownerWallet!, "utf8")).accountId !==
  wallet.near.accountId
)
  throw Error("Owner mismatch");
chmodSync(paths.ownerWallet!, 0o600);
const manifest = JSON.parse(readFileSync(paths.marketManifest!, "utf8"));
const c = devnetConnection();
assertDevnetGenesis(await c.getGenesisHash());
const payer = Keypair.fromSecretKey(Uint8Array.from(wallet.solana.secretKey));
if (manifest.setupWallet !== payer.publicKey.toBase58())
  throw Error("Market setup wallet mismatch");
const keyPath = ".credentials/beta/beta08/vault-owner.json";
if (!existsSync(keyPath))
  writeFileSync(
    keyPath,
    JSON.stringify(Array.from(Keypair.generate().secretKey)),
    { mode: 0o600, flag: "wx" },
  );
const vaultOwner = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))),
);
const ata = await getOrCreateAssociatedTokenAccount(
  c,
  payer,
  new PublicKey(manifest.usdcMint),
  vaultOwner.publicKey,
  false,
  "finalized",
);
const actual = await getAccount(c, ata.address, "finalized");
if (
  actual.mint.toBase58() !== manifest.usdcMint ||
  !actual.owner.equals(vaultOwner.publicKey)
)
  throw Error("Vault token account mismatch");
const existing = existsSync(paths.publicConfig)
  ? JSON.parse(readFileSync(paths.publicConfig, "utf8"))
  : {};
if (existing.feeVaultAta && existing.feeVaultAta !== ata.address.toBase58())
  throw Error("Fee vault changed");
writeFileSync(
  paths.publicConfig,
  JSON.stringify(
    {
      ...existing,
      feeVaultAta: ata.address.toBase58(),
      feeVaultOwner: vaultOwner.publicKey.toBase58(),
      feeVersion: "usdc-entry-v1",
      testnetOnly: true,
    },
    null,
    2,
  ),
);
const config = await setupSession(process.argv.includes("--activate"), paths);
console.log(
  JSON.stringify({
    slot: "beta08",
    contractId: config.contractId,
    feeVaultAta: config.feeVaultAta,
    feeVaultOwner: config.feeVaultOwner,
    activated: !!config.session,
  }),
);
