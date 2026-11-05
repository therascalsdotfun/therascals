import { it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  deriveMarket,
  swapInstruction,
  quoteExactIn,
  CPMM_PROGRAM,
} from "../apps/server/src/execution/cpmm.ts";
const pk = (n: number) =>
  new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n : i)));
it("builds the fixed Raydium exact-in instruction and reverses vault/mint/ATA sides together", () => {
  const m = deriveMarket("demo-a", "DEMO-A", pk(1), pk(2));
  const buy = swapInstruction(m, pk(3), true, 5000000n, 4000000000n),
    sell = swapInstruction(m, pk(3), false, 4000000000n, 4000000n);
  expect(buy.programId.toBase58()).toBe(CPMM_PROGRAM.toBase58());
  expect(buy.data.subarray(0, 8).toString("hex")).toBe("8fbe5adac41e33de");
  expect(buy.data.readBigUInt64LE(8)).toBe(5000000n);
  expect(buy.keys).toHaveLength(13);
  expect(buy.keys[6].pubkey.toBase58()).toBe(sell.keys[7].pubkey.toBase58());
  expect(buy.keys[10].pubkey.toBase58()).toBe(sell.keys[11].pubkey.toBase58());
  expect(buy.keys.filter((k) => k.isSigner)).toHaveLength(1);
});
it("quotes integer constant-product output with ceiling-rounded input fees", () => {
  expect(quoteExactIn(1000n, 100000n, 1000000n, 2500n)).toEqual({
    fee: 3n,
    output: 9871n,
  });
  expect(() => quoteExactIn(0n, 100n, 100n, 2500n)).toThrow();
  expect(() => quoteExactIn(1n, 0n, 100n, 2500n)).toThrow();
});
