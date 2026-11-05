import { tokenTicker } from "../../../../packages/shared/src/token-ticker.ts";
import type { CageProps } from "./cage-scene.ts";
import { ReleaseClock, SETTLE_MS } from "./release-clock.ts";
import { tokenKey } from "../../../../packages/shared/src/token-selection.ts";
import { useEffect, useRef } from "react";
import type { CrankDrive } from "./crank-drive.ts";
import { bottomCanvasExit } from "./canvas-exit.ts";
import { projectPoint } from "./depth.ts";
import { marketCapRadius, stepBlower } from "./dynamics.ts";
import { tokenImageUrl } from "../../../../packages/shared/src/token-media.ts";
import { DrawMotion, extractionPose, type BallPose } from "./motion.ts";
import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
const colors = [
  "#d6f15c",
  "#e4a6bf",
  "#9bbde1",
  "#e9ba77",
  "#bdade1",
  "#8fceae",
  "#ed997c",
  "#a5d3cf",
];
type Ball = {
  token: TokenObservation;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  seed: number;
  color: string;
};
export function CanvasCage(props: CageProps) {
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const el = canvas.current!,
      ctx = el.getContext("2d")!;
    const releaseClock = new ReleaseClock();
    let lastReleaseVersion = 0;
    let w = 0,
      h = 0,
      raf = 0,
      motion = new DrawMotion(0),
      origin: BallPose | null = null,
      captureAt = 0,
      captureDuration = 0,
      captured = false,
      captureNotified = false,
      completed = false,
      roll = -1,
      identity = "",
      balls: Ball[] = [],
      pointerX = 0,
      pointerY = 0,
      cameraX = 0,
      cameraY = 0;
    const images = new Map<string, HTMLImageElement>();
    let visibleClock = 0,
      orbitAngle = 0.12,
      previousWall = performance.now();
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const resize = () => {
      const rect = el.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      const d = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.round(w * d);
      el.height = Math.round(h * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const move = (e: PointerEvent) => {
      if (!finePointer.matches || reduced.matches) return;
      const rect = el.getBoundingClientRect();
      pointerX = (e.clientX - rect.left) / rect.width - 0.5;
      pointerY = (e.clientY - rect.top) / rect.height - 0.5;
    };
    const leave = () => {
      pointerX = 0;
      pointerY = 0;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    function ellipse(
      x: number,
      y: number,
      rx: number,
      ry: number,
      stroke: string,
      width = 1,
    ) {
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        Math.max(0.01, rx),
        Math.max(0.01, ry),
        0,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    function ball(
      x: number,
      y: number,
      r: number,
      b: Ball,
      big = false,
      alpha = 1,
    ) {
      ctx.save();
      ctx.globalAlpha = alpha;
      const g = ctx.createRadialGradient(
        x - r * 0.35,
        y - r * 0.45,
        0,
        x + r * 0.15,
        y + r * 0.2,
        r * 1.2,
      );
      g.addColorStop(0, "#fffff0");
      g.addColorStop(0.23, b.color);
      g.addColorStop(0.7, b.color);
      g.addColorStop(1, "#48553b");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fffbe5dc";
      ctx.beginPath();
      ctx.arc(x, y + r * 0.05, r * 0.72, 0, Math.PI * 2);
      ctx.fill();
      const image = images.get(
        tokenImageUrl(b.token.dex?.icon ?? b.token.icon) ?? "",
      );
      if (image?.complete && image.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
        ctx.clip();
        const edge = Math.min(image.naturalWidth, image.naturalHeight);
        ctx.drawImage(
          image,
          (image.naturalWidth - edge) / 2,
          (image.naturalHeight - edge) / 2,
          edge,
          edge,
          x - r * 0.72,
          y - r * 0.72,
          r * 1.44,
          r * 1.44,
        );
        ctx.fillStyle = "#11170ed9";
        ctx.fillRect(x - r, y + r * 0.2, r * 2, r * 0.45);
        ctx.restore();
      }
      const shine = ctx.createRadialGradient(
        x - r * 0.35,
        y - r * 0.4,
        0,
        x - r * 0.25,
        y - r * 0.25,
        r * 0.75,
      );
      shine.addColorStop(0, "#ffffff88");
      shine.addColorStop(0.6, "#ffffff08");
      shine.addColorStop(1, "#ffffff00");
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle =
        image?.complete && image.naturalWidth > 0 ? "#ffffec" : "#253019";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = tokenTicker(b.token.symbol).slice(0, 13);
      ctx.font = `800 ${big ? r * 0.22 : Math.max(7, r * Math.min(0.38, 1.9 / label.length))}px "Avenir Next",sans-serif`;
      ctx.fillText(
        label,
        x,
        y + r * (image?.complete && image.naturalWidth > 0 ? 0.43 : 0.07),
        r * 1.3,
      );
      ctx.restore();
    }
    function frame(now: number) {
      const wall = now;
      const elapsed = document.hidden
        ? 0
        : Math.min(32, Math.max(0, wall - previousWall));
      previousWall = wall;
      visibleClock += elapsed;
      now = visibleClock;
      const p = latest.current,
        dt = Math.min(0.025, elapsed / 1000);
      if (document.hidden) {
        raf = requestAnimationFrame(frame);
        return;
      }
      cameraX +=
        ((reduced.matches || p.ambientMotion === false ? 0 : pointerX) -
          cameraX) *
        0.07;
      cameraY +=
        ((reduced.matches || p.ambientMotion === false ? 0 : pointerY) -
          cameraY) *
        0.07;
      if (!reduced.matches && p.ambientMotion !== false)
        orbitAngle += dt * (p.phase === "mixing" ? 0.5 : 0.12);
      const s =
          w < 500 ? Math.min(w / 460, h / 500) : Math.min(w / 640, h / 560),
        cx = w * 0.49 + cameraX * 12,
        cy = h * (w < 500 ? 0.39 : 0.38) + cameraY * 8,
        R = 180 * s,
        exit = bottomCanvasExit(cx, cy, R, s),
        intake = exit[0],
        t = now / 1000,
        yaw = reduced.matches ? 0.12 : orbitAngle + cameraX * 0.18,
        pitch = -0.09 + cameraY * 0.1;
      const id = p.tokens.map(tokenKey).join(",");
      for (const token of p.tokens) {
        const url = tokenImageUrl(token.dex?.icon ?? token.icon);
        if (url && !images.has(url)) {
          const image = new Image();
          image.referrerPolicy = "no-referrer";
          image.decoding = "async";
          image.src = url;
          images.set(url, image);
          if (images.size > 48) images.delete(images.keys().next().value!);
        }
      }
      for (const b of balls) {
        const latest = p.tokens.find((t) => tokenKey(t) === tokenKey(b.token));
        if (latest) {
          b.token = latest;
          b.r = marketCapRadius(latest.marketCap.value);
        }
      }
      if (id !== identity) {
        identity = id;
        balls = p.tokens.map((token, i) => ({
          token,
          x: ((i % 4) - 1.5) * 0.28,
          y: 0.5 + Math.floor(i / 4) * 0.17,
          z: Math.sin(i) * 0.4,
          vx: 0,
          vy: 0,
          vz: 0,
          r: marketCapRadius(token.marketCap.value),
          seed: i * 13,
          color: colors[i % 8],
        }));
      }
      if (roll !== p.roll) {
        roll = p.roll;
        releaseClock.reset();
        motion = new DrawMotion(now);
        origin = null;
        captured = false;
        captureNotified = false;
        completed = false;
        for (const b of balls) {
          b.vx = (Math.random() - 0.5) * 7;
          b.vy = -4 - Math.random() * 2;
          b.vz = (Math.random() - 0.5) * 4;
          if (releaseClock.submitted) b.vx = b.vy = b.vz = 0;
        }
      }
      const reveal = p.phase === "reveal",
        chosen = balls.find(
          (b) => !!p.selected && tokenKey(b.token) === tokenKey(p.selected),
        ),
        running = p.phase === "mixing" || p.phase === "extracting";
      let sample = running
        ? motion.sample(
            now,
            chosen?.token.mint ?? null,
            reduced.matches,
            captured,
          )
        : { stage: reveal ? "complete" : "idle", progress: reveal ? 1 : 0 };
      const crank = p.crank;
      if (running && p.proximity && !chosen) {
        const report = releaseClock.update(
          dt,
          (crank?.dragging || crank?.keyboardActive) ?? false,
          (crank?.releaseVersion ?? 0) !== lastReleaseVersion,
        );
        lastReleaseVersion = crank?.releaseVersion ?? 0;
        el.dataset.releaseStage = releaseClock.submitted
          ? "verifying"
          : releaseClock.released
            ? "settling"
            : "mixing";
        el.dataset.releaseElapsed = String(releaseClock.elapsedMs);
        if (report) p.onReleaseSelection?.(report);
      }
      const settling =
          !!p.proximity &&
          releaseClock.released &&
          !crank?.dragging &&
          !crank?.keyboardActive,
        held = !!p.proximity && releaseClock.submitted && !chosen;
      if (crank)
        crank.settlingMs =
          p.proximity && running && releaseClock.released && !chosen
            ? Math.max(0, SETTLE_MS - releaseClock.elapsedMs)
            : null;
      crank?.advance(
        dt,
        running && sample.stage === "mixing" && !reduced.matches && !settling
          ? 1.8
          : 0,
        settling ||
          ["capturing", "extracting", "complete"].includes(sample.stage),
      );
      if (sample.stage === "capturing" && !captureNotified) {
        captureNotified = true;
        p.onExtractionStart?.();
      }
      let capturePose: BallPose | null = null;
      if (
        sample.stage === "capturing" &&
        chosen &&
        !origin &&
        (!crank || crank.aligned)
      ) {
        const projection = projectPoint(chosen, yaw, pitch);
        origin = {
          x: projection.x,
          y: projection.y,
          r: chosen.r * projection.scale,
        };
        captureAt = now;
        captureDuration = reduced.matches
          ? 80
          : Math.max(
              450,
              Math.min(
                1100,
                (Math.hypot(
                  cx + origin.x * R - intake.x,
                  cy + origin.y * R - intake.y,
                ) /
                  (520 * s)) *
                  1000,
              ),
            );
      }
      if (sample.stage === "capturing" && origin && chosen) {
        capturePose = extractionPose((now - captureAt) / captureDuration, [
          { x: cx + origin.x * R, y: cy + origin.y * R, r: origin.r * R },
          intake,
        ]);
        if (
          Math.hypot(capturePose.x - intake.x, capturePose.y - intake.y) < 0.01
        ) {
          captured = true;
          sample = motion.sample(now, chosen.token.mint, reduced.matches, true);
        }
      }
      const capturing = running && sample.stage === "capturing",
        extracting =
          running && ["extracting", "complete"].includes(sample.stage),
        mixing = running && sample.stage === "mixing";
      el.dataset.drawStage = sample.stage;
      el.dataset.exit = "bottom";
      el.dataset.crankSpeed = String(crank?.speed ?? 0);
      el.dataset.drumAngle = String(crank?.angle ?? 0);
      el.dataset.extractionProgress = String(sample.progress);
      el.dataset.captureDistance = String(
        capturePose
          ? Math.hypot(capturePose.x - intake.x, capturePose.y - intake.y)
          : captured
            ? 0
            : -1,
      );
      el.dataset.ballSizes = balls
        .map(
          (b) =>
            `${b.token.symbol}:${b.token.marketCap.value}:${b.r.toFixed(4)}`,
        )
        .join(",");
      if (
        (!reduced.matches && (running || p.ambientMotion !== false)) ||
        Math.abs(crank?.speed ?? 0) > 0.02
      )
        for (const b of balls) {
          if (held) continue;
          if (b === chosen && ((capturing && !!origin) || extracting || reveal))
            continue;
          if (
            !settling &&
            (mixing || capturing || Math.abs(crank?.speed ?? 0) > 0.02)
          ) {
            Object.assign(b, stepBlower(b, t, dt, crank?.speed ?? 0));
            continue;
          } else b.vy += 1.45 * dt;
          if (extracting) {
            b.vx *= 0.94;
            b.vy *= 0.96;
          }
          if (reveal) {
            b.vx = 0;
            b.vy = 0;
            b.vz = 0;
          }
          b.vx *= Math.pow(0.9, dt * 60);
          b.vz *= Math.pow(0.94, dt * 60);
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.z += b.vz * dt;
          const len = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z * 0.18);
          if (len > 0.81) {
            const nx = b.x / len,
              ny = b.y / len,
              nz = (b.z * 0.18) / len;
            b.x *= 0.81 / len;
            b.y *= 0.81 / len;
            const d = b.vx * nx + b.vy * ny + b.vz * nz;
            b.vx -= 1.65 * d * nx;
            b.vy -= 1.65 * d * ny;
            b.vz -= 1.65 * d * nz;
          }
          b.z = Math.max(-0.6, Math.min(0.6, b.z));
        }
      if (!held)
        for (let k = 0; k < 2; k++)
          for (let i = 0; i < balls.length; i++)
            for (let j = i + 1; j < balls.length; j++) {
              const a = balls[i],
                b = balls[j],
                dx = b.x - a.x,
                dy = b.y - a.y,
                dz = b.z - a.z,
                len = Math.hypot(dx, dy, dz),
                min = a.r + b.r;
              if (
                ((capturing && !!origin) || extracting || reveal) &&
                (a === chosen || b === chosen)
              )
                continue;
              if (len < min && len > 0.001) {
                const nx = dx / len,
                  ny = dy / len,
                  nz = dz / len,
                  q = (min - len) * 0.5;
                a.x -= nx * q;
                a.y -= ny * q;
                a.z -= nz * q;
                b.x += nx * q;
                b.y += ny * q;
                b.z += nz * q;
                const rel =
                  (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
                if (rel < 0) {
                  a.vx += rel * nx * 0.75;
                  a.vy += rel * ny * 0.75;
                  a.vz += rel * nz * 0.75;
                  b.vx -= rel * nx * 0.75;
                  b.vy -= rel * ny * 0.75;
                  b.vz -= rel * nz * 0.75;
                }
              }
            }
      for (const b of balls) {
        const length = Math.hypot(b.x, b.y, b.z),
          limit = 0.98 - b.r;
        if (length > limit) {
          b.x *= limit / length;
          b.y *= limit / length;
          b.z *= limit / length;
        }
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#66587822";
      ctx.beginPath();
      ctx.ellipse(cx, cy + R + 98 * s, R * 1.25, 23 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      const metal = ctx.createLinearGradient(cx - 120 * s, 0, cx + 120 * s, 0);
      metal.addColorStop(0, "#5965ac");
      metal.addColorStop(0.3, "#a3b3ed");
      metal.addColorStop(0.55, "#7589d0");
      metal.addColorStop(0.8, "#a99cce");
      metal.addColorStop(1, "#6d63a5");
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.roundRect(cx - 117 * s, cy + R + 14 * s, 234 * s, 68 * s, 16 * s);
      ctx.fill();
      ellipse(cx, cy + R + 16 * s, 116 * s, 19 * s, "#a7b48b88", 1.4);
      ctx.fillStyle = "#8e7cba";
      ctx.beginPath();
      ctx.roundRect(cx - 135 * s, cy + R + 66 * s, 270 * s, 25 * s, 8 * s);
      ctx.fill();
      ctx.fillStyle = "#fff5dc";
      ctx.textAlign = "center";
      ctx.font = `800 ${20 * s}px "Avenir Next",sans-serif`;
      ctx.fillText("RASCALS", cx, cy + R + 55 * s);
      ctx.fillStyle = "#efe4ff";
      ctx.font = `500 ${8 * s}px "Avenir Next",sans-serif`;
      ctx.fillText("THE TICKER LOTTERY", cx, cy + R + 75 * s);
      const glass = ctx.createRadialGradient(
        cx - R * 0.3,
        cy - R * 0.4,
        0,
        cx,
        cy,
        R,
      );
      glass.addColorStop(0, "#c5db9610");
      glass.addColorStop(0.8, "#c5db9605");
      glass.addColorStop(1, "#c5db962a");
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      function wire(front: boolean) {
        const draw = (
          point: (q: number) => { x: number; y: number; z: number },
        ) => {
          ctx.beginPath();
          let pen = false;
          for (let i = 0; i <= 96; i++) {
            const a = projectPoint(
              point((i / 96) * Math.PI * 2),
              yaw,
              pitch + (crank?.angle ?? 0),
            );
            if (a.z >= 0 !== front) {
              pen = false;
              continue;
            }
            const x = cx + a.x * R,
              y = cy + a.y * R;
            if (pen) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
            pen = true;
          }
          ctx.strokeStyle = front ? "#4263b6b0" : "#8698c650";
          ctx.lineWidth = front ? 1.15 * s : 0.8 * s;
          ctx.stroke();
        };
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 8;
          draw((q) => ({
            x: Math.sin(q) * Math.cos(a),
            y: Math.cos(q),
            z: Math.sin(q) * Math.sin(a),
          }));
        }
        for (const y of [-0.65, -0.35, 0, 0.35, 0.65]) {
          const r = Math.sqrt(1 - y * y);
          draw((q) => ({ x: r * Math.cos(q), y, z: r * Math.sin(q) }));
        }
      }
      wire(false);
      if ((mixing || capturing) && !reduced.matches)
        for (let i = 0; i < 20; i++) {
          const a = (t * (2 + i * 0.045) + i * 0.084) % 1,
            x = cx + Math.sin(i * 1.8 + t * 3) * R * 0.48,
            y = cy + R * 0.76 - a * R * 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y + 22 * s);
          ctx.quadraticCurveTo(x + 8 * s, y + 8 * s, x + 4 * s, y);
          ctx.strokeStyle = `rgba(209,240,130,${(1 - a) * 0.3})`;
          ctx.lineWidth = 1.5 * s;
          ctx.stroke();
        }
      for (const b of [...balls].sort(
        (a, b) => projectPoint(a, yaw, pitch).z - projectPoint(b, yaw, pitch).z,
      )) {
        if (b === chosen && (reveal || (capturing && !!origin) || extracting))
          continue;
        const projection = projectPoint(b, yaw, pitch);
        if (mixing && !reduced.matches) {
          const tail = projectPoint(
            {
              x: b.x - b.vx * 0.045,
              y: b.y - b.vy * 0.045,
              z: b.z - b.vz * 0.045,
            },
            yaw,
            pitch,
          );
          ctx.beginPath();
          ctx.moveTo(cx + tail.x * R, cy + tail.y * R);
          ctx.lineTo(cx + projection.x * R, cy + projection.y * R);
          ctx.strokeStyle = b.color + "55";
          ctx.lineWidth = R * b.r * 0.35;
          ctx.stroke();
        }
        ball(
          cx + projection.x * R,
          cy + projection.y * R,
          R * b.r * projection.scale,
          b,
          false,
          reveal ? 0.2 : extracting ? 1 - sample.progress * 0.7 : 1,
        );
      }
      if (capturing && capturePose && chosen) {
        ellipse(intake.x, intake.y, 22 * s, 12 * s, "#deff78bb", 2 * s);
        ball(capturePose.x, capturePose.y, capturePose.r, chosen);
      }
      wire(true);
      ellipse(cx, cy, R, R, "#c8d4a179", 2 * s);
      ellipse(cx, cy, R - 6 * s, R - 4 * s, "#edf7cf15");
      ctx.beginPath();
      ctx.arc(cx, cy, R - 10 * s, 3.45, 4.55);
      ctx.strokeStyle = "#f0f5dd40";
      ctx.lineWidth = 6 * s;
      ctx.lineCap = "round";
      ctx.stroke();
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + sign * R * 0.71, cy + R * 0.7);
        ctx.lineTo(cx + sign * 110 * s, cy + R + 20 * s);
        ctx.strokeStyle = "#829164";
        ctx.lineWidth = 6 * s;
        ctx.stroke();
      }
      // Bottom gate and descending chute to the lower catch tray.
      ctx.beginPath();
      ctx.moveTo(exit[0].x, exit[0].y);
      for (const point of exit.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#b5a0d8aa";
      ctx.lineWidth = 38 * s;
      ctx.stroke();
      ctx.strokeStyle = "#e6dcf2ed";
      ctx.lineWidth = 33 * s;
      ctx.stroke();
      ellipse(intake.x, intake.y, 22 * s, 8 * s, "#d6e9a4bb", 2 * s);
      const tray = exit[exit.length - 1];
      ctx.fillStyle = "#c4aedc";
      ctx.beginPath();
      ctx.ellipse(tray.x, tray.y + 28 * s, 39 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ellipse(tray.x, tray.y + 28 * s, 39 * s, 9 * s, "#d6e9a4bb", 2 * s);
      if (chosen && (reveal || extracting)) {
        const a = reveal ? 1 : sample.progress;
        const { x, y, r } = extractionPose(a, exit);
        ball(x, y, r, chosen, true);
        if (a > 0.98) {
          ctx.font = `600 ${10 * s}px "Avenir Next",sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = "#68518b";
          ctx.fillText(tokenTicker(chosen.token.symbol), x, y + 49 * s);
        }
        if (sample.stage === "complete" && !completed && running) {
          completed = true;
          p.onExtracted?.(chosen.token.mint, p.roll);
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener("pointermove", move);
      images.clear();
      el.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      aria-label={`Lottery cage: ${props.tokens.length} eligible real token balls${props.phase === "reveal" ? ", selected " + props.selected?.symbol : ""}`}
      role="img"
    />
  );
}
