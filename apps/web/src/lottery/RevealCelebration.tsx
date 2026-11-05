import { useEffect, useRef } from "react";
import { fireworkParticles } from "./fireworks.ts";
export function RevealCelebration({
  trigger,
  enabled,
}: {
  trigger: number;
  enabled: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    seen = useRef(trigger);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const fresh = trigger > seen.current;
    seen.current = Math.max(seen.current, trigger);
    if (!fresh || !enabled || reduced.matches) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.celebrating = "false";
      return;
    }
    let raf = 0,
      start = performance.now(),
      stopped = false;
    const rect = canvas.getBoundingClientRect(),
      d = Math.min(devicePixelRatio || 1, 2);
    canvas.width = rect.width * d;
    canvas.height = rect.height * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    canvas.dataset.celebrating = "true";
    function stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.celebrating = "false";
    }
    function frame(now: number) {
      if (stopped) return;
      if (reduced.matches || document.hidden) {
        stop();
        return;
      }
      const elapsed = now - start;
      ctx!.clearRect(0, 0, rect.width, rect.height);
      if (elapsed >= 2300) {
        stop();
        return;
      }
      for (const p of fireworkParticles(elapsed)) {
        ctx!.globalAlpha = p.alpha;
        ctx!.strokeStyle = p.color;
        ctx!.fillStyle = p.color;
        const x = p.x * rect.width,
          y = p.y * rect.height;
        ctx!.beginPath();
        ctx!.arc(x, y, p.size, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(x, y);
        ctx!.lineTo(x + (p.x - 0.5) * 5, y - 4);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    reduced.addEventListener("change", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      stop();
      reduced.removeEventListener("change", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [trigger, enabled]);
  return (
    <canvas
      ref={ref}
      className="reveal-fireworks"
      aria-hidden="true"
      data-celebrating="false"
    />
  );
}
