import { tokenTicker } from "../../../packages/shared/src/token-ticker.ts";
import {
  chainAccess,
  accessibleToken,
  chooseAccessibleChain,
  type WalletAccounts,
} from "../../../packages/shared/src/chain-access.ts";
import type { IntentsCatalog } from "../../../packages/shared/src/intents.ts";
import { useEffect, useId, useRef, useState } from "react";
import { Plus, X, Search, RotateCcw, Check, Pin } from "lucide-react";
import type {
  FilterSpec,
  MarketResponse,
  MarketRow,
  TokenObservation,
} from "../../../packages/shared/src/market.ts";
import {
  EMPTY_SELECTION,
  DISCOVERY_CHAINS,
  chainName,
  selectedChains,
  tokenKey,
  tokenChain,
  updateTokenSelection,
  type DiscoveryChain,
} from "../../../packages/shared/src/token-selection.ts";
import { chooseChain } from "../../../packages/shared/src/roll-chain-selection.ts";
import { TokenIcon, TokenTicker } from "./TokenMedia.tsx";
import { ChainLogo } from "./Icons.tsx";
import { RiskBadge, DrawdownBadge } from "./TokenScreening.tsx";
import "./token-pool.css";
export function ChainPicker({
  filters,
  disabled,
  onChange,
  multiple = true,
  accounts,
  catalog,
  mainnet = false,
}: {
  filters: FilterSpec;
  disabled: boolean;
  multiple?: boolean;
  accounts?: WalletAccounts;
  catalog?: IntentsCatalog | null;
  mainnet?: boolean;
  onChange: (filters: FilterSpec) => void;
}) {
  const chains = selectedChains(filters);
  const group = useId();
  return (
    <fieldset className="chain-picker">
      <legend>
        Chains <span>{multiple ? "Mix chains" : "Choose one chain"}</span>
      </legend>
      {DISCOVERY_CHAINS.map((chain) => (
        <label
          key={chain}
          title={`${chainName(chain)} · ${accounts ? chainAccess(chain, accounts, catalog).reason : "Connect a compatible wallet"}`}
          data-chain={chain}
        >
          <input
            type={multiple ? "checkbox" : "radio"}
            name={group}
            aria-label={`${chainName(chain)}${chain !== "solana" ? (mainnet && (chain === "base" || chain === "bsc") ? " · wallet-approved buys" : " · preview only") : ""}`}
            checked={chains.includes(chain)}
            disabled={
              disabled ||
              (!!accounts &&
                chainAccess(chain, accounts, catalog).kind === "unavailable") ||
              (multiple && chains.includes(chain) && chains.length === 1)
            }
            aria-description={
              accounts
                ? chainAccess(chain, accounts, catalog).reason
                : undefined
            }
            onChange={() =>
              onChange(
                accounts
                  ? chooseAccessibleChain(
                      filters,
                      chain,
                      multiple,
                      accounts,
                      catalog,
                    )
                  : chooseChain(filters, chain, multiple),
              )
            }
          />
          <span aria-hidden="true">
            <ChainLogo chain={chain} size={25} />
          </span>
        </label>
      ))}
    </fieldset>
  );
}
const blockerLabels: Record<string, string> = {
  severe_drawdown_quarantine:
    "90% drawdown quarantine (local observed history)",
  security_pending: "awaiting a risk report",
  security_unavailable: "awaiting a complete risk report",
  security_flagged: "risk flagged",
  security_stale: "risk report expired",
  stale_metadata: "market data expired",
  reference_pair_pending: "awaiting fresh pair data",
  unknown_pair_liquidity: "missing pair liquidity",
  duplicate_name_or_ticker: "weaker duplicate tokens excluded",
  route_pending: "awaiting a two-way route",
  near_screening_not_configured: "NEAR risk screening is not connected",
};
export function ChainPoolStatus({
  data,
  mainnet = false,
}: {
  data: MarketResponse;
  mainnet?: boolean;
}) {
  const chains = selectedChains(data.filters),
    active = chains.filter((c) => data.pool.some((t) => tokenChain(t) === c)),
    names = active.map(chainName);
  return (
    <details className="chain-pool-status">
      <summary>
        <strong>
          {!names.length
            ? "No eligible chains yet"
            : `This draw: ${names.join(" + ")}${names.length === 1 ? " only" : ""}`}
        </strong>
        <span className="chain-ready-count">
          {chains
            .map(
              (chain) =>
                `${chainName(chain)}: ${data.pool.filter((t) => tokenChain(t) === chain).length}`,
            )
            .join(" · ")}
        </span>
        <small>Pool details & odds</small>
      </summary>
      <ul>
        {chains.map((chain) => {
          const source = data.coverage.chainSources?.[chain],
            count = data.pool.filter((t) => tokenChain(t) === chain).length,
            blockers = Object.entries(source?.blockers ?? {});
          return (
            <li key={chain}>
              <b>
                {chainName(chain)} · {count} in draw ·{" "}
                {data.pool.length
                  ? Math.round((100 * count) / data.pool.length)
                  : 0}
                % of pool
              </b>
              {source && (
                <span>
                  {source.observed} observed · {source.matching ?? "?"} match
                  filters · {source.eligible ?? "?"} eligible
                </span>
              )}
              {chain === "near" ? (
                count > 0 || (source?.eligible ?? 0) > 0 ? (
                  <span>
                    JustHoot NEAR draw pool active (Ref Finance DCL / bonding
                    curve).
                  </span>
                ) : (
                  <span>
                    General NEAR risk screening is not connected. Enable
                    JustHoot Draw above to include NEAR launchpad tokens.
                  </span>
                )
              ) : blockers.length > 0 ? (
                <span>
                  {blockers
                    .map(
                      ([reason, n]) =>
                        `${n} ${blockerLabels[reason] ?? reason.replaceAll("_", " ")}`,
                    )
                    .join("; ")}
                  .
                </span>
              ) : source?.matching === 0 ? (
                <span>No tokens match your filters.</span>
              ) : !count && (source?.eligible ?? 0) > 0 ? (
                <span>
                  Eligible tokens are outside the requested pool size. Add them
                  with Edit tokens or increase the pool.
                </span>
              ) : !count ? (
                <span>Waiting for fresh, screened tokens.</span>
              ) : null}
              {source?.error && (
                <span className="chain-provider-status" title={source.error}>
                  Discovery coverage is partial; retrying automatically.
                </span>
              )}
              {chain !== "solana" && (
                <span>
                  {mainnet && chain !== "near"
                    ? `${chainName(chain)} buys require a fresh route, simulation and MetaMask approval.`
                    : `${chainName(chain)} draws are preview only; no trade is sent.`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p>Selecting a chain does not guarantee it has eligible tokens.</p>
    </details>
  );
}
export function TokenPoolEditor({
  data,
  disabled,
  onChange,
  multipleChains = true,
  showChains = true,
  mainnet = false,
  accounts,
  catalog: intentsCatalog,
}: {
  data: MarketResponse | null;
  multipleChains?: boolean;
  showChains?: boolean;
  mainnet?: boolean;
  accounts?: WalletAccounts;
  catalog?: IntentsCatalog | null;
  disabled: boolean;
  onChange: (filters: FilterSpec) => Promise<void>;
}) {
  const [query, setQuery] = useState(""),
    [chain, setChain] = useState<DiscoveryChain>("solana"),
    [found, setFound] = useState<TokenObservation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [catalog, setCatalog] = useState<MarketRow[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const lookup = useRef<AbortController | null>(null);
  useEffect(() => () => lookup.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    setCatalog([]);
    setCatalogError(false);
    void (async () => {
      try {
        const response = await fetch(
          "/api/markets?matchingOnly=false&limit=200",
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
          },
        );
        if (!response.ok) throw Error("Catalog unavailable");
        const value: MarketResponse = await response.json();
        if (
          !abort.signal.aborted &&
          value.configurationHash === data?.configurationHash
        )
          setCatalog(value.rows);
      } catch {
        if (!abort.signal.aborted) setCatalogError(true);
      }
    })();
    return () => abort.abort();
  }, [data?.configurationHash]);
  if (!data) return <p role="status">Loading your pool…</p>;
  const filters = data.filters,
    selection = filters.tokenSelection ?? EMPTY_SELECTION,
    poolKeys = new Set(data.pool.map(tokenKey));
  const all = [
    ...new Map(
      [...catalog, ...(data.manualRows ?? []), ...data.rows].map((r) => [
        tokenKey(r.token),
        r,
      ]),
    ).values(),
  ];
  const picks = all.filter((r) =>
      selection.included.includes(tokenKey(r.token)),
    ),
    removed = all.filter((r) => selection.excluded.includes(tokenKey(r.token)));
  const rows = all
    .filter(
      (r) =>
        selectedChains(filters).includes(tokenChain(r.token)) &&
        (!query ||
          r.token.symbol.toLowerCase().includes(query.toLowerCase()) ||
          r.token.name.toLowerCase().includes(query.toLowerCase()) ||
          r.token.mint.toLowerCase() === query.toLowerCase()),
    )
    .slice(0, 30);
  async function change(
    token: TokenObservation,
    action: "add" | "remove" | "restore",
  ) {
    setError("");
    try {
      if (
        action === "add" &&
        accounts &&
        !(
          Object.keys(accounts).length === 0 && tokenChain(token) === "solana"
        ) &&
        !accessibleToken(token, accounts, intentsCatalog)
      )
        throw Error(
          "Connect a wallet for this chain before adding it to the draw.",
        );
      const key = tokenKey(token),
        next = updateTokenSelection(selection, key, action);
      await onChange({
        ...filters,
        tokenSelection: next,
        chains:
          action === "add"
            ? multipleChains
              ? [
                  ...new Set([
                    ...selectedChains(filters).filter(
                      (c) =>
                        !accounts ||
                        chainAccess(c, accounts, intentsCatalog).kind !==
                          "unavailable",
                    ),
                    tokenChain(token),
                  ]),
                ]
              : [tokenChain(token)]
            : selectedChains(filters),
        poolSize: Math.max(filters.poolSize ?? 8, next.included.length),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot edit pool");
    }
  }
  async function importToken() {
    lookup.current?.abort();
    const abort = new AbortController();
    lookup.current = abort;
    setBusy(true);
    setError("");
    setFound(null);
    try {
      const r = await fetch("/api/pool/import", {
          method: "POST",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chain, mint: query.trim() }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error ?? "Lookup unavailable");
      if (!d.token) throw Error("No token metadata returned");
      if (!abort.signal.aborted) setFound(d.token);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Lookup unavailable");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  function row(r: MarketRow) {
    const t = r.token,
      key = tokenKey(t),
      picked = selection.included.includes(key),
      inPool = poolKeys.has(key),
      excluded = selection.excluded.includes(key);
    const reason = inPool
      ? "In the draw"
      : r.reasons.length
        ? r.reasons[0].replaceAll("_", " ")
        : r.admissionReasons.length
          ? r.admissionReasons[0].replaceAll("_", " ")
          : tokenChain(t) !== "solana"
            ? "Preview pool"
            : "Waiting for route checks";
    return (
      <div className="pool-token-row" key={key}>
        <TokenIcon src={t.dex?.icon ?? t.icon} symbol={t.symbol} size={32} />
        <div className="pool-token-name">
          <strong>
            {tokenTicker(t.symbol)}{" "}
            <ChainLogo chain={tokenChain(t)} size={13} />
            {picked && <Pin size={12} />}
          </strong>
          <small title={t.mint}>
            {t.name} · {t.mint.slice(0, 5)}…{t.mint.slice(-4)}
          </small>
          <span className={inPool ? "success" : ""}>
            {excluded ? "Removed" : reason}
          </span>
        </div>
        <button
          className="pool-add"
          disabled={disabled || busy || picked}
          aria-label={`Add ${tokenTicker(t.symbol)} to pool`}
          onClick={() => void change(t, "add")}
        >
          {picked ? <Check size={16} /> : <Plus size={16} />}
        </button>
        {(inPool || picked) && (
          <button
            className="pool-remove"
            disabled={disabled || busy}
            aria-label={`Remove ${tokenTicker(t.symbol)} from pool`}
            onClick={() => void change(t, "remove")}
          >
            <X size={16} />
          </button>
        )}
        {excluded && (
          <button
            className="text-link"
            disabled={disabled || busy}
            onClick={() => void change(t, "restore")}
          >
            Restore
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="token-pool-editor">
      {showChains && (
        <ChainPicker
          mainnet={mainnet}
          filters={filters}
          multiple={multipleChains}
          accounts={accounts}
          catalog={intentsCatalog}
          disabled={disabled || busy}
          onChange={(f) => void onChange(f)}
        />
      )}
      <div className="pool-mode" role="group" aria-label="Pool fill mode">
        {[false, true].map((manualOnly) => (
          <button
            key={String(manualOnly)}
            aria-pressed={selection.manualOnly === manualOnly}
            disabled={disabled || busy}
            onClick={() =>
              void onChange({
                ...filters,
                tokenSelection: { ...selection, manualOnly },
              })
            }
          >
            {manualOnly ? "Only my picks" : "Auto-fill + my picks"}
          </button>
        ))}
      </div>
      <p className="pool-guidance">
        {selection.manualOnly
          ? "Only your added coins can enter. Choose at least two eligible coins."
          : "Pinned coins go first; automatic discovery fills remaining spaces."}{" "}
        Risk checks and your filters still apply.
      </p>
      <div className="pool-editor-count">
        <strong>{data.pool.length} ready</strong>
        <span>
          {selection.included.length} pinned · {selection.excluded.length}{" "}
          removed · 32 max
        </span>
      </div>
      {!!data.pool.length && (
        <div className="pool-chips" aria-label="Current draw pool">
          {data.pool.map((t) => (
            <span key={tokenKey(t)}>
              <TokenIcon
                src={t.dex?.icon ?? t.icon}
                symbol={t.symbol}
                size={20}
              />
              {tokenTicker(t.symbol)}
              <button
                disabled={disabled || busy}
                aria-label={`Remove ${tokenTicker(t.symbol)} from draw`}
                onClick={() => void change(t, "remove")}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="pool-search">
        <label htmlFor="pool-token-search">
          <Search size={14} /> Find a ticker or paste a token address
        </label>
        <input
          id="pool-token-search"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            lookup.current?.abort();
            setBusy(false);
            setFound(null);
            setQuery(e.target.value);
            setError("");
          }}
          placeholder="Search tokens or paste contract"
          autoComplete="off"
        />
        <div>
          <select
            aria-label="Token address chain"
            value={chain}
            disabled={disabled || busy}
            onChange={(e) => {
              setChain(e.target.value as DiscoveryChain);
              setFound(null);
            }}
          >
            <option value="solana">Solana mint</option>
            <option value="base">Base contract</option>
            <option value="bsc">BNB contract</option>
            <option value="near">NEAR token account</option>
          </select>
          <button
            className="pool-lookup"
            disabled={disabled || busy || !query.trim()}
            onClick={() => void importToken()}
          >
            {busy ? "Looking up…" : "Look up address"}
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {found && (
        <div className="pool-found">
          <strong>
            <TokenTicker symbol={found.symbol} src={found.icon} size={22} />
          </strong>
          <small>
            {chainName(tokenChain(found))}
            {tokenChain(found) !== "solana"
              ? mainnet && tokenChain(found) !== "near"
                ? " · wallet-approved buy after checks"
                : " · preview only"
              : ""}{" "}
            · {found.name}
          </small>
          <RiskBadge risk={found.security} mint={found.mint} />
          <DrawdownBadge evidence={found.drawdown} />
          <button
            className="primary"
            disabled={disabled || busy}
            onClick={() => void change(found, "add")}
          >
            <Plus size={16} /> Add this token
          </button>
          <p>
            Adding saves your choice. A token enters the draw only after its
            filters, liquidity and security checks pass.
          </p>
        </div>
      )}
      {!!picks.length && (
        <section>
          <h3>Pinned picks</h3>
          {picks.map(row)}
        </section>
      )}
      <section>
        <h3>{query ? "Search results" : "Discovered tokens"}</h3>
        <p className="pool-guidance">
          Search up to 200 recent indexed tokens, or look up any exact address.
        </p>
        {catalogError && (
          <p role="status" className="pool-guidance">
            Recent list unavailable. Exact-address lookup is still available.
          </p>
        )}
        {rows.length ? (
          rows.map(row)
        ) : (
          <p className="pool-guidance">
            No indexed matches. Paste an exact address to look it up.
          </p>
        )}
      </section>
      {!!removed.length && (
        <details>
          <summary>Removed tokens ({selection.excluded.length})</summary>
          {removed.map(row)}
        </details>
      )}
      {!!selection.excluded.length && (
        <button
          className="text-link"
          disabled={disabled || busy}
          onClick={() =>
            void onChange({
              ...filters,
              tokenSelection: { ...selection, excluded: [] },
            })
          }
        >
          <RotateCcw size={13} /> Restore all removed tokens
        </button>
      )}
    </div>
  );
}
