import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, verifyTypedData } from "ethers";
import {
  PERPS_DEFAULT_AMOUNT_CAP,
  PERPS_DEFAULT_CLOSE_SECONDS,
  PERPS_MAX_AMOUNT_CAP,
  PERPS_MIN_NOTIONAL,
  drawPerpsSpin,
  perpsAgentApproval,
  perpsCommit,
  perpsConfigHash,
  perpsLeverageChoices,
  perpsLimitPrice,
  perpsLiquidationPrice,
  perpsOrderSize,
  perpsRolls,
  perpsSeedHash,
  type PerpsAgentView,
  type PerpsCatalogView,
  type PerpsMarket,
  type PerpsNetwork,
  type PerpsOperation,
  type PerpsSide,
  type PerpsSpinResult,
  type PerpsUniverse,
} from "../../../../packages/shared/src/perps.ts";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import { subjectFor } from "../beta/access.ts";
import type { MarketStore } from "../market/store.ts";
import { PerpsAgents, requireEvmIdentity } from "./agent.ts";
import { PerpsError } from "./errors.ts";
import type {
  HyperliquidVenue,
  VenueAccount,
  VenueFill,
} from "./hyperliquid.ts";

export type PerpsSpinRecord = {
  id: string;
  owner: string;
  network: PerpsNetwork;
  universe: PerpsUniverse;
  amountCap: number;
  closeSeconds: number | null;
  markets: PerpsMarket[];
  clientSeedHash: string;
  serverSeed: string;
  commit: string;
  createdAt: number;
  revealedAt?: number;
  result?: PerpsSpinResult;
  opId?: string;
};

const CLOSE_OPTIONS = [30, 60, 300, null];
const DAILY_STAKE_CAP = 100;
const ORDER_SLIPPAGE_BPS = 100;

export class PerpsService {
  private timer: NodeJS.Timeout | null = null;
  private busy = new Set<string>();

  constructor(
    private store: MarketStore,
    private venue: HyperliquidVenue,
    private agents: PerpsAgents,
    private now = Date.now,
  ) {}

  get network(): PerpsNetwork {
    return this.venue.network;
  }

  async catalog(): Promise<PerpsCatalogView> {
    const markets = await this.venue.markets();
    return {
      network: this.network,
      markets,
      minNotional: PERPS_MIN_NOTIONAL,
      defaultAmountCap: PERPS_DEFAULT_AMOUNT_CAP,
      maxAmountCap: PERPS_MAX_AMOUNT_CAP,
      defaultCloseSeconds: PERPS_DEFAULT_CLOSE_SECONDS,
      closeOptions: CLOSE_OPTIONS,
    };
  }

  async agentStatus(identity: WalletIdentity): Promise<PerpsAgentView> {
    const master = requireEvmIdentity(identity);
    const record = this.agents.status(identity);
    let approved = false;
    if (record) {
      approved = await this.venue.agentApproved(master, record.agentAddress);
      if (approved && !record.approvedAt) this.agents.markApproved(identity);
    }
    const account = await this.venue.account(master);
    return {
      network: this.network,
      master,
      agentAddress: record?.agentAddress ?? null,
      approved,
      revokedAgent: this.agents.revoked(identity),
      revokedAgents: this.agents.revokedAll(identity),
      accountValue: account.accountValue,
      withdrawable: account.withdrawable,
      positions: account.positions,
      activeOperation: this.active(identity),
    };
  }

  /**
   * Forget the delegated key so no later request can trade from this wallet.
   * The Hyperliquid-side approval outlives it until the owner removes the
   * address themselves, which is why an open position blocks revocation.
   */
  async revokeAgent(identity: WalletIdentity): Promise<PerpsAgentView> {
    const active = this.active(identity);
    if (active)
      throw new PerpsError(
        "Close the open position first. Once the agent key is forgotten Jackpot can no longer close it for you.",
        409,
        "POSITION_OPEN",
      );
    this.agents.revoke(identity);
    return this.agentStatus(identity);
  }

