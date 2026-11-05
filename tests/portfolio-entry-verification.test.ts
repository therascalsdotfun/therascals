import { it, expect } from "vitest";
import bs58 from "bs58";
import {
  PortfolioPositions,
  portfolioFill,
} from "../apps/server/src/portfolio/positions.ts";
import {
  JUPITER_PROGRAM,
  MAINNET_USDC,
} from "../apps/server/src/rewards/receipt.ts";
import { SOLANA_MAINNET_GENESIS } from "../packages/shared/src/solana-network.ts";
const wallet = bs58.encode(new Uint8Array(32).fill(5)),
  mint = bs58.encode(new Uint8Array(32).fill(6)),
  signature = bs58.encode(new Uint8Array(64).fill(7));
const row = (mint: string, amount: string, index: number) => ({
  owner: wallet,
  mint,
  accountIndex: index,
  uiTokenAmount: { amount, decimals: 6 },
});
function tx() {
  return {
    slot: 10,
    blockTime: 1700000000,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [{ signer: true, pubkey: wallet }],
        instructions: [{ programId: JUPITER_PROGRAM }],
      },
    },
    meta: {
      err: null,
      preTokenBalances: [row(MAINNET_USDC, "50000000", 1)],
      postTokenBalances: [
        row(MAINNET_USDC, "30000000", 1),
        row(mint, "100000000", 2),
      ],
    },
  };
}
it("uses successful owner-signed exact token and actual USDC deltas", () => {
  expect(portfolioFill(tx(), wallet, signature)).toMatchObject({
    mint,
    before: "0",
    after: "100000000",
    usdcDelta: "-20000000",
  });
});
it("rejects foreign signer, failed transaction, wrong signature, wrong program and ambiguous deltas", () => {
  const a = tx();
  a.meta.err = "failed" as any;
  expect(portfolioFill(a, wallet, signature)).toBeNull();
  expect(portfolioFill(tx(), wallet + "x", signature)).toBeNull();
  expect(portfolioFill(tx(), wallet, "other")).toBeNull();
  const b = tx();
  b.transaction.message.instructions[0].programId = "other";
  expect(portfolioFill(b, wallet, signature)).toBeNull();
  const c = tx();
  c.meta.postTokenBalances.push(row("other", "3", 3));
  expect(portfolioFill(c, wallet, signature)).toBeNull();
});
it("does not assume zero ownership when pre-balance ownership or decimals are missing", () => {
  const a = tx();
  delete (a.meta.preTokenBalances[0] as any).owner;
  expect(() => portfolioFill(a, wallet, signature)).toThrow();
  const b = tx();
  b.meta.preTokenBalances[0].uiTokenAmount.decimals = 9;
  expect(portfolioFill(b, wallet, signature)).toBeNull();
});
it("refuses a non-mainnet source before reading receipt data", async () => {
  let read = false;
  const service = new PortfolioPositions(undefined, {
    getGenesisHash: async () => "devnet",
    getParsedTransaction: async () => {
      read = true;
      return tx();
    },
  } as any);
  await expect(service.read(wallet, [signature])).rejects.toThrow("mainnet");
  expect(read).toBe(false);
});
it("leaves basis unknown when any supplied history cannot be verified and retries unfinalized receipts", async () => {
  let finalized = false;
  const other = bs58.encode(new Uint8Array(64).fill(8));
  const service = new PortfolioPositions(undefined, {
    getGenesisHash: async () => SOLANA_MAINNET_GENESIS,
    getParsedTransaction: async (s: string) =>
      s === signature
        ? tx()
        : finalized
          ? {
              ...tx(),
              transaction: { ...tx().transaction, signatures: [other] },
            }
          : null,
  } as any);
  const first = await service.read(wallet, [signature, other]);
  expect(first.positions[0].costUsdcAtomic).toBeNull();
  expect(first.warnings.length).toBeGreaterThan(0);
  finalized = true;
  const second = await service.read(wallet, [signature]);
  expect(second.positions[0].costUsdcAtomic).toBe("20000000");
});
