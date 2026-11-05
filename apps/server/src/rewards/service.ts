import { randomUUID, createHash } from "node:crypto";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import {
  DAILY_POINTS_CAP,
  POINTS_PER_DOLLAR,
  REWARD_TIERS,
  REWARDS_VERSION,
  rewardTierForVolume,
  rewardForVolume,
  promotionCost,
  type PointsLeaderboard,
  type RewardLane,
  type RewardEntry,
  type RewardsSnapshot,
  type PointsPromotion,
  type PointsBalance,
} from "../../../../packages/shared/src/rewards.ts";
import { MarketStore } from "../market/store.ts";
import { subjectFor } from "../beta/access.ts";
import { UserError } from "../client-message.ts";
export class RewardsError extends UserError {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export type TradeTicket = {
  id: string;
  owner: string;
  ownerAddress: string;
  mint: string;
  maxAtomic: string;
  createdAt: number;
  expiresAt: number;
  rewardId?: string;
};
export type VerifiedRewardBuy = {
  volumeAtomic: string;
  mint: string;
  signature: string;
  confirmedAt: string;
};
type Purchase = {
  requestId: string;
  lane: RewardLane;
  mint: string;
  message: string;
  placement: "market" | "detail";
  durationHours: number;
};
type Account = {
  balances: Record<RewardLane, PointsBalance>;
  entries: RewardEntry[];
  daily: { day: string; mainnet: number; practice: number };
};
type SavedPromotion = PointsPromotion & {
  owner: string;
  requestId: string;
  requestHash: string;
};
export type RewardsDependencies = {
  verifyMainnet: (
    identity: WalletIdentity,
    ticket: TradeTicket,
    signature: string,
  ) => Promise<VerifiedRewardBuy>;
  practiceReceipt: (
    identity: WalletIdentity,
    operationId: string,
  ) => VerifiedRewardBuy;
  promotionToken: (mint: string) => Promise<{
    mint: string;
    symbol: string;
    name: string;
    icon: string | null;
  }>;
  promotionVisible?: (mint: string) => boolean;
};
export class RewardsService {
  private busy = new Set<string>();
  constructor(
    private store: MarketStore,
    private dependencies: RewardsDependencies,
    private now = () => Date.now(),
  ) {}
  private account(owner: string): Account {
    return (
      this.store.getRecord<Account>("points:account:" + owner) ?? {
        balances: {
          mainnet: { balance: 0, earned: 0, spent: 0 },
          practice: { balance: 0, earned: 0, spent: 0 },
        },
        entries: [],
        daily: { day: "", mainnet: 0, practice: 0 },
      }
    );
  }
  private save(owner: string, account: Account, entry: RewardEntry) {
    account.entries = [entry, ...account.entries].slice(0, 100);
    this.store.putRecord("points:account:" + owner, account);
    this.store.putRecord("points:entry:" + entry.id, entry);
  }
  snapshot(identity: WalletIdentity): RewardsSnapshot {
    const owner = subjectFor(identity),
      account = this.account(owner);
    return {
      owner,
      version: REWARDS_VERSION,
      balances: account.balances,
      entries: account.entries,
      promotions: this.promotions()
        .filter((p) => p.owner === owner)
        .map(this.publicPromotion),
      tiers: REWARD_TIERS,
      dailyCap: DAILY_POINTS_CAP,
    };
  }
  leaderboard(
    lane: RewardLane,
    identity?: WalletIdentity | null,
  ): PointsLeaderboard {
    // A separate public alias never exposes authentication subjects or wallet addresses.
    const alias = (owner: string) =>
      createHash("sha256")
        .update("rascals-leaderboard:" + owner)
        .digest("hex")
        .slice(0, 16);
    return {
      lane,
      entries: this.store.pointsLeaders(lane).map((row, i) => ({
        rank: i + 1,
        id: alias(row.owner),
        points: row.points,
      })),
      ...(identity ? { viewerId: alias(subjectFor(identity)) } : {}),
    };
  }
  private promotions() {
    return (
      this.store.getRecord<SavedPromotion[]>("points:promotions") ?? []
    ).filter((p) => Date.parse(p.expiresAt) > this.now());
  }
  private publicPromotion = ({
    owner: _owner,
    requestId: _id,
    requestHash: _hash,
    ...rest
  }: SavedPromotion): PointsPromotion => rest;
  publicPromotions() {
    return this.promotions()
      .filter(
        (p) =>
          p.lane === "mainnet" &&
          (this.dependencies.promotionVisible?.(p.mint) ?? true),
      )
      .map(this.publicPromotion);
  }
  practiceStarter(identity: WalletIdentity) {
    const owner = subjectFor(identity);
    return this.store.transaction(() => {
      const prior = this.store.getRecord<RewardEntry>(
        "points:starter:" + owner,
      );
      if (prior) return prior;
      const account = this.account(owner),
        points = 1000;
      account.balances.practice.balance += points;
      account.balances.practice.earned += points;
      const entry: RewardEntry = {
        id: randomUUID(),
        lane: "practice",
        type: "starter",
        points,
        balanceAfter: account.balances.practice.balance,
        at: new Date(this.now()).toISOString(),
        label: "Practice starter · no cash value",
      };
      this.save(owner, account, entry);
      this.store.putRecord("points:starter:" + owner, entry);
      return entry;
    });
  }
  createTradeTicket(
    identity: WalletIdentity,
    mint: string,
    maxAtomic: string,
  ): TradeTicket {
    if (identity.kind !== "phantom")
      throw new RewardsError(
        "Solana buy rewards require the verified Phantom wallet.",
        400,
      );
    rewardForVolume(maxAtomic, 10000);
    const ticket = {
      id: randomUUID(),
      owner: subjectFor(identity),
      ownerAddress: identity.address,
      mint,
      maxAtomic,
      createdAt: this.now(),
      expiresAt: this.now() + 600000,
    };
    this.store.putRecord("points:ticket:" + ticket.id, ticket);
    return ticket;
  }
  private credit(
    identity: WalletIdentity,
    lane: RewardLane,
    buy: VerifiedRewardBuy,
  ) {
    const owner = subjectFor(identity),
      receiptKey = "points:receipt:" + lane + ":" + buy.signature;
    return this.store.transaction(() => {
      const prior = this.store.getRecord<{ owner: string; entry: RewardEntry }>(
        receiptKey,
      );
      if (prior) {
        if (prior.owner !== owner)
          throw new RewardsError(
            "This receipt belongs to another rewards account.",
            403,
          );
        return prior.entry;
      }
      if (
        !Number.isFinite(Date.parse(buy.confirmedAt)) ||
        Date.parse(buy.confirmedAt) > this.now() + 60000
      )
        throw new RewardsError("Invalid receipt timestamp.");
      const band = rewardTierForVolume(buy.volumeAtomic),
        account = this.account(owner);
      const volumeKey = `points:volume:${REWARDS_VERSION}:${lane}:${owner}`;
      const previousVolume = BigInt(
        this.store.getRecord<{ atomic: string }>(volumeKey)?.atomic ?? "0",
      );
      const nextVolume = previousVolume + BigInt(buy.volumeAtomic);
      const rate = BigInt(POINTS_PER_DOLLAR);
      const rawPoints = Number(
        (nextVolume * rate) / 1000000n - (previousVolume * rate) / 1000000n,
      );
      const day = new Date(this.now()).toISOString().slice(0, 10);
      if (account.daily.day !== day)
        account.daily = { day, mainnet: 0, practice: 0 };
      const points = Math.min(
        rawPoints,
        Math.max(0, DAILY_POINTS_CAP - account.daily[lane]),
      );
      account.daily[lane] += points;
      account.balances[lane].balance += points;
      account.balances[lane].earned += points;
      const entry: RewardEntry = {
        id: randomUUID(),
        lane,
        type: "trade",
        points,
        balanceAfter: account.balances[lane].balance,
        at: new Date(this.now()).toISOString(),
        label: band.label,
        signature: buy.signature,
        mint: buy.mint,
        volumeAtomic: buy.volumeAtomic,
        bandId: band.id,
        multiplierBps: band.multiplierBps,
        capped: points < rawPoints,
        policyVersion: REWARDS_VERSION,
        roundingCarry: rawPoints > rewardForVolume(buy.volumeAtomic),
      };
      this.save(owner, account, entry);
      this.store.putRecord(volumeKey, { atomic: String(nextVolume) });
      this.store.putRecord(receiptKey, { owner, entry });
      return entry;
    });
  }
  async claimMainnet(identity: WalletIdentity, id: string, signature: string) {
    const owner = subjectFor(identity),
      ticket = this.store.getRecord<TradeTicket>("points:ticket:" + id);
    if (!ticket || ticket.owner !== owner)
      throw new RewardsError(
        "Trade reward ticket unavailable for this wallet.",
        403,
      );
    if (ticket.rewardId) {
      const entry = this.store.getRecord<RewardEntry>(
        "points:entry:" + ticket.rewardId,
      )!;
      if (entry.signature !== signature)
        throw new RewardsError("This buy already has its reward.");
      return entry;
    }
    if (this.now() > ticket.expiresAt + 86400000)
      throw new RewardsError("Trade reward claim window expired.");
    if (this.busy.has(id))
      throw new RewardsError(
        "This receipt is already being checked. Retry shortly.",
        429,
      );
    this.busy.add(id);
    try {
      const buy = await this.dependencies.verifyMainnet(
        identity,
        ticket,
        signature,
      );
      if (
        buy.signature !== signature ||
        buy.mint !== ticket.mint ||
        BigInt(buy.volumeAtomic) > BigInt(ticket.maxAtomic)
      )
        throw new RewardsError(
          "Trade receipt does not match the reward ticket.",
        );
      // No await between credit and ticket persistence. Replays use the global receipt marker.
      const entry = this.credit(identity, "mainnet", buy);
      this.store.putRecord("points:ticket:" + id, {
        ...ticket,
        rewardId: entry.id,
      });
      return entry;
    } finally {
      this.busy.delete(id);
    }
  }
  claimPractice(identity: WalletIdentity, operationId: string) {
    const key =
      "points:practice-claim:" + subjectFor(identity) + ":" + operationId;
    const saved = this.store.getRecord<RewardEntry>(key);
    if (saved) return saved;
    const entry = this.credit(
      identity,
      "practice",
      this.dependencies.practiceReceipt(identity, operationId),
    );
    this.store.putRecord(key, entry);
    return entry;
  }
  async purchasePromotion(identity: WalletIdentity, input: Purchase) {
    const owner = subjectFor(identity),
      key = "points:purchase:" + owner + ":" + input.requestId;
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify([
          input.lane,
          input.mint,
          input.message,
          input.placement,
          input.durationHours,
        ]),
      )
      .digest("hex");
    const old = this.store.getRecord<SavedPromotion>(key);
    if (old) {
      if (old.requestHash !== requestHash)
        throw new RewardsError("This purchase ID has different details.");
      return this.publicPromotion(old);
    }
    const cost = promotionCost(input.placement, input.durationHours);
    if (this.account(owner).balances[input.lane].balance < cost)
      throw new RewardsError("Not enough points in this balance.");
    // All external risk/data work happens before entering the SQLite transaction.
    const token = await this.dependencies.promotionToken(input.mint);
    if (token.mint !== input.mint)
      throw new RewardsError("Promotion token identity mismatch.");
    return this.store.transaction(() => {
      const repeated = this.store.getRecord<SavedPromotion>(key);
      if (repeated) {
        if (repeated.requestHash !== requestHash)
          throw new RewardsError("This purchase ID has different details.");
        return this.publicPromotion(repeated);
      }
      const account = this.account(owner),
        active = this.promotions();
      if (account.balances[input.lane].balance < cost)
        throw new RewardsError("Not enough points in this balance.");
      const mine = active.filter(
        (p) => p.owner === owner && p.lane === input.lane,
      );
      if (active.length >= 100 || mine.length >= 3)
        throw new RewardsError(
          "Promotion slots are full. Wait for a placement to expire.",
        );
      if (
        mine.some(
          (p) => p.mint === input.mint && p.placement === input.placement,
        )
      )
        throw new RewardsError(
          "This token already has an active placement here.",
        );
      const promotion: SavedPromotion = {
        id: randomUUID(),
        owner,
        requestId: input.requestId,
        requestHash,
        lane: input.lane,
        ...token,
        message: input.message,
        placement: input.placement,
        cost,
        startsAt: new Date(this.now()).toISOString(),
        expiresAt: new Date(
          this.now() + input.durationHours * 3600000,
        ).toISOString(),
      };
      account.balances[input.lane].balance -= cost;
      account.balances[input.lane].spent += cost;
      const entry: RewardEntry = {
        id: randomUUID(),
        lane: input.lane,
        type: "promotion",
        points: -cost,
        balanceAfter: account.balances[input.lane].balance,
        at: new Date(this.now()).toISOString(),
        mint: token.mint,
        label:
          input.lane === "practice"
            ? "Practice promotion preview"
            : "Points promotion placement",
      };
      this.save(owner, account, entry);
      this.store.putRecord(key, promotion);
      this.store.putRecord("points:promotions", [...active, promotion]);
      return this.publicPromotion(promotion);
    });
  }
}
