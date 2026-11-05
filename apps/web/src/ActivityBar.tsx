import { tokenTicker } from "../../../packages/shared/src/token-ticker.ts";
import { useEffect, useRef, useState } from "react";
import type {
  ActivitySnapshot,
  TradeActivity,
} from "../../../packages/shared/src/token-media.ts";
import { activeTrades, activityCycle } from "./activity-state.ts";
import { TokenIcon } from "./TokenMedia.tsx";
const short = (s: string) => s.slice(0, 4) + "…" + s.slice(-4);
const dollars = (n: number) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    notation: n >= 10000 ? "compact" : "standard",
    maximumFractionDigits: n < 10 ? 2 : 0,
  }).format(n);
export function ActivityBar({
  onToken,
}: {
  onToken: (mint: string, symbol: string) => void;
}) {
  const [data, setData] = useState<ActivitySnapshot | null>(null),
    [items, setItems] = useState<TradeActivity[]>([]),
    [paused, setPaused] = useState(false),
    [failed, setFailed] = useState(false),
    [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [now, setNow] = useState(Date.now());
  const next = useRef<TradeActivity[]>([]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    async function load() {
      try {
        const r = await fetch("/api/activity", { signal: abort.signal });
        if (!r.ok) throw Error("Activity unavailable");
        const d: ActivitySnapshot = await r.json();
        if (active) {
          setData(d);
          setFailed(false);
          next.current = d.items.slice(0, 12);
          setItems((old) => activityCycle(old, next.current, Date.now()));
          setNow(Date.now());
        }
      } catch {
        if (active) setFailed(true);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  // Keep the current cycle stable; swap new observations only at a loop boundary.
  const visible = activeTrades(items, now);
  const label = failed
    ? "Unavailable"
    : data?.status === "stale"
      ? "Delayed"
      : visible.length
        ? "Recent trades"
        : data?.status === "quiet"
          ? "Quiet markets"
          : "Connecting";
  const apply = () => {
    setItems(next.current);
    setNow(Date.now());
  };
  useEffect(() => {
    if (paused || reduced) apply();
  }, [paused, reduced, data]);
  function event(t: TradeActivity, duplicate: boolean) {
    return (
      <div className={"activity-event " + t.side} key={t.id}>
        <a
          href={"https://solscan.io/account/" + t.wallet}
          target="_blank"
          rel="noreferrer"
          tabIndex={duplicate ? -1 : 0}
          title={"Public wallet " + t.wallet}
        >
          {short(t.wallet)}
        </a>
        <span>{t.side === "buy" ? "bought" : "sold"}</span>
        <strong>{dollars(t.usd)}</strong>
        <span>of</span>
        <button
          onClick={() => onToken(t.mint, t.symbol)}
          tabIndex={duplicate ? -1 : 0}
          title={t.name + " · " + t.mint}
        >
          <TokenIcon src={t.icon} symbol={t.symbol} size={22} />
          <b>{tokenTicker(t.symbol)}</b>
        </button>
        <a
          className="activity-time"
          href={"https://solscan.io/tx/" + t.signature}
          target="_blank"
          rel="noreferrer"
          tabIndex={duplicate ? -1 : 0}
          title={
            new Date(t.at).toLocaleString() +
            " · GeckoTerminal · actual mainnet trade"
          }
        >
          {Math.max(0, Math.floor((now - Date.parse(t.at)) / 60000)) < 1
            ? "just now"
            : Math.floor((now - Date.parse(t.at)) / 60000) + "m ago"}{" "}
          ↗
        </a>
      </div>
    );
  }
  return (
    <section
      className={"activity-bar" + (paused ? " paused" : "")}
      aria-label="External Solana mainnet recent trades"
    >
      <div className="activity-label">
        <i
          className={
            visible.length && !failed && data?.status === "live" ? "live" : ""
          }
        />
        <strong>{label}</strong>
        <span>External mainnet</span>
      </div>
      <div className="activity-window">
        {visible.length ? (
          <div
            className="activity-track"
            style={{
              animationDuration: Math.max(30, visible.length * 10) + "s",
            }}
            onAnimationIteration={apply}
          >
            <div className="activity-sequence">
              {visible.map((t) => event(t, false))}
            </div>
            <div className="activity-sequence" aria-hidden="true">
              {visible.map((t) => event(t, true))}
            </div>
          </div>
        ) : (
          <div className="activity-wait">
            {failed || data?.status === "error"
              ? "Market activity is temporarily unavailable."
              : data?.status === "quiet"
                ? "Waiting for recent indexed trades in watched pools."
                : "Connecting to actual wallet trades…"}{" "}
            <span>GeckoTerminal · polled, not Rascals users</span>
          </div>
        )}
      </div>
      <button
        className="activity-pause"
        onClick={() => {
          setPaused((x) => !x);
          apply();
        }}
        aria-pressed={paused}
        aria-label={
          paused ? "Resume activity scrolling" : "Pause activity scrolling"
        }
      >
        {paused ? "▶" : "Ⅱ"}
      </button>
    </section>
  );
}
