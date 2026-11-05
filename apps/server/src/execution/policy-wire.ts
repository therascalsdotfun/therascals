import { PublicKey, Message, ComputeBudgetProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { protocolFeeSplit } from "../../../../packages/shared/src/protocol-fee.ts";
import { degenAmountForRoll } from "../../../../packages/shared/src/degen-amount.ts";
export function degenAmountFromSeed(seed: string): string {
  if (!/^[a-f0-9]{64}$/.test(seed)) throw Error("Invalid selection seed");
  let entropy = createHash("sha256")
    .update("jackpot:amount:v1")
    .update(Buffer.from(seed, "hex"))
    .digest();
  const limit = 2 ** 32 - (2 ** 32 % 10000);
  for (;;) {
    const roll = entropy.readUInt32BE(0);
    if (roll < limit) return String(degenAmountForRoll(roll % 10000) * 1e6);
    entropy = createHash("sha256").update(entropy).digest();
  }
}
import {
  deriveMarket,
  swapInstruction,
  CPMM_PROGRAM,
  type DemoMarket,
} from "./cpmm.ts";
const u64 = (s: string) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(s));
    return b;
  },
  key = (s: string) => Buffer.from(bs58.decode(s)),
  hex = (s: string) => {
    if (!/^[0-9a-f]{64}$/.test(s)) throw new Error("Expected 32 byte hash");
    return Buffer.from(s, "hex");
  };
export function canonicalSwapMessage(
  m: DemoMarket,
  source: string,
  usdcAta: string,
  tokenAta: string,
  buy: boolean,
  amount: string,
  minOut: string,
  blockhash: string,
  feeVaultAta?: string,
): Buffer {
  if (!buy) feeVaultAta = undefined;
  const owner = new PublicKey(source),
    u = new PublicKey(m.mintUsdc),
    t = new PublicKey(m.mintToken),
    expected = deriveMarket(m.id, m.symbol, u, t);
  for (const k of [
    "program",
    "config",
    "pool",
    "authority",
    "observation",
    "lpMint",
    "mint0",
    "mint1",
    "vaultUsdc",
    "vaultToken",
  ] as const)
    if (m[k] !== expected[k])
      throw new Error("Fixed market configuration mismatch: " + k);
  if (
    getAssociatedTokenAddressSync(u, owner).toBase58() !== usdcAta ||
    getAssociatedTokenAddressSync(t, owner).toBase58() !== tokenAta
  )
    throw new Error("Recipient ATA substitution rejected");
  const keys = [
    source,
    usdcAta,
    tokenAta,
    m.pool,
    m.vaultUsdc,
    m.vaultToken,
    m.observation,
    m.authority,
    m.config,
    m.mintUsdc,
    m.mintToken,
    TOKEN_PROGRAM_ID.toBase58(),
    CPMM_PROGRAM.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
  ].map((k) => new PublicKey(k));
  const fee = buy && feeVaultAta ? protocolFeeSplit(amount) : null;
  if (feeVaultAta) {
    const destination = new PublicKey(feeVaultAta);
    if (keys.some((k) => k.equals(destination)))
      throw Error("Fee destination aliases a swap account");
    keys.splice(7, 0, destination);
  }
  const shift = (i: number) => (feeVaultAta && i >= 7 ? i + 1 : i);
  const ix = swapInstruction(
    m,
    owner,
    buy,
    BigInt(fee?.principalAtomic ?? amount),
    BigInt(minOut),
  );
  return Buffer.from(
    new Message({
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 7,
      },
      accountKeys: keys,
      recentBlockhash: blockhash,
      instructions: [
        {
          programIdIndex: shift(13),
          accounts: [],
          data: bs58.encode(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }).data,
          ),
        },
        {
          programIdIndex: shift(12),
          accounts: [
            0,
            7,
            8,
            3,
            buy ? 1 : 2,
            buy ? 2 : 1,
            buy ? 4 : 5,
            buy ? 5 : 4,
            11,
            11,
            buy ? 9 : 10,
            buy ? 10 : 9,
            6,
          ].map(shift),
          data: bs58.encode(ix.data),
        },
        ...(fee
          ? [
              {
                programIdIndex: shift(11),
                accounts: [1, 7, 0],
                data: bs58.encode(
                  Buffer.concat([Buffer.from([3]), u64(fee.feeAtomic)]),
                ),
              },
            ]
          : []),
      ],
    }).serialize(),
  );
}
export function manifestBytes(
  session: string,
  created: string,
  configurationHash: string,
  mints: string[],
): Buffer {
  return Buffer.concat([
    Buffer.from("JACKPOT_MANIFEST_V1"),
    u64(session),
    u64(created),
    hex(configurationHash),
    Buffer.from([mints.length]),
    ...mints.map(key),
  ]);
}
export interface QuoteArgs {
  session: string;
  attempt: string;
  draw: {
    id: string;
    market_index: number;
    source_mint: string;
    manifest_hash: string;
  };
  buy: boolean;
  amount: string;
  minOut: string;
  blockhash: string;
  lastValid: string;
  slot: string;
  expires: string;
  mappingHash: string;
}
export function quoteBytes(a: QuoteArgs): Buffer {
  return Buffer.concat([
    Buffer.from("JACKPOT_QUOTE_V1"),
    u64(a.session),
    u64(a.attempt),
    u64(a.draw.id),
    Buffer.from([a.draw.market_index, Number(a.buy)]),
    u64(a.amount),
    u64(a.minOut),
    key(a.blockhash),
    u64(a.lastValid),
    u64(a.slot),
    u64(a.expires),
    key(a.draw.source_mint),
    hex(a.draw.manifest_hash),
    hex(a.mappingHash),
  ]);
}

export function proximityBytes(
  manifest: Uint8Array,
  selectedMint: string,
  releaseHash: string,
) {
  return Buffer.concat([
    Buffer.from("JACKPOT_PROXIMITY_V1"),
    Buffer.from(createHash("sha256").update(manifest).digest()),
    key(selectedMint),
    hex(releaseHash),
  ]);
}
