import { expect, it, vi } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { simulateSolanaMessage } from "../apps/server/src/mainnet/preflight.ts";
const owner = Keypair.generate().publicKey;
const raw = () =>
  new Transaction({
    feePayer: owner,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  })
    .add(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    )
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
const rpc = (err: any = null) => ({
  getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  isBlockhashValid: async () => ({ value: true, context: { slot: 123 } }),
  simulateTransaction: async () => ({
    context: { slot: 123 },
    value: { err, logs: [], unitsConsumed: 150 },
  }),
});
it("accepts only a successful actual-wallet mainnet simulation", async () => {
  expect(
    await simulateSolanaMessage(raw(), owner.toBase58(), rpc() as any),
  ).toMatchObject({ status: "passed", slot: 123, unitsConsumed: 150 });
  await expect(
    simulateSolanaMessage(
      raw(),
      owner.toBase58(),
      rpc("AccountNotFound") as any,
    ),
  ).rejects.toThrow(/fund|balance/i);
  await expect(
    simulateSolanaMessage(
      raw(),
      owner.toBase58(),
      rpc({ InstructionError: [0, { Custom: 6001 }] }) as any,
    ),
  ).rejects.toThrow(/6001/);
});
it("keeps a token program's own log text out of the message shown to the wallet", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const e = await simulateSolanaMessage(raw(), owner.toBase58(), {
      ...rpc({ InstructionError: [0, { Custom: 6001 }] }),
      simulateTransaction: async () => ({
        context: { slot: 1 },
        value: {
          err: { InstructionError: [0, { Custom: 6001 }] },
          unitsConsumed: 1,
          logs: [
            "Program Tokenkeg... failed: Instruction at 0 consumed 4003 of 200000 compute units",
            "Error Message: insufficient ledger balance in 12uUJdK...",
          ],
        },
      }),
    } as any).catch((x) => x);
    expect(e.message).toContain("6001");
    expect(e.message).not.toContain("compute units");
    expect(e.message).not.toContain("Error Message");
    expect(warn.mock.calls.flat().join(" ")).toContain("insufficient ledger");
  } finally {
    warn.mockRestore();
  }
});
it("rejects wrong payer, wrong network and oversized messages before wallet approval", async () => {
  await expect(
    simulateSolanaMessage(
      raw(),
      Keypair.generate().publicKey.toBase58(),
      rpc() as any,
    ),
  ).rejects.toThrow(/wallet|payer/i);
  await expect(
    simulateSolanaMessage(raw(), owner.toBase58(), {
      ...rpc(),
      getGenesisHash: async () => "devnet",
    } as any),
  ).rejects.toThrow(/mainnet/);
  await expect(
    simulateSolanaMessage(
      Buffer.alloc(1233).toString("base64"),
      owner.toBase58(),
      rpc() as any,
    ),
  ).rejects.toThrow(/1232/);
});
