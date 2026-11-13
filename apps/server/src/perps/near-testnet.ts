import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Account, JsonRpcProvider, actions } from "near-api-js";
import {
  PERPS_DEFAULT_AMOUNT_CAP,
  PERPS_DEFAULT_CLOSE_SECONDS,
  PERPS_MAX_AMOUNT_CAP,
  PERPS_MIN_NOTIONAL,
  classifyPerpsMarkets,
  drawPerpsSpin,
  perpsCommit,
  perpsConfigHash,
  perpsLeverageChoices,
  perpsLiquidationPrice,
  perpsMarketsFor,
  perpsOrderSize,
  perpsRolls,
  perpsSeedHash,
  type PerpsAgentView,
  type PerpsCatalogView,
  type PerpsMarket,
  type PerpsMetaMarket,
  type PerpsOperation,
  type PerpsSpinResult,
  type PerpsUniverse,
} from "../../../../packages/shared/src/perps.ts";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import { subjectFor } from "../beta/access.ts";
import { PerpsError } from "./errors.ts";
import { HyperliquidClient, type HyperliquidVenue } from "./hyperliquid.ts";

const FALLBACK_META: PerpsMetaMarket[] = [
  { name: "BTC", maxLeverage: 40, szDecimals: 5 },
  { name: "ETH", maxLeverage: 25, szDecimals: 4 },
  { name: "SOL", maxLeverage: 20, szDecimals: 2 },
  { name: "BNB", maxLeverage: 20, szDecimals: 3 },
  { name: "SUI", maxLeverage: 10, szDecimals: 1 },
  { name: "AVAX", maxLeverage: 20, szDecimals: 2 },
  { name: "DOGE", maxLeverage: 10, szDecimals: 0 },
  { name: "kPEPE", maxLeverage: 10, szDecimals: 0 },
  { name: "WIF", maxLeverage: 10, szDecimals: 1 },
  { name: "POPCAT", maxLeverage: 5, szDecimals: 0 },
];

const FALLBACK_PRICES: Record<string, number> = {
  BTC: 94500,
  ETH: 3120,
  SOL: 192.5,
  BNB: 640,
  SUI: 3.15,
  AVAX: 32.4,
  DOGE: 0.285,
  kPEPE: 0.0195,
  WIF: 2.45,
  POPCAT: 1.18,
};

type StoredTestnetSpin = {
  id: string;
  owner: string;
  address: string;
  universe: PerpsUniverse;
  amountCap: number;
  closeSeconds: number | null;
  markets: PerpsMarket[];
  configHash: string;
  clientSeedHash: string;
  serverSeed: string;
  commit: string;
  clientSeed?: string;
  result?: PerpsSpinResult;
  operationId?: string;
  createdAt: number;
};

type NearTestnetCredentials = {
  accountId: string;
  secretKey: string;
  rpcUrl: string;
};

function loadNearTestnetCredentials(): NearTestnetCredentials | null {
  const envAccount = process.env.NEAR_PERPS_TESTNET_ACCOUNT_ID?.trim();
  const envSecret = process.env.NEAR_PERPS_TESTNET_SECRET_KEY?.trim();
  const rpcUrl =
    process.env.NEAR_PERPS_TESTNET_RPC_URL?.trim() ||
    "https://rpc.testnet.near.org";
  if (envAccount && envSecret) {
    return { accountId: envAccount, secretKey: envSecret, rpcUrl };
  }
  const credPath = ".credentials/fee-vault-testnet.json";
  if (existsSync(credPath)) {
    try {
      const parsed = JSON.parse(readFileSync(credPath, "utf8"));
      if (parsed?.accountId && parsed?.secretKey) {
        return {
          accountId: String(parsed.accountId),
          secretKey: String(parsed.secretKey),
          rpcUrl,
        };
      }
    } catch {}
  }
  return null;
}

