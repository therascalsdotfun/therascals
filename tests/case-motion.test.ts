import { describe, expect, it } from "vitest";
import {
  CaseMotion,
  caseTokenAt,
  caseWindow,
} from "../apps/web/src/rolling/case-motion.ts";

describe("case reel reveal integrity", () => {
  for (const count of [2, 8, 32]) {
    it(`lands the selected card exactly at the pointer for ${count} tokens`, () => {
      const mints = Array.from({ length: count }, (_, i) => `mint-${i}`);
      for (const selected of mints) {
        const motion = new CaseMotion(mints, 0);
        motion.sample(0, selected, false);
        const starting = motion.sample(1000, selected, false);
        expect(starting.stage).toBe("braking");
        const landing = motion.sample(5800, selected, false);
        expect(landing.stage).toBe("settling");
        const done = motion.sample(6200, selected, false);
        expect(done.stage).toBe("complete");
        expect(Number.isInteger(done.position)).toBe(true);
        expect(caseTokenAt(mints, done.position)).toBe(selected);
        expect(motion.sample(9000, selected, false).position).toBe(
          done.position,
        );
      }
    });
  }
  it("keeps moving during a delayed result and never substitutes an unknown mint", () => {
    const motion = new CaseMotion(["a", "b"], 0);
    const first = motion.sample(1000, null, false);
    const later = motion.sample(10000, "outside-pool", false);
    expect(later.position).toBeGreaterThan(first.position);
    expect(later.stage).toBe("spinning");
    motion.sample(11000, "b", false);
    expect(motion.sample(16200, "b", false).stage).toBe("complete");
    expect(
      caseTokenAt(["a", "b"], motion.sample(20000, "b", false).position),
    ).toBe("b");
  });
  it("moves monotonically forward through braking and settling", () => {
    const motion = new CaseMotion(["a", "b", "c"], 0);
    let previous = 0;
    for (let now = 0; now <= 7000; now += 16) {
      const frame = motion.sample(now, "c", false);
      expect(frame.position).toBeGreaterThanOrEqual(previous);
      previous = frame.position;
    }
  });
  it("uses a brief stationary settle with reduced motion", () => {
    const motion = new CaseMotion(["a", "b", "c"], 0);
    expect(motion.sample(1000, null, true).position).toBe(0);
    expect(motion.sample(1100, "c", true).stage).toBe("settling");
    const done = motion.sample(1500, "c", true);
    expect(done.stage).toBe("complete");
    expect(caseTokenAt(["a", "b", "c"], done.position)).toBe("c");
  });
  it("renders a bounded, contiguous virtual window including the center", () => {
    const slots = caseWindow(123456.75);
    expect(slots).toHaveLength(11);
    expect(slots).toContain(Math.round(123456.75));
    expect(caseTokenAt(["a", "b"], -1)).toBe("b");
    expect(caseTokenAt([], 0)).toBeNull();
    expect(new CaseMotion([], 0).sample(10000, "a", false).stage).toBe(
      "spinning",
    );
  });
});
