import {
  Megaphone,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  CopyCheck,
} from "lucide-react";
import type { DexToken } from "../../../packages/shared/src/token-media.ts";
import type {
  MarketResponse,
  TokenObservation,
  DrawdownEvidence,
} from "../../../packages/shared/src/market.ts";
export function DrawdownBadge({ evidence }: { evidence?: DrawdownEvidence }) {
  if (!evidence) return null;
  return (
    <span
      className="risk-badge risk-flagged"
      title={`Excluded: ${(evidence.dropFraction * 100).toFixed(1)}% USD price loss observed between ${new Date(evidence.peak.at).toLocaleString()} and ${new Date(evidence.observed.at).toLocaleString()}. Source ${evidence.source}. Persistent local quarantine; a price crash is not proof of fraud.`}
    >
      <ShieldAlert size={11} /> Drawdown quarantine
    </span>
  );
}
import type { TokenRisk } from "../../../packages/shared/src/token-security.ts";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./token-screening.css";
const riskProvider = (risk: TokenRisk | undefined, mint: string) =>
  risk?.source ?? (mint.startsWith("0x") ? "GoPlus" : "RugCheck");
const riskLink = (risk: TokenRisk | undefined, mint: string) =>
  riskProvider(risk, mint) === "Not configured"
    ? "https://nearblocks.io/token/" + encodeURIComponent(mint)
    : riskProvider(risk, mint) === "GoPlus"
      ? "https://api.gopluslabs.io/api/v1/token_security/" +
        (risk?.chain === "bsc" ? "56" : "8453") +
        "?contract_addresses=" +
        encodeURIComponent(mint)
      : "https://rugcheck.xyz/tokens/" + mint;