export class NearPerpsTestnetService {
  readonly venue: Pick<HyperliquidVenue, "markets" | "markPrice">;
  private readonly spins = new Map<string, StoredTestnetSpin>();
  private readonly operations = new Map<string, PerpsOperation>();
  private cachedCatalog: { at: number; markets: PerpsMarket[] } | null = null;
  private txQueue: Promise<unknown> = Promise.resolve();

  constructor(
    venue: Pick<HyperliquidVenue, "markets" | "markPrice"> = new HyperliquidClient("testnet"),
  ) {
    this.venue = venue;
  }

  private async getMarkets(force = false): Promise<PerpsMarket[]> {
    const now = Date.now();
    if (!force && this.cachedCatalog && now - this.cachedCatalog.at < 15_000) {
      return this.cachedCatalog.markets;
    }
    try {
      const markets = await this.venue.markets();
      if (markets.length >= 2) {
        this.cachedCatalog = { at: now, markets };
        return markets;
      }
    } catch {}
    const markets = classifyPerpsMarkets(FALLBACK_META);
    this.cachedCatalog = { at: now, markets };
    return markets;
  }

  private async getMarkPrice(coin: string): Promise<number> {
    try {
      const px = await this.venue.markPrice(coin);
      if (Number.isFinite(px) && px > 0) return px;
    } catch {}
    return FALLBACK_PRICES[coin] ?? 100;
  }

  async catalog(): Promise<PerpsCatalogView> {
    const markets = await this.getMarkets();
    return {
      network: "testnet",
      markets,
      minNotional: PERPS_MIN_NOTIONAL,
      defaultAmountCap: PERPS_DEFAULT_AMOUNT_CAP,
      maxAmountCap: PERPS_MAX_AMOUNT_CAP,
      defaultCloseSeconds: PERPS_DEFAULT_CLOSE_SECONDS,
      closeOptions: [30, 60, 300, null],
    };
  }

