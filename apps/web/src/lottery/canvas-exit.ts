import type { BallPose } from "./motion.ts";
// Canvas coordinates grow downwards. The fallback follows the same bottom-exit
// direction as WebGL and never lifts the result back into a central spotlight.
export function bottomCanvasExit(
  cx: number,
  cy: number,
  radius: number,
  scale: number,
): BallPose[] {
  return [
    { x: cx, y: cy + radius - 16 * scale, r: 16 * scale },
    { x: cx, y: cy + radius + 9 * scale, r: 16 * scale },
    { x: cx + 65 * scale, y: cy + radius + 35 * scale, r: 20 * scale },
    { x: cx + radius * 0.93, y: cy + radius + 60 * scale, r: 26 * scale },
  ];
}
