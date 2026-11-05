import { tokenTicker } from "../../../packages/shared/src/token-ticker.ts";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock3,
  FilePenLine,
  List,
  LoaderCircle,
  Megaphone,
  Save,
  Search,
  ShieldCheck,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import type { DexToken } from "../../../packages/shared/src/token-media.ts";
import type { TokenRisk } from "../../../packages/shared/src/token-security.ts";
import {
  PROMOTION_DURATIONS,
  PROMOTION_STORAGE_KEY,
  readPromotionDrafts,
  savePromotionDraft,
  serializePromotionDrafts,
  validPromotionMint,
  type PromotionDraft,
  type PromotionPlacement,
} from "../../../packages/shared/src/promotion-draft.ts";
import { TokenIcon, TokenTicker } from "./TokenMedia.tsx";
import { RiskDetails } from "./TokenScreening.tsx";
import "./promote-token.css";
import { useRewards } from "./rewards/Rewards.tsx";
import {
  promotionCost,
  type PointsPromotion,
  type RewardLane,
} from "../../../packages/shared/src/rewards.ts";
import { Coins, Ticket } from "lucide-react";
const durationLabel = (hours: number) =>
  hours === 24 ? "24 hours" : `${hours / 24} days`;
const compact = (n: number | null) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
export function PromoteToken({
  suggestedToken,
  pointsLane = "mainnet",
  onConnect,
}: {
  suggestedToken?: TokenObservation | null;
  pointsLane?: RewardLane;
  onConnect?: () => void;
}) {
  const rewards = useRewards();
  const [purchasing, setPurchasing] = useState(false),
    [purchaseError, setPurchaseError] = useState(""),
    [purchased, setPurchased] = useState<PointsPromotion | null>(null);
  const purchaseRequest = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);
  const [address, setAddress] = useState("");
  const [token, setToken] = useState<DexToken | null>(null);
  const [risk, setRisk] = useState<TokenRisk>();
  const [message, setMessage] = useState("");
  const [placement, setPlacement] = useState<PromotionPlacement>("market");
  const [duration, setDuration] = useState(24);
  const [drafts, setDrafts] = useState<PromotionDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setPurchased(null);
    setPurchaseError("");
  }, [
    address,
    message,
    placement,
    duration,
    pointsLane,
    rewards?.snapshot?.owner,
  ]);
  useEffect(() => {
    try {
      setDrafts(
        readPromotionDrafts(localStorage.getItem(PROMOTION_STORAGE_KEY)),
      );
    } catch {
      setStorageError(
        "Saved previews could not be loaded. Saving may replace them on this device.",
      );
    }
    return () => request.current?.abort();
  }, []);
  function changeAddress(value: string) {
    request.current?.abort();
    setAddress(value);
    setToken(null);
    setRisk(undefined);
    setLoading(false);
    setError("");
    setNotice("");
  }
  async function lookup(value = address) {
    request.current?.abort();
    const mint = value.trim();
    setAddress(mint);
    setToken(null);
    setRisk(undefined);
    setError("");
    setNotice("");
    if (!validPromotionMint(mint)) {
      setLoading(false);
      setError(
        "Enter the full Solana mint address, not a ticker or page link.",
      );
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(25000),
    ]);
    setLoading(true);
    void fetch(`/api/security/${mint}`, { signal })
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            "Risk check unavailable. Open the external report or try again.",
          );
        const data = await r.json();
        if (data.mint !== mint) throw Error("Risk source mismatch.");
        if (!controller.signal.aborted) setRisk(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setRisk({
            mint,
            source: "RugCheck",
            status: "unavailable",
            checkedAt: new Date().toISOString(),
            reportAt: null,
            score: null,
            risks: [],
            error:
              e.name === "TimeoutError"
                ? "Risk check timed out. Try the lookup again."
                : e.message,
          });
      });
    try {
      const response = await fetch(`/api/tokens/${mint}`, { signal });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "Token lookup unavailable. Try again.");
      if (
        data.mint !== mint ||
        typeof data.name !== "string" ||
        typeof data.symbol !== "string"
      )
        throw Error("Token source mismatch. Try again.");
      if (!controller.signal.aborted) setToken(data);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          signal.aborted
            ? "Token lookup timed out. Try again."
            : e instanceof Error
              ? e.message
              : "Token lookup unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function persist(next: PromotionDraft[]) {
    setNotice("");
    try {
      localStorage.setItem(
        PROMOTION_STORAGE_KEY,
        serializePromotionDrafts(next),
      );
      setDrafts(next);
      setStorageError("");
      return true;
    } catch {
      setStorageError(
        "This browser could not save your preview. Keep this page open or allow site storage and retry.",
      );
      return false;
    }
  }
  function save() {
    if (!token || token.mint !== address.trim()) return;
    const next = savePromotionDraft(drafts, {
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      icon: token.icon,
      message: message.trim(),
      placement,
      durationHours: duration,
      updatedAt: new Date().toISOString(),
    });
    if (persist(next))
      setNotice("Saved on this device. Unpublished, no payment taken.");
  }
  function openDraft(draft: PromotionDraft) {
    setMessage(draft.message);
    setPlacement(draft.placement);
    setDuration(draft.durationHours);
    void lookup(draft.mint);
  }
  async function buyPlacement() {
    if (!token || !rewards || purchasing) return;
    setPurchasing(true);
    setPurchaseError("");
    setPurchased(null);
    const input = {
      lane: pointsLane,
      mint: token.mint,
      message: message.trim(),
      placement,
      durationHours: duration,
    };
    const fingerprint = JSON.stringify(input);
    if (purchaseRequest.current?.fingerprint !== fingerprint)
      purchaseRequest.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await rewards.action<PointsPromotion>("promotions", {
        ...input,
        requestId: purchaseRequest.current.id,
      });
      setPurchased(result);
    } catch (e) {
      setPurchaseError(
        e instanceof Error
          ? e.message
          : "Points purchase unavailable. Retry the same purchase.",
      );
    } finally {
      setPurchasing(false);
    }
  }
  return (
    <section className="promote-page" aria-labelledby="promote-title">
      <div className="promote-heading">
        <div>
          <h1 id="promote-title">Promote your token.</h1>
          <p>Get your ticker noticed. Keep the draw fair.</p>
        </div>
        <span className="promote-mode">
          <Ticket size={15} /> {"Points-powered placements"}
        </span>
      </div>
      <div className="promote-layout">
        <div className="promote-editor">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <label htmlFor="promotion-mint">Solana token address</label>
            <div className="promote-lookup">
              <input
                id="promotion-mint"
                value={address}
                onChange={(e) => changeAddress(e.target.value)}
                placeholder="Paste the full mint address"
                maxLength={44}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="promotion-mint-help"
              />
              <button
                className="secondary"
                type="submit"
                disabled={loading || !address.trim()}
              >
                {loading ? (
                  <LoaderCircle size={16} className="promote-spinner" />
                ) : (
                  <Search size={16} />
                )}
                {loading ? "Finding…" : "Find token"}
              </button>
            </div>
            <div className="promote-input-help" id="promotion-mint-help">
              <span>Mainnet data · exact mint lookup</span>
              {suggestedToken && !token && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => void lookup(suggestedToken.mint)}
                >
                  Try{" "}
                  <TokenTicker
                    symbol={suggestedToken.symbol}
                    src={suggestedToken.dex?.icon ?? suggestedToken.icon}
                    size={16}
                  />{" "}
                  <ArrowUpRight size={12} />
                </button>
              )}
            </div>
            {error && (
              <p className="promote-error" role="alert">
                {error}
              </p>
            )}
          </form>
          <div className="promote-copy-field">
            <label htmlFor="promotion-message">
              Short message <span>Optional</span>
            </label>
            <textarea
              id="promotion-message"
              value={message}
              maxLength={96}
              onChange={(e) => {
                setMessage(e.target.value);
                setNotice("");
              }}
              placeholder="What should traders know about your token?"
              rows={2}
            />
            <span className="promote-character-count">
              {message.length} / 96
            </span>
          </div>
          <fieldset className="promote-placement">
            <legend>Where it could appear</legend>
            <div>
              {(["market", "detail"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={placement === value}
                  onClick={() => {
                    setPlacement(value);
                    setNotice("");
                  }}
                >
                  {value === "market" ? (
                    <List size={18} />
                  ) : (
                    <SquareArrowOutUpRight size={18} />
                  )}
                  <span>
                    {value === "market" ? "Market row" : "Token spotlight"}
                    <small>
                      {value === "market"
                        ? "A tag beside your ticker"
                        : "A larger token preview"}
                    </small>
                  </span>
                  <Check size={15} className="promote-selected-check" />
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="promote-duration">
            <legend>Planned duration</legend>
            <div>
              {PROMOTION_DURATIONS.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  aria-pressed={duration === hours}
                  onClick={() => {
                    setDuration(hours);
                    setNotice("");
                  }}
                >
                  <Clock3 size={14} />
                  {durationLabel(hours)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="promote-save">
            <button
              className="primary"
              type="button"
              disabled={!token || loading}
              onClick={save}
            >
              <Save size={17} /> Save preview
            </button>
            <span>Save a free draft, or use points below.</span>
          </div>
          <div className="promote-points-checkout">
            <div>
              <Coins size={23} />
              <strong>
                {promotionCost(placement, duration).toLocaleString()} {""}points
              </strong>
              <small>
                {rewards?.snapshot
                  ? `${rewards.snapshot.balances[pointsLane].balance.toLocaleString()} available`
                  : "Verify a wallet to use points"}
              </small>
            </div>
            <p>
              {
                "Buy a timed market tag or spotlight. Fresh risk and liquidity checks run before points are spent. No change to draw odds. Public placements pause when checks expire or flag a risk; the booked time keeps running."
              }
            </p>
            {rewards?.snapshot ? (
              <button
                disabled={
                  !token ||
                  loading ||
                  purchasing ||
                  !!purchased ||
                  rewards.snapshot.balances[pointsLane].balance <
                    promotionCost(placement, duration)
                }
                onClick={() => void buyPlacement()}
              >
                <Megaphone size={16} />
                {purchasing
                  ? "Checking & placing…"
                  : purchased
                    ? "Placement active"
                    : "Promote with points"}
              </button>
            ) : (
              <button onClick={onConnect}>Connect & verify wallet</button>
            )}
            <small>No real tokens or payment. Points have no cash value.</small>
            {purchaseError && (
              <p className="promote-error" role="alert">
                {purchaseError}
              </p>
            )}
            {purchased && (
              <p className="promote-saved" role="status">
                <CheckCheck size={16} />
                <TokenTicker
                  symbol={purchased.symbol}
                  src={purchased.icon}
                  size={18}
                />{" "}
                · {"Points placement active"} · ends{" "}
                {new Date(purchased.expiresAt).toLocaleString()} · receipt{" "}
                {purchased.id.slice(0, 8)}
              </p>
            )}
          </div>
          <div aria-live="polite">
            {notice && (
              <p className="promote-saved">
                <CheckCheck size={15} />
                {notice}
              </p>
            )}
            {storageError && (
              <p className="promote-error" role="alert">
                {storageError}
              </p>
            )}
          </div>
        </div>
        <aside
          className="promotion-preview"
          aria-label="Unpublished placement preview"
        >
          <div className="promote-preview-heading">
            <span>Placement preview</span>
            <span>Unpublished</span>
          </div>
          <div className={`promote-token-preview preview-${placement}`}>
            <TokenIcon
              src={token?.icon}
              symbol={token?.symbol ?? "?"}
              size={placement === "detail" ? 80 : 48}
            />
            <div>
              <strong>
                {token ? tokenTicker(token.symbol) : "Your ticker"}
              </strong>
              <span className="promote-preview-tag">
                <Megaphone size={11} />
                Promoted · Rascals
              </span>
              <p>{token?.name ?? "Look up your token to see it here."}</p>
            </div>
          </div>
          <p
            className={`promote-preview-message${!message.trim() ? " is-placeholder" : ""}`}
          >
            {message.trim() || "Your short message appears here."}
          </p>
          {token && (
            <>
              <a
                className="promote-mint-link"
                href={`https://dexscreener.com/solana/${token.pool}`}
                target="_blank"
                rel="noreferrer"
              >
                {token.mint}
                <ArrowUpRight size={13} />
              </a>
              <dl className="promote-preview-metrics">
                <div>
                  <dt>Market cap</dt>
                  <dd>{compact(token.marketCap)}</dd>
                </div>
                <div>
                  <dt>Pair liquidity</dt>
                  <dd>{compact(token.liquidity)}</dd>
                </div>
              </dl>
              <p className="promote-data-note">
                {token.stale ? "Cached" : "Retrieved"} DEX Screener data ·{" "}
                {new Date(token.fetchedAt).toLocaleTimeString()}
              </p>
              <RiskDetails risk={risk} mint={token.mint} />
            </>
          )}
          <div className="promote-fairness">
            <ShieldCheck size={18} />
            <div>
              <strong>Visibility. Same odds.</strong>
              <p>
                Paying won’t bypass token checks or put extra balls in the cage.
              </p>
            </div>
          </div>
          <p className="promote-preview-footnote">
            Saving this draft adds no live tag. A points purchase adds a
            separate “Promoted · Points” placement; “Promoted · DEX” labels come
            from DEX Screener paid boosts.
          </p>
        </aside>
      </div>
      <section
        className="promote-drafts"
        aria-labelledby="saved-promotions-title"
      >
        {!!rewards?.snapshot?.promotions.filter((p) => p.lane === pointsLane)
          .length && (
          <div className="promote-active-points">
            <h2>{"Your active points placements"}</h2>
            {rewards.snapshot.promotions
              .filter((p) => p.lane === pointsLane)
              .map((p) => (
                <div key={p.id}>
                  <TokenIcon src={p.icon} symbol={p.symbol} size={26} />
                  <strong>{tokenTicker(p.symbol)}</strong>
                  <span>
                    {p.placement === "market" ? "Market tag" : "Spotlight"} ·{" "}
                    {p.cost} pts · until{" "}
                    {new Date(p.expiresAt).toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        )}
        <div className="promote-drafts-heading">
          <h2 id="saved-promotions-title">Saved previews</h2>
          <span>{drafts.length} / 10 · this browser only</span>
        </div>
        {drafts.length ? (
          <ul>
            {drafts.map((draft) => (
              <li key={draft.mint}>
                <TokenIcon src={draft.icon} symbol={draft.symbol} size={36} />
                <button
                  className="promote-draft-open"
                  onClick={() => openDraft(draft)}
                >
                  <strong>
                    {tokenTicker(draft.symbol)}
                    <span>Unpublished</span>
                  </strong>
                  <small>
                    {draft.placement === "market"
                      ? "Market row"
                      : "Token spotlight"}{" "}
                    · {durationLabel(draft.durationHours)} · saved{" "}
                    {new Date(draft.updatedAt).toLocaleDateString()}
                  </small>
                </button>
                <button
                  className="promote-delete"
                  aria-label={`Delete saved preview for ${tokenTicker(draft.symbol)}`}
                  onClick={() => {
                    if (persist(drafts.filter((d) => d.mint !== draft.mint)))
                      setNotice("Saved preview deleted from this browser.");
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            Your saved token previews will appear here. They stay on this device
            and won’t go live.
          </p>
        )}
      </section>
    </section>
  );
}
