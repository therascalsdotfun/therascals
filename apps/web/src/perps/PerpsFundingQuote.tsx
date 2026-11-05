import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import {
  formatAtomic,
  HYPERLIQUID_PERPS_USDC,
  type HyperliquidFundingQuote,
} from "../../../../packages/shared/src/intents.ts";

export function PerpsFundingQuote() {
  const [amount, setAmount] = useState("1"),
    [quote, setQuote] = useState<HyperliquidFundingQuote | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [clock, setClock] = useState(Date.now());
  const pending = useRef<AbortController | null>(null);
  const invalidate = () => {
    pending.current?.abort();
    setQuote(null);
    setError("");
    setBusy(false);
  };
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!quote) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [quote]);
  async function load() {
    invalidate();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/perps/funding-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(25000),
        ]),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Funding quote unavailable.");
      if (
        data.dry !== true ||
        data.network !== "mainnet" ||
        data.destination?.assetId !== HYPERLIQUID_PERPS_USDC ||
        data.destination.decimals !== 8 ||
        !/^\d+$/.test(data.amountOut) ||
        !Number.isFinite(Date.parse(data.refreshAfter)) ||
        data.depositAddress
      )
        throw Error("Unexpected funding quote. Nothing was sent.");
      if (!controller.signal.aborted) {
        setQuote(data);
        setClock(Date.now());
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Quote unavailable.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <details className="perps-funding">
      <summary>
        NEAR → Hyperliquid funding <span>Mainnet quote only</span>
      </summary>
      <p>
        Preview collateral landing in HyperCore’s perps balance through NEAR
        Intents. This is a quote only: no funds are sent and no position is
        opened.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          NEAR amount{" "}
          <input
            aria-label="Perps funding NEAR amount"
            value={amount}
            inputMode="decimal"
            onChange={(e) => {
              invalidate();
              setAmount(e.target.value);
            }}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <ArrowRight size={14} />
          )}{" "}
          {busy ? "Getting quote…" : "Preview funding"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {quote && (
        <div role="status">
          <strong>
            {formatAtomic(quote.amountIn, 24)} NEAR →{" "}
            {formatAtomic(quote.amountOut, 8)} USDC
          </strong>
          <p>
            Minimum {formatAtomic(quote.minAmountOut, 8)} USDC · 1% slippage ·{" "}
            {quote.appFeeBps / 100}% app fee ·{" "}
            {clock >= Date.parse(quote.refreshAfter)
              ? "Quote expired — refresh"
              : "Live quote preview"}
          </p>
          <small>
            No deposit address, transaction or order created. Funding execution
            requires a separate integration and wallet approval.
          </small>
        </div>
      )}
    </details>
  );
}
