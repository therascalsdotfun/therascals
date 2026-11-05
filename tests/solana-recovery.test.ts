import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import Fastify from "fastify";
import {
  pendingSolanaSubmissions,
  assertNoPendingSolana,
  rememberSolanaSubmission,
  reconcileSolanaSubmissions,
} from "../apps/web/src/solana-recovery.ts";
import { solanaReceipt } from "../apps/server/src/mainnet/solana-receipt.ts";
import { registerMainnet } from "../apps/server/src/mainnet/http.ts";
import { SOLANA_MAINNET_GENESIS } from "../packages/shared/src/solana-network.ts";
const owner = Keypair.generate(),
  wallet = owner.publicKey.toBase58();
function signed() {
  const tx = new Transaction({
    feePayer: owner.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  tx.sign(owner);
  return tx;
}
let store: Map<string, string>;
beforeEach(() => {
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn(async (_name: string, operation: () => unknown) =>
        operation(),
      ),
    },
  });
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
it("persists a real signed transaction identity across callers and refuses malformed recovery state", async () => {
  const tx = signed();
  const row = await rememberSolanaSubmission(wallet, tx, 200);
  expect(row.blockhash).toBe(tx.recentBlockhash);
  expect(pendingSolanaSubmissions(wallet)).toEqual([row]);
  expect(() => assertNoPendingSolana(wallet)).toThrow("unresolved");
  expect(
    pendingSolanaSubmissions(Keypair.generate().publicKey.toBase58()),
  ).toEqual([]);
  store.set("rascals-solana-pending:" + wallet, "broken");
  expect(() => assertNoPendingSolana(wallet)).toThrow("unreadable");
});
it("does not use recent-blockhash expiry rules for a durable nonce", async () => {
  const tx = signed();
  tx.nonceInfo = {
    nonce: tx.recentBlockhash!,
    nonceInstruction: SystemProgram.nonceAdvance({
      noncePubkey: owner.publicKey,
      authorizedPubkey: owner.publicKey,
    }),
  };
  await expect(rememberSolanaSubmission(wallet, tx, 200)).rejects.toThrow(
    "Durable-nonce",
  );
});
it.each(["pending", "finalized", "failed", "expired"])(
  "keeps only pending submissions locked after verified %s response",
  async (status) => {
    const row = await rememberSolanaSubmission(wallet, signed(), 200);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ signature: row.signature, status })),
      ),
    );
    const result = await reconcileSolanaSubmissions(wallet);
    expect(result).toHaveLength(status === "pending" ? 0 : 1);
    expect(pendingSolanaSubmissions(wallet)).toHaveLength(
      status === "pending" ? 1 : 0,
    );
  },
);
it("keeps the lock when the RPC fails or a mismatched receipt is returned", async () => {
  await rememberSolanaSubmission(wallet, signed(), 200);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ signature: "other", status: "expired" })),
    ),
  );
  await expect(reconcileSolanaSubmissions(wallet)).rejects.toThrow("verified");
  expect(pendingSolanaSubmissions(wallet)).toHaveLength(1);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("offline");
    }),
  );
  await expect(reconcileSolanaSubmissions(wallet)).rejects.toThrow("offline");
  expect(pendingSolanaSubmissions(wallet)).toHaveLength(1);
});
const rpc = (value: any, valid = true) => ({
  getSlot: vi.fn(async () => 201),
  getGenesisHash: vi.fn(async () => SOLANA_MAINNET_GENESIS),
  getSignatureStatuses: vi.fn(async () => ({ value: [value] })),
  isBlockhashValid: vi.fn(async () => ({ value: valid })),
});
it.each([
  [{ confirmationStatus: "confirmed", err: null }, "pending"],
  [{ confirmationStatus: "confirmed", err: {} }, "pending"],
  [{ confirmationStatus: "finalized", err: null }, "finalized"],
  [{ confirmationStatus: "finalized", err: {} }, "failed"],
  [null, "pending"],
])(
  "uses chain finality before releasing a known submission",
  async (value, status) => {
    expect(
      await solanaReceipt("signature", "hash", 200, rpc(value) as any),
    ).toMatchObject({ status });
  },
);
it("rechecks history after blockhash expiry and rejects a different network", async () => {
  const connection = rpc(null, false);
  expect(
    await solanaReceipt("signature", "hash", 200, connection as any),
  ).toMatchObject({ status: "expired" });
  expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(2);
  connection.getSignatureStatuses.mockResolvedValueOnce({ value: [null] });
  connection.getSignatureStatuses.mockResolvedValueOnce({
    value: [{ confirmationStatus: "confirmed", err: null }],
  });
  expect(
    await solanaReceipt("signature", "hash", 200, connection as any),
  ).toMatchObject({ status: "pending" });
  connection.getGenesisHash.mockResolvedValueOnce("devnet");
  await expect(
    solanaReceipt("signature", "hash", 200, connection as any),
  ).rejects.toThrow("mainnet");
});
it("validates receipt queries and keeps provider failures out of public responses", async () => {
  const connection = rpc(null);
  const app = Fastify();
  registerMainnet(app, {
    market: () => null,
    rate: () => {},
    solana: connection as any,
  });
  try {
    expect(
      (
        await app.inject({
          url: "/api/mainnet/solana/receipt?signature=bad&blockhash=bad",
        })
      ).statusCode,
    ).toBe(400);
    const row = await rememberSolanaSubmission(wallet, signed(), 200);
    connection.getGenesisHash.mockRejectedValueOnce(
      Error("private provider diagnostics"),
    );
    const result = await app.inject({
      url:
        "/api/mainnet/solana/receipt?" +
        new URLSearchParams({
          signature: row.signature,
          blockhash: row.blockhash,
          observedSlot: String(row.observedSlot),
        }),
    });
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toContain("private provider");
  } finally {
    await app.close();
  }
});

it("does not mistake a blockhash newer than the finalized bank for expiry", async () => {
  const connection = rpc(null, false);
  connection.getSlot.mockResolvedValueOnce(199);
  expect(
    await solanaReceipt("signature", "hash", 200, connection as any),
  ).toMatchObject({ status: "pending" });
  expect(connection.isBlockhashValid).not.toHaveBeenCalled();
});

it("permits only one new signing attempt and preserves explicitly grouped transaction signatures", async () => {
  const attempts = await Promise.allSettled([
    rememberSolanaSubmission(wallet, signed(), 200),
    rememberSolanaSubmission(wallet, signed(), 200),
  ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(pendingSolanaSubmissions(wallet)).toHaveLength(1);
  const first = pendingSolanaSubmissions(wallet)[0];
  await rememberSolanaSubmission(wallet, signed(), 200, undefined, [
    first.signature,
  ]);
  expect(pendingSolanaSubmissions(wallet)).toHaveLength(2);
});
it("stops before signing when cross-tab coordination is unavailable", () => {
  vi.stubGlobal("navigator", {});
  expect(() => assertNoPendingSolana(wallet)).toThrow("Web Locks");
});
