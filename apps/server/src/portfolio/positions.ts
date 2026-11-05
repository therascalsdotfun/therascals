import type { MarketStore } from "../market/store.ts";
import { mainnetConnection, assertSolanaMainnet } from "../mainnet/funding.ts";
import {
  JUPITER_PROGRAM,
  MAINNET_USDC,
  validRewardSignature,
} from "../rewards/receipt.ts";
import {
  trackedPositions,
  type TrackedFill,
} from "../../../../packages/shared/src/portfolio-position.ts";
const key = (v: any): string =>
  typeof v === "string" ? v : (v?.toBase58?.() ?? "");
/** Receipts are hints only. The server derives amounts from finalized chain deltas. */
export function portfolioFill(
  tx: any,
  wallet: string,
  signature: string,
): TrackedFill | null {
  if (
    !tx?.meta ||
    tx.meta.err !== null ||
    !Number.isFinite(tx.blockTime) ||
    !Number.isSafeInteger(tx.slot) ||
    tx.transaction?.signatures?.[0] !== signature
  )
    return null;
  const message = tx.transaction.message;
  if (
    !message?.accountKeys?.some(
      (a: any) => a.signer === true && key(a.pubkey) === wallet,
    )
  )
    return null;
  const instructions = [
    ...(message.instructions ?? []),
    ...(tx.meta.innerInstructions ?? []).flatMap(
      (v: any) => v.instructions ?? [],
    ),
  ];
  if (!instructions.some((i: any) => key(i.programId) === JUPITER_PROGRAM))
    return null;
  const sum = (rows: any[]) => {
    if (!Array.isArray(rows)) throw Error("Missing token balances");
    if (rows.some((row) => typeof row.owner !== "string"))
      throw Error("Incomplete balance ownership evidence");
    const map = new Map<string, { raw: bigint; decimals: number }>(),
      seen = new Set<number>();
    for (const row of rows.filter((r) => r.owner === wallet)) {
      const amount = row.uiTokenAmount;
      if (
        !Number.isInteger(row.accountIndex) ||
        seen.has(row.accountIndex) ||
        !/^\d{1,80}$/.test(amount?.amount ?? "") ||
        !Number.isInteger(amount.decimals) ||
        amount.decimals < 0 ||
        amount.decimals > 36
      )
        throw Error("Invalid token balances");
      seen.add(row.accountIndex);
      const old = map.get(row.mint);
      if (old && old.decimals !== amount.decimals)
        throw Error("Conflicting decimals");
      map.set(row.mint, {
        raw: (old?.raw ?? 0n) + BigInt(amount.amount),
        decimals: amount.decimals,
      });
    }
    return map;
  };
  const pre = sum(tx.meta.preTokenBalances),
    post = sum(tx.meta.postTokenBalances);
  const u0 = pre.get(MAINNET_USDC),
    u1 = post.get(MAINNET_USDC);
  if ((u0 && u0.decimals !== 6) || (u1 && u1.decimals !== 6)) return null;
  const usd = (u1?.raw ?? 0n) - (u0?.raw ?? 0n);
  const changed = [...new Set([...pre.keys(), ...post.keys()])].filter(
    (m) =>
      m !== MAINNET_USDC &&
      (post.get(m)?.raw ?? 0n) !== (pre.get(m)?.raw ?? 0n),
  );
  if (changed.length !== 1 || usd === 0n) return null;
  const mint = changed[0],
    a = pre.get(mint),
    b = post.get(mint);
  if (a && b && a.decimals !== b.decimals) return null;
  const delta = (b?.raw ?? 0n) - (a?.raw ?? 0n);
  if (delta > 0n === usd > 0n) return null;
  return {
    signature,
    wallet,
    mint,
    decimals: (a ?? b)!.decimals,
    time: tx.blockTime,
    slot: tx.slot,
    before: String(a?.raw ?? 0n),
    after: String(b?.raw ?? 0n),
    usdcDelta: String(usd),
  };
}
export class PortfolioPositions {
  private cache = new Map<string, TrackedFill | null>();
  constructor(
    private store?: MarketStore,
    private rpc = mainnetConnection(),
  ) {}
  async read(wallet: string, signatures: string[]) {
    if (signatures.some((s) => !validRewardSignature(s)))
      throw Error("Invalid transaction signature");
    assertSolanaMainnet(await this.rpc.getGenesisHash());
    const started = Date.now();
    const fills: TrackedFill[] = [],
      warnings: string[] = [];
    for (const signature of [...new Set(signatures)]) {
      const id = `portfolio:fill:${wallet}:${signature}`;
      let fill = this.store?.getRecord<TrackedFill>(id) ?? this.cache.get(id);
      if (fill === undefined) {
        if (Date.now() - started > 8000) {
          warnings.push("Some receipts could not be verified.");
          continue;
        }
        try {
          const tx = await this.rpc.getParsedTransaction(signature, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          });
          if (!tx) {
            warnings.push("Some receipts are not finalized or unavailable.");
            continue;
          }
          fill = portfolioFill(tx, wallet, signature);
          if (fill) this.store?.putRecord(id, fill);
          if (this.cache.size > 1000) this.cache.clear();
          this.cache.set(id, fill);
        } catch {
          warnings.push("Some receipts could not be verified.");
          continue;
        }
      }
      if (fill) fills.push(fill);
    }
    return {
      wallet,
      positions: trackedPositions(fills).map((p) =>
        warnings.length ? { ...p, costUsdcAtomic: null } : p,
      ),
      warnings: [...new Set(warnings)],
      coverage:
        "Verified supplied Jupiter USDC receipts only; transfers, omitted history and network fees are not a complete tax cost basis.",
    };
  }
}
