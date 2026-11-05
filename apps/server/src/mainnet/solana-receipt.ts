import type { Connection } from "@solana/web3.js";
import { SOLANA_MAINNET_GENESIS } from "../../../../packages/shared/src/solana-network.ts";
import { UserError } from "../client-message.ts";
export async function solanaReceipt(
  signature: string,
  blockhash: string,
  observedSlot: number,
  rpc: Pick<
    Connection,
    "getGenesisHash" | "getSignatureStatuses" | "isBlockhashValid" | "getSlot"
  >,
) {
  if ((await rpc.getGenesisHash()) !== SOLANA_MAINNET_GENESIS)
    throw new UserError("Receipt RPC is not Solana mainnet");
  const statuses = await rpc.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const receipt = statuses.value[0];
  if (receipt?.confirmationStatus === "finalized")
    return { signature, status: receipt.err ? "failed" : "finalized" };
  if (receipt) return { signature, status: "pending" };
  // A recent hash can be absent from a finalized bank simply because it is
  // newer. Wait for that bank to reach the slot where preflight saw it valid.
  if ((await rpc.getSlot("finalized")) < observedSlot)
    return { signature, status: "pending" };
  const valid = await rpc.isBlockhashValid(blockhash, {
    commitment: "finalized",
  });
  // Recheck history after observing expiry, closing the gap between the reads.
  if (!valid.value) {
    const after = (
      await rpc.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (after?.confirmationStatus === "finalized")
      return { signature, status: after.err ? "failed" : "finalized" };
    if (!after) return { signature, status: "expired" };
  }
  return { signature, status: "pending" };
}
