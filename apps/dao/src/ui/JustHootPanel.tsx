import { useState, useEffect, useMemo } from "react";
import {
  ArrowUpRight,
  Dices,
  ExternalLink,
  Flame,
  Layers,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { DaoState } from "../api";
import type { DaoClient } from "../api";
import {
  fetchLiveJustHootRooms,
  justHootPoolIds,
  type JustHootPanelToken,
} from "../../../../packages/shared/src/justhoot-tokens";

export type JustHootToken = JustHootPanelToken;

export function daoAssetUrl(
  path: string | undefined,
  baseUrl = import.meta.env.BASE_URL || "/",
): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (
    /^data:image\/(?:png|jpeg|jpg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/i.test(
      path,
    )
  ) {
    return path;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return "";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${path.replace(/^\/+/, "")}`;
}

const DEFAULT_JUSTHOOT_TOKENS: JustHootToken[] = [
  {
    id: "hoot-8ecf65.launchpad.justhoot.near",
    symbol: "HOOT",
    name: "Hoot",
    decimals: 18,
    icon: "/brands/justhoot/tokens/hoot.webp",
    pool_id: "hoot-8ecf65.launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    market_cap_usd: 1200000.0,
    raised: "Hatched (DEX) · $47.9K 24h Vol",
    price_usd: 0.001386,
  },
  {
    id: "imeme-2.v2-launchpad.justhoot.near",
    symbol: "IMEME",
    name: "iMeme",
    decimals: 18,
    icon: "/brands/justhoot/tokens/imeme.webp",
    pool_id: "imeme-2.v2-launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    market_cap_usd: 307000.0,
    raised: "Hatched (DEX) · $24.3K 24h Vol",
    price_usd: 0.000307,
  },
  {
    id: "three-de86d6.launchpad.justhoot.near",
    symbol: "THREE",
    name: "Three",
    decimals: 18,
    icon: "/brands/justhoot/tokens/three.webp",
    pool_id: "three-de86d6.launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    market_cap_usd: 55200.0,
    raised: "Hatched (DEX) · $1.9K 24h Vol",
    price_usd: 0.0000552,
  },
  {
    id: "hooters-f5dd7a.launchpad.justhoot.near",
    symbol: "HOOTERS",
    name: "HOOTERS",
    decimals: 18,
    icon: "/brands/justhoot/tokens/hooters.webp",
    pool_id: "hooters-f5dd7a.launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    market_cap_usd: 14200.0,
    raised: "Hatched (DEX) · $1.3K 24h Vol",
    price_usd: 0.0000142,
  },
  {
    id: "oyster.v2-launchpad.justhoot.near",
    symbol: "OYSTER",
    name: "Oyster",
    decimals: 18,
    icon: "/brands/justhoot/tokens/oyster.webp",
    pool_id: "oyster.v2-launchpad.justhoot.near|prl.omft.near|10000",
    graduated: true,
    market_cap_usd: 15340.0,
    raised: "Hatched (DEX) · $817 24h Vol",
    price_usd: 0.0000155,
  },
  {
    id: "alexchad.v2-launchpad.justhoot.near",
    symbol: "ALEXCHAD",
    name: "Alex Chad",
    decimals: 18,
    icon: "/brands/justhoot/tokens/alexchad.webp",
    pool_id: "alexchad.v2-launchpad.justhoot.near|wrap.near|10000",
    graduated: false,
    market_cap_usd: 5140.0,
    raised: "Bonding Curve · $724 24h Vol",
    price_usd: 0.00000514,
  },
  {
    id: "robinhoot-2.v2-launchpad.justhoot.near",
    symbol: "ROBINHOOT",
    name: "Robinhoot",
    decimals: 18,
    icon: "/brands/justhoot/tokens/robinhoot.webp",
    pool_id: "robinhoot-2.v2-launchpad.justhoot.near|wrap.near|10000",
    graduated: true,
    market_cap_usd: 6955.0,
    raised: "Hatched (DEX) · $709 24h Vol",
    price_usd: 0.00000695,
  },
];

export function JustHootPanel({
  state,
  client,
  pending,
  act,
}: {
  state: DaoState;
  client: DaoClient;
  pending: string | null;
  act: (
    key: string,
    fn: () => Promise<void>,
    message?: string,
  ) => Promise<boolean>;
}) {
  const [tokens, setTokens] = useState<JustHootToken[]>(DEFAULT_JUSTHOOT_TOKENS);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "bonding" | "migrated">("all");
  const [search, setSearch] = useState("");
  const [rolling, setRolling] = useState(false);
  const [winner, setWinner] = useState<JustHootToken | null>(DEFAULT_JUSTHOOT_TOKENS[0]);
  const [swapAmount, setSwapAmount] = useState("1");
  const [dclQuote, setDclQuote] = useState<{
    estimatedOut: string;
    poolIds: string[];
  } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoadingTokens(true);
        const snap = await fetchLiveJustHootRooms();
        if (active && snap && snap.liveTokens.length > 0) {
          setTokens(snap.liveTokens);
          setWinner((prev) => {
            if (!prev) return snap.liveTokens[0];
            return (
              snap.liveTokens.find(
                (t) => t.id.toLowerCase() === prev.id.toLowerCase(),
              ) ?? prev
            );
          });
        }
      } catch {
        // Fallback tokens remain active
      } finally {
        if (active) setLoadingTokens(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const filteredTokens = useMemo(() => {
    return tokens.filter((t) => {
      if (filterMode === "bonding" && t.graduated) return false;
      if (filterMode === "migrated" && !t.graduated) return false;
      if (search.trim()) {
        const q = search.toLowerCase().replace(/^\$/, "");
        return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [tokens, filterMode, search]);

  const handleRoll = () => {
    if (filteredTokens.length === 0 || rolling) return;
    setRolling(true);
    setDclQuote(null);
    setQuoteError(null);
    let count = 0;
    const interval = setInterval(() => {
      const randomIdx = Math.floor(Math.random() * filteredTokens.length);
      setWinner(filteredTokens[randomIdx]);
      count++;
      if (count > 10) {
        clearInterval(interval);
        setRolling(false);
      }
    }, 80);
  };

  const handleCheckDclQuote = async () => {
    if (!winner) return;
    const nearNum = Number(swapAmount);
    if (!Number.isFinite(nearNum) || nearNum < 0.05) {
      setQuoteError("Enter at least 0.05 wNEAR.");
      return;
    }
    setDclQuote(null);
    setQuoteError(null);
    const poolIds = justHootPoolIds(winner.id, winner.pool_id);
    const nearYocto = (
      BigInt(Math.round(nearNum * 10000)) * 100_000_000_000_000_000_000n
    ).toString();
    await act(
      `justhoot-trade-${winner.id}`,
      async () => {
        const res = await fetch("https://free.rpc.fastnear.com", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "dao-dcl-quote",
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
                  output_token: winner.id,
                  input_amount: nearYocto,
                }),
              ),
            },
          }),
        });
        if (!res.ok) {
          setQuoteError("FastNEAR Mainnet RPC returned an error.");
          return;
        }
        const json = await res.json();
        const bytes: number[] | undefined = json?.result?.result;
        if (!Array.isArray(bytes) || !bytes.length) {
          setQuoteError("Ref DCL pool did not return a quote for this pair.");
          return;
        }
        const decoded = JSON.parse(
          new TextDecoder().decode(new Uint8Array(bytes)),
        );
        const amountStr = String(decoded?.amount ?? "");
        if (!/^[1-9]\d*$/.test(amountStr)) {
          setQuoteError("Quoted output was zero for this amount.");
          return;
        }
        const decimals = Math.max(0, Math.min(24, winner.decimals ?? 18));
        const divisor = 10n ** BigInt(decimals);
        const whole = Number(BigInt(amountStr) / divisor);
        const frac = Number((BigInt(amountStr) % divisor) / (divisor / 1000n || 1n)) / 1000;
        setDclQuote({
          estimatedOut: Math.round(whole + frac).toLocaleString(),
          poolIds,
        });
      },
      `Live NEAR Mainnet DCL quote checked for ${swapAmount} wNEAR -> $${winner.symbol} (dclv2.ref-labs.near).`,
    );
  };

  return (
    <div className="justhoot-panel">
      <div className="justhoot-hero">
        <div className="justhoot-brand">
          <img
            src={daoAssetUrl("brands/justhoot/logo.png")}
            alt="JustHoot"
            className="justhoot-logo-img"
          />
          <div>
            <div className="eyebrow">
              <span className="squiggle">⚡</span> NEAR MEME LAUNCHPAD TRENCHES
            </div>
            <h2>JustHoot Bonding-Curve Roll &amp; Trade</h2>
            <p style={{ margin: "4px 0 0", color: "#554466", fontSize: 14 }}>
              Roll and trade live bonding-curve memecoins before they hatch, or trade graduated tokens on Ref DCL v2.
            </p>
          </div>
        </div>
        <div>
          <a
            href="https://justhoot.fun"
            target="_blank"
            rel="noreferrer"
            className="action-btn"
            style={{ textDecoration: "none" }}
          >
            Launch JustHoot.fun <ArrowUpRight size={14} />
          </a>
        </div>
      </div>

      <div className="justhoot-controls">
        <div className="justhoot-filter-pills" role="tablist" aria-label="Token Filter">
          <button
            type="button"
            className={`justhoot-pill-btn ${filterMode === "bonding" ? "active" : ""}`}
            onClick={() => setFilterMode("bonding")}
          >
            <Flame size={14} /> Bonding Curve (Pre-DEX)
          </button>
          <button
            type="button"
            className={`justhoot-pill-btn ${filterMode === "migrated" ? "active" : ""}`}
            onClick={() => setFilterMode("migrated")}
          >
            <Sparkles size={14} /> Migrated to DEX (Hatched)
          </button>
          <button
            type="button"
            className={`justhoot-pill-btn ${filterMode === "all" ? "active" : ""}`}
            onClick={() => setFilterMode("all")}
          >
            <Layers size={14} /> All Tokens ({tokens.length})
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="search-box" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Search size={15} color="#887799" />
            <input
              type="search"
              placeholder="Find ticker..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d4c7e3" }}
            />
          </div>
          <button
            type="button"
            className="justhoot-roll-btn"
            onClick={handleRoll}
            disabled={rolling || filteredTokens.length === 0}
          >
            {rolling ? <LoaderCircle size={18} className="spin" /> : <Dices size={18} />}
            Roll Trenches ({filteredTokens.length})
          </button>
        </div>
      </div>

      {winner && (
        <div className="justhoot-winner-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {winner.icon ? (
                <img src={daoAssetUrl(winner.icon)} alt="" width={44} height={44} style={{ borderRadius: "50%" }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#4b367c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                  {winner.symbol.slice(0, 2)}
                </div>
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 20 }}>${winner.symbol}</h3>
                  <span className={`curve-badge ${winner.graduated ? "migrated" : "bonding"}`}>
                    {winner.graduated ? "Migrated to DEX" : "Bonding Curve (Active)"}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#665577" }}>{winner.name} · {winner.id}</div>
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>${winner.price_usd.toFixed(8)}</div>
              <div style={{ fontSize: 12, color: "#776688" }}>
                MCap: ${winner.market_cap_usd.toLocaleString()} · Raised: {winner.raised}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px dashed #dcd1ea", display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)", gap: 20, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                Ref Finance DCL Pool Routing:
              </div>
              <code style={{ fontSize: 11, background: "#ede6f7", padding: "4px 8px", borderRadius: 6, display: "block", wordBreak: "break-all" }}>
                wrap.near ft_transfer_call -&gt; dclv2.ref-labs.near [route: {justHootPoolIds(winner.id, winner.pool_id).join(" -> ")}]
              </code>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#554466" }}>
                {winner.graduated
                  ? "Token has graduated from JustHoot bonding curve to open Ref / Rhea Finance DEX pools on NEAR Mainnet."
                  : "Token is live on JustHoot bonding curve. Swaps settle on NEAR Mainnet via Ref Finance DCL v2."}
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  value={swapAmount}
                  onChange={(e) => {
                    setSwapAmount(e.target.value);
                    setDclQuote(null);
                    setQuoteError(null);
                  }}
                  style={{ width: 90, padding: "8px", borderRadius: 8, border: "1px solid #d4c7e3", fontWeight: 700 }}
                  aria-label="wNEAR Amount"
                />
                <button
                  type="button"
                  className="action-btn"
                  style={{ flex: 1, justifyContent: "center" }}
                  disabled={Boolean(pending)}
                  onClick={handleCheckDclQuote}
                >
                  <Wallet size={14} /> Check DCL quote ({swapAmount} wNEAR)
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a
                  href="https://therascals.fun"
                  target="_blank"
                  rel="noreferrer"
                  className="action-btn secondary"
                  style={{ flex: 1, textDecoration: "none", justifyContent: "center", fontSize: 12 }}
                >
                  Sign Mainnet Swap on Rascals <ExternalLink size={12} />
                </a>
                <a
                  href={`https://justhoot.fun/token/${winner.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="action-btn secondary"
                  style={{ flex: 1, textDecoration: "none", justifyContent: "center", fontSize: 12 }}
                >
                  View on JustHoot <ExternalLink size={12} />
                </a>
              </div>
              {dclQuote && (
                <div style={{ fontSize: 12, color: "#1a7f37", fontWeight: 700 }}>
                  Live Mainnet DCL quote: ~{dclQuote.estimatedOut} ${winner.symbol} for {swapAmount} wNEAR. Use Rascals or JustHoot above with a Mainnet NEAR wallet to sign (DAO portal stays on NEAR Testnet).
                </div>
              )}
              {quoteError && (
                <div style={{ fontSize: 12, color: "#991b1b", fontWeight: 600 }}>
                  {quoteError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 16 }}>
          Live JustHoot Pool Tokens ({filteredTokens.length})
        </h4>
        <div className="justhoot-grid">
          {filteredTokens.map((t) => (
            <div key={t.id} className="justhoot-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong style={{ fontSize: 16, display: "block" }}>${t.symbol}</strong>
                  <span style={{ fontSize: 12, color: "#776688" }}>{t.name}</span>
                </div>
                <span className={`curve-badge ${t.graduated ? "migrated" : "bonding"}`}>
                  {t.graduated ? "DEX" : "Curve"}
                </span>
              </div>
              <div style={{ fontSize: 12, display: "flex", justifyContent: "space-between", color: "#443355" }}>
                <span>${t.price_usd.toFixed(8)}</span>
                <span>MCap ${t.market_cap_usd.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button
                  type="button"
                  className="action-btn secondary"
                  style={{ flex: 1, padding: "5px 8px", fontSize: 11, justifyContent: "center" }}
                  onClick={() => {
                    setWinner(t);
                    setDclQuote(null);
                    setQuoteError(null);
                  }}
                >
                  Select / Roll
                </button>
                <a
                  href={`https://justhoot.fun/token/${t.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="action-btn"
                  style={{ padding: "5px 8px", fontSize: 11, textDecoration: "none" }}
                  title="Trade on JustHoot"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
