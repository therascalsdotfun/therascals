import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MarketRow } from "../../../packages/shared/src/market.ts";
import { activityChanges, rankActivity } from "./market-energy.ts";
export function useMarketEnergy(rows: MarketRow[], resetKey: string) {
  const [paused, setPaused] = useState(false),
    [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [hidden, setHidden] = useState(document.hidden),
    [recent, setRecent] = useState<string[]>([]),
    [pops, setPops] = useState<string[]>([]);
  const previous = useRef<MarketRow[]>([]),
    key = useRef(resetKey),
    latest = useRef(rows),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    body = useRef<HTMLTableSectionElement>(null),
    positions = useRef(new Map<string, number>()),
    hoverOrder = useRef<string[]>([]);
  latest.current = rows;
  const enabled = !paused && !reduced && !hidden;
  function pop(mints: string[]) {
    if (!mints.length) return;
    setRecent((old) => [...new Set([...mints, ...old])].slice(0, 30));
    setPops(mints);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPops([]), 500);
  }
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)"),
      changed = () => setReduced(media.matches),
      visibility = () => setHidden(document.hidden);
    media.addEventListener("change", changed);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", changed);
      document.removeEventListener("visibilitychange", visibility);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (key.current !== resetKey) {
      key.current = resetKey;
      previous.current = [];
      positions.current.clear();
      setRecent([]);
      setPops([]);
    }
    const changed = activityChanges(previous.current, rows);
    previous.current = rows;
    if (enabled) pop(changed.slice(0, 3));
  }, [rows, resetKey, enabled]);
  const ordered = reduced
    ? rows
    : rankActivity(rows, paused ? hoverOrder.current : recent);
  if (!paused) hoverOrder.current = ordered.map((r) => r.token.mint);
  useLayoutEffect(() => {
    if (!body.current) return;
    const next = new Map<string, number>();
    for (const row of body.current.querySelectorAll<HTMLTableRowElement>(
      "tr[data-mint]",
    )) {
      const mint = row.dataset.mint!,
        y = row.offsetTop;
      next.set(mint, y);
      const old = positions.current.get(mint);
      if (enabled && old !== undefined && Math.abs(old - y) > 1) {
        row.getAnimations().forEach((a) => a.cancel());
        row.animate(
          [
            { transform: `translateY(${old - y}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: 500, easing: "cubic-bezier(.16,1,.3,1)" },
        );
      }
    }
    positions.current = next;
  });
  return {
    ordered,
    pops: enabled ? pops : [],
    paused,
    setPaused,
    reduced,
    body,
  };
}
