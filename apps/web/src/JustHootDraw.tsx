import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Dices,
  ExternalLink,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  DEFAULT_JUSTHOOT_NEAR_USD,
  JUSTHOOT_ALL_LEADERBOARD_KEYS,
  JUSTHOOT_DEFAULT_TOP3_KEYS,
  JUSTHOOT_LEADERBOARD_TOKENS,
  fetchLiveJustHootRooms,
  findJustHootEntry,
  justHootPoolIds,
  type JustHootLeaderboardEntry,
} from "../../../packages/shared/src/justhoot-tokens.ts";
import type { FilterSpec, TokenObservation } from "../../../packages/shared/src/market.ts";
import { TokenIcon } from "./TokenMedia.tsx";
import { useWallets } from "./wallets/Wallets.tsx";
import "./justhoot-draw.css";

function useJustHootLiveData() {
  const [entries, setEntries] = useState<JustHootLeaderboardEntry[]>(
    JUSTHOOT_LEADERBOARD_TOKENS,
  );
  const [nearPriceUsd, setNearPriceUsd] = useState<number>(
    DEFAULT_JUSTHOOT_NEAR_USD,
  );
  const [liveUpdated, setLiveUpdated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchLiveJustHootRooms()
      .then((snap) => {
        if (!cancelled && snap) {
          setEntries(snap.entries);
          setNearPriceUsd(snap.nearPriceUsd);
          setLiveUpdated(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, nearPriceUsd, liveUpdated };
}

function formatQuotedTokenCount(rawAmount: string, decimals: number): number {
  const safeDecimals = Math.max(0, Math.min(24, decimals));
  const raw = BigInt(rawAmount);
  if (safeDecimals === 0) return Number(raw);
  const divisor = 10n ** BigInt(safeDecimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  const tenthDivisor = 10n ** BigInt(Math.max(0, safeDecimals - 3));
  const millis = tenthDivisor > 0n ? Number(remainder / tenthDivisor) / 1000 : 0;
  return Number(whole) + millis;
}

function Sparkline({ points, id }: { points: number[]; id: string }) {
  const width = 92;
  const height = 28;
  const min = Math.min(...points);
  const max = Math.max(...points, min + 1);
  const coords = points.map((v, idx) => {
    const x = (idx / Math.max(1, points.length - 1)) * width;
    const y = height - 3 - ((v - min) / (max - min)) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${coords.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`jh-grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16a34a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#16a34a" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#jh-grad-${id})`} />
      <path
        d={linePath}
        fill="none"
        stroke="#16a34a"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function JustHootDrawControl({
  filters,
  disabled,
  onApplyFilters,
}: {
  filters?: FilterSpec;
  disabled?: boolean;
  onApplyFilters: (next: FilterSpec) => void;
}) {
  const { entries } = useJustHootLiveData();
  const savedFiltersRef = useRef<{
    chains?: FilterSpec["chains"];
    poolSize?: number;
    tokenSelection?: FilterSpec["tokenSelection"];
  } | null>(null);
  const enabled = Boolean(filters?.includeBondingCurve);
  const includedKeys =
    enabled && filters?.tokenSelection?.included?.length
      ? filters.tokenSelection.included
      : JUSTHOOT_DEFAULT_TOP3_KEYS;

  const isTop3Only =
    includedKeys.length === JUSTHOOT_DEFAULT_TOP3_KEYS.length &&
    JUSTHOOT_DEFAULT_TOP3_KEYS.every((k) => includedKeys.includes(k));

  function handleToggleBox(checked: boolean) {
    if (!checked) {
      const prev = savedFiltersRef.current;
      savedFiltersRef.current = null;
      onApplyFilters({
        ...(filters ?? ({} as FilterSpec)),
        chains: prev?.chains?.length ? prev.chains : ["solana"],
        includeBondingCurve: false,
        poolSize: prev?.poolSize ?? filters?.poolSize ?? 12,
        tokenSelection: prev?.tokenSelection ?? {
          included: [],
          excluded: [],
          manualOnly: false,
        },
      });
      return;
    }
    if (filters && !filters.includeBondingCurve) {
      savedFiltersRef.current = {
        chains: filters.chains,
        poolSize: filters.poolSize,
        tokenSelection: filters.tokenSelection,
      };
    }
    onApplyFilters({
      ...(filters ?? ({} as FilterSpec)),
      chains: ["near"],
      includeBondingCurve: true,
      poolSize: Math.max(filters?.poolSize ?? 12, 10),
      tokenSelection: {
        included: [...JUSTHOOT_DEFAULT_TOP3_KEYS],
        excluded: [],
        manualOnly: true,
      },
    });
  }

  function selectTop3Default() {
    if (!filters) return;
    onApplyFilters({
      ...filters,
      chains: ["near"],
      includeBondingCurve: true,
      tokenSelection: {
        included: [...JUSTHOOT_DEFAULT_TOP3_KEYS],
        excluded: [],
        manualOnly: true,
      },
    });
  }

  function selectAllLeaderboard() {
    if (!filters) return;
    onApplyFilters({
      ...filters,
      chains: ["near"],
      includeBondingCurve: true,
      poolSize: Math.max(filters.poolSize ?? 12, 12),
      tokenSelection: {
        included: [...JUSTHOOT_ALL_LEADERBOARD_KEYS],
        excluded: [],
        manualOnly: true,
      },
    });
  }

  function toggleTokenKey(key: string) {
    if (!filters) return;
    const exists = includedKeys.includes(key);
    const nextIncluded = exists
      ? includedKeys.length <= 2
        ? includedKeys
        : includedKeys.filter((k) => k !== key)
      : [...includedKeys, key];
    onApplyFilters({
      ...filters,
      chains: ["near"],
      includeBondingCurve: true,
      poolSize: Math.max(filters.poolSize ?? 12, nextIncluded.length),
      tokenSelection: {
        included: nextIncluded,
        excluded: [],
        manualOnly: true,
      },
    });
  }

  return (
    <div
      className={`justhoot-draw-box ${enabled ? "is-active" : ""}`}
      data-justhoot-draw={enabled ? "active" : "idle"}
    >
      <div className="justhoot-draw-header">
        <label
          className="justhoot-draw-checkbox-label"
          htmlFor="justhoot-draw-checkbox"
        >
          <input
            id="justhoot-draw-checkbox"
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => handleToggleBox(e.target.checked)}
          />
          <img
            src="/brands/justhoot/logo.png"
            alt="JustHoot"
            className="justhoot-brand-badge"
          />
          <span>JustHoot Draw</span>
          <span className="justhoot-draw-tag">
            <Sparkles size={11} /> NEAR Launchpad
          </span>
        </label>
        <div className="justhoot-draw-meta">
          {enabled ? (
            <strong>
              {includedKeys.length} JustHoot tokens loaded in cage
            </strong>
          ) : (
            <span>
              Tick to load top 3 ($HOOT, $IMEME, $THREE) + JustHoot leaderboard
            </span>
          )}
        </div>
      </div>

      {enabled && (
        <div className="justhoot-draw-tray" aria-label="JustHoot draw tokens">
          <div className="justhoot-tray-head">
            <span className="justhoot-tray-title">
              Active draw pool · defaults to top 3 ($HOOT, $IMEME, $THREE) +
              leaderboard picks
            </span>
            <div className="justhoot-tray-actions">
              <button
                type="button"
                className={`justhoot-quick-btn ${isTop3Only ? "is-selected" : ""}`}
                disabled={disabled}
                onClick={selectTop3Default}
              >
                Default Top 3 ($HOOT, $IMEME, $THREE)
              </button>
              <button
                type="button"
                className={`justhoot-quick-btn ${!isTop3Only && includedKeys.length >= 6 ? "is-selected" : ""}`}
                disabled={disabled}
                onClick={selectAllLeaderboard}
              >
                <Plus size={12} /> Load more on leaderboard (
                {JUSTHOOT_LEADERBOARD_TOKENS.length})
              </button>
            </div>
          </div>
          <div className="justhoot-token-pills">
            {entries.map((item) => {
              const key = `near:${item.mint}`;
              const active = includedKeys.includes(key);
              return (
                <button
                  key={item.mint}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleTokenKey(key)}
                  className={`justhoot-token-pill ${active ? "in-cage" : ""} ${item.defaultTop3 ? "is-top3" : ""}`}
                  title={`${item.name} ($${item.symbol}) · Mkt Cap ${item.marketCapLabel} · 24h Vol ${item.volume24hLabel}`}
                >
                  <span className="justhoot-pill-rank">#{item.rank}</span>
                  <TokenIcon
                    src={item.icon}
                    symbol={item.symbol}
                    size={18}
                  />
                  <span>${item.symbol}</span>
                  <span className="justhoot-pill-mc">
                    {item.marketCapLabel}
                  </span>
                  {active ? <Check size={12} /> : <Plus size={12} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function JustHootLeaderboardTable({
  filters,
  disabled,
  onToggleToken,
  onLoadAll,
  onChart,
}: {
  filters?: FilterSpec;
  disabled?: boolean;
  onToggleToken?: (key: string) => void;
  onLoadAll?: () => void;
  onChart?: (entry: JustHootLeaderboardEntry) => void;
}) {
  const { entries, liveUpdated } = useJustHootLiveData();
  const enabled = Boolean(filters?.includeBondingCurve);
  const includedKeys =
    enabled && filters?.tokenSelection?.included?.length
      ? filters.tokenSelection.included
      : JUSTHOOT_DEFAULT_TOP3_KEYS;

  return (
    <section
      className="justhoot-leaderboard-card"
      aria-label="JustHoot Volume Leaderboard"
    >
      <div className="justhoot-leaderboard-head">
        <div className="justhoot-leaderboard-title">
          <img
            src="/brands/justhoot/logo.png"
            alt="JustHoot"
            className="justhoot-brand-badge"
          />
          <div>
            <h3>JustHoot Token Leaderboard</h3>
            <span>
              Top Volume on NEAR · Default Top 3 ($HOOT, $IMEME, $THREE) +
              Leaderboard{liveUpdated ? " · Live stats" : ""}
            </span>
          </div>
        </div>
        <div className="justhoot-tray-actions">
          {onLoadAll && (
            <button
              type="button"
              className="justhoot-quick-btn is-selected"
              disabled={disabled}
              onClick={onLoadAll}
            >
              <Dices size={13} /> Load all {JUSTHOOT_LEADERBOARD_TOKENS.length}{" "}
              into Draw Cage
            </button>
          )}
          <a
            href="https://justhoot.fun"
            target="_blank"
            rel="noreferrer"
            className="justhoot-quick-btn"
            style={{ textDecoration: "none" }}
          >
            justhoot.fun <ArrowUpRight size={12} />
          </a>
        </div>
      </div>

      <div className="justhoot-leaderboard-table-wrap">
        <table className="justhoot-leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>TOKEN</th>
              <th>24H CHART</th>
              <th>MKT CAP</th>
              <th>24H</th>
              <th>VOLUME ↓</th>
              <th>HOLDERS</th>
              <th>AGE</th>
              {onToggleToken && <th>DRAW POOL</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((item) => {
              const key = `near:${item.mint}`;
              const inCage = includedKeys.includes(key);
              const positiveChange = item.change24h >= 0;
              return (
                <tr
                  key={item.mint}
                  className={item.defaultTop3 ? "is-top3-row" : ""}
                >
                  <td
                    className={`justhoot-rank-cell ${item.rank === 1 ? "rank-1" : ""}`}
                  >
                    {item.rank}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="justhoot-token-info justhoot-token-btn"
                      style={{ cursor: onChart ? "pointer" : "default" }}
                      onClick={() => onChart?.(item)}
                      disabled={!onChart}
                    >
                      <img
                        src={item.icon}
                        alt={item.symbol}
                        className="justhoot-token-avatar"
                      />
                      <span>
                        <span className="justhoot-token-name-line">
                          <span>{item.name}</span>
                          <span className="justhoot-token-symbol">
                            ${item.symbol}
                          </span>
                        </span>
                        <span className="justhoot-token-sub">
                          {item.subtitle}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td>
                    <Sparkline points={item.sparkline} id={item.symbol} />
                  </td>
                  <td className="justhoot-mc-cell">
                    <strong>{item.marketCapLabel}</strong>
                  </td>
                  <td>
                    <span
                      className={
                        positiveChange
                          ? "justhoot-change-pos"
                          : "justhoot-change-neg"
                      }
                    >
                      {positiveChange
                        ? `+${item.change24h.toFixed(1)}%`
                        : `${item.change24h.toFixed(1)}%`}
                    </span>
                  </td>
                  <td className="justhoot-vol-cell">
                    <strong>{item.volume24hLabel}</strong>
                    <small>{item.trades24h} trades</small>
                  </td>
                  <td>
                    <strong>{item.holders}</strong>
                  </td>
                  <td className="justhoot-age-cell">
                    <strong>{item.ageLabel}</strong>
                    <small>{item.lastTradedLabel}</small>
                  </td>
                  {onToggleToken && (
                    <td>
                      <button
                        type="button"
                        disabled={disabled}
                        className={`justhoot-row-toggle ${inCage ? "active" : ""}`}
                        onClick={() => onToggleToken(key)}
                      >
                        {inCage ? "In Cage ✓" : "+ Add to Cage"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function JustHootTrade({
  token,
  amount,
}: {
  token: TokenObservation;
  amount: string;
}) {
  const { entries, nearPriceUsd } = useJustHootLiveData();
  const {
    accounts,
    identity,
    pending,
    connect,
    verify,
    sendNearRefDclSwap,
  } = useWallets();
  const entry = findJustHootEntry(token.mint, entries);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [liveQuoteTokens, setLiveQuoteTokens] = useState<number | null>(null);
  const [liveQuoteRaw, setLiveQuoteRaw] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [slippagePct, setSlippagePct] = useState<number>(5);

  const usdBudget = Number(amount) || 5;
  const nearAmount = Math.max(
    0.1,
    Number((usdBudget / Math.max(nearPriceUsd, 0.2)).toFixed(2)),
  );
  const nearAmountYocto = (
    BigInt(Math.round(nearAmount * 10000)) * 100_000_000_000_000_000_000n
  ).toString();
  const decimals = entry?.decimals ?? token.decimals ?? 18;
  const priceUsd = entry?.priceUsd ?? token.price.value ?? 0.001;
  const fallbackEstTokens = Math.round(usdBudget / Math.max(priceUsd, 1e-9));
  const estTokens = liveQuoteTokens ?? fallbackEstTokens;
  const poolIds = justHootPoolIds(
    token.mint,
    entry?.poolId ?? token.firstPoolId ?? undefined,
  );
  const poolRouteKey = poolIds.join(",");
  const minOutputRaw =
    liveQuoteRaw && BigInt(liveQuoteRaw) > 0n
      ? ((BigInt(liveQuoteRaw) * BigInt(100 - slippagePct)) / 100n).toString()
      : null;
  const minEstTokens =
    liveQuoteTokens !== null
      ? Math.max(1, Math.floor((liveQuoteTokens * (100 - slippagePct)) / 100))
      : null;

  const nearAccount = accounts.near;
  const isNearVerified =
    !!nearAccount &&
    identity?.kind === "near" &&
    identity.address === nearAccount.address;

  useEffect(() => {
    setTxHash(null);
    setTradeError(null);
    setLiveQuoteTokens(null);
    setLiveQuoteRaw(null);
    setQuoteFailed(false);
    setQuoteLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("https://free.rpc.fastnear.com", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "dcl-quote",
            method: "query",
            params: {
              request_type: "call_function",
              finality: "final",
              account_id: "dclv2.ref-labs.near",
              method_name: "quote",
              args_base64: btoa(
                JSON.stringify({
                  pool_ids: poolIds,
                  input_token: "wrap.near",
                  output_token: token.mint,
                  input_amount: nearAmountYocto,
                }),
              ),
            },
          }),
        });
        if (!res.ok || cancelled) {
          if (!cancelled) setQuoteFailed(true);
          return;
        }
        const json = await res.json();
        const bytes: number[] | undefined = json?.result?.result;
        if (!Array.isArray(bytes) || !bytes.length) {
          if (!cancelled) setQuoteFailed(true);
          return;
        }
        const decoded = JSON.parse(
          new TextDecoder().decode(new Uint8Array(bytes)),
        );
        const amountStr = decoded?.amount;
        if (typeof amountStr === "string" && /^[1-9]\d*$/.test(amountStr)) {
          const human = formatQuotedTokenCount(amountStr, decimals);
          if (!cancelled && Number.isFinite(human) && human > 0) {
            setLiveQuoteRaw(amountStr);
            setLiveQuoteTokens(Math.round(human));
            return;
          }
        }
        if (!cancelled) setQuoteFailed(true);
      } catch {
        if (!cancelled) setQuoteFailed(true);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token.mint, nearAmountYocto, poolRouteKey, decimals]);

  async function handleSwapClick() {
    setTradeError(null);
    try {
      if (!nearAccount) {
        await connect("near");
        return;
      }
      if (!isNearVerified) {
        await verify("near");
        return;
      }
      if (!minOutputRaw || BigInt(minOutputRaw) <= 0n) {
        setTradeError(
          quoteLoading
            ? "Waiting for live Ref DCL quote before signing."
            : "Live Ref DCL quote is unavailable for this route. Check amount or trade on JustHoot.fun.",
        );
        return;
      }
      setSwapping(true);
      const hash = await sendNearRefDclSwap({
        signerId: nearAccount.address,
        tokenContractId: token.mint,
        poolIds,
        nearAmountYocto,
        minOutputAmount: minOutputRaw,
      });
      setTxHash(hash);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Swap cancelled or failed.";
      setTradeError(msg);
    } finally {
      setSwapping(false);
    }
  }

  return (
    <div className="justhoot-trade-box" aria-label="JustHoot NEAR trade">
      <div className="justhoot-trade-head">
        <div className="justhoot-trade-token">
          <TokenIcon
            src={token.dex?.icon ?? token.icon}
            symbol={token.symbol}
            size={36}
          />
          <div>
            <strong>
              {token.name} (${token.symbol})
            </strong>
            <div style={{ fontSize: "0.74rem", color: "#6b5b4b" }}>
              JustHoot · Ref Finance DCL v2 (NEAR)
            </div>
          </div>
        </div>
        <img
          src="/brands/justhoot/logo.png"
          alt="JustHoot"
          className="justhoot-brand-badge"
        />
      </div>

      <div className="justhoot-trade-stats">
        <div>
          <span>Mkt Cap</span>
          <strong>{entry?.marketCapLabel ?? "$1.2M"}</strong>
        </div>
        <div>
          <span>24h Volume</span>
          <strong>{entry?.volume24hLabel ?? "$47.9K"}</strong>
        </div>
        <div>
          <span>Holders</span>
          <strong>{entry?.holders ?? token.holders.value ?? "—"}</strong>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: "0.8rem", color: "#3e3226" }}>
        {liveQuoteTokens !== null ? "Live quote" : "Est. output"} for{" "}
        <b>${usdBudget} USD</b> (~{nearAmount.toFixed(2)} wNEAR):{" "}
        <b>
          {estTokens.toLocaleString()} ${token.symbol}
        </b>{" "}
        via <code>dclv2.ref-labs.near</code>.
      </p>

      <div className="justhoot-slippage-row">
        <span>Max slippage:</span>
        <div role="group" aria-label="Max slippage tolerance" className="justhoot-slippage-pills">
          {[2, 5, 10].map((pct) => (
            <button
              key={pct}
              type="button"
              className={`justhoot-quick-btn ${slippagePct === pct ? "is-selected" : ""}`}
              onClick={() => setSlippagePct(pct)}
            >
              {pct}%
            </button>
          ))}
        </div>
        {minEstTokens !== null ? (
          <small>
            Min received: {minEstTokens.toLocaleString()} ${token.symbol}
          </small>
        ) : quoteLoading ? (
          <small>Fetching live DCL quote…</small>
        ) : quoteFailed ? (
          <small>Live DCL quote unavailable</small>
        ) : null}
      </div>

      {nearAccount && !isNearVerified && (
        <div
          role="status"
          style={{
            padding: "0.5rem 0.65rem",
            borderRadius: 9,
            background: "#fff4ec",
            border: "1px solid #d4551f",
            color: "#7a2e0e",
            fontSize: "0.76rem",
          }}
        >
          <b>Wallet verification required:</b> Verify{" "}
          <code>{nearAccount.address}</code> first to unlock NEAR swaps and
          rolls.
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="primary"
          style={{ flex: 1 }}
          disabled={swapping || !!pending || (isNearVerified && quoteLoading)}
          onClick={() => void handleSwapClick()}
        >
          {swapping || pending === "near" ? (
            <>
              <LoaderCircle className="spin" size={15} />{" "}
              {swapping ? "Approve swap in NEAR wallet…" : "Check NEAR wallet…"}
            </>
          ) : !nearAccount ? (
            <>
              <Wallet size={15} /> Connect &amp; Verify NEAR Wallet to Swap
            </>
          ) : !isNearVerified ? (
            <>
              <ShieldCheck size={15} /> Verify NEAR Wallet First (Mandatory)
            </>
          ) : quoteLoading ? (
            <>
              <LoaderCircle className="spin" size={15} /> Fetching live DCL quote…
            </>
          ) : (
            <>
              <Dices size={15} /> Swap {nearAmount.toFixed(2)} wNEAR → $
              {token.symbol}
            </>
          )}
        </button>
        <a
          href={`https://justhoot.fun/token/${token.mint}`}
          target="_blank"
          rel="noreferrer"
          className="secondary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            textDecoration: "none",
            padding: "0.5rem 0.75rem",
          }}
        >
          JustHoot.fun <ArrowUpRight size={14} />
        </a>
      </div>

      <div
        role="status"
        style={{
          padding: "0.55rem 0.7rem",
          borderRadius: 10,
          background: "#f8f1e5",
          border: "1px solid #d4c4ae",
          color: "#4a3c2c",
          fontSize: "0.76rem",
        }}
      >
        <b>{minEstTokens !== null ? "Live DCL route ready:" : "Route preview:"}</b>{" "}
        Swap {nearAmount.toFixed(2)} wNEAR for{" "}
        {minEstTokens !== null
          ? `~${estTokens.toLocaleString()} $${token.symbol} (min ${minEstTokens.toLocaleString()} @ ${slippagePct}% slippage)`
          : `~${estTokens.toLocaleString()} $${token.symbol}`}{" "}
        on JustHoot pool <code>{poolIds.join(" → ")}</code>.{" "}
        {isNearVerified
          ? minEstTokens !== null
            ? `Connected & verified (${nearAccount.address}) — click Swap above to sign in your NEAR wallet.`
            : quoteLoading
              ? "Waiting for live Ref DCL quote before enabling wallet signature."
              : "Live Ref DCL quote unavailable right now; check amount or open JustHoot.fun."
          : nearAccount
            ? "Verify your connected NEAR wallet above to sign the swap."
            : "Connect & verify your NEAR wallet to sign the swap directly."}
      </div>

      {txHash && (
        <div
          role="status"
          style={{
            padding: "0.6rem 0.75rem",
            borderRadius: 10,
            background: "#ecfdf5",
            border: "1px solid #10b981",
            color: "#065f46",
            fontSize: "0.78rem",
            display: "grid",
            gap: "0.35rem",
          }}
        >
          <div>
            <b>Swap submitted on NEAR Mainnet!</b>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <a
              href={`https://nearblocks.io/txns/${txHash}`}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "#047857",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
              }}
            >
              View Transaction on NearBlocks ({txHash.slice(0, 8)}…)
              <ExternalLink size={12} />
            </a>
            <a
              href={`https://justhoot.fun/token/${token.mint}`}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "#047857",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
              }}
            >
              Check ${token.symbol} on JustHoot.fun
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

      {tradeError && (
        <div
          role="alert"
          style={{
            padding: "0.55rem 0.7rem",
            borderRadius: 10,
            background: "#fef2f2",
            border: "1px solid #f87171",
            color: "#991b1b",
            fontSize: "0.76rem",
          }}
        >
          {tradeError}
        </div>
      )}
    </div>
  );
}

export function JustHootChartView({
  entry,
}: {
  entry: JustHootLeaderboardEntry;
}) {
  const width = 680;
  const height = 220;
  const pts = entry.sparkline;
  const min = Math.min(...pts);
  const max = Math.max(...pts, min + 1);
  const coords = pts.map((v, idx) => {
    const x = 24 + (idx / Math.max(1, pts.length - 1)) * (width - 48);
    const y = height - 28 - ((v - min) / (max - min)) * (height - 56);
    return { x, y };
  });
  const linePath = `M ${coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" L ")}`;
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)},${height - 20} L ${coords[0].x.toFixed(1)},${height - 20} Z`;

  return (
    <div
      style={{
        marginTop: "0.65rem",
        padding: "0.95rem 1.05rem",
        borderRadius: 14,
        background: "#fffdf5",
        border: "1.5px solid #c9baca",
        boxShadow: "3px 3px 0 #e7d8e9",
        color: "#2d2939",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.5rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <img
            src={entry.icon}
            alt={entry.symbol}
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              border: "1px solid #d4c7e3",
            }}
          />
          <strong>
            {entry.name} (${entry.symbol}) / wNEAR
          </strong>
          <span
            style={{
              color: "#15803d",
              background: "#e6f6ec",
              border: "1px solid #a8dfc0",
              borderRadius: 999,
              padding: "0.12rem 0.45rem",
              fontWeight: 800,
              fontSize: "0.8rem",
            }}
          >
            +{entry.change24h.toFixed(1)}% (24h)
          </span>
        </div>
        <span style={{ fontSize: "0.76rem", color: "#6e637d" }}>
          Pool: <code>{entry.poolId}</code> · {entry.trades24h} trades (24h)
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`${entry.symbol} 24h price chart`}
      >
        <defs>
          <linearGradient
            id={`jh-big-grad-${entry.symbol}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#16a34a" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1={24}
            x2={width - 24}
            y1={height * r}
            y2={height * r}
            stroke="#e2d7ec"
            strokeDasharray="4 4"
          />
        ))}
        <path d={areaPath} fill={`url(#jh-big-grad-${entry.symbol})`} />
        <path
          d={linePath}
          fill="none"
          stroke="#16a34a"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((c, idx) => (
          <circle
            key={idx}
            cx={c.x}
            cy={c.y}
            r={idx === coords.length - 1 ? 5 : 2.5}
            fill={idx === coords.length - 1 ? "#15803d" : "#16a34a"}
          />
        ))}
      </svg>
    </div>
  );
}
