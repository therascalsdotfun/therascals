export class DrawMotion {
  private extractionAt: number | null = null;
  constructor(private startedAt: number) {}
  sample(now: number, mint: string | null, reduced: boolean, atIntake = false) {
    const minimum = reduced ? 150 : 2600;
    const duration = reduced ? 250 : 1900;
    if (this.extractionAt === null) {
      if (!mint || now - this.startedAt < minimum)
        return { stage: "mixing" as const, progress: 0 };
      if (!atIntake) return { stage: "capturing" as const, progress: 0 };
      this.extractionAt = now;
    }
    const progress = Math.max(
      0,
      Math.min(1, (now - this.extractionAt) / duration),
    );
    return {
      stage: progress === 1 ? ("complete" as const) : ("extracting" as const),
      progress,
    };
  }
}
export type BallPose = { x: number; y: number; r: number };
export function extractionPose(progress: number, points: BallPose[]): BallPose {
  const t = Math.max(0, Math.min(1, progress)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(t));
  const local = t - index,
    q = local * local * (3 - 2 * local);
  const a = points[index],
    b = points[index + 1];
  return {
    x: a.x + (b.x - a.x) * q,
    y: a.y + (b.y - a.y) * q,
    r: a.r + (b.r - a.r) * q,
  };
}
