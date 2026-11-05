const bursts = [
  { x: 0.22, y: 0.32, at: 0 },
  { x: 0.77, y: 0.26, at: 230 },
  { x: 0.52, y: 0.15, at: 470 },
];
const colors = ["#d6f15c", "#f1c780", "#c8bae9", "#9bd9c5"];
export function fireworkParticles(
  ms: number,
): { x: number; y: number; alpha: number; color: string; size: number }[] {
  if (ms < 0 || ms >= 2300) return [];
  return bursts.flatMap((b, j) => {
    const t = (ms - b.at) / 1000;
    if (t < 0 || t > 1.65) return [];
    return Array.from({ length: 28 }, (_, i) => {
      const angle = (i / 28) * Math.PI * 2,
        speed = 0.12 + (i % 4) * 0.022,
        drag = (1 - Math.exp(-t * 1.8)) / 1.8;
      return {
        x: b.x + Math.cos(angle) * speed * drag,
        y: b.y + Math.sin(angle) * speed * drag + t * t * 0.065,
        alpha: Math.max(0, Math.min(1, (1.65 - t) / 0.9)),
        color: colors[(i + j) % colors.length],
        size: 1.2 + (i % 3) * 0.45,
      };
    });
  });
}
