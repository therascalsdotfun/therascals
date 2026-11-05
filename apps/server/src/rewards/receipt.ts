import bs58 from "bs58";
import type { TradeTicket, VerifiedRewardBuy } from "./service.ts";
import { RewardsError } from "./service.ts";
import { assertSolanaMainnet, mainnetConnection } from "../mainnet/funding.ts";
// Official Jupiter v6 IDL: jup-ag/jupiter-amm-implementation/idls/jupiter_aggregator_v6.json.
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export function validRewardSignature(value: string) {
  try {
    return (
      value.length >= 80 &&
      value.length <= 90 &&
      bs58.decode(value).length === 64
    );
  } catch {
    return false;
  }
}
const key = (value: any): string =>
  typeof value === "string" ? value : (value?.toBase58?.() ?? "");
export function verifyRewardReceipt(
  tx: any,
  ticket: Pick<
    TradeTicket,
    "ownerAddress" | "mint" | "maxAtomic" | "createdAt" | "expiresAt"
  >,
  signature: string,
  now: number,
): VerifiedRewardBuy {
  const at = tx?.blockTime * 1000;
  const message = tx?.transaction?.message;
  const instructions = [
    ...(message?.instructions ?? []),
    ...(tx?.meta?.innerInstructions ?? []).flatMap(
      (v: any) => v.instructions ?? [],
    ),
  ];
  if (
    !tx?.meta ||
    tx.meta.err !== null ||
    tx.transaction?.signatures?.[0] !== signature ||
    !Number.isFinite(at) ||
    at < ticket.createdAt - 30000 ||
    at > ticket.expiresAt ||
    at > now + 60000 ||
    !message?.accountKeys?.some(
      (a: any) => a.signer === true && key(a.pubkey) === ticket.ownerAddress,
    ) ||
    !instructions.some((i: any) => key(i.programId) === JUPITER_PROGRAM)
  )
    throw new RewardsError(
      "A finalized, successful Jupiter buy from this wallet and trade window is required.",
    );
  function sum(rows: any[], mint: string) {
    if (!Array.isArray(rows))
      throw new RewardsError("Token-balance evidence unavailable.");
    const indexes = new Set<number>();
    return rows
      .filter((b) => b.owner === ticket.ownerAddress && b.mint === mint)
      .reduce((n, b) => {
        if (
          !Number.isInteger(b.accountIndex) ||
          indexes.has(b.accountIndex) ||
          !/^\d{1,30}$/.test(b.uiTokenAmount?.amount ?? "") ||
          (mint === MAINNET_USDC && b.uiTokenAmount.decimals !== 6)
        )
          throw new RewardsError("Incomplete token-balance evidence.");
        indexes.add(b.accountIndex);
        return n + BigInt(b.uiTokenAmount.amount);
      }, 0n);
  }
  const input =
    sum(tx.meta.preTokenBalances, MAINNET_USDC) -
    sum(tx.meta.postTokenBalances, MAINNET_USDC);
  const output =
    sum(tx.meta.postTokenBalances, ticket.mint) -
    sum(tx.meta.preTokenBalances, ticket.mint);
  if (
    ticket.mint === MAINNET_USDC ||
    input <= 0n ||
    input > BigInt(ticket.maxAtomic) ||
    input > 100000000n ||
    output <= 0n
  )
    throw new RewardsError(
      "Receipt needs a positive USDC spend and selected-token receipt within the locked amount. Sells, SOL swaps and funding transfers do not earn buy rewards.",
    );
  return {
    volumeAtomic: String(input),
    mint: ticket.mint,
    signature,
    confirmedAt: new Date(at).toISOString(),
  };
}
export async function verifyMainnetBuy(
  _identity: unknown,
  ticket: TradeTicket,
  signature: string,
) {
  const rpc = mainnetConnection();
  assertSolanaMainnet(await rpc.getGenesisHash());
  const tx = await rpc.getParsedTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx)
    throw new RewardsError(
      "Receipt is not finalized yet. Retry this same receipt shortly.",
    );
  return verifyRewardReceipt(tx, ticket, signature, Date.now());
}
