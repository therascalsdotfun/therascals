import { useEffect, useId, useState } from "react";
import { TokenDetails, TokenTicker } from "./TokenMedia.tsx";
import type { DexToken } from "../../../packages/shared/src/token-media.ts";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import { tokenChain } from "../../../packages/shared/src/token-selection.ts";
import { dexChartUrl } from "./dex-chart.ts";
import type { ChartEntry } from "./trade-chart-model.ts";
import "./source-chart.css";
export function SourceChart({
  mint,
  symbol,
  entry,
  source,
}: {
  mint: string;
  symbol: string;
  entry?: ChartEntry | null;
  source?: TokenObservation;
}) {
  const [metadata, setMetadata] = useState<DexToken | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [expired, setExpired] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), 10000);
    return () => clearTimeout(timer);
  }, [mint, attempt]);
  const contentId = useId();
  const chain = source ? tokenChain(source) : "solana";
  const pair =
    source?.mint === mint && source.dex?.mint === mint
      ? source.dex
      : metadata?.mint === mint
        ? metadata
        : null;
  const url = pair ? dexChartUrl(chain, pair.pool) : null;
  const external = pair ? dexChartUrl(chain, pair.pool, false) : null;
  const mark =
    entry &&
    Number.isFinite(entry.price) &&
    entry.price > 0 &&
    Number.isFinite(entry.time)
      ? entry
      : null;
  return (
    <section
      className="source-chart"
      aria-label={`${symbol} mainnet source chart`}
    >
      {chain === "solana" && (
        <TokenDetails
          key={`${mint}:${attempt}`}
          mint={mint}
          symbol={symbol}
          onMetadata={setMetadata}
        />
      )}
      <button
        className="chart-expansion"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((v) => !v)}
      >
        <span>{expanded ? "Collapse price chart" : "Expand price chart"}</span>
        <b aria-hidden="true">{expanded ? "−" : "+"}</b>
      </button>
      <div id={contentId} hidden={!expanded}>
        <div className="chart-heading">
          <h2>
            <TokenTicker
              symbol={symbol || "Token"}
              src={pair?.icon ?? source?.icon}
              size={26}
            />
          </h2>
          {external && (
            <a
              className="text-link"
              href={external}
              target="_blank"
              rel="noreferrer"
            >
              Open DEX Screener ↗
            </a>
          )}
        </div>
        {mark && (
          <p className="chart-entry-receipt">
            Recorded entry:{" "}
            {mark.price.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              maximumSignificantDigits: 6,
            })}{" "}
            · {new Date(mark.time * 1000).toLocaleString()}. Entry shown
            separately from the provider chart.
          </p>
        )}
        {url ? (
          <>
            <iframe
              key={url}
              className="dex-pair-chart"
              src={url}
              title={`${symbol} price chart · DEX Screener · ${chain}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            />
            <p className="chart-provider-note">
              DEX Screener · exact reference pair. If the embedded chart is
              blocked by your browser, open it using the link above.
            </p>
          </>
        ) : (
          <div className="chart-empty">
            <strong>
              {expired
                ? "Exact market pair unavailable"
                : "Finding the exact market pair…"}
            </strong>
            <p>
              A chart needs a supported reference pair. No substitute token or
              invented candles.
            </p>
            {expired && (
              <button
                className="text-link"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry market lookup ↻
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