  private enqueueNearTx<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.txQueue.then(fn, fn);
    this.txQueue = next.catch(() => {});
    return next;
  }

  private async settleNearTestnetOpen(args: {
    spinId: string;
    trader: string;
    result: PerpsSpinResult;
    entryPx: number;
  }): Promise<{
    txHash: string;
    explorerUrl: string;
    settlementAccount: string;
    settlementContract: string;
  }> {
    const creds = loadNearTestnetCredentials();
    if (!creds) {
      throw new PerpsError(
        "NEAR Perps Testnet settlement credentials are not configured on this server.",
        503,
        "VENUE_UNAVAILABLE",
      );
    }
    const tokenId = `usdc.${creds.accountId}`;
    const vaultId = `vault.${creds.accountId}`;
    const grossUsdc = String(Math.round(args.result.amount * 1_000_000));
    const feeUsdc = String(Math.round(args.result.amount * 5_000));
    const rollKey = `perp-${args.spinId}`;
    const memo = `NEAR-PERPS-TESTNET|OPEN|${args.result.market.display}-PERP|${args.result.side.toUpperCase()}|${args.result.leverage}x|$${args.result.amount}|entry:${args.entryPx}|trader:${args.trader}`;

    return this.enqueueNearTx(async () => {
      const provider = new JsonRpcProvider({ url: creds.rpcUrl });
      const account = new Account(
        creds.accountId,
        provider,
        creds.secretKey as any,
      );
      const outcome: any = await account.signAndSendTransaction({
        receiverId: tokenId,
        actions: [
          actions.functionCall(
            "ft_transfer_call",
            {
              receiver_id: vaultId,
              amount: feeUsdc,
              memo,
              msg: JSON.stringify({
                roll_id: rollKey,
                payer: creds.accountId,
                gross_usdc: grossUsdc,
              }),
            },
            100_000_000_000_000n,
            1n,
          ),
        ],
        waitUntil: "EXECUTED_OPTIMISTIC",
        throwOnFailure: false,
      });
      const txHash: string | undefined =
        outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id;
      if (!txHash) {
        throw new PerpsError(
          "NEAR Testnet RPC did not return a transaction hash.",
          503,
          "VENUE_UNAVAILABLE",
        );
      }
      return {
        txHash,
        explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}`,
        settlementAccount: creds.accountId,
        settlementContract: vaultId,
      };
    });
  }

  private async settleNearTestnetClose(op: PerpsOperation, exitPx: number): Promise<{
    txHash: string;
    explorerUrl: string;
  } | null> {
    const creds = loadNearTestnetCredentials();
    if (!creds) return null;
    const tokenId = `usdc.${creds.accountId}`;
    const vaultId = `vault.${creds.accountId}`;
    const memo = `NEAR-PERPS-TESTNET|CLOSE|${op.display}-PERP|${op.side.toUpperCase()}|${op.leverage}x|exit:${exitPx}|pnl:${(op.realizedPnl ?? 0).toFixed(2)}`;
    try {
      return await this.enqueueNearTx(async () => {
        const provider = new JsonRpcProvider({ url: creds.rpcUrl });
        const account = new Account(
          creds.accountId,
          provider,
          creds.secretKey as any,
        );
        const outcome: any = await account.signAndSendTransaction({
          receiverId: tokenId,
          actions: [
            actions.functionCall(
              "ft_transfer",
              {
                receiver_id: vaultId,
                amount: "1000",
                memo,
              },
              50_000_000_000_000n,
              1n,
            ),
          ],
          waitUntil: "EXECUTED_OPTIMISTIC",
          throwOnFailure: false,
        });
        const txHash: string | undefined =
          outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id;
        if (!txHash) return null;
        return {
          txHash,
          explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}`,
        };
      });
    } catch {
      return null;
    }
  }

  private async refreshOwnerOperations(owner: string): Promise<PerpsOperation[]> {
    const now = Date.now();
    const list = [...this.operations.values()]
      .filter((op) => op.owner === owner)
      .sort((a, b) => b.createdAt - a.createdAt);

    for (const op of list) {
      if (op.phase === "open") {
        const liveMark = await this.getMarkPrice(op.market);
        const entry = op.entryPx ?? liveMark;
        const sizeNum = Number(op.size ?? 0);
        const rawPnl =
          op.side === "long"
            ? (liveMark - entry) * sizeNum
            : (entry - liveMark) * sizeNum;
        op.markPx = liveMark;
        op.unrealizedPnl = Number(rawPnl.toFixed(4));
        op.updatedAt = now;

        if (op.closeAt && now >= op.closeAt) {
          op.phase = "closed";
          op.exitPx = liveMark;
          op.closedAt = now;
          op.fees = Number((op.notional * 0.0005).toFixed(4));
          op.realizedPnl = Number((rawPnl - op.fees).toFixed(4));
        }
      }
    }
    return list;
  }

  async agentStatus(wallet: WalletIdentity): Promise<PerpsAgentView> {
    const owner = subjectFor(wallet);
    const creds = loadNearTestnetCredentials();
    const ops = await this.refreshOwnerOperations(owner);
    const active =
      ops.find((entry) => ["opening", "open", "closing"].includes(entry.phase)) ??
      null;
    const realizedTotal = ops
      .filter((o) => o.phase === "closed" || o.phase === "liquidated")
      .reduce((sum, o) => sum + (o.realizedPnl ?? 0), 0);
    const marginInUse = active ? active.amount : 0;
    const accountValue = Math.max(100, Number((1000 + realizedTotal).toFixed(2)));
    const withdrawable = Math.max(25, Number((accountValue - marginInUse).toFixed(2)));

    return {
      network: "testnet",
      master: wallet.address,
      agentAddress: creds ? `vault.${creds.accountId}` : "near-perps-testnet",
      approved: true,
      revokedAgent: null,
      revokedAgents: [],
      accountValue,
      withdrawable,
      positions: active
        ? [
            {
              coin: active.display,
              size: Number(active.size ?? 0) * (active.side === "long" ? 1 : -1),
              entryPx: active.entryPx ?? 0,
              liquidationPx: active.liquidationPx ?? null,
              unrealizedPnl: active.unrealizedPnl ?? 0,
              marginUsed: active.amount,
              leverage: active.leverage,
            },
          ]
        : [],
      activeOperation: active,
    };
  }

  async list(wallet: WalletIdentity): Promise<PerpsOperation[]> {
    const owner = subjectFor(wallet);
    return this.refreshOwnerOperations(owner);
  }

  async startSpin(
    wallet: WalletIdentity,
    input: {
      universe: PerpsUniverse;
      marketNames?: string[];
      amountCap: number;
      closeSeconds: number | null;
      clientSeedHash: string;
    },
  ) {
    const owner = subjectFor(wallet);
    const catalogMarkets = await this.getMarkets();
    const markets =
      input.universe === "custom"
        ? catalogMarkets.filter((m) => input.marketNames?.includes(m.name))
        : perpsMarketsFor(catalogMarkets, input.universe);
    if (markets.length < 2) {
      throw new PerpsError(
        "Select at least 2 listed testnet markets before spinning.",
        400,
        "INVALID_SPIN",
      );
    }
    const spinId = randomUUID();
    const serverSeed = randomBytes(32).toString("hex");
    const commit = perpsCommit(serverSeed, spinId);
    const configHash = perpsConfigHash({
      universe: input.universe,
      amountCap: input.amountCap,
      closeSeconds: input.closeSeconds,
      markets,
    });
    const record: StoredTestnetSpin = {
      id: spinId,
      owner,
      address: wallet.address,
      universe: input.universe,
      amountCap: input.amountCap,
      closeSeconds: input.closeSeconds,
      markets,
      configHash,
      clientSeedHash: input.clientSeedHash.toLowerCase(),
      serverSeed,
      commit,
      createdAt: Date.now(),
    };
    this.spins.set(spinId, record);

    return {
      spinId,
      network: "testnet" as const,
      universe: input.universe,
      amountCap: input.amountCap,
      closeSeconds: input.closeSeconds,
      clientSeedHash: record.clientSeedHash,
      commit,
      configHash,
      markets: markets.map((market) => ({
        name: market.name,
        display: market.display,
        universe: market.universe,
        maxLeverage: market.maxLeverage,
        leverageChoices: perpsLeverageChoices(market.maxLeverage),
      })),
    };
  }

  async reveal(wallet: WalletIdentity, spinId: string, clientSeed: string) {
    const owner = subjectFor(wallet);
    const spin = this.spins.get(spinId);
    if (!spin || spin.owner !== owner) {
      throw new PerpsError("Spin not found for this wallet.", 404, "NOT_FOUND");
    }
    const normalizedSeed = clientSeed.toLowerCase();
    if (perpsSeedHash(normalizedSeed) !== spin.clientSeedHash) {
      throw new PerpsError(
        "Client seed does not match the committed seed hash.",
        400,
        "INVALID_SEED",
      );
    }
    if (!spin.result) {
      const rolls = perpsRolls({
        serverSeed: spin.serverSeed,
        clientSeed: normalizedSeed,
        spinId: spin.id,
        configHash: spin.configHash,
      });
      spin.clientSeed = normalizedSeed;
      spin.result = drawPerpsSpin({
        markets: spin.markets,
        universe: spin.universe,
        amountCap: spin.amountCap,
        closeSeconds: spin.closeSeconds,
        rolls,
      });
    }
    return {
      spinId: spin.id,
      commit: spin.commit,
      serverSeed: spin.serverSeed,
      clientSeed: spin.clientSeed!,
      configHash: spin.configHash,
      result: spin.result,
    };
  }

  async open(wallet: WalletIdentity, spinId: string): Promise<PerpsOperation> {
    const owner = subjectFor(wallet);
    const spin = this.spins.get(spinId);
    if (!spin || spin.owner !== owner || !spin.result) {
      throw new PerpsError(
        "Reveal the spin first before opening the position.",
        400,
        "INVALID_SPIN",
      );
    }
    if (spin.operationId) {
      const existing = this.operations.get(spin.operationId);
      if (existing) return existing;
    }

    const result = spin.result;
    const rawMark = await this.getMarkPrice(result.market.name);
    const entryPx = Number(rawMark.toPrecision(6));
    const liquidationPx = Number(
      perpsLiquidationPrice(result.side, entryPx, result.leverage).toPrecision(6),
    );
    let size = "1";
    let notional = result.notional;
    try {
      const sized = perpsOrderSize(
        result.notional,
        entryPx,
        result.market.szDecimals,
      );
      size = sized.size;
      notional = Number(sized.notional.toFixed(2));
    } catch {
      size = (result.notional / entryPx).toFixed(
        Math.max(2, result.market.szDecimals),
      );
    }

    const settlement = await this.settleNearTestnetOpen({
      spinId: spin.id,
      trader: wallet.address,
      result,
      entryPx,
    });

    const now = Date.now();
    const op: PerpsOperation = {
      id: spin.id,
      owner,
      network: "testnet",
      spinId: spin.id,
      master: wallet.address,
      agentAddress: settlement.settlementContract,
      market: result.market.name,
      display: result.market.display,
      side: result.side,
      leverage: result.leverage,
      amount: result.amount,
      notional,
      closeSeconds: result.closeSeconds,
      phase: "open",
      orderId: Math.floor(now / 1000),
      entryPx,
      size,
      liquidationPx,
      markPx: entryPx,
      unrealizedPnl: 0,
      openedAt: now,
      closeAt:
        result.closeSeconds !== null ? now + result.closeSeconds * 1000 : undefined,
      txHash: settlement.txHash,
      explorerUrl: settlement.explorerUrl,
      nearPerpsUrl: "https://perps.near.com/",
      hyperliquidPositionUrl: `https://app.hyperliquid-testnet.xyz/trade/${result.market.display}`,
      settlementAccount: settlement.settlementAccount,
      settlementContract: settlement.settlementContract,
      createdAt: now,
      updatedAt: now,
    };

    spin.operationId = op.id;
    this.operations.set(op.id, op);
    return op;
  }

  async close(wallet: WalletIdentity, operationId: string): Promise<PerpsOperation> {
    const owner = subjectFor(wallet);
    const op = this.operations.get(operationId);
    if (!op || op.owner !== owner) {
      throw new PerpsError("Position not found.", 404, "NOT_FOUND");
    }
    if (op.phase === "closed" || op.phase === "liquidated") {
      return op;
    }
    const exitPx = await this.getMarkPrice(op.market);
    const entry = op.entryPx ?? exitPx;
    const sizeNum = Number(op.size ?? 0);
    const rawPnl =
      op.side === "long"
        ? (exitPx - entry) * sizeNum
        : (entry - exitPx) * sizeNum;
    const fees = Number((op.notional * 0.0005).toFixed(4));
    const realizedPnl = Number((rawPnl - fees).toFixed(4));
    const now = Date.now();

    op.phase = "closed";
    op.markPx = exitPx;
    op.exitPx = exitPx;
    op.closedAt = now;
    op.fees = fees;
    op.realizedPnl = realizedPnl;
    op.unrealizedPnl = 0;
    op.updatedAt = now;

    const closeSettlement = await this.settleNearTestnetClose(op, exitPx);
    if (closeSettlement) {
      op.closeTxHash = closeSettlement.txHash;
      op.closeExplorerUrl = closeSettlement.explorerUrl;
    }
    return op;
  }
}
