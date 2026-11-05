import { VersionedTransaction, type Connection } from "@solana/web3.js";
import { SOLANA_MAINNET_GENESIS } from "../../../../packages/shared/src/solana-network.ts";
import { UserError } from "../client-message.ts";
export async function simulateSolanaMessage(
  encoded: string,
  owner: string,
  rpc: Pick<
    Connection,
    "getGenesisHash" | "simulateTransaction" | "isBlockhashValid"
  >,
) {
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > 1232)
    throw new UserError(
      "Transaction exceeds Solana's 1232-byte limit. Request a smaller route.",
    );
  const tx = VersionedTransaction.deserialize(bytes);
  if (
    tx.message.staticAccountKeys[0]?.toBase58() !== owner ||
    tx.message.header.numRequiredSignatures < 1
  )
    throw new UserError("Transaction payer does not match this wallet");
  if ((await rpc.getGenesisHash()) !== SOLANA_MAINNET_GENESIS)
    throw new UserError("Simulation RPC is not Solana mainnet");
  const result = await rpc.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (result.value.err) {
    const code =
      typeof result.value.err === "string"
        ? result.value.err
        : JSON.stringify(result.value.err);
    if (/AccountNotFound|InsufficientFunds|InsufficientFundsForRent/.test(code))
      throw new UserError(
        "Not enough SOL or token balance for this trade and network fees. Top up the wallet, then retry.",
      );
    // Program logs are text the token's own program chooses, so they are logged
    // for the operator instead of shown. The error code is a structured enum.
    console.warn(
      "solana simulation failed:",
      result.value.logs?.findLast((s) =>
        /Error Code:|Error Message:|insufficient|failed:/i.test(s),
      ) ?? "(no matching log)",
    );
    throw new UserError(
      `The chain rejected this trade (${code.slice(0, 160)}). No wallet approval was requested.`,
    );
  }
  const blockhash = await rpc.isBlockhashValid(tx.message.recentBlockhash, {
    commitment: "confirmed",
  });
  if (!blockhash.value)
    throw new UserError(
      "This route's recent blockhash is unavailable or expired. Refresh the route before approval.",
    );
  return {
    blockhashSlot: blockhash.context.slot,
    status: "passed" as const,
    slot: result.context.slot,
    unitsConsumed: result.value.unitsConsumed ?? null,
    checkedAt: new Date().toISOString(),
  };
}
