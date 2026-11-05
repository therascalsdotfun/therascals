import { useEffect, useRef, useState } from "react";
import { CaseMotion, caseTokenAt, type CaseFrame } from "./case-motion.ts";

export type ReelProps = {
  ids: string[];
  selectedId: string | null;
  phase: string;
  roll: number;
  onExtractionStart?: () => void;
  onExtracted?: (id: string, roll: number) => void;
  onTick?: () => void;
};

export function useReelMotion(props: ReelProps) {
  const latest = useRef(props);
  latest.current = props;
  const restored = useRef(props.phase === "reveal");
  const restoredFrame = (p: ReelProps): CaseFrame => ({
    position: Math.max(0, p.ids.indexOf(p.selectedId ?? "")),
    stage: "complete",
  });
  const [frame, setFrame] = useState<CaseFrame>(() =>
    props.phase === "reveal"
      ? restoredFrame(props)
      : { position: 0, stage: "spinning" },
  );
  const active = ["mixing", "extracting", "reveal"].includes(props.phase);
  const identity = props.ids.join(",");
  useEffect(() => {
    if (latest.current.phase === "reveal") {
      setFrame(restoredFrame(latest.current));
      return;
    }
    restored.current = false;
    if (!active) {
      setFrame({ position: 0, stage: "spinning" });
      return;
    }
    const motion = new CaseMotion(latest.current.ids, 0);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0,
      clock = 0,
      previous = performance.now(),
      started = false,
      completed = false,
      lastTick = -1,
      lastSound = 0;
    const render = (wall: number) => {
      const dt = document.hidden
        ? 0
        : Math.min(40, Math.max(0, wall - previous));
      previous = wall;
      if (!document.hidden) {
        clock += dt;
        const current = latest.current;
        const next = motion.sample(clock, current.selectedId, reduced.matches);
        setFrame(next);
        if (next.stage !== "spinning" && !started) {
          started = true;
          current.onExtractionStart?.();
        }
        const tick = Math.round(next.position);
        if (
          !reduced.matches &&
          tick !== lastTick &&
          clock - lastSound > 55 &&
          next.stage !== "complete"
        ) {
          current.onTick?.();
          lastSound = clock;
        }
        lastTick = tick;
        if (
          next.stage === "complete" &&
          !completed &&
          current.selectedId &&
          caseTokenAt(current.ids, next.position) === current.selectedId
        ) {
          completed = true;
          current.onExtracted?.(current.selectedId, current.roll);
        }
      }
      if (!completed) raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [active, props.roll, identity]);
  return { frame, active, restored: restored.current };
}
