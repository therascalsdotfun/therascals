/** User-authorized Devnet-only transfer to a portfolio viewer. Never mainnet. */
import { readFileSync, writeFileSync } from "node:fs";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  getAccount,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  devnetConnection,
  assertDevnetGenesis,
} from "../apps/server/src/execution/network.ts";
const recipientText = process.argv[2];
if (!recipientText) throw Error("Explicit recipient required");
const recipient = new PublicKey(recipientText),
  connection = devnetConnection();
assertDevnetGenesis(await connection.getGenesisHash());
const manifest = JSON.parse(
  readFileSync("docs/evidence/devnet-market-manifest.json", "utf8"),
);
if (manifest.genesis !== (await connection.getGenesisHash()))
  throw Error("Manifest must match Devnet");
const wallet = JSON.parse(readFileSync(".credentials/wallets.json", "utf8")),
  payer = Keypair.fromSecretKey(Uint8Array.from(wallet.solana.secretKey));
if (
  payer.publicKey.toBase58() !== manifest.setupWallet ||
  recipient.equals(payer.publicKey)
)
  throw Error("Dedicated payer or recipient mismatch");
if ((await connection.getBalance(payer.publicKey, "finalized")) < 50000000)
  throw Error("Insufficient faucet SOL for capped transfer/rent");
const evidence: any = {
  checkedAt: new Date().toISOString(),
  network: "Solana Devnet",
  recipient: recipient.toBase58(),
  payer: payer.publicKey.toBase58(),
  mainnet: false,
  transfers: [],
};
const save = () =>
  writeFileSync(
    "docs/evidence/demo-viewer-funding.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
const sol = await connection.getBalance(recipient, "finalized"),
  topup = Math.max(0, 20000000 - sol);
if (topup) {
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient,
        lamports: topup,
      }),
    ),
    [payer],
    { commitment: "finalized", skipPreflight: false },
  );
  evidence.transfers.push({
    symbol: "test SOL",
    amountAtomic: String(topup),
    signature,
  });
  save();
}
const tokens = [
  { mint: manifest.usdcMint, symbol: "TEST-USDC", target: 1000n * 1000000n },
  ...manifest.markets.map((m: any, i: number) => ({
    mint: m.mintToken,
    symbol: m.symbol,
    target: BigInt([10000, 25000, 5000][i]) * 1000000n,
  })),
];
for (const t of tokens) {
  assertDevnetGenesis(await connection.getGenesisHash());
  const mint = new PublicKey(t.mint),
    source = getAssociatedTokenAddressSync(mint, payer.publicKey),
    sourceAccount = await getAccount(connection, source, "finalized"),
    dest = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      recipient,
      false,
      "finalized",
    ),
    amount = t.target > dest.amount ? t.target - dest.amount : 0n;
  if (amount > 0n) {
    if (sourceAccount.amount < amount)
      throw Error("Insufficient pre-existing test tokens");
    const signature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        createTransferCheckedInstruction(
          source,
          mint,
          dest.address,
          payer.publicKey,
          amount,
          6,
          [],
          TOKEN_PROGRAM_ID,
        ),
      ),
      [payer],
      { commitment: "finalized", skipPreflight: false },
    );
    evidence.transfers.push({
      symbol: t.symbol,
      mint: t.mint,
      amountAtomic: String(amount),
      signature,
    });
    save();
  }
  evidence.balances ??= [];
  evidence.balances.push({
    symbol: t.symbol,
    mint: t.mint,
    amountAtomic: (
      await getAccount(connection, dest.address, "finalized")
    ).amount.toString(),
    decimals: 6,
  });
  save();
}
evidence.nativeLamports = await connection.getBalance(recipient, "finalized");
save();
console.log(JSON.stringify(evidence, null, 2));
