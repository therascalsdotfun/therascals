import {
  POINTS_PER_DOLLAR,
  DAILY_POINTS_CAP,
  rewardForVolume,
  type RewardLane,
} from "../../../../packages/shared/src/rewards.ts";
import "./rewards.css";
export function RewardTierBar({
  amount,
  lane,
}: {
  amount: number | null;
  lane: RewardLane;
}) {
  const atomic =
    amount !== null && Number.isFinite(amount) && amount >= 1 && amount <= 100
      ? String(Math.round(amount * 1e6))
      : null;
  return (
    <section
      className="reward-tier-card"
      aria-label="Points from executed volume"
    >
      <div className="reward-tier-title">
        <span>Trade points</span>
        <b>{POINTS_PER_DOLLAR} pts / USDC</b>
      </div>
      <p>
        {atomic ? (
          <>
            <b>
              {rewardForVolume(atomic).toLocaleString()}{" "}
              {lane === "practice" ? "practice " : ""}pts
            </b>{" "}
            estimated for ${amount} executed.
          </>
        ) : (
          "Choose an amount to estimate your points."
        )}
      </p>
      <small>
        The same rate at every amount. Actual verified USDC spent determines
        credit. Solana USDC buys currently qualify. Up to{" "}
        {DAILY_POINTS_CAP.toLocaleString()} points per UTC day; after that,
        further volume earns no points.
      </small>
    </section>
  );
}
