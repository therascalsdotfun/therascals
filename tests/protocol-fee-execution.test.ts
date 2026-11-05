import { expect, it } from "vitest";
import { Keypair, Message } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createHash } from "node:crypto";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { deriveMarket } from "../apps/server/src/execution/cpmm.ts";
import { canonicalSwapMessage } from "../apps/server/src/execution/policy-wire.ts";
function fixture() {
  const source = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
  const mint = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
  const output = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
  const vault = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
  const market = deriveMarket("demo-1", "DEMO-1", mint, output);
  const message = Message.from(
    canonicalSwapMessage(
      market,
      source.toBase58(),
      getAssociatedTokenAddressSync(mint, source).toBase58(),
      getAssociatedTokenAddressSync(output, source).toBase58(),
      true,
      "5000000",
      "1000",
      mint.toBase58(),
      vault.toBase58(),
    ),
  );
  const balance = (
    accountIndex: number,
    owner: string,
    mint: string,
    amount: string,
  ) => ({ accountIndex, owner, mint, uiTokenAmount: { amount, decimals: 6 } });
  const tx = {
    transaction: { message },
    slot: 100,
    meta: {
      err: null as object | null,
      fee: 5000,
      preTokenBalances: [
        balance(1, source.toBase58(), mint.toBase58(), "100000000"),
        balance(2, source.toBase58(), output.toBase58(), "0"),
        balance(7, "treasury", mint.toBase58(), "0"),
      ],
      postTokenBalances: [
        balance(1, source.toBase58(), mint.toBase58(), "95000000"),
        balance(2, source.toBase58(), output.toBase58(), "1500"),
        balance(7, "treasury", mint.toBase58(), "25000"),
      ],
    },
  };
  const store = new MarketStore(":memory:");
  const service: any = new ExecutionService(store, {} as any);
  service.rpc = { getTransaction: async () => tx };
  service.chain = { session: { source: source.toBase58() } };
  service.config = { markets: [market], feeVaultAta: vault.toBase58() };
  const attempt = {
    signature: "test",
    message_hash: createHash("sha256")
      .update(message.serialize())
      .digest("hex"),
    market_index: 0,
    buy: true,
    amount: "5000000",
    min_out: "1000",
  };
  return { service, store, tx, attempt };
}
it("credits a fee receipt only after finalized gross spend, output and vault delta agree", async () => {
  const { service, store, tx, attempt } = fixture();
  try {
    const fill = await service.readFill(attempt);
    expect(fill.protocolFee).toMatchObject({
      feeAtomic: "25000",
      principalAtomic: "4975000",
      chain: "solana-devnet",
    });
    tx.meta.postTokenBalances[2].uiTokenAmount.amount = "24999";
    await expect(service.readFill(attempt)).rejects.toThrow(/protocol fee/);
    tx.meta.postTokenBalances[2].uiTokenAmount.amount = "25000";
    tx.meta.postTokenBalances[0].uiTokenAmount.amount = "95025000";
    await expect(service.readFill(attempt)).rejects.toThrow(/token deltas/);
  } finally {
    store.close();
  }
});
it("a failed atomic transaction earns no fee receipt, and receipts survive idempotent restore", async () => {
  const { service, store, tx, attempt } = fixture();
  try {
    tx.meta.err = { InstructionError: [2, "InsufficientFunds"] };
    expect(await service.readFill(attempt)).toMatchObject({
      success: false,
      input: "0",
      output: "0",
      protocolFee: null,
    });
    tx.meta.err = null;
    const fill = await service.readFill(attempt);
    service.op = { id: "op", source: { mint: "source" }, nearTransactions: [] };
    service.positions = () => [];
    await service.captureFill(
      { ...attempt, id: "1", session: "1", draw: "1" },
      fill,
    );
    delete service.op.fillEvidence;
    await service.captureFill({ ...attempt, id: "1", session: "1", draw: "1" });
    expect(service.op.fillEvidence.protocolFee.feeAtomic).toBe("25000");
    expect(store.records("fill:")).toHaveLength(1);
  } finally {
    store.close();
  }
});
