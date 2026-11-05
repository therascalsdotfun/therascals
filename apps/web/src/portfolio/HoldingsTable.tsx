import { useEffect, useState } from "react";
import type { WalletPortfolio } from "../wallets/providers.ts";
import type { ConnectedWallet } from "../wallets/Wallets.tsx";
import { formatUnits } from "../wallets/providers.ts";
import { AssetIcon } from "./AssetIcon.tsx";
import { tokenTicker } from "../../../../packages/shared/src/token-ticker.ts";
import {
  positionMetrics,
  type TrackedPosition,
} from "../../../../packages/shared/src/portfolio-position.ts";
import { savedPortfolioSignatures } from "./receipts.ts";
import { MiniChart } from "./MiniChart.tsx";
import { PortfolioSell } from "./PortfolioSell.tsx";
const SOL = "So11111111111111111111111111111111111111112";
const money = (n: number) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
const price = (n: number) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumSignificantDigits: 5,
  }).format(n);
export function HoldingsTable({
  data,
  wallet,
  readOnly,
  stale,
  onChart,
  onRefresh,
}: {
  data: WalletPortfolio;
  wallet: ConnectedWallet;
  readOnly: boolean;
  stale: boolean;
  onChart: (mint: string, symbol: string) => void;
  onRefresh: () => void;
}) {
  const [positions, setPositions] = useState<TrackedPosition[]>([]),
    [historyStatus, setHistoryStatus] = useState(""),
    [query, setQuery] = useState("");
  useEffect(() => {
    setPositions([]);
    setHistoryStatus("");
    if (wallet.kind !== "phantom") return;
    const controller = new AbortController();
    const signatures = savedPortfolioSignatures(wallet.address);
    if (!signatures.length) return;
    setHistoryStatus("Verifying recorded trade history…");
    fetch(
      `/api/portfolio/solana/${encodeURIComponent(wallet.address)}/positions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signatures }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(25000),
        ]),
      },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || d.wallet !== wallet.address || !Array.isArray(d.positions))
          throw Error();
        return d;
      })
      .then((d) => {
        if (!controller.signal.aborted) {
          setPositions(d.positions);
          setHistoryStatus(
            d.warnings?.length ? "Some entry history is unavailable." : "",
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHistoryStatus(
            "Entry history unavailable. Balance values remain separate.",
          );
      });
    return () => controller.abort();
  }, [wallet.address, wallet.kind, data.asOf]);
  const assets = data.assets.filter(
    (a) =>
      BigInt(a.raw) > 0n &&
      (!query ||
        `${a.symbol} ${a.name ?? ""} ${a.mint}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <div className="portfolio-positions">
      <div className="holdings-toolbar">
        <div>
          <h3>Token holdings</h3>
          <span>
            {data.assets.filter((a) => BigInt(a.raw) > 0n).length} nonzero
            assets
          </span>
        </div>
        <input
          aria-label="Search holdings"
          placeholder="Search holdings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {wallet.kind !== "phantom" && (
        <p className="disclosure">
          In-app selling currently supports Solana with Phantom. This chain is
          read-only in this view.
        </p>
      )}
      {historyStatus && (
        <p className="disclosure" role="status">
          {historyStatus}
        </p>
      )}
      <div className="holdings-table-wrap">
        <table className="holdings-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Balance / value</th>
              <th title="Weighted entry from verified recorded USDC trades">
                Tracked entry
              </th>
              <th title="Estimated unrealized gain or loss on the tracked remaining cost">
                Unrealized PnL
              </th>
              <th>Action</th>
              <th>Recent price</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const metrics = positionMetrics(
                a.raw,
                a.decimals,
                a.valueUsd,
                positions.find((p) => p.mint === a.mint),
              );
              const chartMint = a.mint === "native" ? SOL : a.mint;
              return (
                <tr key={a.mint}>
                  <td data-label="Token">
                    <div className="holding-identity">
                      <AssetIcon
                        asset={a}
                        network={data.network}
                        chainId={data.chainId}
                        size={32}
                      />
                      <div>
                        <strong>{tokenTicker(a.symbol || "Unknown")}</strong>
                        <small>
                          {a.name ??
                            (a.mint === "native"
                              ? "Native balance"
                              : a.mint.slice(0, 6) + "…" + a.mint.slice(-4))}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td data-label="Balance / value">
                    <strong>{formatUnits(a.raw, a.decimals)}</strong>
                    <small>
                      {a.valueUsd == null
                        ? "Value unavailable"
                        : money(a.valueUsd)}
                    </small>
                  </td>
                  <td data-label="Tracked entry">
                    <strong>
                      {metrics.entry === null
                        ? "Unavailable"
                        : price(metrics.entry)}
                    </strong>
                    <small>
                      {metrics.cost === null
                        ? "No verified basis"
                        : money(metrics.cost) + " remaining cost"}
                    </small>
                  </td>
                  <td
                    data-label="Unrealized PnL"
                    className={
                      metrics.pnl === null
                        ? ""
                        : metrics.pnl >= 0
                          ? "positive"
                          : "negative"
                    }
                  >
                    <strong>
                      {metrics.pnl === null
                        ? "Unavailable"
                        : (metrics.pnl > 0 ? "+" : "") + money(metrics.pnl)}
                    </strong>
                    <small>
                      {metrics.percent === null
                        ? "—"
                        : (metrics.percent > 0 ? "+" : "") +
                          metrics.percent.toFixed(2) +
                          "%"}
                    </small>
                  </td>
                  <td data-label="Action">
                    <PortfolioSell
                      asset={a}
                      wallet={wallet.address}
                      available={
                        !readOnly && !stale && wallet.kind === "phantom"
                      }
                      reason={
                        readOnly
                          ? "Connect this wallet to sell"
                          : wallet.kind !== "phantom"
                            ? "In-app sell currently supports Solana with Phantom"
                            : stale
                              ? "Refresh current balances before selling"
                              : undefined
                      }
                      onComplete={onRefresh}
                    />
                  </td>
                  <td data-label="Recent price">
                    <MiniChart
                      mint={chartMint}
                      supported={wallet.kind === "phantom"}
                      onOpen={() => onChart(chartMint, a.symbol)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!assets.length && (
        <p className="holdings-empty">
          {query
            ? "No holdings match this search."
            : "No token balances returned for this address."}
        </p>
      )}
      <p className="holdings-basis-note">
        Entry and PnL use verified recorded Jupiter USDC trades only. Transfers,
        missing history or a balance mismatch leave them unavailable. PnL is an
        estimate before exit slippage and network fees; chart lines show market
        prices.
      </p>
    </div>
  );
}
