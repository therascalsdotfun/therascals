import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
  AuthorityType,
  setAuthority,
} from "@solana/spl-token";
import {
  deriveMarket,
  initializeInstruction,
  CPMM_PROGRAM,
  CONFIG,
  CREATION_FEE_ACCOUNT,
} from "../apps/server/src/execution/cpmm.ts";
import {
  devnetConnection,
  assertDevnetGenesis,
} from "../apps/server/src/execution/network.ts";
const arg = (name: string, fallback: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const manifestPath = arg(
  "manifest",
  "docs/evidence/devnet-market-manifest.json",
);
const mintPath = arg("mints", ".credentials/devnet-mints.json");
const walletPath = arg("wallets", ".credentials/wallets.json");
if (
  ![manifestPath, mintPath, walletPath].every(
    (p) =>
      !p.includes("..") &&
      (p.startsWith(".data/") ||
        p.startsWith(".credentials/") ||
        p === "docs/evidence/devnet-market-manifest.json"),
  )
)
  throw Error("Expected project-local demo paths");
const c = devnetConnection();
assertDevnetGenesis(await c.getGenesisHash());
const wallets = JSON.parse(readFileSync(walletPath, "utf8")),
  payer = Keypair.fromSecretKey(Uint8Array.from(wallets.solana.secretKey));
const path = mintPath;
if (!existsSync(path))
  writeFileSync(
    path,
    JSON.stringify(
      Array.from({ length: 4 }, () => Array.from(Keypair.generate().secretKey)),
    ),
    { mode: 0o600, flag: "wx" },
  );
const mints: number[][] = JSON.parse(readFileSync(path, "utf8"));
const [program, config, feeAccount] = await c.getMultipleAccountsInfo(
  [CPMM_PROGRAM, CONFIG, CREATION_FEE_ACCOUNT],
  "finalized",
);
if (!program?.executable || !config?.owner.equals(CPMM_PROGRAM) || !feeAccount)
  throw new Error("Official Devnet CPMM setup unavailable");
const fee = config.data.readBigUInt64LE(36);
console.log(
  "Verified Devnet CPMM; per-pool creation fee",
  String(fee),
  "lamports",
);
if (fee > 200000000n) throw new Error("Unexpected pool creation fee");
const mintKeys: PublicKey[] = [];
for (let i = 0; i < 4; i++) {
  const k = Keypair.fromSecretKey(Uint8Array.from(mints[i]));
  if (!(await c.getAccountInfo(k.publicKey, "finalized"))) {
    await createMint(c, payer, payer.publicKey, null, 6, k, {
      commitment: "finalized",
    });
    console.log("Created test mint", i, k.publicKey.toBase58());
  }
  const ata = await getOrCreateAssociatedTokenAccount(
    c,
    payer,
    k.publicKey,
    payer.publicKey,
    false,
    "finalized",
  );
  const target = i === 0 ? 1000000000000n : 1000000000000000n;
  if (ata.amount < target) {
    const mint = await getMint(c, k.publicKey, "finalized");
    if (!mint.mintAuthority?.equals(payer.publicKey))
      throw new Error("Cannot top up test mint with disabled/wrong authority");
    await mintTo(
      c,
      payer,
      k.publicKey,
      ata.address,
      payer,
      target - ata.amount,
      [],
      { commitment: "finalized" },
    );
  }
  mintKeys.push(k.publicKey);
}
mkdirSync("docs/evidence", { recursive: true });
const manifest: any = {
  version: 1,
  genesis: await c.getGenesisHash(),
  createdAt: new Date().toISOString(),
  setupWallet: payer.publicKey.toBase58(),
  usdcMint: mintKeys[0].toBase58(),
  markets: [],
  initializations: [],
};
if (existsSync(manifestPath)) {
  const prior = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    prior.setupWallet === manifest.setupWallet &&
    prior.usdcMint === manifest.usdcMint &&
    prior.genesis === manifest.genesis
  )
    manifest.initializations = prior.initializations ?? [];
}
for (let i = 1; i <= 3; i++) {
  const m = deriveMarket("demo-" + i, "DEMO-" + i, mintKeys[0], mintKeys[i]);
  if (!(await c.getAccountInfo(new PublicKey(m.pool), "finalized"))) {
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
      initializeInstruction(
        m,
        payer.publicKey,
        1000000000n,
        BigInt(1000000 * i) * 1000000n,
      ),
    );
    const sig = await sendAndConfirmTransaction(c, tx, [payer], {
      commitment: "finalized",
      skipPreflight: false,
    });
    manifest.initializations.push({ market: m.id, signature: sig });
    console.log("Finalized Devnet pool", m.id, sig);
  }
  manifest.markets.push(m);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
console.log(
  "Three controlled test-token markets ready. Test USDC is not real USDC.",
);
