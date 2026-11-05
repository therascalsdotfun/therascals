import { CaseMotion, type CaseFrame } from "./case-motion.ts";
export class ThreeReelMotion {
  private reels: CaseMotion[];
  constructor(chains: string[], tokens: string[], amounts: string[]) {
    this.reels = [chains, tokens, amounts].map(
      (ids, i) =>
        new CaseMotion(ids, 0, {
          minimumSpin: 450 + i * 550,
          brake: 1200 + i * 450,
          settle: 240,
          travel: 12 + i * 5,
        }),
    );
  }
  sample(
    now: number,
    results: [string | null, string | null, string | null],
    reduced: boolean,
  ) {
    const frames = this.reels.map((r, i) =>
      r.sample(now, results[i], reduced),
    ) as [CaseFrame, CaseFrame, CaseFrame];
    return {
      frames,
      complete:
        results.every(Boolean) && frames.every((f) => f.stage === "complete"),
    };
  }
}
