import { queueMainnetReward } from "./rewards/Rewards.tsx";
import { useCallback, useEffect, useState } from "react";
import {
  pendingSolanaSubmissions,
  reconcileSolanaSubmissions,
  recoveryEvent,
  type SolanaSubmission,
} from "./solana-recovery.ts";
import { recordPortfolioReceipt } from "./portfolio/receipts.ts";
export function useSolanaRecovery(wallet?: string) {
  const [revision, changed] = useState(0);
  useEffect(() => {
    const update = () => changed((v) => v + 1);
    window.addEventListener(recoveryEvent, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(recoveryEvent, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  let rows: SolanaSubmission[] = [],
    error = "";
  try {
    if (wallet) rows = pendingSolanaSubmissions(wallet);
  } catch {
    error =
      "Saved transaction status is unreadable. Inspect wallet activity before another trade.";
  }
  return { rows, error, blocked: !!error || rows.length > 0, revision };
}
export function SolanaRecovery({
  wallet,
  onResolved,
}: {
  wallet: string;
  onResolved?: () => void;
}) {
  const { rows, error, blocked } = useSolanaRecovery(wallet);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const check = useCallback(async () => {
    setBusy(true);
    try {
      const resolved = await reconcileSolanaSubmissions(wallet);
      for (const row of resolved)
        if (row.status === "finalized") {
          recordPortfolioReceipt(wallet, row.signature, "Jupiter · recovery");
          if (row.rewardTicketId)
            queueMainnetReward({
              wallet,
              ticketId: row.rewardTicketId,
              signature: row.signature,
            });
        }
      setNotice(
        resolved.length
          ? resolved
              .map((r) =>
                r.status === "finalized"
                  ? "Original transaction finalized. Refresh holdings to inspect the result."
                  : r.status === "failed"
                    ? "Original transaction failed on chain."
                    : "Original transaction expired without appearing in chain history.",
              )
              .join(" ")
          : "Original transaction is still pending or unknown. Another swap remains blocked.",
      );
      if (resolved.length) onResolved?.();
    } catch {
      setNotice(
        "Could not verify the original transaction. Another swap remains blocked; retry the status check.",
      );
    } finally {
      setBusy(false);
    }
  }, [wallet, onResolved]);
  if (!blocked && !notice) return null;
  return (
    <section
      className="disclosure solana-recovery"
      aria-label="Solana transaction recovery"
    >
      {blocked && (
        <p role="status">
          An earlier signed Solana transaction needs checking before another
          swap.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {rows.map((row) => (
        <p key={row.signature}>
          <a
            href={"https://explorer.solana.com/tx/" + row.signature}
            target="_blank"
            rel="noreferrer"
          >
            Open original transaction ↗
          </a>
        </p>
      ))}
      {!!rows.length && (
        <button type="button" disabled={busy} onClick={() => void check()}>
          {busy
            ? "Checking original transaction…"
            : "Check original transaction"}
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
