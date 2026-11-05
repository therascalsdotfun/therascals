import { expect, it } from "vitest";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import {
  unsignedJupiterMessage,
  fittingJupiterSimulation,
} from "../scripts/jupiter-simulation-message.ts";

const owner = Keypair.generate().publicKey.toBase58();
const hash = Keypair.generate().publicKey.toBase58();
function build(bytes: number) {
  return {
    transactionVersion: 0,
    swapInstruction: {
      programId: "11111111111111111111111111111111",
      accounts: [],
      data: Buffer.alloc(bytes).toString("base64"),
    },
  };
}
it("rejects an oversized assembled route before submitting it for simulation", () => {
  expect(() => unsignedJupiterMessage(build(1250), owner, hash)).toThrow(
    /1232/,
  );
});
it("keeps a fitting simulation message entirely unsigned", () => {
  const raw = Buffer.from(
    unsignedJupiterMessage(build(10), owner, hash),
    "base64",
  );
  expect(raw.length).toBeLessThanOrEqual(1232);
  const tx = VersionedTransaction.deserialize(raw);
  expect(tx.message.staticAccountKeys[0].toBase58()).toBe(owner);
  expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(
    true,
  );
});
it("rebuilds oversized quotes with a smaller bounded account limit", async () => {
  const requested: number[] = [];
  const result = await fittingJupiterSimulation(
    async (maxAccounts) => {
      requested.push(maxAccounts);
      return build(maxAccounts > 32 ? 1250 : 10);
    },
    owner,
    hash,
  );
  expect(requested).toEqual([64, 48, 32]);
  expect(result.attempts.map((a) => a.fits)).toEqual([false, false, true]);
  expect(Buffer.from(result.raw, "base64").length).toBeLessThanOrEqual(1232);
});
it("does not retry unrelated builder failures as oversized routes", async () => {
  let requests = 0;
  await expect(
    fittingJupiterSimulation(
      async () => {
        requests++;
        throw Error("Provider unavailable");
      },
      owner,
      hash,
    ),
  ).rejects.toThrow("Provider unavailable");
  expect(requests).toBe(1);
});
it("stops when the smallest allowed route still exceeds the packet limit", async () => {
  const requested: number[] = [];
  await expect(
    fittingJupiterSimulation(
      async (limit) => {
        requested.push(limit);
        return build(1250);
      },
      owner,
      hash,
    ),
  ).rejects.toThrow(/1232/);
  expect(requested).toEqual([64, 48, 32, 24, 16]);
});
