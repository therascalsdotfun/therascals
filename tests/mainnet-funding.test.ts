import { expect, it } from "vitest";
import { Keypair, Transaction, SendTransactionError } from "@solana/web3.js";
import {
  assertSolanaMainnet,
  fundingInstructions,
  verifyFundingTransaction,
} from "../apps/server/src/mainnet/funding.ts";
it("rejects test clusters and accepts only the canonical mainnet genesis", () => {
  expect(() =>
    assertSolanaMainnet("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
  ).toThrow("not Solana mainnet");
  expect(() =>
    assertSolanaMainnet("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"),
  ).not.toThrow();
  expect(() => assertSolanaMainnet("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toThrow(
    "not Solana mainnet",
  );
});
it("binds the signed deposit to exact transfer bytes, sender, amount and recipient", () => {
  const sender = Keypair.generate(),
    to = Keypair.generate().publicKey,
    tx = new Transaction({
      feePayer: sender.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      ...fundingInstructions(
        sender.publicKey.toBase58(),
        to.toBase58(),
        "nep141:sol.omft.near",
        undefined,
        "1000000",
      ),
    );
  const expected = tx.serializeMessage().toString("base64");
  tx.sign(sender);
  expect(
    verifyFundingTransaction(
      tx.serialize().toString("base64"),
      expected,
      sender.publicKey.toBase58(),
    ).signature,
  ).toBeTruthy();
  expect(() =>
    verifyFundingTransaction(
      tx.serialize().toString("base64"),
      expected,
      Keypair.generate().publicKey.toBase58(),
    ),
  ).toThrow();
  tx.instructions = fundingInstructions(
    sender.publicKey.toBase58(),
    to.toBase58(),
    "nep141:sol.omft.near",
    undefined,
    "2000000",
  );
  tx.sign(sender);
  expect(() =>
    verifyFundingTransaction(
      tx.serialize().toString("base64"),
      expected,
      sender.publicKey.toBase58(),
    ),
  ).toThrow("different");
});
it("never permits an arbitrary SPL mint as a funding asset", () => {
  expect(() =>
    fundingInstructions(
      Keypair.generate().publicKey.toBase58(),
      Keypair.generate().publicKey.toBase58(),
      "other",
      Keypair.generate().publicKey.toBase58(),
      "1000000",
    ),
  ).toThrow("not supported");
});

import { vi } from "vitest";
import { IntentsFunding } from "../apps/server/src/mainnet/funding.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
it("blocks an unfunded Intents deposit before recording any wallet approval request", async () => {
  const store = new MarketStore(":memory:"),
    owner = Keypair.generate().publicKey.toBase58(),
    save = vi.fn();
  const operation = {
    id: "unfunded",
    phase: "prepared",
    amountIn: "1000000",
    origin: { assetId: "nep141:sol.omft.near", blockchain: "sol" },
    depositAddress: Keypair.generate().publicKey.toBase58(),
  };
  const rpc: any = {
    getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 1,
    }),
    simulateTransaction: async () => ({
      context: { slot: 1 },
      value: { err: "AccountNotFound" },
    }),
  };
  try {
    const service = new IntentsFunding(
      store,
      { assertFundable: () => operation, save } as any,
      rpc,
    );
    await expect(
      service.prepare({ kind: "phantom", address: owner } as any, "unfunded"),
    ).rejects.toThrow(/balance|fund/i);
    expect(save).not.toHaveBeenCalled();
    expect(store.getRecord("intents-funding:unfunded")).toBeNull();
    expect(operation.phase).toBe("prepared");
  } finally {
    store.close();
  }
});
it.each(["timeout", "preflight"])(
  "records a %s broadcast outcome once and never sends a second transfer on retry",
  async (kind) => {
    const sender = Keypair.generate(),
      recipient = Keypair.generate().publicKey.toBase58();
    const store = new MarketStore(":memory:");
    let op: any = {
      id: "mock",
      phase: "prepared",
      amountIn: "10000",
      depositAddress: recipient,
      origin: { assetId: "nep141:sol.omft.near", blockchain: "sol" },
      fundBefore: new Date(Date.now() + 60000).toISOString(),
    };
    const identity: any = {
      kind: "phantom",
      address: sender.publicKey.toBase58(),
    };
    const swaps: any = {
      get: () => structuredClone(op),
      assertFundable: () => {
        if (op.fundingSignature) throw Error("already funded");
        return structuredClone(op);
      },
      save: (value: any) => {
        op = structuredClone(value);
        return value;
      },
      refresh: async () => structuredClone(op),
      notify: vi.fn(),
    };
    const rpc: any = {
      getGenesisHash: async () =>
        "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 1,
      }),
      isBlockhashValid: async () => ({ value: true, context: { slot: 1 } }),
      simulateTransaction: async () => ({
        context: { slot: 1 },
        value: { err: null, unitsConsumed: 150, logs: [] },
      }),
      sendRawTransaction: vi.fn(async () => {
        if (kind === "preflight")
          throw new SendTransactionError({
            action: "simulate",
            signature: "",
            transactionMessage: "insufficient SOL",
          });
        throw Error("network timed out after acceptance");
      }),
    };
    try {
      const funding = new IntentsFunding(store, swaps, rpc);
      const prepared: any = await funding.prepare(identity, "mock");
      const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
      tx.sign(sender);
      const signed = tx.serialize().toString("base64");
      const first = await funding.submit(identity, "mock", signed);
      expect(first.phase).toBe(
        kind === "preflight" ? "funding_failed" : "unknown",
      );
      expect(first.fundingSignature).toBeTruthy();
      expect(store.getRecord<any>("intents-funding:mock").wire).toBe(signed);
      expect(
        (await funding.submit(identity, "mock", signed)).fundingSignature,
      ).toBe(first.fundingSignature);
      expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
      expect(swaps.notify).not.toHaveBeenCalled();
      await expect(funding.prepare(identity, "mock")).rejects.toThrow("funded");
    } finally {
      store.close();
    }
  },
);
it("claims a single wallet-approval attempt across two tabs before requesting a NEAR transfer", async () => {
  const store = new MarketStore(":memory:");
  let op: any = {
    id: "near-op",
    phase: "prepared",
    amountIn: "1000000000000000000000000",
    depositAddress: "deposit.near",
    origin: { blockchain: "near" },
  };
  const swaps: any = {
    get: () => structuredClone(op),
    assertFundable: () => structuredClone(op),
    save: (o: any) => {
      op = structuredClone(o);
      return o;
    },
  };
  const identity: any = { kind: "near", address: "sender.near" };
  try {
    const funding = new IntentsFunding(store, swaps);
    expect((await funding.prepare(identity, "near-op")).chain).toBe("near");
    expect(op.fundingRequestedAt).toEqual(expect.any(String));
    op.phase = "prepared"; // A stale phase does not release the durable claim.
    await expect(funding.prepare(identity, "near-op")).rejects.toThrow(
      "already requested",
    );
    funding.reject(identity, "near-op");
    expect(op.fundingRequestedAt).toBeUndefined();
    expect((await funding.prepare(identity, "near-op")).chain).toBe("near");
  } finally {
    store.close();
  }
});

