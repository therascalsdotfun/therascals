import type { ReactNode } from "react";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import { TokenTicker } from "./TokenMedia.tsx";
import { SourceChart } from "./SourceChart.tsx";
import "./trade-chart-flow.css";
export function TradeChartFlow({
  token,
  baseChart,
}: {
  token: TokenObservation;
  baseChart?: ReactNode;
}) {
  return (
    <section
      id="trade-chart-flow"
      className="trade-chart-flow"
      aria-label={token.symbol + " market chart"}
    >
      <div className="chart-flow-intro">
        <span>THE DRAW → THE CHART</span>
        <strong>
          <TokenTicker
            symbol={token.symbol}
            src={token.dex?.icon ?? token.icon}
            size={24}
          />
        </strong>
      </div>
      <p>
        Live market data. Review the token and approve a trade in your wallet.
      </p>
      {!token.chain || token.chain === "solana" ? (
        <SourceChart mint={token.mint} symbol={token.symbol} source={token} />
      ) : (
        baseChart
      )}
    </section>
  );
}
