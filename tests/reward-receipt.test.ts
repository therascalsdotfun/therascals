import { expect, it } from "vitest";
import {
  verifyRewardReceipt,
  JUPITER_PROGRAM,
  MAINNET_USDC,
} from "../apps/server/src/rewards/receipt.ts";
const owner = "11111111111111111111111111111111",
  mint = "So11111111111111111111111111111111111111112",
  signature = "2".repeat(88);
const now = Date.now();
function transaction() {
  return {
    blockTime: Math.floor(now / 1000),
    meta: {
      err: null,
      preTokenBalances: [
        {
          accountIndex: 1,
          owner,
          mint: MAINNET_USDC,
          uiTokenAmount: { amount: "20000000", decimals: 6 },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 1,
          owner,
          mint: MAINNET_USDC,
          uiTokenAmount: { amount: "10000000", decimals: 6 },
        },
        {
          accountIndex: 2,
          owner,
          mint,
          uiTokenAmount: { amount: "300", decimals: 9 },
        },
      ],
      innerInstructions: [],
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [{ pubkey: owner, signer: true }],
        instructions: [{ programId: JUPITER_PROGRAM }],
      },
    },
  };
}
it("reads actual USDC debits and token credits, binds the signer, mint, signature and purchase window", () => {
  const ticket = {
    ownerAddress: owner,
    mint,
    maxAtomic: "10000000",
    createdAt: now - 1000,
    expiresAt: now + 10000,
  };
  expect(
    verifyRewardReceipt(transaction(), ticket, signature, now).volumeAtomic,
  ).toBe("10000000");
  for (const patch of [
    (t: any) => {
      t.meta.err = "failed";
    },
    (t: any) => {
      t.transaction.signatures = ["3".repeat(88)];
    },
    (t: any) => {
      t.transaction.message.accountKeys[0].signer = false;
    },
    (t: any) => {
      t.transaction.message.instructions = [];
    },
    (t: any) => {
      t.blockTime -= 86400;
    },
    (t: any) => {
      t.meta.postTokenBalances[0].uiTokenAmount.amount = "0";
    },
    (t: any) => {
      t.meta.postTokenBalances[1].mint = MAINNET_USDC;
    },
    (t: any) => {
      t.meta.postTokenBalances[1].owner = "other";
    },
  ]) {
    const t = transaction();
    patch(t);
    expect(() => verifyRewardReceipt(t, ticket, signature, now)).toThrow();
  }
});