it("allows correcting an unverified NEAR candidate while keeping deposit approval locked", async () => {
  const store = new MarketStore(":memory:");
  let op: any = {
    id: "near-op",
    phase: "awaiting_wallet",
    amountIn: "10",
    depositAddress: "deposit.near",
    origin: { blockchain: "near" },
  };
  const identity: any = { kind: "near", address: "sender.near" };
  const swaps: any = {
    get: () => structuredClone(op),
    save: (o: any) => {
      op = structuredClone(o);
      return o;
    },
    notify: async (_i: any, _id: string, hash: string) => {
      op.fundingSignature = hash;
      op.phase = "deposit_submitted";
      return op;
    },
  };
  const near: any = {
    sendJsonRpc: async (method: string, args: any[]) =>
      method === "status"
        ? { chain_id: "mainnet" }
        : {
            transaction: {
              hash: args[0],
              signer_id: "sender.near",
              receiver_id:
                args[0] === "wrong" ? "someone.near" : "deposit.near",
              actions: [{ Transfer: { deposit: "10" } }],
            },
            status: { SuccessValue: "" },
          },
  };
  try {
    const funding = new IntentsFunding(store, swaps, {} as any, near);
    const wrong = await funding.notifyNear(identity, "near-op", "wrong");
    expect(wrong.fundingSignature).toBeUndefined();
    expect(wrong.phase).toBe("awaiting_wallet");
    const correct = await funding.notifyNear(identity, "near-op", "correct");
    expect(correct.fundingSignature).toBe("correct");
    expect(correct.fundingChainStatus).toBe("finalized");
  } finally {
    store.close();
  }
});
it("unlocks a conclusively failed finalized source transfer without treating unknown status as failure", async () => {
  const store = new MarketStore(":memory:");
  let op: any = {
    id: "op",
    origin: { blockchain: "sol" },
    phase: "unknown",
    fundingSignature: "original",
  };
  const swaps: any = {
    get: () => structuredClone(op),
    save: (o: any) => {
      op = structuredClone(o);
      return o;
    },
    refresh: async () => op,
  };
  let failed = false;
  const rpc: any = {
    getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    getSignatureStatuses: async () => ({
      value: [
        failed
          ? {
              confirmationStatus: "finalized",
              err: { InstructionError: [0, "InsufficientFunds"] },
            }
          : null,
      ],
    }),
  };
  try {
    const funding = new IntentsFunding(store, swaps, rpc);
    expect((await funding.status({} as any, "op")).phase).toBe("unknown");
    failed = true;
    expect((await funding.status({} as any, "op")).phase).toBe(
      "funding_failed",
    );
  } finally {
    store.close();
  }
});
