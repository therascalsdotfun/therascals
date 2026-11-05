import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Check,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { formatUnits as units } from "ethers";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import { tokenChain } from "../../../packages/shared/src/token-selection.ts";
import {
  EVM_MAINNET,
  sameEvm,
  validateEvmQuote,
  type EvmTradeQuote,
  type EvmPreflight,
  type EvmTradeChain,
} from "../../../packages/shared/src/evm-mainnet.ts";
import { StatusJourney } from "./StatusJourney.tsx";
import { evmJourney } from "./status-journey.ts";
import { TokenIcon, TokenTicker } from "./TokenMedia.tsx";
import { AssetLabel } from "./portfolio/AssetIcon.tsx";
import { ChainLogo, WalletLogo } from "./Icons.tsx";
import { useWallets } from "./wallets/Wallets.tsx";
import {
  switchEvmTradeNetwork,
  submitReviewedEvmTrade,
} from "./wallets/evm-trade.ts";
type PendingTrade = {
  quote: EvmTradeQuote;
  requestedAt: string;
  hash?: string;
  status: "awaiting_wallet" | "unknown" | "pending" | "success" | "reverted";
  blockNumber?: string;
  preflight?: EvmPreflight;
};
const storage = "rascals-evm-mainnet-trades-v1";
function history(): PendingTrade[] {
  try {
    const list = JSON.parse(localStorage.getItem(storage) ?? "[]");
    return Array.isArray(list)
      ? list
          .filter(
            (t) =>
              ["base", "bsc"].includes(t?.quote?.chain) &&
              typeof t.quote.wallet === "string" &&
              typeof t.quote.mint === "string" &&
              typeof t.requestedAt === "string",
          )
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
function persist(trade: PendingTrade) {
  // Saving the ambiguity lock must succeed before the wallet is asked to send.
  localStorage.setItem(
    storage,
    JSON.stringify(
      [trade, ...history().filter((t) => t.quote.id !== trade.quote.id)].slice(
        0,
        50,
      ),
    ),
  );
  window.dispatchEvent(new Event("rascals-evm-trades"));
}
function removeDraft(id: string) {
  localStorage.setItem(
    storage,
    JSON.stringify(history().filter((t) => t.quote.id !== id)),
  );
}
const rejected = (e: any) =>
  e?.code === 4001 ||
  e?.code === "ACTION_REJECTED" ||
  e?.data?.originalError?.code === 4001;
const text = (e: any) =>
  rejected(e)
    ? "Cancelled in MetaMask. No transaction was sent."
    : String(e?.message ?? "Trade unavailable").slice(0, 450);
const output = (raw: string, decimals: number) =>
  Number(units(raw, decimals)).toLocaleString("en", {
    maximumSignificantDigits: 7,
  });
export function EvmTrade({
  token,
  amount,
  onBusy,
}: {
  token: TokenObservation;
  amount: string;
  onBusy?: (busy: boolean) => void;
}) {
  const { accounts, connect, evm, pending: walletPending } = useWallets();
  const wallet = accounts.metamask?.address,
    chain = tokenChain(token) as EvmTradeChain,
    network = EVM_MAINNET[chain];
  const scope = `${chain}:${wallet?.toLowerCase()}:${token.mint.toLowerCase()}:${amount}`,
    latest = useRef(scope);
  latest.current = scope;
  const [quote, setQuote] = useState<EvmTradeQuote | null>(null),
    [simulation, setSimulation] = useState<EvmPreflight | null>(null),
    [working, setWorking] = useState(""),
    [error, setError] = useState(""),
    [trade, setTrade] = useState<PendingTrade | null>(null),
    [hashInput, setHashInput] = useState(""),
    [tick, setTick] = useState(Date.now());
  const busyRef = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    setQuote(null);
    setSimulation(null);
    setError("");
    setTrade(
      history().find(
        (t) =>
          sameEvm(t.quote.wallet, wallet) &&
          t.quote.chain === chain &&
          !["success", "reverted"].includes(t.status),
      ) ?? null,
    );
  }, [scope]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    onBusy?.(
      !!working ||
        !!quote ||
        (!!trade && !["success", "reverted"].includes(trade.status)),
    );
    return () => onBusy?.(false);
  }, [!!working, !!quote, trade?.status]);
  async function api(path: string, body?: any) {
    const r = await fetch("/api/mainnet/evm/" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error ?? "Mainnet request unavailable");
    return data;
  }
  async function updateReceipt(p: PendingTrade) {
    if (!p.hash) return;
    const own = scope;
    const receipt = await api(`receipt?chain=${p.quote.chain}&hash=${p.hash}`);
    if (receipt.wallet && !sameEvm(receipt.wallet, p.quote.wallet))
      throw Error("This receipt belongs to a different wallet");
    const next = {
      ...p,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
    } as PendingTrade;
    if (next.status === p.status && next.blockNumber === p.blockNumber) return;
    persist(next);
    if (
      active.current &&
      latest.current === own &&
      sameEvm(p.quote.wallet, accounts.metamask?.address)
    )
      setTrade(next);
  }
  useEffect(() => {
    if (!trade?.hash || ["success", "reverted"].includes(trade.status)) return;
    let stopped = false,
      running = false;
    const poll = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await updateReceipt(trade);
      } catch (e) {
        if (!stopped) setError(text(e));
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [trade?.hash, trade?.status]);
  async function prepare() {
    if (
      !wallet ||
      !evm ||
      busyRef.current ||
      (trade && !["success", "reverted"].includes(trade.status))
    )
      return;
    const own = scope;
    busyRef.current = true;
    setError("");
    setQuote(null);
    setSimulation(null);
    setTrade(null);
    setWorking("Checking token & finding route…");
    try {
      const q = (await api("quote", {
        chain,
        mint: token.mint,
        wallet,
        amount,
      })) as EvmTradeQuote;
      validateEvmQuote(q.routeQuote, {
        chain,
        mint: token.mint,
        wallet,
        amountAtomic: q.nativeAmount,
      });
      if (latest.current !== own)
        throw Error("Wallet or selection changed. Request a new quote.");
      setQuote(q);
      setWorking("Simulating with your real wallet balance…");
      const s = await api("simulate", { quoteId: q.id, wallet });
      if (latest.current !== own)
        throw Error("Wallet changed during preflight");
      setSimulation(s);
    } catch (e) {
      if (active.current) setError(text(e));
    } finally {
      busyRef.current = false;
      if (active.current) setWorking("");
    }
  }
  async function approve() {
    if (!quote || !wallet || !evm || busyRef.current || trade) return;
    const q = quote,
      own = scope;
    busyRef.current = true;
    setError("");
    setWorking(`Switching to ${network.name}…`);
    let requested = false;
    let lastPreflight: EvmPreflight | undefined;
    try {
      if (accounts.metamask?.chainId?.toLowerCase() !== network.hex)
        throw Error(
          `Switch MetaMask to ${network.name}, then request a new quote.`,
        );
      if (latest.current !== own)
        throw Error("Wallet changed. Refresh the quote.");
      setWorking("Refreshing risk checks & simulation…");
      const s = await api("simulate", { quoteId: q.id, wallet });
      lastPreflight = s;
      if (latest.current !== own)
        throw Error(
          "Wallet changed during preflight. Reopen the trade for the current account.",
        );
      setSimulation(s);
      if (s.status !== "passed") throw Error(s.message);
      if (!navigator.locks)
        throw Error(
          "Use a current browser with wallet-request locking enabled.",
        );
      const hash = await navigator.locks.request(
        `rascals-evm-send:${wallet.toLowerCase()}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw Error(
              "Another Rascals tab is waiting for this wallet. Finish that request first.",
            );
          if (
            history().some(
              (t) =>
                sameEvm(t.quote.wallet, wallet) &&
                !["success", "reverted"].includes(t.status),
            )
          )
            throw Error(
              "An earlier wallet request needs to be resolved before a new buy.",
            );
          return await submitReviewedEvmTrade(
            evm,
            q,
            s,
            () => latest.current === own,
            () => {
              const p: PendingTrade = {
                quote: q,
                requestedAt: new Date().toISOString(),
                status: "awaiting_wallet",
                preflight: s,
              };
              persist(p);
              requested = true;
              setTrade(p);
              setWorking("Review in MetaMask…");
            },
          );
        },
      );
      const p: PendingTrade = {
        quote: q,
        requestedAt: new Date().toISOString(),
        hash,
        status: "pending",
        preflight: s,
      };
      if (active.current && latest.current === own) {
        setTrade(p);
        setQuote(null);
      }
      try {
        persist(p);
      } catch {
        if (active.current && latest.current === own)
          setError(
            "Transaction submitted, but this browser could not save its receipt. Copy the hash below before leaving.",
          );
      }
    } catch (e) {
      if (requested && rejected(e)) {
        removeDraft(q.id);
        if (active.current && latest.current === own) setTrade(null);
      } else if (requested) {
        const p: PendingTrade = {
          quote: q,
          requestedAt: new Date().toISOString(),
          status: "unknown",
          preflight: lastPreflight,
        };
        persist(p);
        if (active.current && latest.current === own) setTrade(p);
      }
      if (active.current && latest.current === own) setError(text(e));
    } finally {
      busyRef.current = false;
      if (active.current) setWorking("");
    }
  }
  const q = trade?.quote ?? quote,
    seconds = quote
      ? Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - tick) / 1000))
      : 0;
  const correctNetwork =
    accounts.metamask?.chainId?.toLowerCase() === network.hex;
  const shownSimulation = simulation ?? trade?.preflight;
  const nativeLabel = (
    <AssetLabel
      asset={{ mint: "native", symbol: network.symbol }}
      network="EVM mainnet"
      chainId={network.hex}
      size={16}
    />
  );
  const outputLabel = (
    <TokenTicker
      symbol={q?.symbol ?? token.symbol}
      src={
        !q || q.mint === token.mint
          ? (token.dex?.icon ?? token.icon)
          : undefined
      }
      size={18}
    />
  );
  return (
    <section className="evm-trade" aria-label={`${network.name} mainnet trade`}>
      <div className="evm-trade-heading">
        <ChainLogo chain={chain} />
        <strong>{network.name} · real funds</strong>
        <span>Pay {nativeLabel}</span>
      </div>
      <p className="disclosure">
        {q ? (
          <>
            {units(q.nativeAmount, 18)} {nativeLabel} ≈ ${q.requestedUsd}
          </>
        ) : (
          <>
            ~${amount} in {nativeLabel}
          </>
        )}{" "}
        →{" "}
        <TokenTicker
          symbol={q?.symbol ?? token.symbol}
          src={
            q && q.mint !== token.mint
              ? undefined
              : (token.dex?.icon ?? token.icon)
          }
          size={20}
        />
      </p>
      {!wallet ? (
        <button
          className="primary"
          disabled={!!walletPending}
          onClick={() => void connect("metamask")}
        >
          <WalletLogo kind="metamask" /> Connect MetaMask
        </button>
      ) : !correctNetwork && !trade ? (
        <button
          className="primary"
          disabled={!!working}
          onClick={async () => {
            if (!evm) return;
            setWorking(`Switching to ${network.name}…`);
            setError("");
            try {
              await switchEvmTradeNetwork(evm, chain);
            } catch (e) {
              setError(text(e));
            } finally {
              setWorking("");
            }
          }}
        >
          <ChainLogo chain={chain} /> Switch MetaMask to {network.name}
        </button>
      ) : !q ? (
        <button
          className="primary"
          disabled={!!working}
          onClick={() => void prepare()}
        >
          <ArrowRightLeft size={16} /> {working || "Review mainnet buy"}
        </button>
      ) : null}
      {q && (
        <>
          <StatusJourney
            {...evmJourney(trade?.status, shownSimulation?.status)}
            nodes={[
              {
                id: "input",
                name: network.symbol,
                label: network.symbol,
                icon: <TokenIcon symbol={network.symbol} branded size={32} />,
                state: "complete",
                detail: "Input",
              },
              {
                id: "wallet",
                name: "MetaMask",
                label: "MetaMask",
                icon: <WalletLogo kind="metamask" size={30} />,
                state: evmJourney(trade?.status, shownSimulation?.status)
                  .states[1],
                detail: trade?.hash ? "Signed" : "Approval",
              },
              {
                id: "route",
                name: q.provider,
                label: q.provider,
                icon: <ChainLogo chain={chain} size={30} />,
                state: evmJourney(trade?.status, shownSimulation?.status)
                  .states[2],
                detail: network.name,
              },
              {
                id: "output",
                name: q.symbol,
                label: q.symbol,
                icon: (
                  <TokenIcon
                    symbol={q.symbol}
                    src={
                      q.mint === token.mint
                        ? (token.dex?.icon ?? token.icon)
                        : undefined
                    }
                    size={32}
                  />
                ),
                state: evmJourney(trade?.status, shownSimulation?.status)
                  .states[3],
                detail: trade?.status === "success" ? "Confirmed" : "Receive",
              },
            ]}
          />
          <details className="journey-details">
            <summary>Checks & transaction details</summary>
            <ol
              className="evm-trade-steps"
              aria-label="Mainnet transaction steps"
            >
              <li data-complete="true">
                <Check size={16} />
                <div>
                  <b>Token & route checked</b>
                  <small>
                    {q.provider} · {q.route.join(" → ") || "Native swap"} · 1%
                    maximum slippage
                  </small>
                  <code>Quote {q.id}</code>
                  <code>Checked {q.createdAt}</code>
                </div>
              </li>
              <li
                data-complete={shownSimulation?.status === "passed" || !!trade}
              >
                <ShieldCheck size={16} />
                <div>
                  <b>
                    {shownSimulation?.status === "passed" || trade
                      ? "Simulation passed"
                      : "Preflight"}
                  </b>
                  <small>
                    {shownSimulation?.message ??
                      (trade
                        ? "Checked before wallet request"
                        : working || "Waiting for the wallet-balance check")}
                  </small>
                  {shownSimulation?.checkedAt && (
                    <code>{shownSimulation.checkedAt}</code>
                  )}
                </div>
              </li>
              <li data-complete={!!trade?.hash}>
                <Wallet size={16} />
                <div>
                  <b>
                    {trade?.status === "awaiting_wallet"
                      ? "Approve in MetaMask"
                      : trade?.hash
                        ? "Submitted"
                        : "Your approval"}
                  </b>
                  <small>
                    {trade?.hash
                      ? "Track this transaction; no automatic resend."
                      : "You approve the native spend and gas in your wallet."}
                  </small>
                  {trade?.hash && (
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={`${network.explorer}/tx/${trade.hash}`}
                    >
                      <code>{trade.hash}</code>
                      <ArrowUpRight size={12} />
                    </a>
                  )}
                </div>
              </li>
              <li data-complete={trade?.status === "success"}>
                <Check size={16} />
                <div>
                  <b>
                    {trade?.status === "success"
                      ? "Confirmed on chain"
                      : trade?.status === "reverted"
                        ? "Reverted on chain"
                        : "Network confirmation"}
                  </b>
                  <small>
                    {trade?.blockNumber
                      ? `Block ${parseInt(trade.blockNumber, 16).toLocaleString()}`
                      : "The receipt appears here after submission."}
                  </small>
                </div>
              </li>
            </ol>
          </details>
          <dl className="evm-quote-facts">
            <div>
              <dt>Expected</dt>
              <dd>
                {output(q.outputAtomic, q.decimals)} {outputLabel}
              </dd>
            </div>
            <div>
              <dt>Minimum receive</dt>
              <dd>
                {output(q.minimumOutputAtomic, q.decimals)} {outputLabel}
              </dd>
            </div>
            <div>
              <dt>Gas estimate</dt>
              <dd>
                {shownSimulation?.gasCostNative ? (
                  <>
                    {shownSimulation.gasCostNative} {nativeLabel}
                  </>
                ) : (
                  "Available after preflight"
                )}
              </dd>
            </div>
            {q.fees.map((f, i) => (
              <div key={i}>
                <dt>{f.name}</dt>
                <dd>
                  ${f.usd} {f.included ? "included" : "extra"}
                </dd>
              </div>
            ))}
          </dl>
          {chain === "base" && (
            <p className="disclosure">
              Gas estimate may exclude Base's L1 data fee. MetaMask shows the
              final network estimate.
            </p>
          )}
          {quote && !trade && (
            <div className="evm-trade-actions">
              <button
                className="primary"
                disabled={
                  !!working ||
                  simulation?.status !== "passed" ||
                  !seconds ||
                  !correctNetwork
                }
                onClick={() => void approve()}
              >
                <WalletLogo kind="metamask" />{" "}
                {working || (
                  <>
                    Approve {nativeLabel} buy · {seconds}s
                  </>
                )}
              </button>
              <button
                className="secondary"
                disabled={!!working}
                onClick={() => void prepare()}
              >
                <RefreshCw size={15} /> Refresh quote
              </button>
              <button
                className="text-link"
                disabled={!!working}
                onClick={() => {
                  setQuote(null);
                  setSimulation(null);
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {trade && !trade.hash && (
            <div className="evm-recovery">
              <b>Check wallet activity before another buy</b>
              <p>
                A wallet request may still be open or may have submitted. Close
                it and inspect {network.name} activity.
              </p>
              <label>
                Original transaction hash
                <input
                  value={hashInput}
                  onChange={(e) => setHashInput(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <button
                disabled={!!working || !/^0x[0-9a-fA-F]{64}$/.test(hashInput)}
                onClick={() => {
                  const p = {
                    ...trade,
                    hash: hashInput,
                    status: "pending" as const,
                  };
                  persist(p);
                  setTrade(p);
                  setQuote(null);
                }}
              >
                Track original transaction
              </button>
              <button
                disabled={!!working}
                onClick={() => {
                  if (
                    window.confirm(
                      "I checked MetaMask activity and the explorer, closed the old request, and confirmed no transaction was submitted. Clear this local pending marker?",
                    )
                  ) {
                    removeDraft(trade.quote.id);
                    setTrade(null);
                    setQuote(null);
                  }
                }}
              >
                I verified nothing was sent
              </button>
            </div>
          )}
          {trade?.hash && (
            <a
              className="mainnet-receipt"
              target="_blank"
              rel="noreferrer"
              href={`${network.explorer}/tx/${trade.hash}`}
            >
              Open {network.name} receipt <ArrowUpRight size={14} />
            </a>
          )}
          {trade && ["success", "reverted"].includes(trade.status) && (
            <button
              className="secondary"
              onClick={() => {
                setTrade(null);
                setQuote(null);
                setSimulation(null);
              }}
            >
              New trade
            </button>
          )}
        </>
      )}
      {working && (
        <p role="status">
          <i className="spinner" /> {working}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="disclosure">
        Wallet-approved mainnet purchase. No token approval or automatic buy.
        Provider fees apply; risk checks do not guarantee safety.
      </p>
    </section>
  );
}
