import { useEffect, useRef, useState } from "react";
import { RotateCw, Sparkles } from "lucide-react";
import {
  REWARD_TIERS,
  rewardWheelRotation,
  type RewardEntry,
} from "../../../../packages/shared/src/rewards.ts";
/** The spin celebrates an already verified volume credit; it never chooses the award. */
export function RewardWheel({ entry }: { entry: RewardEntry | null }) {
  const [angle, setAngle] = useState(0),
    [spinning, setSpinning] = useState(false),
    [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const band = REWARD_TIERS.find((b) => b.id === entry?.bandId);
  function replay() {
    if (!band) {
      setShown(true);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setShown(false);
    setSpinning(true);
    setAngle((v) => rewardWheelRotation(band.id, v, reduced ? 0 : 5));
    timer.current = setTimeout(
      () => {
        setSpinning(false);
        setShown(true);
      },
      reduced ? 30 : 2950,
    );
  }
  useEffect(() => {
    setShown(false);
    setSpinning(false);
    // Let the initial wheel paint before starting its transition, including in a dialog.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (entry) replay();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [entry?.id]);
  return (
    <div
      className={`reward-machine ${spinning ? "is-spinning" : ""} ${shown ? "is-revealed" : ""}`}
    >
      <span className="reward-machine-label">
        Trade verified · points recorded
      </span>
      <div className="reward-wheel-stage">
        <span className="reward-wheel-pointer" aria-hidden="true" />
        <svg
          className="reward-wheel"
          viewBox="0 0 320 320"
          style={{ transform: `rotate(${angle}deg)` }}
          role="img"
          aria-label="Executed volume points celebration"
        >
          <circle
            cx="160"
            cy="160"
            r="145"
            fill="#e1edd8"
            stroke="#35513d"
            strokeWidth="3"
          />
          {Array.from({ length: 12 }, (_, i) => (
            <circle
              key={i}
              cx={160 + 122 * Math.cos((i * Math.PI) / 6)}
              cy={160 + 122 * Math.sin((i * Math.PI) / 6)}
              r="5"
              fill="#35513d"
            />
          ))}
          <text x="160" y="95" textAnchor="middle" fill="#35513d" fontSize="20">
            10 pts / USDC
          </text>
          <circle
            cx="160"
            cy="160"
            r="32"
            fill="#fffdf5"
            stroke="#383044"
            strokeWidth="3"
          />
          <text x="160" y="169" textAnchor="middle" fontSize="28">
            ✳
          </text>
        </svg>
      </div>
      <div className="reward-wheel-result" aria-live="polite">
        {entry ? (
          shown ? (
            <>
              <strong>+{entry.points.toLocaleString()} points!</strong>
              <span>{entry.label}</span>
              <small>
                {Number(entry.volumeAtomic) / 1e6} USDC × 10 points
                {entry.capped ? " · daily cap applied" : ""}
                {entry.roundingCarry
                  ? " · accumulated fractional points included"
                  : ""}
              </small>
            </>
          ) : (
            <>
              <strong>Giving your points a little spin…</strong>
              <span>
                Already credited. Your executed volume fixes the award.
              </span>
            </>
          )
        ) : (
          <>
            <strong>Fill first. Confetti second.</strong>
            <span>Completed eligible trades trigger an automatic spin.</span>
          </>
        )}
      </div>
      <button
        className="reward-spin"
        disabled={!band || spinning}
        onClick={replay}
      >
        {spinning ? <Sparkles size={18} /> : <RotateCw size={18} />}
        {spinning ? "Spinning…" : "Replay celebration"}
      </button>
      <p className="reward-wheel-note">
        Points follow verified executed volume. Replaying changes no points.
      </p>
      <details className="reward-odds">
        <summary>Points from executed volume</summary>
        <ul>
          {REWARD_TIERS.map((b) => (
            <li key={b.id}>
              <span>
                {b.range} · {b.label}
              </span>
              <b>Same rate</b>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
