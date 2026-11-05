export function marketCapRadius(cap: number | null): number {
  if (cap === null || !Number.isFinite(cap) || cap <= 0) return 0.105;
  return 0.105 + Math.max(0, Math.min(1, Math.log10(cap / 10000) / 4)) * 0.085;
}
type Body = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  seed: number;
};
export function stepBlower<T extends Body>(
  body: T,
  time: number,
  delta: number,
  rotationSpeed = 0,
): T {
  const b = { ...body };
  const steps = Math.max(1, Math.ceil(Math.min(delta, 0.05) * 120));
  const dt = Math.min(delta, 0.05) / steps;
  for (let i = 0; i < steps; i++) {
    const t = time + dt * i;
    const rotor = Number.isFinite(rotationSpeed)
      ? Math.max(-12, Math.min(12, rotationSpeed))
      : 0;
    b.vy += -rotor * b.z * 2 * dt;
    b.vz += rotor * b.y * 2 * dt;
    b.vx += (-b.y * 12 + Math.sin(t * 11 + b.seed) * 9) * dt;
    b.vy +=
      (b.x * 9 +
        2 -
        Math.max(0, b.y + 0.1) * 24 +
        Math.cos(t * 9 + b.seed) * 6) *
      dt;
    b.vz += (Math.sin(t * 8 + b.seed) * 8 - b.z * 10) * dt;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const damping =
      Math.exp(-0.35 * dt) *
      Math.min(1, (5.8 + Math.abs(rotor) * 0.45) / Math.max(speed, 0.001));
    b.vx *= damping;
    b.vy *= damping;
    b.vz *= damping;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    const length = Math.hypot(b.x, b.y, b.z),
      limit = 0.98 - b.r;
    if (length > limit) {
      const nx = b.x / length,
        ny = b.y / length,
        nz = b.z / length;
      b.x = nx * limit;
      b.y = ny * limit;
      b.z = nz * limit;
      const outward = b.vx * nx + b.vy * ny + b.vz * nz;
      if (outward > 0) {
        b.vx -= 1.85 * outward * nx;
        b.vy -= 1.85 * outward * ny;
        b.vz -= 1.85 * outward * nz;
      }
    }
  }
  return b;
}