export function PromotionTag({ dex }: { dex?: DexToken | null }) {
  const age = Date.now() - Date.parse(dex?.fetchedAt ?? "");
  if (
    !dex ||
    dex.stale ||
    !Number.isFinite(age) ||
    age < 0 ||
    age >= 60000 ||
    !Number.isInteger(dex.activeBoosts) ||
    (dex.activeBoosts ?? 0) <= 0
  )
    return null;
  return (
    <span
      className="promoted-tag"
      title={`DEX Screener reports ${dex.activeBoosts} active paid boosts. Observed ${new Date(dex.fetchedAt).toLocaleTimeString()}. Visual label only; no effect on draw odds or security checks.`}
    >
      <Megaphone size={10} />
      Promoted <span>· DEX</span>
    </span>
  );
}
export function RiskBadge({ risk, mint }: { risk?: TokenRisk; mint: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
  }>({ left: 12, top: 12, width: 320 });
  const trigger = useRef<HTMLAnchorElement>(null),
    popup = useRef<HTMLDivElement>(null),
    hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    firstTouch = useRef(false);
  const tooltipId = useId();
  function show() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setOpen(true);
  }
  function hide() {
    hideTimer.current = setTimeout(() => setOpen(false), 140);
  }
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(340, window.innerWidth - 24);
      const above =
        window.innerHeight - box.bottom <
          Math.min(280, window.innerHeight / 2) && box.top > 150;
      setPosition({
        width,
        left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
        ...(above
          ? { bottom: window.innerHeight - box.top + 8 }
          : { top: Math.max(12, box.bottom + 8) }),
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    place();
    // The top layer also works when this badge is inside an open chart dialog.
    popup.current?.showPopover?.();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", escape);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );
  const stale =
    !!risk &&
    risk.status !== "unavailable" &&
    (!Number.isFinite(Date.parse(risk.checkedAt)) ||
      Date.now() - Date.parse(risk.checkedAt) > 300000);
  const state = stale ? "stale" : (risk?.status ?? "pending");
  const label = {
    checked: "Risk checked",
    flagged: "Risk flagged",
    stale: "Scan expired",
    unavailable: "Scan unavailable",
    pending: "Scan pending",
  }[state];
  return (
    <>
      <a
        ref={trigger}
        className={`risk-badge risk-${state}`}
        href={riskLink(risk, mint)}
        target="_blank"
        rel="noreferrer"
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onPointerDown={(e) => {
          firstTouch.current = e.pointerType === "touch" && !open;
        }}
        onClick={(e) => {
          if (firstTouch.current) {
            e.preventDefault();
            firstTouch.current = false;
            show();
          }
        }}
      >
        {state === "checked" ? (
          <ShieldCheck size={11} />
        ) : state === "flagged" ? (
          <ShieldAlert size={11} />
        ) : (
          <ShieldQuestion size={11} />
        )}{" "}
        {label}
      </a>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popup}
            popover="manual"
            className="risk-tooltip"
            role="tooltip"
            id={tooltipId}
            style={position}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <strong>
              {risk?.risks.length ? "Why this token is flagged" : label}
            </strong>
            {risk?.risks.length ? (
              <ul>
                {risk.risks.map((item, index) => (
                  <li key={index}>
                    <b>{item.name}</b>
                    <span>{item.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {risk?.error ??
                  (state === "checked"
                    ? `No risks reported in the fetched ${riskProvider(risk, mint)} response. This is not a safety guarantee.`
                    : "A fresh external risk check is required before this token can enter a draw.")}
              </p>
            )}
            <p>
              {risk
                ? `${riskProvider(risk, mint)} · fetched ${new Date(risk.checkedAt).toLocaleTimeString()}.`
                : riskProvider(risk, mint) + " report pending."}{" "}
              {stale ? "This check has expired." : ""} Flagged tokens cannot
              enter a draw.
            </p>
            <small>
              Click the badge for the full report. On touch, tap again.
            </small>
          </div>,
          document.body,
        )}
    </>
  );
}
export function IdentityTag({ token }: { token: TokenObservation }) {
  const identity = token.identity;
  if (!identity || identity.count < 2) return null;
  return (
    <span
      className="identity-tag"
      title={`Same or similar normalized name/ticker across ${identity.count} different mint addresses. The eligible universe keeps the highest-liquidity candidate, using market cap as a tie-breaker. This does not verify the original token.`}
    >
      <CopyCheck size={10} />
      {identity.winnerMint === token.mint
        ? `${identity.count - 1} lookalike${identity.count > 2 ? "s" : ""} hidden`
        : "Lookalike excluded"}
    </span>
  );
}
export function RiskDetails({
  risk,
  mint,
}: {
  risk?: TokenRisk;
  mint: string;
}) {
  return (
    <details className="risk-details">
      <summary>
        <RiskBadge risk={risk} mint={mint} />
        <span>Details</span>
      </summary>
      <p>
        {riskProvider(risk, mint)} ·{" "}
        {risk
          ? "fetched " + new Date(risk.checkedAt).toLocaleString()
          : "check pending"}
        . Flagged, missing and expired checks are excluded from draws.
      </p>
      {risk?.reportAt && (
        <p>
          Token detected {new Date(risk.reportAt).toLocaleString()}. This is not
          the scan time. Public reports can be provider-cached; a fresh fetch
          does not prove a new scan.
        </p>
      )}
      {risk?.risks.length ? (
        <ul>
          {risk.risks.map((r, i) => (
            <li key={i}>
              <strong>{r.name}</strong>
              <span>{r.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {risk?.status === "checked"
            ? "No risks were reported by the checked sources. This does not prove a token is authentic or safe."
            : (risk?.error ??
              "A recent external report is required before this token can enter a draw.")}
        </p>
      )}
      <a href={riskLink(risk, mint)} target="_blank" rel="noreferrer">
        {risk?.source === "Not configured"
          ? "View token · screening unavailable ↗"
          : "Open full report ↗"}
      </a>
    </details>
  );
}

export function drawReadiness(data: MarketResponse | null) {
  if (!data)
    return {
      title: "Loading live token checks",
      detail: "Listening for fresh launches…",
    };
  const ready = data.pool.length;
  if (ready >= 2)
    return { title: "Coins ready to draw", detail: `${ready} screened coins` };
  if (!data.matching)
    return {
      title: ["error", "rate_limited"].includes(data.health.state)
        ? "Market data unavailable"
        : "No coins match these filters",
      detail: ["error", "rate_limited"].includes(data.health.state)
        ? "Live sources could not refresh. Retry to check again."
        : "Try More coins or adjust your filters.",
    };
  const rows = data.rows.filter(
    (row) =>
      row.matches && !row.admissionReasons.includes("duplicate_name_or_ticker"),
  );
  const count = (reason: string) =>
    rows.filter((row) => row.admissionReasons.includes(reason)).length;
  const awaiting = count("security_pending"),
    expired = count("security_stale"),
    unavailable = count("security_unavailable"),
    flagged = count("security_flagged"),
    noLiquidity = count("unknown_pair_liquidity"),
    reference = count("reference_pair_pending");
  const quarantined = count("severe_drawdown_quarantine");
  const routeWaiting = rows.filter(
    (row) =>
      (!row.token?.chain || row.token.chain === "solana") &&
      !row.admissionReasons.length &&
      row.route?.status !== "eligible",
  );
  const failures = [
    quarantined && `${quarantined} severe drawdown quarantines`,
    flagged && `${flagged} risk flagged`,
    expired && `${expired} checks expired`,
    unavailable && `${unavailable} checks unavailable`,
    awaiting && `${awaiting} awaiting risk checks`,
    noLiquidity && `${noLiquidity} no pair liquidity`,
    reference && `${reference} awaiting pair data`,
    routeWaiting.length && `${routeWaiting.length} awaiting routes`,
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
  const title =
    ready === 1
      ? "One coin ready. Need two."
      : data.health.state === "error" || data.health.state === "rate_limited"
        ? "Market data unavailable"
        : awaiting || reference
          ? "Waiting for fresh token checks"
          : expired || unavailable
            ? "Fresh risk checks required"
            : routeWaiting.length
              ? "Waiting for trade routes"
              : "No coins cleared screening";
  return {
    title,
    detail:
      failures ||
      `${data.matching} match${data.matching === 1 ? "" : "es"} · blocked by source checks`,
  };
}
