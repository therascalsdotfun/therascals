import bs58 from "bs58";
import { it, expect } from "vitest";
import { Keypair, Message } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deriveMarket } from "../apps/server/src/execution/cpmm.ts";
import {
  canonicalSwapMessage,
  manifestBytes,
  quoteBytes,
} from "../apps/server/src/execution/policy-wire.ts";
it("serializes the constrained legacy message with one signer, fixed compute limit and CPMM program", () => {
  const source = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey,
    u = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey,
    t = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey,
    m = deriveMarket("demo-1", "DEMO-1", u, t),
    ua = getAssociatedTokenAddressSync(u, source),
    ta = getAssociatedTokenAddressSync(t, source);
  const b = canonicalSwapMessage(
      m,
      source.toBase58(),
      ua.toBase58(),
      ta.toBase58(),
      true,
      "5000000",
      "4000000000",
      u.toBase58(),
    ),
    message = Message.from(b);
  expect(message.header).toEqual({
    numRequiredSignatures: 1,
    numReadonlySignedAccounts: 0,
    numReadonlyUnsignedAccounts: 7,
  });
  expect(message.instructions).toHaveLength(2);
  expect(message.accountKeys[0].equals(source)).toBe(true);
  expect(message.accountKeys[12].toBase58()).toBe(m.program);
  expect(() =>
    canonicalSwapMessage(
      { ...m, program: u.toBase58() },
      source.toBase58(),
      ua.toBase58(),
      ta.toBase58(),
      true,
      "5",
      "4",
      u.toBase58(),
    ),
  ).toThrow();
  expect(() =>
    canonicalSwapMessage(
      m,
      source.toBase58(),
      ta.toBase58(),
      ua.toBase58(),
      true,
      "5",
      "4",
      u.toBase58(),
    ),
  ).toThrow();
});
it("binds source, manifest, mapping, side, session and attempt in versioned binary attestations", () => {
  const k = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey.toBase58(),
    d: any = {
      id: "2",
      market_index: 0,
      source_mint: k,
      manifest_hash: "11".repeat(32),
    },
    args: any = {
      session: "1",
      attempt: "3",
      draw: d,
      buy: true,
      amount: "5000000",
      minOut: "4000000000",
      blockhash: k,
      lastValid: "100",
      slot: "90",
      expires: "1234",
      mappingHash: "22".repeat(32),
    };
  const first = quoteBytes(args);
  expect(first.length).toBe(210);
  expect(quoteBytes({ ...args, buy: false })).not.toEqual(first);
  expect(quoteBytes({ ...args, attempt: "4" })).not.toEqual(first);
  expect(
    manifestBytes("1", "1234", "00".repeat(32), [k, k])
      .subarray(0, 19)
      .toString(),
  ).toBe("JACKPOT_MANIFEST_V1");
});

it("collects 0.5% in the same signed buy message and leaves sells fee-free", () => {
  const source = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
  const u = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
  const t = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
  const vault = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
  const m = deriveMarket("demo-1", "DEMO-1", u, t);
  const ua = getAssociatedTokenAddressSync(u, source).toBase58();
  const ta = getAssociatedTokenAddressSync(t, source).toBase58();
  const b = canonicalSwapMessage(
    m,
    source.toBase58(),
    ua,
    ta,
    true,
    "5000000",
    "4000000000",
    u.toBase58(),
    vault.toBase58(),
  );
  const message = Message.from(b);
  expect(message.instructions).toHaveLength(3);
  expect(message.accountKeys[7].equals(vault)).toBe(true);
  const swap = Buffer.from(bs58.decode(message.instructions[1].data));
  const fee = Buffer.from(bs58.decode(message.instructions[2].data));
  expect(swap.readBigUInt64LE(8)).toBe(4975000n);
  expect(fee[0]).toBe(3);
  expect(fee.readBigUInt64LE(1)).toBe(25000n);
  expect(message.instructions[2].accounts).toEqual([1, 7, 0]);
  expect(
    message.accountKeys[message.instructions[2].programIdIndex].toBase58(),
  ).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  expect(
    canonicalSwapMessage(
      m,
      source.toBase58(),
      ua,
      ta,
      false,
      "5000000",
      "4000",
      u.toBase58(),
      vault.toBase58(),
    ),
  ).toEqual(
    canonicalSwapMessage(
      m,
      source.toBase58(),
      ua,
      ta,
      false,
      "5000000",
      "4000",
      u.toBase58(),
    ),
  );
  expect(() =>
    canonicalSwapMessage(
      m,
      source.toBase58(),
      ua,
      ta,
      true,
      "5000000",
      "4000",
      u.toBase58(),
      ua,
    ),
  ).toThrow(/aliases/);
});
