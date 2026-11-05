import { expect, it } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { RewardsService } from "../apps/server/src/rewards/service.ts";
import {
  rewardForVolume,
  rewardTierForVolume,
} from "../packages/shared/src/rewards.ts";
const alice = {
  kind: "phantom" as const,
  address: "11111111111111111111111111111111",
  expiresAt: "2099-01-01",
};
const bob = {
  ...alice,
  address: "So11111111111111111111111111111111111111112",
};
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const signature = "2".repeat(88);
function fixture() {
  let now = Date.now();
  const store = new MarketStore(":memory:");
  const dependencies = {
    verifyMainnet: async (_user: any, ticket: any, _signature: string) => ({
      volumeAtomic: "10000000",
      mint: ticket.mint,
      signature,
      confirmedAt: new Date(now).toISOString(),
    }),
    practiceReceipt: (_user: any, id: string) => ({
      id,
      signature: "3".repeat(88),
      volumeAtomic: "10000000",
      mint,
      confirmedAt: new Date(now).toISOString(),
    }),
    promotionToken: async () => ({
      mint,
      symbol: "FIX",
      name: "Fixture",
      icon: null,
    }),
  };
  return {
    store,
    dependencies,
    service: new RewardsService(store, dependencies, () => now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}
it("uses the same executed-volume rate across former $5 and $10 tier boundaries", () => {
  for (const [volume, multiplier, points] of [
    ["1000000", 10000, 10],
    ["4999999", 10000, 49],
    ["5000000", 10000, 50],
    ["7500000", 10000, 75],
    ["9999999", 10000, 99],
    ["10000000", 10000, 100],
    ["100000000", 10000, 1000],
  ] as const) {
    expect(rewardTierForVolume(volume).multiplierBps).toBe(multiplier);
    expect(rewardForVolume(volume, multiplier)).toBe(points);
  }
  for (const volume of ["-1", "1e6", "0", "100000001"])
    expect(() => rewardTierForVolume(volume)).toThrow();
});
it("credits completed trades once, survives restart, and isolates practice/live balances and wallet owners", async () => {
  const f = fixture();
  try {
    const ticket = f.service.createTradeTicket(alice, mint, "10000000");
    await expect(
      f.service.claimMainnet(bob, ticket.id, signature),
    ).rejects.toThrow();
    const first = await f.service.claimMainnet(alice, ticket.id, signature);
    expect(first.points).toBe(100);
    expect((await f.service.claimMainnet(alice, ticket.id, signature)).id).toBe(
      first.id,
    );
    expect(f.service.snapshot(alice).balances.mainnet.balance).toBe(100);
    const practice = f.service.claimPractice(alice, "fixture-buy");
    expect(practice.lane).toBe("practice");
    expect(f.service.claimPractice(alice, "fixture-buy").id).toBe(practice.id);
    expect(f.service.snapshot(bob).balances.practice.balance).toBe(0);
    const reloaded = new RewardsService(f.store, f.dependencies, Date.now);
    expect((await reloaded.claimMainnet(alice, ticket.id, signature)).id).toBe(
      first.id,
    );
    expect(reloaded.snapshot(alice).balances.mainnet.balance).toBe(100);
    const other = f.service.createTradeTicket(bob, mint, "10000000");
    await expect(
      f.service.claimMainnet(bob, other.id, signature),
    ).rejects.toThrow();
  } finally {
    f.store.close();
  }
});
it("gives one practice starter, atomically spends points once per purchase, and never changes public visibility with practice", async () => {
  const f = fixture();
  try {
    f.service.practiceStarter(alice);
    f.service.practiceStarter(alice);
    expect(f.service.snapshot(alice).balances.practice.balance).toBe(1000);
    const input = {
      requestId: "a6b53313-938c-4022-ad98-169114e97d43",
      lane: "practice" as const,
      mint,
      message: "Hello",
      placement: "market" as const,
      durationHours: 24,
    };
    const bought = await f.service.purchasePromotion(alice, input);
    expect(bought.cost).toBe(250);
    expect((await f.service.purchasePromotion(alice, input)).id).toBe(
      bought.id,
    );
    expect(f.service.snapshot(alice).balances.practice.balance).toBe(750);
    expect(f.service.publicPromotions()).toHaveLength(0);
    expect(f.service.snapshot(bob).promotions).toHaveLength(0);
    await expect(
      f.service.purchasePromotion(alice, {
        ...input,
        requestId: "other",
        lane: "mainnet",
      }),
    ).rejects.toThrow();
    await expect(
      f.service.purchasePromotion(alice, { ...input, message: "changed" }),
    ).rejects.toThrow();
    f.advance(86400001);
    expect(f.service.snapshot(alice).promotions).toHaveLength(0);
  } finally {
    f.store.close();
  }
});
it("does not award failed/unknown fills or spend when fresh token screening fails", async () => {
  const f = fixture();
  try {
    f.dependencies.practiceReceipt = () => {
      throw Error("No finalized owned buy");
    };
    expect(() => f.service.claimPractice(alice, "bad")).toThrow();
    f.service.practiceStarter(alice);
    f.dependencies.promotionToken = async () => {
      throw Error("Risk flagged");
    };
    await expect(
      f.service.purchasePromotion(alice, {
        requestId: "b",
        lane: "practice",
        mint,
        message: "",
        placement: "market",
        durationHours: 24,
      }),
    ).rejects.toThrow();
    expect(f.service.snapshot(alice).balances.practice.balance).toBe(1000);
  } finally {
    f.store.close();
  }
});
it("serializes simultaneous purchases, handles the daily cap without rerolls, and rolls back incomplete ledger writes", async () => {
  const f = fixture();
  try {
    f.service.practiceStarter(alice);
    const input = {
      requestId: "c",
      lane: "practice" as const,
      mint,
      message: "",
      placement: "market" as const,
      durationHours: 24,
    };
    const [a, b] = await Promise.all([
      f.service.purchasePromotion(alice, input),
      f.service.purchasePromotion(alice, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(f.service.snapshot(alice).balances.practice.balance).toBe(750);
    const capped = new RewardsService(
      f.store,
      {
        ...f.dependencies,
        practiceReceipt: (_user, id) => ({
          signature: id,
          mint,
          volumeAtomic: "100000000",
          confirmedAt: new Date().toISOString(),
        }),
      },
      Date.now,
    );
    for (let i = 0; i < 51; i++) capped.claimPractice(bob, "buy-" + i);
    expect(capped.snapshot(bob).balances.practice.balance).toBe(50000);
    expect(capped.snapshot(bob).entries[0]).toMatchObject({
      points: 0,
      capped: true,
    });
    const result = capped.claimPractice(bob, "buy-50");
    expect(result.points).toBe(0);
    expect(() =>
      f.store.transaction(() => {
        f.store.putRecord("rollback-test", true);
        throw Error("abort");
      }),
    ).toThrow();
    expect(f.store.getRecord("rollback-test")).toBeNull();
  } finally {
    f.store.close();
  }
});
it("publishes live-point placements only while current screening permits them", async () => {
  const f = fixture();
  let visible = true;
  try {
    const service = new RewardsService(
      f.store,
      {
        ...f.dependencies,
        verifyMainnet: async (_u, ticket, signature) => ({
          mint: ticket.mint,
          signature,
          volumeAtomic: "100000000",
          confirmedAt: new Date().toISOString(),
        }),
        promotionVisible: () => visible,
      },
      Date.now,
    );
    const ticket = service.createTradeTicket(alice, mint, "100000000");
    await service.claimMainnet(alice, ticket.id, signature);
    await service.purchasePromotion(alice, {
      requestId: "live-promo",
      lane: "mainnet",
      mint,
      message: "No extra odds",
      placement: "market",
      durationHours: 24,
    });
    expect(service.publicPromotions()).toHaveLength(1);
    expect(service.snapshot(alice).balances.mainnet.balance).toBe(750);
    visible = false;
    expect(service.publicPromotions()).toHaveLength(0);
    expect(service.snapshot(alice).balances.mainnet.balance).toBe(750);
  } finally {
    f.store.close();
  }
});

it("ranks only earned trade points, separates lanes, and preserves rank after spending", async () => {
  const f = fixture();
  try {
    f.service.practiceStarter(alice);
    expect(f.service.leaderboard("practice").entries).toEqual([]);
    f.service.claimPractice(bob, "buy-bob");
    f.dependencies.verifyMainnet = async (_u, ticket, signature) => ({
      volumeAtomic: "30000000",
      mint: ticket.mint,
      signature,
      confirmedAt: new Date().toISOString(),
    });
    const ticket = f.service.createTradeTicket(alice, mint, "30000000");
    await f.service.claimMainnet(alice, ticket.id, signature);
    const before = f.service.leaderboard("mainnet", alice);
    expect(before.entries).toEqual([
      { rank: 1, id: before.viewerId, points: 300 },
    ]);
    expect(JSON.stringify(before)).not.toContain(alice.address);
    expect(JSON.stringify(before)).not.toContain(
      f.service.snapshot(alice).owner,
    );
    expect(JSON.stringify(before)).not.toContain(signature);
    await f.service.purchasePromotion(alice, {
      requestId: "rank-spend",
      lane: "mainnet",
      mint,
      message: "",
      placement: "market",
      durationHours: 24,
    });
    expect(f.service.snapshot(alice).balances.mainnet.balance).toBe(50);
    expect(f.service.leaderboard("mainnet", alice)).toEqual(before);
    expect(f.service.leaderboard("practice").entries).toHaveLength(1);
    expect(f.service.leaderboard("practice").entries[0].points).toBe(100);
    // Reopening the durable store leaves rankings intact.
    expect(
      new RewardsService(f.store, f.dependencies).leaderboard("mainnet", alice),
    ).toEqual(before);
  } finally {
    f.store.close();
  }
});
it("bounds rankings to the top 50 with stable ordering and excludes starter grants", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 70; i++) {
      const owner = i.toString().padStart(64, "0");
      f.store.putRecord("points:account:" + owner, {
        balances: {
          mainnet: { earned: i * 10, balance: 0, spent: i * 10 },
          practice: { earned: 1000, balance: 1000, spent: 0 },
        },
      });
      f.store.putRecord("points:starter:" + owner, { points: 1000 });
    }
    const board = f.service.leaderboard("mainnet");
    expect(board.entries).toHaveLength(50);
    expect(board.entries[0]).toMatchObject({ rank: 1, points: 690 });
    expect(board.entries[49]).toMatchObject({ rank: 50, points: 200 });
    expect(f.service.leaderboard("practice").entries).toEqual([]);
    expect(f.service.leaderboard("mainnet")).toEqual(board);
  } finally {
    f.store.close();
  }
});
it("carries fractional volume across fills and restarts without rewarding split/replayed receipts", () => {
  const f = fixture();
  try {
    const dependencies = {
      ...f.dependencies,
      practiceReceipt: (_u: any, id: string) => ({
        signature: id,
        mint,
        volumeAtomic: id.startsWith("whole") ? "100000" : "50000",
        confirmedAt: new Date().toISOString(),
      }),
    };
    const service = new RewardsService(f.store, dependencies, Date.now);
    expect(service.claimPractice(alice, "part-1").points).toBe(0);
    const restarted = new RewardsService(f.store, dependencies, Date.now);
    const next = restarted.claimPractice(alice, "part-2");
    expect(next).toMatchObject({
      points: 1,
      roundingCarry: true,
      policyVersion: "rascal-points-volume-v1",
    });
    expect(restarted.claimPractice(alice, "part-2").id).toBe(next.id);
    expect(restarted.claimPractice(bob, "whole-1").points).toBe(1);
    expect(restarted.snapshot(alice).balances.practice.balance).toBe(
      restarted.snapshot(bob).balances.practice.balance,
    );
  } finally {
    f.store.close();
  }
});
