export function projectPoint(
  p: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
) {
  const x = p.x * Math.cos(yaw) + p.z * Math.sin(yaw),
    z0 = p.z * Math.cos(yaw) - p.x * Math.sin(yaw);
  const y = p.y * Math.cos(pitch) - z0 * Math.sin(pitch),
    z = p.y * Math.sin(pitch) + z0 * Math.cos(pitch);
  const scale = 1 / (1 - Math.max(-1, Math.min(1, z)) * 0.22);
  return { x: x * scale, y: y * scale, z, scale };
}
