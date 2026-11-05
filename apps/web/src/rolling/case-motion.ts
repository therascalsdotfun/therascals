export type CaseFrame = {
  position: number;
  stage: "spinning" | "braking" | "settling" | "complete";
};

/** Card-space coordinates: an integer position is exactly under the pointer. */
export function caseTokenAt<T>(tokens: readonly T[], index: number): T | null {
  if (!tokens.length) return null;
  return tokens[
    ((Math.round(index) % tokens.length) + tokens.length) % tokens.length
  ];
}

export function caseWindow(position: number): number[] {
  const center = Math.floor(position);
  return Array.from({ length: 11 }, (_, i) => center + i - 5);
}

/** Presentation only. The selected mint always comes from the existing draw. */
export class CaseMotion {
  private previous: number;
  private position = 0;
  private landing: {
    at: number;
    from: number;
    target: number;
    reduced: boolean;
  } | null = null;

  constructor(
    private mints: readonly string[],
    private startedAt: number,
    private timing = {
      minimumSpin: 1000,
      brake: 4800,
      settle: 400,
      travel: 48,
    },
  ) {
    this.previous = startedAt;
  }

  sample(now: number, selected: string | null, reduced: boolean): CaseFrame {
    const elapsed = Math.max(0, now - this.previous);
    this.previous = Math.max(this.previous, now);
    if (!this.landing) {
      if (!reduced) this.position += elapsed * 0.03;
      const index = selected === null ? -1 : this.mints.indexOf(selected);
      if (
        index < 0 ||
        (!reduced && now - this.startedAt < this.timing.minimumSpin)
      )
        return { position: this.position, stage: "spinning" };
      const minimum = Math.ceil(
        this.position + (reduced ? 0 : this.timing.travel),
      );
      const offset =
        (((index - minimum) % this.mints.length) + this.mints.length) %
        this.mints.length;
      this.landing = {
        at: now,
        from: this.position,
        target: minimum + offset,
        reduced,
      };
    }
    const landing = this.landing;
    if (landing.reduced) {
      this.position = landing.target;
      return {
        position: this.position,
        stage: now - landing.at >= 400 ? "complete" : "settling",
      };
    }
    const progress = Math.max(
      0,
      Math.min(1, (now - landing.at) / this.timing.brake),
    );
    this.position =
      landing.from +
      (landing.target - landing.from) * (1 - (1 - progress) ** 3);
    return {
      position: this.position,
      stage:
        now - landing.at >= this.timing.brake + this.timing.settle
          ? "complete"
          : progress >= 1
            ? "settling"
            : "braking",
    };
  }
}
