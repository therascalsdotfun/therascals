import bs58 from "bs58";
const key = (wallet: string) => "rascals-solana-pending:" + wallet;
export const recoveryEvent = "rascals-solana-recovery";
export interface SolanaSubmission {
  signature: string;
  blockhash: string;
  observedSlot: number;
  rewardTicketId?: string;
}
export function pendingSolanaSubmissions(wallet: string): SolanaSubmission[] {
  const value = localStorage.getItem(key(wallet));
  if (!value) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(value);
  } catch {
    throw Error(
      "Saved Solana submission is unreadable. Inspect wallet activity before another trade.",
    );
  }
  if (
    !Array.isArray(rows) ||
    rows.some(
      (r) =>
        !r ||
        !Number.isSafeInteger(r.observedSlot) ||
        r.observedSlot <= 0 ||
        !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(r.signature) ||
        !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.blockhash),
    )
  )
    throw Error(
      "Saved Solana submission is invalid. Inspect wallet activity before another trade.",
    );
  return rows;
}
function requireRecoveryLocks() {
  if (typeof navigator === "undefined" || !navigator.locks?.request)
    throw Error(
      "This browser cannot safely coordinate pending swaps. Use a browser with Web Locks support before trading.",
    );
}
function locked<T>(
  wallet: string,
  operation: () => T,
): Promise<T> {
  requireRecoveryLocks();
  return navigator.locks.request(
    "rascals-solana-recovery:" + wallet,
    operation,
  );
}
export function assertNoPendingSolana(wallet: string) {
  requireRecoveryLocks();
  if (pendingSolanaSubmissions(wallet).length)
    throw Error(
      "A Solana submission is unresolved. Check its original receipt before another trade.",
    );
}
/** Save the identity before returning signed bytes to a plugin that can broadcast them. */
export async function rememberSolanaSubmission(
  wallet: string,
  signed: any,
  observedSlot: number,
  rewardTicketId?: string,
  batchSignatures: readonly string[] = [],
) {
  if (!Number.isSafeInteger(observedSlot) || observedSlot <= 0)
    throw Error(
      "Preflight did not establish a valid recent blockhash. Refresh the route.",
    );
  // Nonce transactions do not expire like recent-blockhash transactions. Never
  // apply our expiry recovery rule to them.
  const message = signed.message ?? signed.compileMessage?.();
  const first =
    message?.compiledInstructions?.[0] ?? message?.instructions?.[0];
  const accounts = message?.staticAccountKeys ?? message?.accountKeys;
  const data =
    typeof first?.data === "string" ? bs58.decode(first.data) : first?.data;
  if (
    signed.nonceInfo ||
    (accounts?.[first?.programIdIndex]?.toString() ===
      "11111111111111111111111111111111" &&
      data?.length === 4 &&
      data[0] === 4 &&
      data.slice(1).every((b: number) => b === 0))
  )
    throw Error(
      "Durable-nonce transactions are not supported by this swap recovery flow.",
    );
  const bytes =
    signed.signature ??
    signed.signatures?.[0]?.signature ??
    signed.signatures?.[0];
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length !== 64 ||
    !bytes.some((b) => b !== 0)
  )
    throw Error(
      "Wallet returned no usable transaction signature. Nothing was handed to Jupiter.",
    );
  const entry = {
    observedSlot,
    ...(rewardTicketId ? { rewardTicketId } : {}),
    signature: bs58.encode(bytes),
    blockhash: message?.recentBlockhash ?? signed.recentBlockhash,
  };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(entry.blockhash ?? ""))
    throw Error("Wallet returned no usable recent blockhash.");
  return locked(wallet, () => {
    const rows = pendingSolanaSubmissions(wallet);
    if (rows.some((row) => !batchSignatures.includes(row.signature)))
      throw Error(
        "A Solana submission is unresolved. Check its original receipt before another trade.",
      );
    localStorage.setItem(
      key(wallet),
      JSON.stringify([
        ...rows.filter((r) => r.signature !== entry.signature),
        entry,
      ]),
    );
    window.dispatchEvent(new Event(recoveryEvent));
    return entry;
  });
}
export async function reconcileSolanaSubmissions(wallet: string) {
  const rows = pendingSolanaSubmissions(wallet);
  const resolved: (SolanaSubmission & { status: string })[] = [];
  for (const row of rows) {
    const response = await fetch(
      "/api/mainnet/solana/receipt?" +
        new URLSearchParams({
          signature: row.signature,
          blockhash: row.blockhash,
          observedSlot: String(row.observedSlot),
        }),
      { signal: AbortSignal.timeout(20000) },
    );
    const result = await response.json();
    if (
      !response.ok ||
      result.signature !== row.signature ||
      !["pending", "finalized", "failed", "expired"].includes(result.status)
    )
      throw Error(
        "Original transaction status could not be verified. Keep the existing submission pending.",
      );
    if (result.status !== "pending") {
      // The same cross-tab lock protects insertions and removals.
      await locked(wallet, () => {
        localStorage.setItem(
          key(wallet),
          JSON.stringify(
            pendingSolanaSubmissions(wallet).filter(
              (r) => r.signature !== row.signature,
            ),
          ),
        );
      });
      resolved.push({ ...row, status: result.status });
      window.dispatchEvent(new Event(recoveryEvent));
    }
  }
  return resolved;
}