  prepareAgent(identity: WalletIdentity) {
    const { record } = this.agents.ensure(identity);
    return {
      agentAddress: record.agentAddress,
      network: this.network,
      approval: perpsAgentApproval({
        network: this.network,
        agentAddress: record.agentAddress,
        nonce: this.now(),
      }),
    };
  }

  async approveAgent(
    identity: WalletIdentity,
    input: { signature: string; nonce: number },
  ) {
    const master = requireEvmIdentity(identity);
    const record = this.agents.status(identity);
    if (!record)
      throw new PerpsError(
        "Prepare a trading agent before approving it.",
        403,
        "AGENT_REQUIRED",
      );
    if (
      !Number.isInteger(input.nonce) ||
      Math.abs(this.now() - input.nonce) > 300_000
    )
      throw new PerpsError(
        "The approval request expired. Prepare the agent again.",
        400,
        "APPROVAL_EXPIRED",
      );
    if (!/^0x[0-9a-f]{130}$/i.test(input.signature))
      throw new PerpsError(
        "Invalid approval signature.",
        400,
        "INVALID_SIGNATURE",
      );
    const approval = perpsAgentApproval({
      network: this.network,
      agentAddress: record.agentAddress,
      nonce: input.nonce,
    });
    const { EIP712Domain: _domain, ...types } = approval.typedData.types;
    let valid = false;
    try {
      const signer = verifyTypedData(
        approval.typedData.domain,
        types as any,
        approval.typedData.message,
        input.signature,
      );
      valid = signer.toLowerCase() === getAddress(master).toLowerCase();
    } catch {
      valid = false;
    }
    if (!valid)
      throw new PerpsError(
        "That approval was not signed by the connected wallet.",
        400,
        "INVALID_SIGNATURE",
      );
    const funding = await this.venue.account(master);
    if (funding.withdrawable < 5)
      throw new PerpsError(
        "Not enough available Hyperliquid USDC. Fund the account with at least $5 before enabling trading.",
        402,
        "NO_BALANCE",
      );
    await this.venue.approveAgent(approval, input.signature);
    this.agents.markApproved(identity);
    return this.agentStatus(identity);
  }

