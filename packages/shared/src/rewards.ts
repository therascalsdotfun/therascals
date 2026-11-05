export type RewardLane = "mainnet" | "practice";
export const REWARDS_VERSION = "rascal-points-volume-v1";
export const POINTS_PER_DOLLAR = 10;
// Existing cap is retained pending the owner's separate cap decision.
export const DAILY_POINTS_CAP = 50000;
export const REWARD_TIERS = [
  {
    id: "volume",
    label: "Executed volume",
    minAtomic: "0",
    range: "10 points / USDC",
    multiplierBps: 10000,
    color: "#b5e3c8",
  },
] as const;
function verifiedVolume(atomic: string) {
  if (!/^[1-9]\d{0,8}$/.test(atomic) || BigInt(atomic) > 100000000n)
    throw Error(
      "Reward volume must be a verified positive USDC input up to 100 USDC",
    );
  return BigInt(atomic);
}
export function rewardTierForVolume(atomic: string) {
  verifiedVolume(atomic);
  return REWARD_TIERS[0];
}
export function rewardForVolume(atomic: string, multiplierBps = 10000) {
  const volume = verifiedVolume(atomic);
  if (multiplierBps !== 10000)
    throw Error("Volume rewards do not accept multipliers");
  return Number((volume * BigInt(POINTS_PER_DOLLAR)) / 1000000n);
}
export type PointsLeaderboard = {
  lane: RewardLane;
  entries: { rank: number; id: string; points: number }[];
  viewerId?: string;
};
export const promotionCost = (
  placement: "market" | "detail",
  hours: number,
) => {
  if (![24, 72, 168].includes(hours))
    throw Error("Choose a supported promotion duration");
  return ((placement === "market" ? 250 : 500) * hours) / 24;
};
export type RewardEntry = {
  id: string;
  lane: RewardLane;
  type: "trade" | "starter" | "promotion";
  points: number;
  at: string;
  balanceAfter: number;
  signature?: string;
  mint?: string;
  volumeAtomic?: string;
  bandId?: string;
  multiplierBps?: number;
  capped?: boolean;
  policyVersion?: string;
  roundingCarry?: boolean;
  label: string;
};
export type PointsBalance = { balance: number; earned: number; spent: number };
export type PointsPromotion = {
  id: string;
  lane: RewardLane;
  mint: string;
  name: string;
  symbol: string;
  icon: string | null;
  message: string;
  placement: "market" | "detail";
  cost: number;
  startsAt: string;
  expiresAt: string;
};
export type RewardsSnapshot = {
  owner: string;
  version: string;
  balances: Record<RewardLane, PointsBalance>;
  entries: RewardEntry[];
  promotions: PointsPromotion[];
  tiers: typeof REWARD_TIERS;
  dailyCap: number;
};
/** Presentation only; the server already credited the amount-based tier. */
export function rewardWheelRotation(bandId: string, previous = 0, turns = 5) {
  const index = REWARD_TIERS.findIndex((b) => b.id === bandId);
  if (index < 0) throw Error("Unknown reward band");
  const target = (360 - ((index + 0.5) * 360) / REWARD_TIERS.length) % 360;
  return Math.ceil(previous / 360) * 360 + turns * 360 + target;
}
