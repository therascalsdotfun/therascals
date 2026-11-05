import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { CrankDrive, MAX_CRANK_SPEED } from "./crank-drive.ts";
import "./crank-control.css";
export function CrankControl({
  drive,
  phase,
  onStart,
  selectionArmed = true,
}: {
  drive: CrankDrive;
  phase: string;
  onStart?: () => boolean | void;
  selectionArmed?: boolean;
}) {
  const wheel = useRef<HTMLDivElement>(null),
    rotor = useRef<SVGGElement>(null),
    readout = useRef<HTMLElement>(null),
    meter = useRef<HTMLSpanElement>(null);
  const activePointer = useRef<number | null>(null),
    [dragging, setDragging] = useState(false),
    hint = useId();
  const disabled = ["extracting", "reveal", "submitting"].includes(phase);
  const turned = useRef(false);
  function release() {
    const id = activePointer.current;
    activePointer.current = null;
    if (id !== null && wheel.current?.hasPointerCapture(id))
      wheel.current.releasePointerCapture(id);
    if (turned.current) {
      drive.releaseVersion++;
      turned.current = false;
    }
    drive.keyboardActive = false;
    drive.release();
    setDragging(false);
  }
  useEffect(() => {
    if (disabled) release();
  }, [disabled]);
  useEffect(() => {
    let raf = 0;
    function frame() {
      if (!document.hidden) {
        const rpm = Math.round((drive.speed * 60) / (Math.PI * 2)),
          text =
            drive.settlingMs === null
              ? `${Math.abs(rpm)} RPM`
              : drive.settlingMs > 0
                ? `Settling ${(drive.settlingMs / 1000).toFixed(1)}s`
                : "Verifying…";
        rotor.current?.setAttribute(
          "transform",
          `rotate(${(drive.angle * 180) / Math.PI} 50 50)`,
        );
        wheel.current?.setAttribute("aria-valuenow", String(rpm));
        wheel.current?.setAttribute(
          "aria-valuetext",
          `${Math.abs(rpm)} RPM${rpm < 0 ? ", counterclockwise" : rpm > 0 ? ", clockwise" : ""}`,
        );
        if (readout.current && readout.current.textContent !== text)
          readout.current.textContent = text;
        if (meter.current)
          meter.current.style.width = `${Math.min(1, Math.abs(drive.speed) / MAX_CRANK_SPEED) * 100}%`;
        if (wheel.current) {
          wheel.current.dataset.crankSpeed = String(drive.speed);
          wheel.current.dataset.crankAngle = String(drive.angle);
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      drive.release();
    };
  }, [drive]);
  function pointerAngle(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.atan2(
      event.clientY - box.top - box.height / 2,
      event.clientX - box.left - box.width / 2,
    );
  }
  return (
    <div
      className={`crank-control ${dragging ? "is-grabbed" : ""} ${disabled ? "is-locked" : ""}`}
    >
      <span className="crank-heading">
        {phase === "extracting"
          ? "RELEASING"
          : phase === "reveal"
            ? "LANDED"
            : phase === "submitting"
              ? "VERIFYING"
              : "TURN TO MIX"}
      </span>
      <div
        ref={wheel}
        className="crank-wheel"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Lottery crank"
        aria-valuemin={-115}
        aria-valuemax={115}
        aria-valuenow={0}
        aria-describedby={hint}
        aria-disabled={disabled}
        title={
          selectionArmed
            ? "Turn to mix. Release to settle, then watch the ball drop. Arrow keys turn; Home releases."
            : "Mix the cage freely. Press Draw a token to start a draw. Arrow keys turn; Home stops."
        }
        onPointerDown={(event) => {
          if (disabled || activePointer.current !== null) return;
          if (onStart?.() === false) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          activePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          drive.grab(pointerAngle(event), event.timeStamp);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!disabled && activePointer.current === event.pointerId) {
            drive.turn(pointerAngle(event), event.timeStamp);
            if (Math.abs(drive.speed) > 0.1) turned.current = true;
          }
        }}
        onPointerUp={release}
        onBlur={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyUp={(event) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              " ",
              "Enter",
            ].includes(event.key) &&
            turned.current
          )
            release();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const direction =
            event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -1
              : event.key === "ArrowRight" ||
                  event.key === "ArrowUp" ||
                  event.key === " " ||
                  event.key === "Enter"
                ? 1
                : 0;
          if (direction) {
            event.preventDefault();
            if (onStart?.() === false) return;
            drive.keyboardActive = true;
            drive.boost(direction * 1.7);
            turned.current = true;
          } else if (event.key === "Home") {
            event.preventDefault();
            drive.keyboardActive = false;
            drive.stop();
            drive.releaseVersion++;
          }
        }}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="43" className="crank-outer" />
          <circle cx="50" cy="50" r="35" className="crank-inner" />
          {Array.from({ length: 12 }, (_, i) => (
            <path
              key={i}
              d="M50 4v4"
              transform={`rotate(${i * 30} 50 50)`}
              className="crank-notch"
            />
          ))}
          <g ref={rotor}>
            <path
              d="M50 50V15M50 50L20 68M50 50L80 68"
              className="crank-spokes"
            />
            <circle cx="50" cy="50" r="9" className="crank-hub" />
            <circle cx="50" cy="15" r="11" className="crank-grip" />
            <circle cx="47" cy="12" r="3" className="crank-shine" />
          </g>
        </svg>
      </div>
      <div className="crank-meter" aria-hidden="true">
        <span ref={meter} />
      </div>
      <strong ref={readout} className="crank-rpm" aria-hidden="true">
        0 RPM
      </strong>
      <span id={hint} className="crank-hint">
        {disabled
          ? phase === "reveal"
            ? "Roll again to mix"
            : "Aligning & releasing"
          : dragging
            ? "Faster turns. Harder hits."
            : selectionArmed
              ? "Release → settle → drop"
              : "Mix for fun · press Draw to pick"}
      </span>
    </div>
  );
}
