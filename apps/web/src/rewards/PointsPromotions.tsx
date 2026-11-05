import { useRewards } from "./Rewards.tsx";
import { Megaphone, Ticket } from "lucide-react";
import { TokenTicker } from "../TokenMedia.tsx";
import type { RewardLane } from "../../../../packages/shared/src/rewards.ts";
import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
import { tokenChain } from "../../../../packages/shared/src/token-selection.ts";
const fresh = (p: { expiresAt: string }) =>
  Date.parse(p.expiresAt) > Date.now();
function usePlacements(lane: RewardLane) {
  const rewards = useRewards();
  return (
    lane === "practice"
      ? (rewards?.snapshot?.promotions ?? [])
      : (rewards?.publicPromotions ?? [])
  ).filter((p) => p.lane === lane && fresh(p));
}
export function RascalPromotionTag({
  token,
  lane,
}: {
  token: TokenObservation;
  lane: RewardLane;
}) {
  const promoted = usePlacements(lane).some(
    (p) => p.mint === token.mint && p.placement === "market",
  );
  if (tokenChain(token) !== "solana" || !promoted) return null;
  return (
    <span
      className="rascal-promoted-tag"
      title={
        lane === "practice"
          ? "Your private points-funded practice preview. No public placement or odds change."
          : "Paid with Rascals points. Visual placement only; token screening and draw odds are unchanged."
      }
    >
      <Megaphone size={10} />
      {lane === "practice" ? "Practice promo" : "Promoted · Points"}
    </span>
  );
}
export function PointsSpotlights({ lane }: { lane: RewardLane }) {
  const placements = usePlacements(lane)
    .filter((p) => p.placement === "detail")
    .slice(0, 3);
  if (!placements.length) return null;
  return (
    <aside
      className="points-spotlights"
      aria-label={
        lane === "practice"
          ? "Your practice spotlight previews"
          : "Points-promoted token spotlights"
      }
    >
      {placements.map((p) => (
        <a
          key={p.id}
          href={`https://dexscreener.com/solana/${p.mint}`}
          target="_blank"
          rel="noreferrer"
        >
          <span className="points-spotlight-label">
            <Ticket size={13} />
            {lane === "practice"
              ? "Private practice preview"
              : "Promoted · Points"}
          </span>
          <TokenTicker symbol={p.symbol} src={p.icon} size={28} />
          <p>{p.message || p.name}</p>
          <small>Visibility only · same checks & odds ↗</small>
        </a>
      ))}
    </aside>
  );
}
