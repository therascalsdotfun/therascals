import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  rewardWheelRotation,
  REWARD_TIERS,
} from "../packages/shared/src/rewards.ts";
import { RewardWheel } from "../apps/web/src/rewards/RewardWheel.tsx";
it("lands every selected sector's centre beneath the pointer across repeated spins", () => {
  let previous = 0;
  for (let repeat = 0; repeat < 3; repeat++)
    for (const [i, band] of REWARD_TIERS.entries()) {
      const next = rewardWheelRotation(band.id, previous);
      expect(next).toBeGreaterThan(previous);
      expect(
        ((i + 0.5) * (360 / REWARD_TIERS.length) + next) % 360,
      ).toBeCloseTo(0);
      previous = next;
    }
});
it("shows proportional volume points and no random reward before a completed buy", () => {
  const html = renderToStaticMarkup(<RewardWheel entry={null} />);
  expect(html).toContain("disabled");
  expect(html).toContain("Points from executed volume");
  expect(html).toContain("Replaying changes no points");
  for (const band of REWARD_TIERS) expect(html).toContain(band.label);
});

import { RewardTierBar } from "../apps/web/src/rewards/RewardTierBar.tsx";
it("previews executed volume at one rate with no tier cliffs", () => {
  for (const [amount, points] of [
    [1, 10],
    [5, 50],
    [7.5, 75],
    [10, 100],
    [100, 1000],
  ]) {
    const html = renderToStaticMarkup(
      <RewardTierBar amount={amount} lane="practice" />,
    );
    expect(html).toContain("10 pts / USDC");
    expect(html).toContain(`${points.toLocaleString()} practice`);
    expect(html).not.toMatch(/× fixed|aria-current="step"/);
    expect(html).toContain("further volume earns no points");
  }
  const pending = renderToStaticMarkup(
    <RewardTierBar amount={null} lane="mainnet" />,
  );
  expect(pending).toContain("Choose an amount");
});
