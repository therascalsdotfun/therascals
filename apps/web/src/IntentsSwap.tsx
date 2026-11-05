import { StatusJourney } from "./StatusJourney.tsx";
import { intentsJourney } from "./status-journey.ts";
import { ChainLogo } from "./Icons.tsx";
import { TokenTicker } from "./TokenMedia.tsx";
import { IntentsAssetLabel } from "./IntentsAssetLabel.tsx";
import { tokenTicker } from "../../../packages/shared/src/token-ticker.ts";
import { useEffect, useRef, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import {
  ArrowDown,
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
  Wallet,
  Check,
  Download,
} from "lucide-react";
import type { IntentsCatalog } from "../../../packages/shared/src/intents.ts";
import { formatAtomic } from "../../../packages/shared/src/intents.ts";
import {
  intentsFundingPending,
  type IntentsSwapOperation,
} from "../../../packages/shared/src/intents-execution.ts";
import { exactIntentsAsset } from "../../../packages/shared/src/chain-access.ts";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import { useWallets } from "./wallets/Wallets.tsx";
import { phantomProvider } from "./wallets/providers.ts";
import { walletRequest } from "./wallets/requests.ts";
import { WalletLogo } from "./Icons.tsx";
import { LoadingSkeleton } from "./LoadingSkeleton.tsx";
import "./mainnet.css";
const nativeSOL = "nep141:sol.omft.near",
  usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const terminal = (o: IntentsSwapOperation) =>
  ["success", "refunded", "funding_failed"].includes(o.phase);
export function IntentsSwap({
  token,
  onConnect,
  onBusy,
}: {
  token?: TokenObservation | null;
  onConnect: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const { identity, accounts, verify, sendNearTransfer, signIntentsSession } =
    useWallets();
  const [confidential, setConfidential] = useState(false);
  const [sessionExpires, setSessionExpires] = useState<number>(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalog, setCatalog] = useState<IntentsCatalog | null>(null),
    [origin, setOrigin] = useState(""),
    [destination, setDestination] = useState(""),
    [amount, setAmount] = useState("1"),
    [recipient, setRecipient] = useState("");
  const [op, setOp] = useState<IntentsSwapOperation | null>(null),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [clock, setClock] = useState(Date.now()),
    [recoveryHash, setRecoveryHash] = useState("");
  const epoch = useRef(0),
    requestId = useRef(crypto.randomUUID()),
    scope = identity
      ? identity.kind + ":" + identity.address + ":" + identity.expiresAt
      : "",
    scopeRef = useRef(scope);
  scopeRef.current = scope;
  const source = catalog?.assets.find((a) => a.assetId === origin),
    target = catalog?.assets.find((a) => a.assetId === destination),
    exact = token ? exactIntentsAsset(catalog, token) : undefined;
  const wallet = Object.values(accounts)[0];
  async function api(path: string, body?: any) {
    const r = await fetch("/api/intents/" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    const d = await r.json();
    if (!r.ok) {
      if (r.status === 401) setSessionExpires(0);
      throw Error(d.error ?? "Intents request unavailable");
    }
    return d;
  }
  useEffect(() => {
    const a = new AbortController();
    setCatalogLoading(true);
    fetch("/api/intents/tokens", { signal: a.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok)
          throw Error(
            d.error ??
              "Asset catalog unavailable. Retry to load supported assets.",
          );
        if (!a.signal.aborted) {
          setCatalog(d);
          setError("");
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!a.signal.aborted) setCatalogLoading(false);
      });
    return () => a.abort();
  }, [reload]);
  useEffect(() => {
    epoch.current++;
    setOp(null);
    setSessionExpires(0);
    setConfidential(false);
    setWorking(false);
    setRecoveryHash("");
    setError("");
    requestId.current = crypto.randomUUID();
    if (identity) {
      const ownEpoch = epoch.current;
      api("operations")
        .then((list) => {
          if (ownEpoch === epoch.current) setOp(list[0] ?? null);
        })
        .catch((e) => {
          if (ownEpoch === epoch.current) setError(e.message);
        });
      api("session")
        .then((s) => {
          if (ownEpoch === epoch.current)
            setSessionExpires(s.authorized ? Date.parse(s.expiresAt) : 0);
        })
        .catch(() => {});
    }
  }, [scope]);
  useEffect(() => {
    if (!catalog) return;
    setOrigin(
      identity?.kind === "near"
        ? catalog.originAsset
        : (catalog.assets.find(
            (a) => a.blockchain === "sol" && a.contractAddress === usdc,
          )?.assetId ?? nativeSOL),
    );
    setDestination(
      exact?.assetId ??
        catalog.assets.find(
          (a) => a.blockchain === "base" && a.symbol === "USDC",
        )?.assetId ??
        catalog.defaultDestination,
    );
  }, [catalog, scope, exact?.assetId]);
  useEffect(() => {
    if (!identity || !target) return;
    setRecipient(
      (identity.kind === "phantom" && target.blockchain === "sol") ||
        (identity.kind === "near" && target.blockchain === "near")
        ? identity.address
        : "",
    );
    requestId.current = crypto.randomUUID();
  }, [scope, target?.assetId]);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    onBusy?.(working || (!!op && intentsFundingPending(op)));
    return () => onBusy?.(false);
  }, [
    working,
    op?.id,
    op?.phase,
    op?.fundingSignature,
    op?.fundingRequestedAt,
    op?.nearCandidateHash,
  ]);
  useEffect(() => {
    if (!op || !identity || terminal(op)) return;
    const id = op.id,
      e = epoch.current;
    const timer = setInterval(() => {
      api("operations/" + id)
        .then((d) => {
          if (e === epoch.current) setOp(d);
        })
        .catch((err) => {
          if (e === epoch.current) setError(err.message);
        });
    }, 8000);
    return () => clearInterval(timer);
  }, [op?.id, op?.phase, scope]);
  useEffect(() => {
    if (op && terminal(op)) requestId.current = crypto.randomUUID();
  }, [op?.id, op?.phase]);
  function changed() {
    requestId.current = crypto.randomUUID();
    setError("");
  }
  async function prepare() {
    if (working || !identity) return;
    const own = scopeRef.current;
    setWorking(true);
    setError("");
    try {
      const d = await api("operations", {
        requestId: requestId.current,
        confidentiality: confidential ? "basic" : "public",
        originAsset: origin,
        destinationAsset: destination,
        amount,
        recipient,
      });
      if (own === scopeRef.current) setOp(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quote unavailable");
    } finally {
      if (own === scopeRef.current) setWorking(false);
    }
  }
  async function authorizeConfidential() {
    if (working || identity?.kind !== "phantom") return;
    const ownEpoch = epoch.current;
    setWorking(true);
    setError("");
    try {
      const challenge = await api("session/challenge", {});
      if (ownEpoch !== epoch.current) return;
      const signature = await signIntentsSession(challenge);
      if (ownEpoch !== epoch.current) return;
      const result = await api("session/verify", {
        id: challenge.id,
        signature,
      });
      if (ownEpoch === epoch.current)
        setSessionExpires(result.authorized ? Date.parse(result.expiresAt) : 0);
    } catch (e) {
      if (ownEpoch === epoch.current)
        setError(
          e instanceof Error
            ? e.message
            : "Confidential session authorization failed. Try again.",
        );
    } finally {
      if (ownEpoch === epoch.current) setWorking(false);
    }
  }
  async function fund() {
    if (!op || working || !identity) return;
    const own = scopeRef.current,
      id = op.id;
    setWorking(true);
    setError("");
    try {
      const draft = await api(`operations/${id}/funding`, {});
      if (own !== scopeRef.current)
        throw Error("Wallet changed. Reopen the original swap.");
      setOp({ ...op, phase: "awaiting_wallet" });
      if (draft.network !== "mainnet" || draft.operationId !== id)
        throw Error("Invalid deposit request");
      if (draft.chain === "near") {
        if (
          draft.receiverId !== op.depositAddress ||
          draft.amount !== op.amountIn ||
          draft.signerId !== identity.address
        )
          throw Error("Deposit recipient or amount changed");
        const txHash = await sendNearTransfer(draft);
        const d = await api(`operations/${id}/near-deposit`, { txHash });
        if (own === scopeRef.current) setOp(d);
      } else {
        if (draft.preflight?.status !== "passed")
          throw Error(
            "Deposit preflight did not pass. No wallet approval was requested.",
          );
        const provider = phantomProvider();
        if (
          identity.kind !== "phantom" ||
          provider?.publicKey?.toString() !== identity.address
        )
          throw Error("Connect the original Phantom wallet");
        const tx = VersionedTransaction.deserialize(
            Uint8Array.from(atob(draft.transaction), (c) => c.charCodeAt(0)),
          ),
          before = tx.message.serialize();
        const signed: any = await walletRequest(
          () => provider.signTransaction(tx),
          { timeoutMs: 60000 },
        );
        if (
          own !== scopeRef.current ||
          provider.publicKey?.toString() !== identity.address
        )
          throw Error(
            "Wallet changed before submission. Check the original swap.",
          );
        if (!signed?.message || !sameBytes(before, signed.message.serialize()))
          throw Error("Wallet changed the deposit transaction.");
        const encoded = btoa(String.fromCharCode(...signed.serialize()));
        const d = await api(`operations/${id}/submit`, {
          signedTransaction: encoded,
        });
        if (own === scopeRef.current) setOp(d);
      }
    } catch (e: any) {
      if (own === scopeRef.current) {
        setError(
          e.message ?? "Funding request failed. Check the original swap.",
        );
        if (e?.code === 4001) {
          try {
            const result = await api(`operations/${id}/rejected`, {});
            if (own === scopeRef.current) setOp(result);
          } catch {}
        } else {
          try {
            const result = await api("operations/" + id);
            if (own === scopeRef.current) setOp(result);
          } catch {}
        }
      }
    } finally {
      if (own === scopeRef.current) setWorking(false);
    }
  }
  const expired = !!op && clock >= Date.parse(op.fundBefore),
    locked = !!op && intentsFundingPending(op);
  return (
    <section
      className="intents-executable"
      aria-labelledby="intents-live-heading"
    >
      <div className="mainnet-panel-heading">
        <WalletLogo kind="near" size={20} />
        <h2 id="intents-live-heading">NEAR Intents</h2>
        <span>MAINNET</span>
      </div>
      <p className="disclosure">
        Cross-chain swap. Every deposit requires your wallet approval.
      </p>
      {token && !exact && catalog && (
        <p className="route-unavailable">
          <TokenTicker
            symbol={token.symbol}
            src={token.dex?.icon ?? token.icon}
            size={16}
          />{" "}
          is not listed on Intents. The swap below is separate; it does not buy
          this token.
        </p>
      )}
      {!identity || identity.kind === "metamask" ? (
        <div className="mainnet-connect">
          <p>
            {identity?.kind === "metamask"
              ? "Connect NEAR or Phantom to fund an Intents swap."
              : wallet
                ? "Verify this wallet to prepare a real swap."
                : "Connect NEAR or Phantom to swap with Intents."}
          </p>
          <button
            className="secondary"
            onClick={() =>
              wallet && identity?.kind !== "metamask"
                ? void verify(wallet.kind)
                : onConnect()
            }
          >
            <Wallet size={15} />
            {wallet && identity?.kind !== "metamask"
              ? "Verify wallet"
              : "Connect wallet"}
          </button>
        </div>
      ) : null}
      {catalogLoading && !catalog && <LoadingSkeleton kind="panel" />}
      {catalog && (!op || (!locked && expired) || terminal(op)) && (
        <>
          <label className="mainnet-field">
            Pay
            {source && <IntentsAssetLabel asset={source} />}
            <select
              value={origin}
              disabled={!catalog || working}
              onChange={(e) => {
                setOrigin(e.target.value);
                changed();
              }}
            >
              {catalog?.assets
                .filter((a) =>
                  identity?.kind === "near"
                    ? a.assetId === catalog.originAsset
                    : a.blockchain === "sol" &&
                      (a.assetId === nativeSOL || a.contractAddress === usdc),
                )
                .map((a) => (
                  <option key={a.assetId} value={a.assetId}>
                    {a.assetId === catalog.originAsset
                      ? "NEAR (native)"
                      : a.symbol}{" "}
                    · {a.blockchain.toUpperCase()}
                  </option>
                ))}
            </select>
          </label>
          <label className="mainnet-field">
            Amount{" "}
            <span>
              {source && <IntentsAssetLabel asset={source} size={16} />}
            </span>
            <input
              inputMode="decimal"
              value={amount}
              disabled={working}
              onChange={(e) => {
                setAmount(e.target.value);
                changed();
              }}
            />
          </label>
          <ArrowDown size={16} />
          <label className="mainnet-field">
            Receive
            {target && <IntentsAssetLabel asset={target} />}
            <select
              value={destination}
              disabled={!catalog || working}
              onChange={(e) => {
                setDestination(e.target.value);
                changed();
              }}
            >
              {catalog?.assets
                .filter((a) => a.assetId !== origin)
                .map((a) => (
                  <option key={a.assetId} value={a.assetId}>
                    {tokenTicker(a.symbol)} · {a.blockchain.toUpperCase()}
                    {a.assetId === exact?.assetId ? " · selected token" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label className="mainnet-field">
            Recipient on {target?.blockchain.toUpperCase()}
            <input
              value={recipient}
              disabled={working}
              spellCheck={false}
              onChange={(e) => {
                setRecipient(e.target.value.trim());
                changed();
              }}
              placeholder="Your receiving wallet address"
            />
          </label>
          <label className="mainnet-field">
            <span>
              <input
                type="checkbox"
                checked={confidential}
                disabled={working || identity?.kind !== "phantom"}
                onChange={(e) => {
                  setConfidential(e.target.checked);
                  changed();
                }}
              />{" "}
              Confidential Intents · basic
            </span>
            <small>
              Requests the provider’s confidential settlement layer. Deposits
              and withdrawals on external chains remain public. Rascals and the
              provider still receive your quote details. Supported catalog
              assets only; this does not make Jupiter or Perps trades
              confidential.
            </small>
          </label>
          {identity?.kind === "near" && (
            <small>
              Confidential sessions currently support Phantom. NEAR requires a
              registered Intents key; public swaps remain available.
            </small>
          )}
          {confidential && (
            <p role="status">
              Confidential quote access is awaiting the provider. You can
              authorize a wallet session, but confidential swaps cannot be
              funded yet.
            </p>
          )}
          {confidential && (
            <div className="inline-note">
              {sessionExpires > clock ? (
                <span>
                  Confidential session authorized until{" "}
                  {new Date(sessionExpires).toLocaleTimeString()}.
                </span>
              ) : (
                <>
                  <span>
                    Sign an empty ownership intent to authorize your
                    confidential session. This requests no transfer or spending
                    approval.
                  </span>
                  <button
                    disabled={working}
                    onClick={() => void authorizeConfidential()}
                  >
                    Authorize confidential session
                  </button>
                </>
              )}
            </div>
          )}
          <button
            className="primary"
            disabled={
              !identity ||
              !catalog ||
              working ||
              !recipient ||
              identity.kind === "metamask" ||
              confidential
            }
            onClick={() => void prepare()}
          >
            {working ? <i className="spinner" /> : <RefreshCw size={15} />}
            {confidential
              ? "Confidential quotes unavailable"
              : "Prepare signed quote"}
          </button>
        </>
      )}
      {op && (
        <div className="intents-operation" aria-live="polite">
          <div className="quote-verified">
            <ShieldCheck size={14} /> Provider signature verified
          </div>
          <strong>
            {formatAtomic(op.amountIn, op.origin.decimals)}{" "}
            <IntentsAssetLabel asset={op.origin} size={20} /> →{" "}
            {formatAtomic(op.amountOut, op.destination.decimals)}{" "}
            <IntentsAssetLabel asset={op.destination} size={18} />
          </strong>
          {op.confidentiality === "basic" && (
            <p className="disclosure">
              Confidential Intents · basic requested for this quote.
              External-chain transfers remain public. No public-mode fallback.
            </p>
          )}
          <dl>
            <div>
              <dt>Minimum receive</dt>
              <dd>
                {formatAtomic(op.minAmountOut, op.destination.decimals)}{" "}
                <IntentsAssetLabel asset={op.destination} size={18} />
              </dd>
            </div>
            <div>
              <dt>Included app fee</dt>
              <dd>{op.appFeeBps / 100}%</dd>
            </div>
            <div>
              <dt>Deposit address</dt>
              <dd>
                <code>{op.depositAddress}</code>
              </dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>
                <code>{op.recipient}</code>
              </dd>
            </div>
            <div>
              <dt>Refund address</dt>
              <dd>
                <code>{op.refundTo}</code>
              </dd>
            </div>
            <div>
              <dt>Refund deadline</dt>
              <dd>{new Date(op.refundDeadline).toLocaleString()}</dd>
            </div>
          </dl>
          <p className="disclosure">
            Wallet network fees are additional. Fund only through the approval
            button before {new Date(op.fundBefore).toLocaleTimeString()}. An
            unfilled swap follows this provider deadline. Refunds may be reduced
            by fees.
          </p>
          {op.nearCandidateHash && !op.fundingSignature && (
            <p className="disclosure">
              Unverified NEAR candidate: <code>{op.nearCandidateHash}</code>
            </p>
          )}
          <StatusJourney
            {...intentsJourney(op.phase, !!op.fundingSignature)}
            nodes={[
              {
                id: "input",
                name: op.origin.symbol,
                label: op.origin.symbol,
                icon: (
                  <IntentsAssetLabel asset={op.origin} iconOnly size={32} />
                ),
                state: "complete",
                detail: formatAtomic(op.amountIn, op.origin.decimals),
              },
              {
                id: "deposit",
                name: "Deposit",
                label: "Deposit",
                icon: (
                  <WalletLogo
                    kind={op.origin.blockchain === "near" ? "near" : "phantom"}
                    size={30}
                  />
                ),
                state: intentsJourney(op.phase, !!op.fundingSignature)
                  .states[1],
                detail: op.fundingSignature ? "Submitted" : "Approval",
              },
              {
                id: "intents",
                name: "NEAR Intents",
                label: "NEAR Intents",
                icon: <ChainLogo chain="near" size={30} />,
                state: intentsJourney(op.phase, !!op.fundingSignature)
                  .states[2],
                detail: op.providerStatus.replaceAll("_", " "),
              },
              {
                id: "destination",
                name: (op.phase === "refunded" ? op.origin : op.destination)
                  .symbol,
                label: (op.phase === "refunded" ? op.origin : op.destination)
                  .symbol,
                icon: (
                  <IntentsAssetLabel
                    asset={op.phase === "refunded" ? op.origin : op.destination}
                    iconOnly
                    size={32}
                  />
                ),
                state: intentsJourney(op.phase, !!op.fundingSignature)
                  .states[3],
                detail:
                  op.phase === "refunded"
                    ? "Refund"
                    : op.destination.blockchain,
              },
            ]}
          />
          <details className="journey-details">
            <summary>Deposit & settlement details</summary>
            <ol className="intents-live-steps">
              <li className="done">
                <Check size={13} /> Signed quote saved
              </li>
              <li className={op.fundingSignature ? "done" : ""}>
                Wallet-approved deposit{" "}
                {op.fundingSignature && (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={
                      op.origin.blockchain === "near"
                        ? `https://nearblocks.io/txns/${op.fundingSignature}`
                        : `https://explorer.solana.com/tx/${op.fundingSignature}`
                    }
                  >
                    <code>{op.fundingSignature}</code>
                    <ArrowUpRight size={12} />
                  </a>
                )}
              </li>
              <li>{op.providerStatus.replaceAll("_", " ")}</li>
              <li>
                {op.phase === "funding_failed" ? (
                  "Source funding failed; no swap deposit completed"
                ) : op.phase === "success" ? (
                  "Destination transfer reported"
                ) : op.phase === "refunded" ? (
                  typeof op.swapDetails?.refundedAmount === "string" &&
                  /^\d{1,80}$/.test(op.swapDetails.refundedAmount) ? (
                    <>
                      Refunded{" "}
                      {formatAtomic(
                        op.swapDetails.refundedAmount,
                        op.origin.decimals,
                      )}{" "}
                      <IntentsAssetLabel asset={op.origin} size={16} />
                    </>
                  ) : (
                    "Refund reported; net amount not provided"
                  )
                ) : (
                  "Destination / refund pending"
                )}
              </li>
            </ol>
          </details>
          {op.swapDetails?.nearTxHashes?.slice(0, 10).map((h: string) => (
            <a
              className="text-link"
              key={h}
              href={`https://nearblocks.io/txns/${encodeURIComponent(h)}`}
              target="_blank"
              rel="noreferrer"
            >
              NEAR settlement <code>{h}</code>
              <ArrowUpRight size={12} />
            </a>
          ))}
          {op.swapDetails?.destinationChainTxHashes
            ?.slice(0, 10)
            .map((t: any) => (
              <p key={t.hash}>
                <span>Destination transaction: </span>
                <code>{t.hash}</code>
              </p>
            ))}
          {!locked && !terminal(op) && !expired && (
            <button
              className="primary"
              disabled={working}
              onClick={() => void fund()}
            >
              {working ? <i className="spinner" /> : <Wallet size={16} />}
              Approve {formatAtomic(op.amountIn, op.origin.decimals)}{" "}
              <IntentsAssetLabel asset={op.origin} size={18} /> deposit
            </button>
          )}
          {!locked && !terminal(op) && expired && (
            <p className="route-unavailable">
              Funding quote expired. Prepare a fresh quote; nothing is sent
              automatically.
            </p>
          )}
          {locked && op.origin.blockchain === "near" && !terminal(op) && (
            <details className="intents-recovery">
              <summary>Missing or unverified NEAR deposit?</summary>
              <p className="disclosure">
                Check your original wallet activity. Paste that transaction hash
                to verify it; this never sends another deposit.
              </p>
              <label className="mainnet-field">
                Original NEAR transaction hash
                <input
                  value={recoveryHash}
                  onChange={(e) => setRecoveryHash(e.target.value.trim())}
                  placeholder={op.fundingSignature ?? "NEAR transaction hash"}
                />
              </label>
              <button
                className="secondary"
                disabled={
                  working || !/^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(recoveryHash)
                }
                onClick={async () => {
                  const own = scopeRef.current;
                  setWorking(true);
                  setError("");
                  try {
                    const result = await api(
                      `operations/${op.id}/near-deposit`,
                      { txHash: recoveryHash },
                    );
                    if (own === scopeRef.current) setOp(result);
                  } catch (e) {
                    if (own === scopeRef.current)
                      setError(
                        e instanceof Error ? e.message : "Recovery unavailable",
                      );
                  } finally {
                    if (own === scopeRef.current) setWorking(false);
                  }
                }}
              >
                Verify original deposit
              </button>
            </details>
          )}
          <button
            className="text-link"
            disabled={working}
            onClick={() => {
              const ownEpoch = epoch.current,
                ownScope = scopeRef.current;
              void api("operations/" + op.id)
                .then((result) => {
                  if (
                    ownEpoch === epoch.current &&
                    ownScope === scopeRef.current
                  )
                    setOp(result);
                })
                .catch((e) => {
                  if (
                    ownEpoch === epoch.current &&
                    ownScope === scopeRef.current
                  )
                    setError(e.message);
                });
            }}
          >
            <RefreshCw size={13} />
            Check original swap
          </button>
          <button
            className="text-link"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(op, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `jackpot-intents-${op.id}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={13} />
            Save signed quote & receipts
          </button>
          {op.error && <p className="error">{op.error}</p>}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!catalog && !catalogLoading && (
        <button className="text-link" onClick={() => setReload((r) => r + 1)}>
          <RefreshCw size={13} />
          Retry asset catalog
        </button>
      )}
    </section>
  );
}
function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}
