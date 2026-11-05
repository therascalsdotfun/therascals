import { beforeEach, describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { signL1Action } from "@nktkas/hyperliquid/signing";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { PerpsAgents } from "../apps/server/src/perps/agent.ts";
import { PerpsService } from "../apps/server/src/perps/execution.ts";
import type {
  HyperliquidVenue,
  VenueAccount,
  VenueFill,
  VenueOrderResult,
} from "../apps/server/src/perps/hyperliquid.ts";
import {
  PERPS_MIN_NOTIONAL,
  drawPerpsSpin,
  perpsAgentApproval,
  perpsCommit,
  perpsConfigHash,
  perpsLiquidationPrice,
  perpsRolls,
  perpsSeedHash,
  type PerpsMarket,
  type PerpsOperation,
  type PerpsSide,
} from "../packages/shared/src/perps.ts";
import { subjectFor } from "../apps/server/src/beta/access.ts";
import type { WalletIdentity } from "../packages/shared/src/wallet-auth.ts";

const markets: PerpsMarket[] = [
  {
    name: "BTC",
    display: "BTC",
    universe: "perp",
    maxLeverage: 40,
    szDecimals: 5,
  },
  {
    name: "ETH",
    display: "ETH",
    universe: "perp",
    maxLeverage: 25,
    szDecimals: 4,
  },
  {
    name: "WIF",
    display: "WIF",
    universe: "meme",
    maxLeverage: 5,
    szDecimals: 0,
  },
  {
    name: "DOGE",
    display: "DOGE",
    universe: "meme",
    maxLeverage: 10,
    szDecimals: 1,
  },
];
const marks: Record<string, number> = {
  BTC: 100_000,
  ETH: 3_000,
  WIF: 2,
  DOGE: 0.2,
};

type Position = VenueAccount["positions"][number];

function fakeVenue() {
  let approved = false;
  let balance = 100;
  const positions: Position[] = [];
  const fills: VenueFill[] = [];
  let orders = 0;
  let clock = 1_793_000_000_000;
  let failClose = false;
  let failAccountRead: false | "always" | "after-first-order" = false;
  let rejectOpen = false;
  const venue: HyperliquidVenue & {
    setApproved(value: boolean): void;
    setBalance(value: number): void;
    addPosition(coin: string): void;
    setFailClose(value: boolean): void;
    setFailAccountRead(value: typeof failAccountRead): void;
    setRejectOpen(value: boolean): void;
    orders(): number;
    clock: () => number;
    advance(ms: number): void;
  } = {
    network: "testnet",
    markets: async () => markets,
    market: async (coin) => {
      const market = markets.find((entry) => entry.name === coin);
      return market ? { market, index: markets.indexOf(market) } : null;
    },
    markPrice: async (coin) => marks[coin] ?? 1,
    account: async () => {
      if (
        failAccountRead === "always" ||
        (failAccountRead === "after-first-order" && orders > 0)
      )
        // Wording a naive classifier would mistake for a venue rejection.
        throw Error("clearinghouseState failed: insufficient margin data");
      return {
        accountValue: balance,
        withdrawable: balance,
        positions: positions.map((position) => ({ ...position })),
      };
    },
    agentApproved: async () => approved,
    approveAgent: async () => {
      approved = true;
    },
    updateLeverage: async () => {},
    placeOrder: async (args) => {
      orders++;
      const market = markets[args.assetIndex]!;
      const mark = marks[market.name] ?? 1;
      const size = Number(args.size) * (args.side === "long" ? 1 : -1);
      const entry = mark;
      if (rejectOpen && !args.reduceOnly)
        return {
          status: "failed",
          error: "Hyperliquid rejected the order: insufficient margin",
        };
      if (args.reduceOnly) {
        if (failClose) return { status: "failed", error: "close rejected" };
        const index = positions.findIndex(
          (position) => position.coin === market.name,
        );
        if (index >= 0) {
          const position = positions[index]!;
          const closedPnl =
            (entry - position.entryPx) *
            position.size *
            (position.size > 0 ? 1 : -1);
          fills.push({
            coin: position.coin,
            px: entry,
            sz: Math.abs(position.size),
            side: position.size > 0 ? "A" : "B",
            closedPnl,
            fee: 0.01,
            time: clock,
            dir: "Close",
            liquidation: false,
          });
          positions.splice(index, 1);
        }
      } else {
        positions.push({
          coin: market.name,
          size,
          entryPx: entry,
          liquidationPx: perpsLiquidationPrice(args.side, entry, 5),
          unrealizedPnl: 0,
          marginUsed: 5,
          leverage: 5,
        });
      }
      return {
        status: "filled",
        oid: 100 + orders,
        avgPx: entry,
        totalSz: Math.abs(Number(args.size)),
      } satisfies VenueOrderResult;
    },
    fills: async (_master, since) => fills.filter((fill) => fill.time >= since),
    setApproved: (value) => {
      approved = value;
    },
    setBalance: (value) => {
      balance = value;
    },
    addPosition: (coin) => {
      positions.push({
        coin,
        size: 1,
        entryPx: marks[coin] ?? 1,
        liquidationPx: null,
        unrealizedPnl: 0,
        marginUsed: 5,
        leverage: 5,
      });
    },
    setFailClose: (value) => {
      failClose = value;
    },
    setFailAccountRead: (value) => {
      failAccountRead = value;
    },
    setRejectOpen: (value) => {
      rejectOpen = value;
    },
    orders: () => orders,
    clock: () => clock,
    advance: (ms) => {
      clock += ms;
    },
  };
  return venue;
}

describe("perps execution", () => {
  let clock: number;
  let store: MarketStore;
  let venue: ReturnType<typeof fakeVenue>;
  let agents: PerpsAgents;
  let service: PerpsService;
  let identity: WalletIdentity;
  let master: Wallet;
  const seed = "b".repeat(64);

  beforeEach(() => {
    clock = 1_793_000_000_000;
    store = new MarketStore(":memory:");
    venue = fakeVenue();
    agents = new PerpsAgents(
      store,
      "testnet",
      Buffer.alloc(32, 7),
      () => clock,
    );
    service = new PerpsService(store, venue, agents, () => clock);
    master = new Wallet(Wallet.createRandom().privateKey);
    identity = {
      kind: "metamask",
      address: master.address,
      chainId: "0x66eee",
      expiresAt: new Date(clock + 3_600_000).toISOString(),
    };
  });

  async function approve(service: PerpsService, wallet = master) {
    const prepared = service.prepareAgent(identity);
    const { EIP712Domain: _domain, ...types } =
      prepared.approval.typedData.types;
    const signature = await wallet.signTypedData(
      prepared.approval.typedData.domain,
      types as any,
      prepared.approval.typedData.message,
    );
    return service.approveAgent(identity, {
      signature,
      nonce: prepared.approval.action.nonce,
    });
  }

  it("creates a trade-only agent and verifies the wallet approval", async () => {
    const prepared = service.prepareAgent(identity);
    expect(prepared.agentAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(prepared.approval.action.hyperliquidChain).toBe("Testnet");
    await expect(
      service.approveAgent(identity, {
        signature: "0x" + "11".repeat(65),
        nonce: prepared.approval.action.nonce,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });

    const status = await approve(service);
    expect(status.approved).toBe(true);
    expect(status.agentAddress).toBe(prepared.agentAddress);
    const again = service.prepareAgent(identity);
    expect(again.agentAddress).toBe(prepared.agentAddress);
  });

  it("rejects a signature from another wallet and expired approvals", async () => {
    const prepared = service.prepareAgent(identity);
    const { EIP712Domain: _domain, ...types } =
      prepared.approval.typedData.types;
    const signature = await Wallet.createRandom().signTypedData(
      prepared.approval.typedData.domain,
      types as any,
      prepared.approval.typedData.message,
    );
    await expect(
      service.approveAgent(identity, {
        signature,
        nonce: prepared.approval.action.nonce,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });

    clock += 301_000;
    await expect(
      service.approveAgent(identity, {
        signature: "0x" + "11".repeat(65),
        nonce: prepared.approval.action.nonce,
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
  });

  it("keeps the server seed hidden until reveal and commits to the result", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 10,
      closeSeconds: 60,
    });
    expect(spin).not.toHaveProperty("serverSeed");
    expect(spin.commit).toMatch(/^[0-9a-f]{64}$/);
    expect(spin.clientSeedHash).toBe(perpsSeedHash(seed));

    const revealed = service.reveal(identity, spin.spinId, seed);
    expect(revealed.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(revealed.result.market.universe).toBe("perp");
    expect(revealed.result.notional).toBeGreaterThanOrEqual(PERPS_MIN_NOTIONAL);
    expect(revealed.result.leverage).toBeLessThanOrEqual(
      revealed.result.market.maxLeverage,
    );
    const repeated = service.reveal(identity, spin.spinId, seed);
    expect(repeated.result).toEqual(revealed.result);
    expect(repeated.serverSeed).toBe(revealed.serverSeed);
  });

  it("lets the client reproduce the revealed result from the proof", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "meme",
      amountCap: 10,
      closeSeconds: 30,
    });
    const revealed = service.reveal(identity, spin.spinId, seed);
    const snapshot: PerpsMarket[] = spin.markets.map((market) => ({
      name: market.name,
      display: market.display,
      universe: market.universe,
      maxLeverage: market.maxLeverage,
      szDecimals: 0,
    }));
    expect(spin.configHash).toBe(
      perpsConfigHash({
        universe: spin.universe,
        amountCap: spin.amountCap,
        closeSeconds: spin.closeSeconds,
        markets: snapshot,
      }),
    );
    expect(perpsCommit(revealed.serverSeed, spin.spinId)).toBe(spin.commit);
    const recomputed = drawPerpsSpin({
      markets: snapshot,
      universe: spin.universe,
      amountCap: spin.amountCap,
      closeSeconds: spin.closeSeconds,
      rolls: perpsRolls({
        serverSeed: revealed.serverSeed,
        clientSeed: revealed.clientSeed,
        spinId: spin.spinId,
        configHash: spin.configHash,
      }),
    });
    expect(recomputed.market.name).toBe(revealed.result.market.name);
    expect(recomputed.side).toBe(revealed.result.side);
    expect(recomputed.leverage).toBe(revealed.result.leverage);
    expect(recomputed.amount).toBe(revealed.result.amount);
  });

  it("freezes an exact custom pool across core and meme perps into the spin proof", async () => {
    await approve(service);
    const chosen = ["BTC", "WIF"];
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "custom",
      marketNames: chosen,
      amountCap: 10,
      closeSeconds: 60,
    });
    expect(spin.markets.map((m) => m.name)).toEqual(["BTC", "WIF"]);
    chosen.splice(0, chosen.length, "ETH", "DOGE");
    const revealed = service.reveal(identity, spin.spinId, seed);
    expect(["BTC", "WIF"]).toContain(revealed.result.market.name);
    const snapshot = spin.markets.map((m) => ({ ...m, szDecimals: 0 }));
    expect(
      perpsConfigHash({
        universe: "custom",
        markets: snapshot,
        amountCap: 10,
        closeSeconds: 60,
      }),
    ).toBe(spin.configHash);
    expect(
      drawPerpsSpin({
        markets: snapshot,
        universe: "custom",
        amountCap: 10,
        closeSeconds: 60,
        rolls: perpsRolls({
          serverSeed: revealed.serverSeed,
          clientSeed: seed,
          spinId: spin.spinId,
          configHash: spin.configHash,
        }),
      }),
    ).toMatchObject({
      market: { name: revealed.result.market.name },
      side: revealed.result.side,
      leverage: revealed.result.leverage,
      amount: revealed.result.amount,
    });
  });

  it("rejects a signed unfunded approval with NO_BALANCE before venue delegation", async () => {
    venue.setBalance(0);
    await expect(approve(service)).rejects.toMatchObject({
      status: 402,
      code: "NO_BALANCE",
    });
    expect((await service.agentStatus(identity)).approved).toBe(false);
    expect(venue.orders()).toBe(0);
  });

  it("rejects unknown, repeated, empty and single-market custom pools before creating an order", async () => {
    await approve(service);
    for (const marketNames of [
      [],
      ["BTC"],
      ["BTC", "BTC"],
      ["BTC", "NOT-LISTED"],
    ]) {
      await expect(
        service.startSpin(identity, {
          clientSeedHash: perpsSeedHash(seed),
          universe: "custom",
          marketNames,
          amountCap: 10,
          closeSeconds: 60,
        }),
      ).rejects.toMatchObject({ code: "INVALID_POOL" });
    }
    expect(venue.orders()).toBe(0);
  });

  it("rejects a custom pool with an existing position instead of silently substituting another token", async () => {
    await approve(service);
    venue.addPosition("BTC");
    await expect(
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "custom",
        marketNames: ["BTC", "WIF"],
        amountCap: 10,
        closeSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: "NO_ELIGIBLE_MARKETS" });
    expect(venue.orders()).toBe(0);
  });

  it("opens one position, blocks a second round, auto-closes and records PnL", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "meme",
      amountCap: 10,
      closeSeconds: 60,
    });
    service.reveal(identity, spin.spinId, seed);
    const opened = await service.open(identity, spin.spinId);
    expect(opened.phase).toBe("open");
    expect(opened.size).toBeTruthy();
    expect(opened.closeAt).toBe(clock + 60_000);
    expect(venue.orders()).toBe(1);
    const again = await service.open(identity, spin.spinId);
    expect(again.id).toBe(opened.id);
    expect(venue.orders()).toBe(1);

    await expect(
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "meme",
        amountCap: 10,
        closeSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: "POSITION_OPEN" });

    clock += 61_000;
    await (service as unknown as { sweep(): Promise<void> }).sweep();
    const closed = await service.list(identity);
    expect(closed[0]?.phase).toBe("closed");
    expect(closed[0]?.exitPx).toBeTruthy();
    expect(closed[0]?.realizedPnl).toBeDefined();
    expect(closed[0]?.fees).toBeCloseTo(0.01, 8);
  });

  // The stake a spin was granted is not the stake a position may still spend:
  // other rounds can consume the daily budget while unopened reels are waiting.
  function spendDailyBudget(remaining: number) {
    const spent = 100 - remaining + 1;
    store.putRecord("perps-op:already-spent", {
      id: "already-spent",
      owner: subjectFor(identity),
      phase: "closed",
      amount: spent,
      createdAt: clock,
      openedAt: clock,
    } as unknown as PerpsOperation);
    return spent;
  }

  it("refuses to open once other rounds have spent the daily budget", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 25,
      closeSeconds: 60,
    });
    const revealed = service.reveal(identity, spin.spinId, seed);
    spendDailyBudget(revealed.result.amount);
    await expect(service.open(identity, spin.spinId)).rejects.toMatchObject({
      code: "DAILY_LIMIT",
    });
    expect(venue.orders()).toBe(0);
  });

  it("reserves the stake before ordering so two simultaneous opens cannot both spend it", async () => {
    await approve(service);
    const spins = await Promise.all([
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "perp",
        amountCap: 25,
        closeSeconds: 60,
      }),
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash("c".repeat(64)),
        universe: "meme",
        amountCap: 25,
        closeSeconds: 60,
      }),
    ]);
    const results = spins.map((spin, i) => ({
      spinId: spin.spinId,
      amount: service.reveal(
        identity,
        spin.spinId,
        i === 0 ? seed : "c".repeat(64),
      ).result.amount,
    }));
    const spent = spendDailyBudget(results[0]!.amount + results[1]!.amount);
    const settled = await Promise.allSettled(
      results.map((r) => service.open(identity, r.spinId)),
    );
    const opened = settled.filter((s) => s.status === "fulfilled");
    expect(opened).toHaveLength(1);
    expect(venue.orders()).toBe(1);
    const amount = (opened[0] as PromiseFulfilledResult<PerpsOperation>).value
      .amount;
    expect(spent + amount).toBeLessThanOrEqual(100);
    expect(
      settled
        .filter((s) => s.status === "rejected")
        .map((s) => (s as PromiseRejectedResult).reason),
    ).toEqual([expect.objectContaining({ code: "DAILY_LIMIT" })]);
  });

  it("treats a Hyperliquid read failure as unavailable, never as an empty account", async () => {
    await approve(service);
    venue.setFailAccountRead("always");
    await expect(
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "perp",
        amountCap: 10,
        closeSeconds: 60,
      }),
    ).rejects.toThrow(/clearinghouseState failed/);
    await expect(service.agentStatus(identity)).rejects.toThrow(
      /clearinghouseState failed/,
    );
  });

  it("returns the same operation for concurrent duplicate opens at the daily limit", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 25,
      closeSeconds: 60,
    });
    const { result } = service.reveal(identity, spin.spinId, seed);
    spendDailyBudget(result.amount + 1);
    const settled = await Promise.allSettled([
      service.open(identity, spin.spinId),
      service.open(identity, spin.spinId),
    ]);
    expect(settled.map((entry) => entry.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      settled.map((entry) =>
        entry.status === "fulfilled" ? entry.value.id : null,
      ),
    ).toEqual([spin.spinId, spin.spinId]);
    expect(venue.orders()).toBe(1);
    expect(await service.list(identity)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: spin.spinId, phase: "open" }),
      ]),
    );
  });

  it.each([false, true])(
    "does not open with an agent revoked during a venue read (replacement=%s)",
    async (replace) => {
      await approve(service);
      const spin = await service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "perp",
        amountCap: 10,
        closeSeconds: 60,
      });
      service.reveal(identity, spin.spinId, seed);
      let notifyEntered!: () => void;
      let resume!: () => void;
      const entered = new Promise<void>((resolve) => {
        notifyEntered = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const market = venue.market.bind(venue);
      venue.market = async (coin) => {
        notifyEntered();
        await paused;
        return market(coin);
      };
      const opening = service.open(identity, spin.spinId).then(
        (operation) => ({ operation }),
        (error: unknown) => ({ error }),
      );
      await entered;
      try {
        await service.revokeAgent(identity);
        if (replace) service.prepareAgent(identity);
      } finally {
        resume();
      }
      expect(await opening).toMatchObject({
        error: { code: "AGENT_REQUIRED" },
      });
      expect(venue.orders()).toBe(0);
      expect(await service.list(identity)).toEqual([]);
    },
  );

  it("reports a venue order rejection through its own channel and frees the stake", async () => {
    await approve(service);
    venue.setRejectOpen(true);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 25,
      closeSeconds: 60,
    });
    service.reveal(identity, spin.spinId, seed);
    await expect(service.open(identity, spin.spinId)).rejects.toMatchObject({
      code: "ORDER_REJECTED",
    });
    const [failed] = await service.list(identity);
    expect(failed.phase).toBe("failed");
    expect(failed.error).not.toContain("insufficient margin");
    // A rejected order must not consume the daily budget.
    await expect(
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash("d".repeat(64)),
        universe: "meme",
        amountCap: 25,
        closeSeconds: 60,
      }),
    ).resolves.toHaveProperty("spinId");
  });

  it.each(["rejected", "unconfirmed"])(
    "keeps the position recoverable without exposing an upstream %s close error",
    async (outcome) => {
      await approve(service);
      const spin = await service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "perp",
        amountCap: 10,
        closeSeconds: 60,
      });
      service.reveal(identity, spin.spinId, seed);
      const opened = await service.open(identity, spin.spinId);
      const detail = "upstream-private-node.internal:8545";
      const placeOrder = venue.placeOrder.bind(venue);
      venue.placeOrder = async () => {
        if (outcome === "unconfirmed") throw Error(detail);
        return { status: "failed", error: detail };
      };
      const failure = await service
        .close(identity, opened.id)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: outcome === "rejected" ? "CLOSE_REJECTED" : "CLOSE_UNCERTAIN",
      });
      expect((failure as Error).message).not.toContain(detail);
      const [unclosed] = await service.list(identity);
      expect(unclosed.phase).toBe("open");
      expect(unclosed.error).toBeTruthy();
      expect(unclosed.error).not.toContain(detail);
      venue.placeOrder = placeOrder;
      expect((await service.close(identity, opened.id)).phase).toBe("closed");
    },
  );

  it("locks an order whose outcome cannot be read instead of calling it rejected", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 25,
      closeSeconds: 60,
    });
    service.reveal(identity, spin.spinId, seed);
    venue.setFailAccountRead("after-first-order");
    await expect(service.open(identity, spin.spinId)).rejects.toMatchObject({
      code: "ORDER_UNCERTAIN",
    });
    // The read error mentions margin; that must not settle the round as failed
    // when the order itself was accepted.
    const [uncertain] = await service.list(identity);
    expect(uncertain.phase).toBe("opening");
    venue.setFailAccountRead(false);
    clock += 121_000;
    await (service as unknown as { sweep(): Promise<void> }).sweep();
    const [settled] = await service.list(identity);
    expect(settled.phase).toBe("open");
  });

  it("keeps a live position open while Hyperliquid cannot be read", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 10,
      closeSeconds: 30,
    });
    service.reveal(identity, spin.spinId, seed);
    const opened = await service.open(identity, spin.spinId);
    expect(opened.phase).toBe("open");
    const ordersBefore = venue.orders();

    venue.setFailAccountRead("always");
    clock += 31_000;
    await (service as unknown as { sweep(): Promise<void> }).sweep();

    // A failed read must not be read as "the position is gone": that would stop
    // Jackpot from ever closing a live, leveraged position.
    const [listed] = await service.list(identity);
    expect(listed.phase).toBe("open");
    expect(venue.orders()).toBe(ordersBefore);

    venue.setFailAccountRead(false);
    clock += 1;
    await (service as unknown as { sweep(): Promise<void> }).sweep();
    const [closed] = await service.list(identity);
    expect(closed.phase).toBe("closed");
    expect(venue.orders()).toBe(ordersBefore + 1);
  });

  it("forgets the agent key on revocation and stops signing orders", async () => {
    await approve(service);
    const before = await service.agentStatus(identity);
    expect(before.approved).toBe(true);
    expect(before.agentAddress).toMatch(/^0x[0-9a-f]{40}$/);

    const revoked = await service.revokeAgent(identity);
    expect(revoked.approved).toBe(false);
    expect(revoked.agentAddress).toBeNull();
    expect(revoked.revokedAgent?.agentAddress).toBe(before.agentAddress);
    expect(
      store.getRecord("perps-agent:" + "testnet" + ":" + subjectFor(identity)),
    ).toBeNull();

    await expect(
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "perp",
        amountCap: 10,
        closeSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: "AGENT_REQUIRED" });
    expect(venue.orders()).toBe(0);

    // A fresh approval mints a different key; the revoked one is never reused.
    const next = await approve(service);
    expect(next.agentAddress).not.toBe(before.agentAddress);
    await expect(service.revokeAgent(identity)).resolves.toMatchObject({
      approved: false,
    });
    await expect(service.revokeAgent(identity)).rejects.toMatchObject({
      code: "AGENT_REQUIRED",
    });
  });

  it("retains every revoked address across restarts and legacy revocation records", async () => {
    const legacy = {
      owner: subjectFor(identity),
      network: "testnet",
      master: identity.address.toLowerCase(),
      agentAddress: "0x" + "44".repeat(20),
      revokedAt: clock - 1,
    };
    store.putRecord(
      "perps-agent-revoked:testnet:" + subjectFor(identity),
      legacy,
    );
    const first = await approve(service);
    await service.revokeAgent(identity);
    const second = await approve(service);
    await service.revokeAgent(identity);
    const restarted = new PerpsService(
      store,
      venue,
      new PerpsAgents(store, "testnet", Buffer.alloc(32, 7), () => clock),
      () => clock,
    );
    const status = await restarted.agentStatus(identity);
    expect(status).toMatchObject({
      approved: false,
      agentAddress: null,
      revokedAgent: { agentAddress: second.agentAddress },
      revokedAgents: [
        { agentAddress: legacy.agentAddress },
        { agentAddress: first.agentAddress },
        { agentAddress: second.agentAddress },
      ],
    });
  });

  it("keeps the agent while a position is still open", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 10,
      closeSeconds: 300,
    });
    service.reveal(identity, spin.spinId, seed);
    const opened = await service.open(identity, spin.spinId);
    expect(opened.phase).toBe("open");

    await expect(service.revokeAgent(identity)).rejects.toMatchObject({
      code: "POSITION_OPEN",
    });
    // The key has to stay usable, otherwise nothing can close the position.
    const closed = await service.close(identity, opened.id);
    expect(closed.phase).toBe("closed");
    await expect(service.revokeAgent(identity)).resolves.toMatchObject({
      approved: false,
    });
  });

  it("blocks spins without agent approval or available balance", async () => {
    await expect(
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "perp",
        amountCap: 5,
        closeSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: "AGENT_REQUIRED" });

    await approve(service);
    venue.setBalance(4);
    await expect(
      service.startSpin(identity, {
        clientSeedHash: perpsSeedHash(seed),
        universe: "perp",
        amountCap: 5,
        closeSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: "NO_BALANCE" });
  });

  it("scopes spins and positions to the verified wallet", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 10,
      closeSeconds: 60,
    });
    service.reveal(identity, spin.spinId, seed);
    const other: WalletIdentity = {
      ...identity,
      address: Wallet.createRandom().address,
    };
    expect(() => service.reveal(other, spin.spinId, seed)).toThrow(
      "Unknown spin",
    );
    await expect(service.open(other, spin.spinId)).rejects.toMatchObject({
      code: "SPIN_NOT_FOUND",
    });
  });

  it("excludes markets that already have a Hyperliquid position", async () => {
    await approve(service);
    venue.addPosition("WIF");
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "meme",
      amountCap: 10,
      closeSeconds: 60,
    });
    expect(spin.markets.map((market) => market.name)).toEqual(["DOGE"]);
    const revealed = service.reveal(identity, spin.spinId, seed);
    expect(revealed.result.market.name).toBe("DOGE");
  });

  it("refuses to add to a position opened after the spin", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "meme",
      amountCap: 10,
      closeSeconds: 60,
    });
    const revealed = service.reveal(identity, spin.spinId, seed);
    venue.addPosition(revealed.result.market.name);
    await expect(service.open(identity, spin.spinId)).rejects.toMatchObject({
      code: "MARKET_POSITION_OPEN",
    });
  });

  it("keeps the position open when a close is rejected", async () => {
    await approve(service);
    const spin = await service.startSpin(identity, {
      clientSeedHash: perpsSeedHash(seed),
      universe: "perp",
      amountCap: 10,
      closeSeconds: 60,
    });
    service.reveal(identity, spin.spinId, seed);
    const opened = await service.open(identity, spin.spinId);
    venue.setFailClose(true);
    await expect(service.close(identity, opened.id)).rejects.toMatchObject({
      code: "CLOSE_REJECTED",
    });
    const stillOpen = await service.list(identity);
    expect(stillOpen[0]?.phase).toBe("open");
    venue.setFailClose(false);
    const closed = await service.close(identity, opened.id);
    expect(closed.phase).toBe("closed");
  });

  it("refuses to decrypt an agent with a different secret", async () => {
    await service.prepareAgent(identity);
    const other = new PerpsAgents(
      store,
      "testnet",
      Buffer.alloc(32, 9),
      () => clock,
    );
    expect(() => other.agentKey(identity)).toThrow("cannot be decrypted");
  });

  it("signs Hyperliquid L1 actions with the ethers agent wallet", async () => {
    const wallet = new Wallet(Wallet.createRandom().privateKey);
    const signature = await signL1Action({
      wallet,
      action: { type: "cancel", cancels: [{ a: 0, o: 1 }] },
      nonce: clock,
    });
    expect(signature.r).toMatch(/^0x[0-9a-f]{64}$/);
    expect(signature.s).toMatch(/^0x[0-9a-f]{64}$/);
    expect([27, 28]).toContain(signature.v);
  });
});
