import { TokenTicker } from "./TokenMedia.tsx";
import { IntentsAssetLabel } from "./IntentsAssetLabel.tsx";
import { tokenTicker } from "../../../packages/shared/src/token-ticker.ts";
import { exactIntentsAsset } from "../../../packages/shared/src/chain-access.ts";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import {
  formatAtomic,
  type IntentsCatalog,
  type IntentsDryQuote,
} from "../../../packages/shared/src/intents.ts";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import { ChainLogo, WalletLogo } from "./Icons.tsx";
import "./intents.css";

export function IntentsQuote({
  token,
  onFilters,
}: {
  token?: TokenObservation | null;
  onFilters?: () => void;
}) {
  const [catalog, setCatalog] = useState<IntentsCatalog | null>(null),
    [catalogError, setCatalogError] = useState("");
  const [generation, setGeneration] = useState(0),
    [target, setTarget] = useState(""),
    [amount, setAmount] = useState("1");
  const [quote, setQuote] = useState<IntentsDryQuote | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const pending = useRef<AbortController | null>(null);
  const invalidate = () => {
    pending.current?.abort();
    setLoading(false);
    setQuote(null);
    setError("");
  };
  useEffect(() => {
    const abort = new AbortController();
    setCatalog(null);
    setCatalogError("");
    fetch("/api/intents/tokens", {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error || "Intents assets unavailable.");
        if (!Array.isArray(data.assets) || !data.defaultDestination)
          throw Error("Invalid Intents catalog.");
        return data;
      })
      .then((data) => {
        if (!abort.signal.aborted) setCatalog(data);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setCatalogError(
            e.name === "TimeoutError"
              ? "Asset lookup timed out. Retry below."
              : e.message,
          );
      });
    return () => abort.abort();
  }, [generation]);
  const supported = token ? exactIntentsAsset(catalog, token) : undefined;
  useEffect(() => {
    invalidate();
    setTarget(supported?.assetId ?? catalog?.defaultDestination ?? "");
  }, [catalog, token?.mint, supported?.assetId]);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const selected = catalog?.assets.find((a) => a.assetId === target);
  const expired = !!quote && clock >= Date.parse(quote.refreshAfter);
  async function requestQuote() {
    invalidate();
    const abort = new AbortController();
    pending.current = abort;
    setLoading(true);
    try {
      const response = await fetch("/api/intents/quote", {
        method: "POST",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destinationAsset: target, amount }),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "Quote unavailable. Try again.");
      if (
        data.dry !== true ||
        data.network !== "mainnet" ||
        data.destination?.assetId !== target ||
        data.depositAddress ||
        !Number.isFinite(Date.parse(data.refreshAfter))
      )
        throw Error("Unexpected quote response. Nothing was submitted.");
      if (!abort.signal.aborted) {
        setQuote(data);
        setClock(Date.now());
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error && e.name === "TimeoutError"
            ? "The quote timed out. Try again."
            : e instanceof Error
              ? e.message
              : "Quote unavailable.",
        );
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }
  return (
    <section className="intents-panel" aria-labelledby="intents-heading">
      <div className="intents-heading">
        <WalletLogo kind="near" size={20} />
        <h2 id="intents-heading">NEAR Intents</h2>
        <span>Quote only</span>
      </div>
      <p className="intents-intro">
        Live mainnet pricing. No deposit, signature or purchase.
      </p>
      {token && (
        <div className="intents-source-status">
          <strong>
            <TokenTicker
              symbol={token.symbol}
              src={token.dex?.icon ?? token.icon}
              size={20}
            />
          </strong>
          <p>
            {!catalog
              ? catalogError
                ? "The catalog is unavailable. Retry below to check exact-mint support."
                : "Checking exact-mint support…"
              : supported
                ? "Exact mint listed. Select it below for a quote."
                : "This exact contract isn’t listed on Intents. The separate USDC funding quote does not buy this token."}
          </p>
        </div>
      )}
      <div className="intents-pay">
        <label htmlFor="intents-amount">
          Quote amount <TokenTicker symbol="NEAR" size={16} branded />
        </label>
        <div>
          <WalletLogo kind="near" size={22} />
          <input
            id="intents-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              invalidate();
              setAmount(e.target.value);
            }}
            maxLength={12}
            aria-describedby="intents-amount-help"
          />
          <strong>
            <TokenTicker symbol="NEAR" size={18} branded />
          </strong>
        </div>
        <small id="intents-amount-help">0.1–100 NEAR · pricing only</small>
      </div>
      <ArrowDown className="intents-route-arrow" size={17} />
      <label className="intents-receive" htmlFor="intents-target">
        <span>
          Receive ·{" "}
          {selected?.blockchain === "sol"
            ? "Solana"
            : selected?.blockchain === "bsc"
              ? "BNB"
              : (selected?.blockchain ?? "supported chain")}
        </span>
        <div>
          {selected && <IntentsAssetLabel asset={selected} size={20} />}
          <ChainLogo
            chain={
              selected?.blockchain === "sol"
                ? "solana"
                : (selected?.blockchain ?? "solana")
            }
            size={20}
          />
          <select
            id="intents-target"
            value={target}
            disabled={!catalog}
            onChange={(e) => {
              invalidate();
              setTarget(e.target.value);
            }}
          >
            {!catalog && <option value="">Loading supported assets…</option>}
            {catalog?.assets
              .filter((a) => a.assetId !== catalog.originAsset)
              .map((a) => (
                <option key={a.assetId} value={a.assetId}>
                  {tokenTicker(a.symbol)} · {a.blockchain.toUpperCase()}
                  {a.assetId === supported?.assetId
                    ? " · selected token"
                    : a.assetId === catalog.defaultDestination
                      ? " · funding asset"
                      : ""}
                </option>
              ))}
          </select>
        </div>
      </label>
      {catalogError ? (
        <div className="intents-error" role="alert">
          <p>{catalogError}</p>
          <button
            className="text-link"
            onClick={() => {
              invalidate();
              setGeneration((n) => n + 1);
            }}
          >
            <RefreshCw size={13} /> Retry assets
          </button>
        </div>
      ) : (
        <button
          className="primary intents-quote-button"
          disabled={!catalog || !target || loading}
          onClick={() => void requestQuote()}
        >
          {loading ? <i className="spinner" /> : <RefreshCw size={15} />}
          {loading ? "Getting live quote…" : "Get live quote"}
        </button>
      )}
      {error && (
        <p className="intents-error" role="alert">
          {error}
        </p>
      )}
      {quote && (
        <div
          className={`intents-result${expired ? " expired" : ""}`}
          aria-live="polite"
        >
          <span>{expired ? "Quote needs refresh" : "Indicative receive"}</span>
          <strong>
            {formatAtomic(quote.amountOut, quote.destination.decimals)}{" "}
            <small>
              <IntentsAssetLabel asset={quote.destination} size={20} />
            </small>
          </strong>
          <dl>
            <div>
              <dt>Minimum at 1% slippage</dt>
              <dd>
                {formatAtomic(quote.minAmountOut, quote.destination.decimals)}{" "}
                <IntentsAssetLabel asset={quote.destination} size={16} />
              </dd>
            </div>
            <div>
              <dt>Estimated route time</dt>
              <dd>
                {quote.timeEstimateSeconds == null
                  ? "—"
                  : `~${quote.timeEstimateSeconds}s`}
              </dd>
            </div>
            <div>
              <dt>Included app fee</dt>
              <dd>{quote.appFeeBps / 100}%</dd>
            </div>
          </dl>
          <p>
            Fetched {new Date(quote.observedAt).toLocaleTimeString()} ·{" "}
            {expired
              ? "Refresh before comparing prices."
              : "Refresh after 30s. Price is not locked."}
          </p>
        </div>
      )}
      {selected && (
        <p className="intents-pair-note">
          <TokenTicker symbol="NEAR" size={16} branded /> →{" "}
          <IntentsAssetLabel asset={selected} size={16} />
          {selected.assetId === catalog?.defaultDestination
            ? " · Solana funding quote"
            : " · supported Intents asset"}
        </p>
      )}
      <details className="intents-notes">
        <summary>How this quote works</summary>
        <p>
          A real 1Click request with dry: true and fixed preview addresses. Your
          wallet isn’t shared. No deposit address is generated and there is no
          send action.
        </p>
        <p>
          App fees are included in the provider quote; this is not a complete
          itemized fee breakdown. A live swap needs a new executable quote, real
          funds and explicit authorization.
        </p>
        <a
          href="https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote"
          target="_blank"
          rel="noreferrer"
        >
          Provider documentation <ArrowUpRight size={12} />
        </a>
      </details>
      {onFilters && (
        <button className="text-link intents-filter" onClick={onFilters}>
          <SlidersHorizontal size={13} /> Edit draw filters
        </button>
      )}
    </section>
  );
}
