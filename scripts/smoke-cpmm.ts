import { readFileSync, writeFileSync } from "node:fs";
import {
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  devnetConnection,
  assertDevnetGenesis,
} from "../apps/server/src/execution/network.ts";
import {
  verifyAndQuote,
  swapInstruction,
  type DemoMarket,
} from "../apps/server/src/execution/cpmm.ts";
const c = devnetConnection();
assertDevnetGenesis(await c.getGenesisHash());
const w = JSON.parse(readFileSync(".credentials/wallets.json", "utf8")),
  payer = Keypair.fromSecretKey(Uint8Array.from(w.solana.secretKey)),
  manifest = JSON.parse(
    readFileSync("docs/evidence/devnet-market-manifest.json", "utf8"),
  ),
  evidence: any[] = [];
for (const m of manifest.markets as DemoMarket[]) {
  const ata = getAssociatedTokenAddressSync(
      new PublicKey(m.mintToken),
      payer.publicKey,
    ),
    before = BigInt(
      (await c.getTokenAccountBalance(ata, "finalized")).value.amount,
    ),
    q = await verifyAndQuote(c, m, true, 1000000n);
  const buy = await sendAndConfirmTransaction(
    c,
    new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
      swapInstruction(m, payer.publicKey, true, 1000000n, q.minOut),
    ),
    [payer],
    { commitment: "finalized" },
  );
  const received =
    BigInt((await c.getTokenAccountBalance(ata, "finalized")).value.amount) -
    before;
  if (received <= 0n) throw new Error("No finalized test output");
  const reverse = await verifyAndQuote(c, m, false, received);
  const sell = await sendAndConfirmTransaction(
    c,
    new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
      swapInstruction(m, payer.publicKey, false, received, reverse.minOut),
    ),
    [payer],
    { commitment: "finalized" },
  );
  evidence.push({
    market: m.id,
    buy,
    sell,
    inputDemoUsdc: "1000000",
    testTokenReceived: received.toString(),
    quotedReverseDemoUsdc: reverse.output.toString(),
    finality: "finalized",
    checkedAt: new Date().toISOString(),
  });
  writeFileSync(
    "docs/evidence/direct-cpmm-smoke.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log("Finalized direct test buy/sell", m.id, buy, sell);
}
