import { useEffect, useRef, useState } from "react";
import { CrankDrive } from "./crank-drive.ts";
import { CrankControl } from "./CrankControl.tsx";
import { CanvasCage } from "./CanvasCage.tsx";
import { LoadingSkeleton } from "../LoadingSkeleton.tsx";
import type { CageProps } from "./cage-scene.ts";
export function Cage(props: CageProps) {
  const ref = useRef<HTMLCanvasElement>(null),
    crank = useRef(new CrankDrive()),
    latest = useRef({ ...props, crank: crank.current });
  latest.current = { ...props, crank: crank.current };
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => setSubmitted(false), [props.roll, props.phase === "idle"]);
  const notifyRelease = (
    release: Parameters<NonNullable<CageProps["onReleaseSelection"]>>[0],
  ) => {
    setSubmitted(true);
    props.onReleaseSelection?.(release);
  };
  latest.current = {
    ...props,
    crank: crank.current,
    onReleaseSelection: notifyRelease,
  };
  const [state, setState] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const loadFailed = useRef(false);
  useEffect(() => {
    let cancelled = false,
      cleanup: (() => void) | undefined;
    void import("./cage-scene.ts")
      .then(({ createCageScene }) => {
        if (cancelled || !ref.current) return;
        try {
          cleanup = createCageScene(
            ref.current,
            () => latest.current,
            () => {
              if (!cancelled) {
                cleanup?.();
                cleanup = undefined;
                setState("fallback");
              }
            },
          );
          setState("ready");
        } catch {
          setState("fallback");
        }
      })
      .catch(() => {
        if (!cancelled) {
          loadFailed.current = true;
          cleanup?.();
          cleanup = undefined;
          setState("fallback");
        }
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [attempt]);
  // Fallback uses a different canvas: a canvas cannot change WebGL/2D context type.
  if (state === "fallback")
    return (
      <div
        className="cage-fallback"
        style={{ position: "relative", height: "100%" }}
      >
        <CanvasCage
          {...props}
          crank={crank.current}
          onReleaseSelection={notifyRelease}
        />
        <CrankControl
          drive={crank.current}
          selectionArmed={props.selectionArmed}
          phase={submitted && !props.selected ? "submitting" : props.phase}
          onStart={props.onCrankStart}
        />
        <div className="renderer-fallback-note" role="status">
          <span>2D compatibility mode</span>
          <button
            type="button"
            onClick={() => {
              if (loadFailed.current) {
                location.reload();
                return;
              }
              setState("loading");
              setAttempt((value) => value + 1);
            }}
          >
            Restore 3D
          </button>
        </div>
      </div>
    );
  return (
    <div
      className="webgl-cage"
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <canvas
        ref={ref}
        style={{
          opacity: state === "ready" ? 1 : 0,
          transition: "opacity 0.4s",
        }}
        role="img"
        aria-label={`3D lottery cage: ${props.tokens.length} token balls${props.phase === "reveal" ? ", selected " + props.selected?.symbol : ""}`}
      />
      {state === "ready" && (
        <CrankControl
          drive={crank.current}
          selectionArmed={props.selectionArmed}
          phase={submitted && !props.selected ? "submitting" : props.phase}
          onStart={props.onCrankStart}
        />
      )}
      {state === "loading" && (
        <div style={{ position: "absolute", inset: 0 }}>
          <LoadingSkeleton kind="machine" />
        </div>
      )}
    </div>
  );
}
