import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Fingerprint,
  Route,
  Sparkles,
  CircleHelp,
} from "lucide-react";
import type {
  RoutePair,
  TokenObservation,
} from "../../../packages/shared/src/market.ts";
import { WalletLogo, SolanaLogo } from "./Icons.tsx";
import { TokenIcon } from "./TokenMedia.tsx";
import { mappedDemoIndex, sourceRouteView } from "./route-preview.ts";
export function RoutePreview({
  token,
  quote,
  ticketAtomic,
  markets = [],
}: {
  token: TokenObservation | null;
  quote?: RoutePair | null;
  ticketAtomic: string;
  markets?: { symbol: string; mintToken: string; pool: string }[];
}) {
  const [now, setNow] = useState(Date.now),
    [animate, setAnimate] = useState(true);
  const saved = useRef<{ mint: string; quote: RoutePair | null }>({
    mint: "",
    quote: null,
  });
  if (saved.current.mint !== (token?.mint ?? ""))
    saved.current = { mint: token?.mint ?? "", quote: null };
  if (quote && quote.mint === token?.mint) saved.current.quote = quote;
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [token?.mint]);
  const index = token ? mappedDemoIndex(token.mint) : null,
    market = index === null ? null : markets[index];
  const view = token
    ? sourceRouteView(saved.current.quote, token.mint, ticketAtomic, now)
    : null;
  return (
    <section
      className={"route-preview " + (animate ? "route-animated" : "")}
      aria-label="Simulated transaction route"
    >
      <div className="route-preview-head">
        <span>
          <Route size={15} /> Route preview
        </span>
        <button
          type="button"
          className="route-sim-toggle"
          aria-label={
            animate
              ? "Pause simulated route animation"
              : "Play simulated route animation"
          }
          aria-pressed={animate}
          onClick={() => setAnimate((v) => !v)}
          title="Toggle the illustrative route animation"
        >
          <Sparkles size={12} /> Simulation
        </button>
      </div>
      <div
        className="route-track"
        aria-label="NEAR policy to MPC signing to Solana Devnet swap"
      >
        <div className="route-stop near-stop">
          <span className="route-stop-icon">
            <WalletLogo kind="near" size={20} />
          </span>
          <b>NEAR</b>
          <small>Draw + policy</small>
        </div>
        <span className="route-wire" aria-hidden="true">
          <ArrowRight size={14} />
        </span>
        <div className="route-stop mpc-stop">
          <span className="route-stop-icon">
            <Fingerprint size={21} />
          </span>
          <b>MPC</b>
          <small>Sign</small>
        </div>
        <span className="route-wire" aria-hidden="true">
          <ArrowRight size={14} />
        </span>
        <div className="route-stop solana-stop">
          <span className="route-stop-icon">
            <SolanaLogo size={20} />
          </span>
          <b>{market?.symbol ?? "Demo token"}</b>
          <small>Swap · Devnet</small>
        </div>
      </div>
      {token && (
        <div className="source-route-quote">
          <div className="source-route-pair">
            <span>USDC</span>
            <ArrowRight size={13} />
            <TokenIcon
              src={token.dex?.icon ?? token.icon}
              symbol={token.symbol}
              size={21}
            />
            <b title={token.mint}>${token.symbol}</b>
            <small className={view?.state === "quoted" ? "quote-live" : ""}>
              {view?.state === "quoted"
                ? "Quote only"
                : view?.state === "stale"
                  ? "Expired quote"
                  : "No fresh quote"}
            </small>
          </div>
          {!!view?.venues.length && (
            <p className="route-venues">
              Venues <span>{view.venues.join(" · ")}</span>
            </p>
          )}
        </div>
      )}
      <details className="route-explanation">
        <summary>
          <CircleHelp size={12} />{" "}
          {token
            ? "Source quote ≠ test trade"
            : "Live ticker → mapped test token"}
          <ChevronDown size={12} />
        </summary>
        <p>
          This panel simulates the path; it sends no transaction.{" "}
          {token
            ? "The USDC pair above is a Solana mainnet quote, not a purchase. Quoted venues may include split routes."
            : "After the draw, inspect the selected ticker’s quoted venues here."}{" "}
          Actual buys use a mapped Devnet token through NEAR policy and MPC
          signing.
        </p>
        {market && (
          <a
            href={
              "https://explorer.solana.com/address/" +
              market.pool +
              "?cluster=devnet"
            }
            target="_blank"
            rel="noreferrer"
          >
            Mapped Devnet pool ↗
          </a>
        )}
      </details>
    </section>
  );
}