  async startSpin(
    identity: WalletIdentity,
    input: {
      universe: PerpsUniverse;
      marketNames?: string[];
      amountCap: number;
      closeSeconds: number | null;
      clientSeedHash: string;
    },
  ) {
    const master = requireEvmIdentity(identity);
    const record = this.agents.status(identity);
    if (
      !record ||
      !(await this.venue.agentApproved(master, record.agentAddress))
    )
      throw new PerpsError(
        "Enable one-tap trading before spinning.",
        403,
        "AGENT_REQUIRED",
      );
    const active = this.active(identity);
    if (active)
      throw new PerpsError(
        "Close the open position before starting another round.",
        409,
        "POSITION_OPEN",
      );
    if (!["perp", "meme", "custom"].includes(input.universe))
      throw new PerpsError("Unknown perps universe.", 400, "INVALID_UNIVERSE");
    if (
      input.universe === "custom"
        ? !Array.isArray(input.marketNames) ||
          input.marketNames.length < 2 ||
          input.marketNames.length > 32 ||
          new Set(input.marketNames).size !== input.marketNames.length
        : input.marketNames !== undefined
    )
      throw new PerpsError(
        "Choose 2–32 distinct listed Hyperliquid markets.",
        400,
        "INVALID_POOL",
      );
    if (
      !Number.isInteger(input.amountCap) ||
      input.amountCap < 5 ||
      input.amountCap > PERPS_MAX_AMOUNT_CAP
    )
      throw new PerpsError(
        `Choose a per-spin cap between $5 and $${PERPS_MAX_AMOUNT_CAP}.`,
        400,
        "INVALID_CAP",
      );
    if (!CLOSE_OPTIONS.includes(input.closeSeconds))
      throw new PerpsError("Unknown close window.", 400, "INVALID_CLOSE");
    this.requireDailyRoom(identity, input.amountCap);
    const account = await this.venue.account(master);
    if (account.withdrawable < 5)
      throw new PerpsError(
        "Not enough available Hyperliquid USDC. Fund the account before spinning.",
        402,
        "NO_BALANCE",
      );
    const openCoins = new Set(
      account.positions.map((position) => position.coin),
    );
    const catalog = await this.venue.markets();
    const selectedNames = new Set(input.marketNames);
    if (
      input.universe === "custom" &&
      input.marketNames!.some((name) => !catalog.some((m) => m.name === name))
    )
      throw new PerpsError(
        "A selected market is not in the live Hyperliquid catalog. Remove it before spinning.",
        400,
        "INVALID_POOL",
      );
    if (
      input.universe === "custom" &&
      input.marketNames!.some((name) => openCoins.has(name))
    )
      throw new PerpsError(
        "Remove tokens with an existing position from your pool, or close those positions first.",
        409,
        "NO_ELIGIBLE_MARKETS",
      );
    const markets = catalog.filter((market) =>
      input.universe === "custom"
        ? selectedNames.has(market.name)
        : market.universe === input.universe && !openCoins.has(market.name),
    );
    if (!markets.length)
      throw new PerpsError(
        "Every Hyperliquid market in that universe already has an open position. Close it before spinning.",
        409,
        "NO_ELIGIBLE_MARKETS",
      );
    if (!validHash(input.clientSeedHash))
      throw new PerpsError(
        "Commit to a client seed before spinning.",
        400,
        "INVALID_SEED",
      );
    const id = randomUUID();
    const serverSeed = randomHex(32);
    const spin: PerpsSpinRecord = {
      id,
      owner: subjectFor(identity),
      network: this.network,
      universe: input.universe,
      amountCap: input.amountCap,
      closeSeconds: input.closeSeconds,
      markets,
      clientSeedHash: input.clientSeedHash.toLowerCase(),
      serverSeed,
      commit: perpsCommit(serverSeed, id),
      createdAt: this.now(),
    };
    this.store.putRecord(this.spinKey(id), spin);
    return {
      spinId: id,
      network: this.network,
      universe: input.universe,
      amountCap: input.amountCap,
      closeSeconds: input.closeSeconds,
      clientSeedHash: spin.clientSeedHash,
      commit: spin.commit,
      configHash: this.configHash(spin),
      markets: markets.map((market) => ({
        name: market.name,
        display: market.display,
        universe: market.universe,
        maxLeverage: market.maxLeverage,
        leverageChoices: perpsLeverageChoices(market.maxLeverage).map(
          (choice) => ({ leverage: choice.leverage, weight: choice.weight }),
        ),
      })),
    };
  }

  reveal(identity: WalletIdentity, spinId: string, clientSeed: string) {
    const spin = this.loadSpin(identity, spinId);
    if (
      !validHash(clientSeed) ||
      perpsSeedHash(clientSeed) !== spin.clientSeedHash
    )
      throw new PerpsError(
        "That client seed does not match the spin commitment.",
        400,
        "INVALID_SEED",
      );
    if (spin.revealedAt && spin.result)
      return this.revealView(spin, clientSeed);
    if (this.now() - spin.createdAt > 300_000)
      throw new PerpsError(
        "This spin expired. Start a new round.",
        410,
        "SPIN_EXPIRED",
      );
    const configHash = this.configHash(spin);
    const rolls = perpsRolls({
      serverSeed: spin.serverSeed,
      clientSeed,
      spinId: spin.id,
      configHash,
    });
    spin.result = drawPerpsSpin({
      markets: spin.markets,
      universe: spin.universe,
      amountCap: spin.amountCap,
      closeSeconds: spin.closeSeconds,
      rolls,
    });
    spin.revealedAt = this.now();
    this.store.putRecord(this.spinKey(spin.id), spin);
    return this.revealView(spin, clientSeed);
  }

  private revealView(spin: PerpsSpinRecord, clientSeed: string) {
    return {
      spinId: spin.id,
      network: spin.network,
      commit: spin.commit,
      clientSeed,
      serverSeed: spin.serverSeed,
      configHash: this.configHash(spin),
      result: spin.result!,
    };
  }

