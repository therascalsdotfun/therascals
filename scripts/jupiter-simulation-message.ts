import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

class PacketLimitError extends Error {
  constructor(readonly bytes: number | null) {
    super(
      bytes === null
        ? "Assembled message exceeds Solana's 1232-byte limit"
        : `Assembled transaction is ${bytes} bytes; Solana limit is 1232`,
    );
  }
}

export async function fittingJupiterSimulation(
  build: (maxAccounts: number) => Promise<any>,
  owner: string,
  blockhash: string,
) {
  const attempts: {
    maxAccounts: number;
    bytes: number | null;
    fits: boolean;
  }[] = [];
  for (const maxAccounts of [64, 48, 32, 24, 16]) {
    const quote = await build(maxAccounts);
    try {
      const raw = unsignedJupiterMessage(quote, owner, blockhash);
      attempts.push({
        maxAccounts,
        bytes: Buffer.from(raw, "base64").length,
        fits: true,
      });
      return { quote, raw, attempts };
    } catch (e) {
      if (!(e instanceof PacketLimitError)) throw e;
      attempts.push({ maxAccounts, bytes: e.bytes, fits: false });
      if (maxAccounts === 16) throw e;
    }
  }
  throw Error("No fitting route");
}

/** Compose Jupiter's current /swap/v2/build response without a wallet or signing. */
export function unsignedJupiterMessage(
  build: any,
  owner: string,
  blockhash: string,
) {
  if (!build.swapInstruction || build.transactionVersion !== 0)
    throw Error("Expected Jupiter v0 instructions");
  const convert = (i: any) =>
    new TransactionInstruction({
      programId: new PublicKey(i.programId),
      keys: i.accounts.map((a: any) => ({
        ...a,
        pubkey: new PublicKey(a.pubkey),
      })),
      data: Buffer.from(i.data, "base64"),
    });
  const budget = (build.computeBudgetInstructions ?? []).map(convert);
  if (!budget.some((i: TransactionInstruction) => i.data[0] === 2))
    budget.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
    );
  const tables = Object.entries(build.addressesByLookupTableAddress ?? {}).map(
    ([key, addresses]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          deactivationSlot: 18446744073709551615n,
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: (addresses as string[]).map((a) => new PublicKey(a)),
        },
      }),
  );
  const instructions = [
    ...budget,
    ...(build.setupInstructions ?? []).map(convert),
    ...(build.otherInstructions ?? []).map(convert),
    convert(build.swapInstruction),
    ...(build.cleanupInstruction ? [convert(build.cleanupInstruction)] : []),
    ...(build.tipInstruction ? [convert(build.tipInstruction)] : []),
  ];
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(owner),
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(tables),
  );
  if (tx.signatures.some((s) => s.some((byte) => byte !== 0)))
    throw Error("Unexpected signature");
  let serialized: Uint8Array;
  try {
    serialized = tx.serialize();
  } catch (e) {
    // web3.js also limits the message buffer before transaction serialization.
    if (e instanceof RangeError && e.message === "encoding overruns Uint8Array")
      throw new PacketLimitError(null);
    throw e;
  }
  if (serialized.length > 1232) throw new PacketLimitError(serialized.length);
  return Buffer.from(serialized).toString("base64");
}
