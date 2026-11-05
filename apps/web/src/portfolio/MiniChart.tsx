import { useEffect, useRef, useState } from "react";
const cache = new Map<string, { at: number; points: number[] }>();
export function MiniChart({
  mint,
  supported,
  onOpen,
}: {
  mint: string;
  supported: boolean;
  onOpen: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const ref = useRef<HTMLButtonElement>(null),
    [visible, setVisible] = useState(false),
    [points, setPoints] = useState<number[] | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!visible || !supported) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setRevision((n) => n + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, [visible, supported]);
  useEffect(() => {
    if (!supported) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [mint, supported]);
  useEffect(() => {
    if (!visible || !supported) return;
    const controller = new AbortController();
    setPoints(null);
    setError(false);
    const saved = cache.get(mint);
    if (saved && Date.now() - saved.at < 60000) {
      setPoints(saved.points);
      return;
    }
    fetch(`/api/price-trends/${encodeURIComponent(mint)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (r) => {
        const d = await r.json();
        if (
          !r.ok ||
          d.mint !== mint ||
          d.chain !== "solana-mainnet" ||
          d.currency !== "USD" ||
          d.stale === true ||
          !Array.isArray(d.points)
        )
          throw Error();
        const p = d.points
          .filter(
            (c: any) =>
              Number.isFinite(c.time) &&
              c.time <= Date.now() + 60_000 &&
              Number.isFinite(c.price) &&
              c.price > 0,
          )
          .sort((a: any, b: any) => a.time - b.time)
          .slice(-24);
        if (p.length < 2 || Date.now() - p.at(-1).time > 600_000) throw Error();
        return p.map((c: any) => c.price);
      })
      .then((p) => {
        if (!controller.signal.aborted) {
          if (cache.size > 200) cache.clear();
          cache.set(mint, { at: Date.now(), points: p });
          setPoints(p);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [mint, visible, supported, revision]);
  let path = "";
  if (points) {
    const lo = Math.min(...points),
      hi = Math.max(...points),
      span = hi - lo || hi * 0.01;
    path = points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${2 + (i / (points.length - 1)) * 116},${34 - ((p - lo) / span) * 30}`,
      )
      .join(" ");
  }
  return (
    <button
      ref={ref}
      type="button"
      disabled={!supported}
      className="holding-mini-chart"
      onClick={onOpen}
      aria-label="Open token price chart"
      title="Observed source prices since tracking began, not your PnL"
    >
      {points ? (
        <svg
          viewBox="0 0 120 38"
          role="img"
          aria-label="Recent market price trend"
          className={points.at(-1)! >= points[0] ? "positive" : "negative"}
        >
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : (
        <span>
          {!supported || error
            ? "Open price chart"
            : "Collecting price history…"}
        </span>
      )}
      <small>View chart ↗</small>
    </button>
  );
}