  async open(
    identity: WalletIdentity,
    spinId: string,
  ): Promise<PerpsOperation> {
    const spin = this.loadSpin(identity, spinId);
    if (!spin.result || !spin.revealedAt)
      throw new PerpsError("Reveal the reels first.", 409, "NOT_REVEALED");
    const existing = this.store.getRecord<PerpsOperation>(this.opKey(spin.id));
    if (existing) return existing;
    if (this.now() - spin.revealedAt > 120_000)
      throw new PerpsError(
        "This result expired. Spin again.",
        410,
        "RESULT_EXPIRED",
      );
    const active = this.active(identity);
    if (active && active.id !== spin.id)
      throw new PerpsError(
        "Close the open position before opening another.",
        409,
        "POSITION_OPEN",
      );
    this.requireDailyRoom(identity, spin.result.amount);
    const master = requireEvmIdentity(identity);
    const agent = this.agents.status(identity);
    if (!agent || !(await this.venue.agentApproved(master, agent.agentAddress)))
      throw new PerpsError(
        "Approve the trading agent before opening a position.",
        403,
        "AGENT_REQUIRED",
      );
    const result = spin.result;
    const listed = await this.venue.market(result.market.name);
    if (!listed)
      throw new PerpsError(
        "That Hyperliquid market is no longer listed.",
        410,
        "MARKET_GONE",
      );
    const mark = await this.venue.markPrice(result.market.name);
    const { size } = perpsOrderSize(
      result.notional,
      mark,
      listed.market.szDecimals,
    );
    const limitPx = perpsLimitPrice(
      mark,
      result.side,
      ORDER_SLIPPAGE_BPS,
      listed.market.szDecimals,
    );
    const account = await this.venue.account(master);
    const base: PerpsOperation = {
      id: spin.id,
      owner: spin.owner,
      network: this.network,
      spinId: spin.id,
      master,
      agentAddress: agent.agentAddress,
      market: result.market.name,
      display: result.market.display,
      side: result.side,
      leverage: result.leverage,
      amount: result.amount,
      notional: result.notional,
      closeSeconds: result.closeSeconds,
      phase: "opening",
      size,
      markPx: mark,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    // Venue reads above can race another open or a revocation. Recheck the
    // current agent and budget together with the reservation, without awaiting.
    // Once reserved, revokeAgent sees an active operation and keeps its key.
    const reservation = this.store.transaction(() => {
      const existing = this.store.getRecord<PerpsOperation>(
        this.opKey(base.id),
      );
      if (existing) return { operation: existing };
      const currentAgent = this.agents.status(identity);
      if (!currentAgent || currentAgent.agentAddress !== agent.agentAddress)
        throw new PerpsError(
          "The trading agent changed. Approve the current agent before opening a position.",
          403,
          "AGENT_REQUIRED",
        );
      this.requireDailyRoom(identity, result.amount);
      if (this.active(identity))
        throw new PerpsError(
          "Close the open position before opening another.",
          409,
          "POSITION_OPEN",
        );
      if (account.withdrawable < result.amount)
        throw new PerpsError(
          "Not enough available USDC for this position.",
          402,
          "NO_BALANCE",
        );
      if (
        account.positions.some(
          (position) => position.coin === result.market.name,
        )
      )
        throw new PerpsError(
          `You already have an open ${result.market.display} position on Hyperliquid. Close it before adding another.`,
          409,
          "MARKET_POSITION_OPEN",
        );
      const agentKey = this.agents.agentKey(identity);
      this.saveOp(base);
      return { agentKey };
    });
    if (reservation.operation) return reservation.operation;
    const agentKey = reservation.agentKey;
    try {
      await this.venue.updateLeverage({
        agentKey,
        assetIndex: listed.index,
        leverage: result.leverage,
      });
      const order = await this.venue.placeOrder({
        agentKey,
        assetIndex: listed.index,
        side: result.side,
        size,
        limitPx,
        reduceOnly: false,
      });
      if (order.status === "failed") {
        base.phase = "failed";
        console.warn("hyperliquid order rejected:", order.error);
        base.error = "Hyperliquid rejected the order. Nothing was opened.";
        base.updatedAt = this.now();
        this.saveOp(base);
        throw new PerpsError(base.error, 422, "ORDER_REJECTED");
      }
      base.orderId = order.oid;
      if (order.avgPx) base.entryPx = order.avgPx;
      base.updatedAt = this.now();
      this.saveOp(base);
      for (let attempt = 0; attempt < 8; attempt++) {
        const synced = await this.syncOp(
          base,
          await this.venue.account(master),
        );
        if (synced.phase !== "opening") return synced;
        await sleep(500);
      }
      return this.store.getRecord<PerpsOperation>(this.opKey(spin.id)) ?? base;
    } catch (error) {
      if (error instanceof PerpsError) throw error;
      // Anything thrown past this point is an outcome we cannot see, including a
      // status read that failed. The venue's own rejection channel is
      // order.status === "failed"; guessing at rejection from error text could
      // mark a position that really opened as failed and free its stake.
      base.error =
        "Order status is unknown. Do not retry; Jackpot is checking the position.";
      base.updatedAt = this.now();
      this.saveOp(base);
      throw new PerpsError(
        "The Hyperliquid response was lost. The operation is locked while Jackpot checks whether the position opened.",
        502,
        "ORDER_UNCERTAIN",
      );
    }
  }

  async list(identity: WalletIdentity): Promise<PerpsOperation[]> {
    const master = requireEvmIdentity(identity);
    const owner = subjectFor(identity);
    const operations = this.store
      .records<PerpsOperation>("perps-op:")
      .filter((operation) => operation.owner === owner);
    if (!operations.some((operation) => isActive(operation.phase)))
      return operations.sort((a, b) => b.createdAt - a.createdAt);
    // A read that failed is not a read that found nothing: syncing against a
    // bogus flat account would settle a live position as closed. List what is
    // stored and let the sweep retry.
    const account = await this.venue.account(master).catch(() => null);
    if (account)
      for (const operation of operations) {
        if (isActive(operation.phase)) await this.syncOp(operation, account);
      }
    return this.store
      .records<PerpsOperation>("perps-op:")
      .filter((operation) => operation.owner === owner)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async close(identity: WalletIdentity, opId: string): Promise<PerpsOperation> {
    const operation = this.store.getRecord<PerpsOperation>(this.opKey(opId));
    if (!operation || operation.owner !== subjectFor(identity))
      throw new PerpsError("Unknown position.", 404, "POSITION_NOT_FOUND");
    if (operation.phase === "opening")
      throw new PerpsError(
        "Wait for the position to finish opening.",
        409,
        "POSITION_OPENING",
      );
    if (!isActive(operation.phase)) return operation;
    return this.closeOp(operation);
  }

  private async closeOp(operation: PerpsOperation): Promise<PerpsOperation> {
    if (this.busy.has(operation.id)) return operation;
    this.busy.add(operation.id);
    try {
      const account = await this.venue.account(operation.master);
      const position = account.positions.find(
        (entry) => entry.coin === operation.market,
      );
      if (!position) return this.syncOp(operation, account);
      const listed = await this.venue.market(operation.market);
      const agentKey = this.decryptAgentFor(operation);
      if (!listed)
        throw new PerpsError(
          "That Hyperliquid market is no longer listed.",
          410,
          "MARKET_GONE",
        );
      const mark = await this.venue.markPrice(operation.market);
      const closeSide: PerpsSide = position.size > 0 ? "short" : "long";
      const limitPx = perpsLimitPrice(
        mark,
        closeSide,
        ORDER_SLIPPAGE_BPS,
        listed.market.szDecimals,
      );
      operation.phase = "closing";
      operation.updatedAt = this.now();
      this.saveOp(operation);
      let order: Awaited<ReturnType<HyperliquidVenue["placeOrder"]>>;
      try {
        order = await this.venue.placeOrder({
          agentKey,
          assetIndex: listed.index,
          side: closeSide,
          size: Math.abs(position.size).toFixed(listed.market.szDecimals),
          limitPx,
          reduceOnly: true,
        });
      } catch (error) {
        operation.phase = "open";
        console.warn(
          "hyperliquid close unconfirmed:",
          error instanceof Error ? error.message : error,
        );
        operation.error = "The close request was not confirmed.";
        operation.closeAt = this.now() + 15_000;
        operation.updatedAt = this.now();
        this.saveOp(operation);
        throw new PerpsError(operation.error, 502, "CLOSE_UNCERTAIN");
      }
      if (order.status === "failed") {
        operation.phase = "open";
        console.warn("hyperliquid close rejected:", order.error);
        operation.error =
          "Hyperliquid rejected the close. The position is still open.";
        operation.closeAt = this.now() + 15_000;
        operation.updatedAt = this.now();
        this.saveOp(operation);
        throw new PerpsError(operation.error, 422, "CLOSE_REJECTED");
      }
      operation.orderId = order.oid ?? operation.orderId;
      for (let attempt = 0; attempt < 8; attempt++) {
        const synced = await this.syncOp(
          operation,
          await this.venue.account(operation.master),
        );
        if (!isActive(synced.phase)) return synced;
        await sleep(500);
      }
      if (operation.phase === "closing") {
        operation.phase = "open";
        operation.error = "The close order did not fill. Try closing again.";
        operation.updatedAt = this.now();
        this.saveOp(operation);
      }
      return operation;
    } finally {
      this.busy.delete(operation.id);
    }
  }

  private decryptAgentFor(operation: PerpsOperation): string {
    const agent = this.agents.agentKey({
      kind: "metamask",
      address: operation.master,
      expiresAt: "",
    });
    if (agent.length !== 66) throw new PerpsError("Invalid agent key.", 409);
    return agent;
  }

  private async syncOp(
    operation: PerpsOperation,
    account?: VenueAccount,
  ): Promise<PerpsOperation> {
    if (!isActive(operation.phase)) return operation;
    const state = account ?? (await this.venue.account(operation.master));
    const position = state.positions.find(
      (entry) => entry.coin === operation.market,
    );
    if (position) {
      operation.entryPx ??= position.entryPx;
      operation.size = Math.abs(position.size).toString();
      operation.liquidationPx =
        position.liquidationPx ?? operation.liquidationPx;
      operation.unrealizedPnl = position.unrealizedPnl;
      operation.markPx = await this.venue
        .markPrice(operation.market)
        .catch(() => operation.markPx);
      if (operation.phase === "opening") {
        operation.phase = "open";
        operation.openedAt ??= this.now();
        operation.closeAt = operation.closeSeconds
          ? operation.openedAt + operation.closeSeconds * 1000
          : undefined;
        operation.error = undefined;
      }
      operation.updatedAt = this.now();
      this.saveOp(operation);
      return operation;
    }
    if (operation.phase === "opening") {
      const fills = await this.venue
        .fills(operation.master, operation.createdAt)
        .catch(() => [] as VenueFill[]);
      const opening = fills.find((fill) => fill.coin === operation.market);
      if (opening) {
        operation.phase = "open";
        operation.entryPx = opening.px;
        operation.size = String(opening.sz);
        operation.liquidationPx ??= perpsLiquidationPrice(
          operation.side,
          opening.px,
          operation.leverage,
        );
        operation.openedAt = opening.time;
        operation.closeAt = operation.closeSeconds
          ? opening.time + operation.closeSeconds * 1000
          : undefined;
        operation.updatedAt = this.now();
        this.saveOp(operation);
        return operation;
      }
      if (
        this.now() - operation.createdAt >
        (operation.orderId ? 20_000 : 120_000)
      ) {
        operation.phase = "failed";
        operation.error = "Hyperliquid did not confirm the order.";
        operation.updatedAt = this.now();
        this.saveOp(operation);
      }
      return operation;
    }
    const fills = await this.venue
      .fills(operation.master, operation.openedAt ?? operation.createdAt)
      .catch(() => [] as VenueFill[]);
    const closing = fills.filter(
      (fill) =>
        fill.coin === operation.market &&
        (fill.closedPnl !== 0 || /close|liquidat/i.test(fill.dir)),
    );
    if (closing.length) {
      const size = closing.reduce((sum, fill) => sum + fill.sz, 0);
      const notional = closing.reduce(
        (sum, fill) => sum + fill.px * fill.sz,
        0,
      );
      operation.exitPx = size > 0 ? notional / size : operation.markPx;
      operation.realizedPnl = closing.reduce(
        (sum, fill) => sum + fill.closedPnl,
        0,
      );
      operation.fees = closing.reduce((sum, fill) => sum + fill.fee, 0);
      operation.phase = closing.some((fill) => fill.liquidation)
        ? "liquidated"
        : "closed";
      operation.closedAt = Math.max(...closing.map((fill) => fill.time));
      operation.closeAt = undefined;
      operation.updatedAt = this.now();
      this.saveOp(operation);
      return operation;
    }
    if (
      operation.phase === "closing" &&
      this.now() - operation.updatedAt > 60_000
    ) {
      operation.phase = "closed";
      operation.error =
        "Close was submitted; Hyperliquid returned no fill yet.";
      operation.updatedAt = this.now();
      this.saveOp(operation);
    } else if (
      operation.phase === "open" &&
      this.now() - (operation.openedAt ?? 0) > 15_000
    ) {
      operation.phase = "closed";
      operation.error = "The position is no longer open on Hyperliquid.";
      operation.closedAt = this.now();
      operation.closeAt = undefined;
      operation.updatedAt = this.now();
      this.saveOp(operation);
    }
    return operation;
  }

  private active(identity: WalletIdentity): PerpsOperation | null {
    const owner = subjectFor(identity);
    return (
      this.store
        .records<PerpsOperation>("perps-op:")
        .filter(
          (operation) => operation.owner === owner && isActive(operation.phase),
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  }

  private requireDailyRoom(identity: WalletIdentity, amount: number) {
    if (this.dailyStake(identity) + amount > DAILY_STAKE_CAP)
      throw new PerpsError(
        `The daily perps stake limit is $${DAILY_STAKE_CAP}.`,
        429,
        "DAILY_LIMIT",
      );
  }

  private dailyStake(identity: WalletIdentity): number {
    const owner = subjectFor(identity);
    const start = new Date(this.now());
    start.setUTCHours(0, 0, 0, 0);
    return this.store
      .records<PerpsOperation>("perps-op:")
      .filter(
        (operation) =>
          operation.owner === owner &&
          operation.phase !== "failed" &&
          (operation.openedAt ?? operation.createdAt) >= start.getTime(),
      )
      .reduce((sum, operation) => sum + operation.amount, 0);
  }

  private loadSpin(identity: WalletIdentity, spinId: string): PerpsSpinRecord {
    const spin = this.store.getRecord<PerpsSpinRecord>(this.spinKey(spinId));
    if (!spin || spin.owner !== subjectFor(identity))
      throw new PerpsError("Unknown spin.", 404, "SPIN_NOT_FOUND");
    if (spin.network !== this.network)
      throw new PerpsError("This spin belongs to another network.", 409);
    return spin;
  }

  private configHash(spin: PerpsSpinRecord): string {
    return perpsConfigHash({
      universe: spin.universe,
      amountCap: spin.amountCap,
      closeSeconds: spin.closeSeconds,
      markets: spin.markets,
    });
  }

  private saveOp(operation: PerpsOperation) {
    this.store.putRecord(this.opKey(operation.id), operation);
  }

  private spinKey(id: string) {
    return `perps-spin:${id}`;
  }

  private opKey(id: string) {
    return `perps-op:${id}`;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), 5_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sweep() {
    for (const operation of this.store.records<PerpsOperation>("perps-op:")) {
      if (!isActive(operation.phase)) continue;
      try {
        if (
          operation.phase === "open" &&
          operation.closeAt &&
          operation.closeAt <= this.now()
        )
          await this.closeOp(operation);
        else if (operation.phase === "closing") await this.syncOp(operation);
        else if (
          operation.phase === "opening" &&
          this.now() - operation.createdAt > 120_000
        )
          await this.syncOp(operation);
      } catch {
        // Keep the operation persisted; the next sweep or user action retries.
      }
    }
  }
}

function isActive(phase: PerpsOperation["phase"]): boolean {
  return phase === "opening" || phase === "open" || phase === "closing";
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
