import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { Signature, Wallet } from "ethers";
import {
  classifyPerpsMarkets,
  type PerpsMarket,
  type PerpsNetwork,
  type PerpsSide,
} from "../../../../packages/shared/src/perps.ts";
import type { PerpsAgentApproval } from "../../../../packages/shared/src/perps.ts";

export type VenuePosition = {
  coin: string;
  size: number;
  entryPx: number;
  liquidationPx: number | null;
  unrealizedPnl: number;
  marginUsed: number;
  leverage: number;
};

export type VenueAccount = {
  accountValue: number;
  withdrawable: number;
  positions: VenuePosition[];
};

export type VenueOrderResult = {
  status: "filled" | "resting" | "pending" | "failed";
  oid?: number;
  avgPx?: number;
  totalSz?: number;
  error?: string;
};

export type VenueFill = {
  coin: string;
  px: number;
  sz: number;
  side: "B" | "A";
  closedPnl: number;
  fee: number;
  time: number;
  dir: string;
  liquidation: boolean;
};

export interface HyperliquidVenue {
  network: PerpsNetwork;
  markets(): Promise<PerpsMarket[]>;
  market(coin: string): Promise<{ market: PerpsMarket; index: number } | null>;
  markPrice(coin: string): Promise<number>;
  account(master: string): Promise<VenueAccount>;
  agentApproved(master: string, agent: string): Promise<boolean>;
  approveAgent(approval: PerpsAgentApproval, signature: string): Promise<void>;
  updateLeverage(args: {
    agentKey: string;
    assetIndex: number;
    leverage: number;
  }): Promise<void>;
  placeOrder(args: {
    agentKey: string;
    assetIndex: number;
    side: PerpsSide;
    size: string;
    limitPx: string;
    reduceOnly: boolean;
  }): Promise<VenueOrderResult>;
  fills(master: string, since: number): Promise<VenueFill[]>;
}

type MetaCache = {
  at: number;
  byName: Map<
    string,
    { index: number; name: string; maxLeverage: number; szDecimals: number }
  >;
  markets: PerpsMarket[];
};

export class HyperliquidClient implements HyperliquidVenue {
  readonly transport: HttpTransport;
  readonly info: InfoClient;
  private cache: MetaCache | null = null;

  constructor(readonly network: PerpsNetwork) {
    this.transport = new HttpTransport({ isTestnet: network === "testnet" });
    this.info = new InfoClient({ transport: this.transport });
  }

  private async meta(): Promise<MetaCache> {
    if (this.cache && Date.now() - this.cache.at < 300_000) return this.cache;
    const response = await this.info.meta();
    const byName = new Map<
      string,
      { index: number; name: string; maxLeverage: number; szDecimals: number }
    >();
    response.universe.forEach((asset, index) => {
      if (asset.isDelisted) return;
      byName.set(asset.name, {
        index,
        name: asset.name,
        maxLeverage: asset.maxLeverage,
        szDecimals: asset.szDecimals,
      });
    });
    try {
      const xyz = (await this.info.meta({ dex: "xyz" } as any)) as {
        universe?: {
          name: string;
          maxLeverage: number;
          szDecimals: number;
          isDelisted?: boolean;
        }[];
      };
      xyz?.universe?.forEach((asset, index) => {
        if (asset.isDelisted) return;
        byName.set(asset.name, {
          index: 10000 + index,
          name: asset.name,
          maxLeverage: asset.maxLeverage,
          szDecimals: asset.szDecimals,
        });
      });
    } catch {
      // HIP-3 dex is optional
    }
    const markets = classifyPerpsMarkets([...byName.values()]);
    this.cache = { at: Date.now(), byName, markets };
    return this.cache;
  }

  async markets(): Promise<PerpsMarket[]> {
    return [...(await this.meta()).markets];
  }

  async market(coin: string) {
    const meta = await this.meta();
    const raw = meta.byName.get(coin) ?? meta.byName.get(`xyz:${coin}`);
    if (!raw) return null;
    const market = meta.markets.find(
      (entry) => entry.name === raw.name || entry.display === coin,
    );
    return market ? { market, index: raw.index } : null;
  }

  async markPrice(coin: string): Promise<number> {
    const isXyz =
      coin.startsWith("xyz:") || coin === "JIO" || coin === "RELIANCE";
    if (isXyz) {
      try {
        const xyzMids = (await this.info.allMids({ dex: "xyz" } as any)) as Record<
          string,
          string
        >;
        const raw = xyzMids[coin] ?? xyzMids[`xyz:${coin}`];
        const px = Number(raw);
        if (Number.isFinite(px) && px > 0) return px;
      } catch {
        // fall through to default allMids
      }
    }
    const mids = await this.info.allMids();
    const price = Number(mids[coin]);
    if (!Number.isFinite(price) || price <= 0)
      throw Error(`No Hyperliquid mark price for ${coin}`);
    return price;
  }

  // A failed read must not look like an empty account: callers decide whether a
  // position is open, whether funds are available, and whether a close already
  // happened. An unreported new address is a valid state; an RPC error is not.
  async account(master: string): Promise<VenueAccount> {
    const state = await this.info.clearinghouseState({
      user: master as `0x${string}`,
    });
    const numeric = (value: unknown) => {
      if (
        (typeof value !== "string" && typeof value !== "number") ||
        String(value).trim() === "" ||
        !Number.isFinite(Number(value))
      )
        throw Error("Malformed Hyperliquid account balance");
      return Number(value);
    };
    return {
      accountValue: numeric(state.marginSummary.accountValue),
      withdrawable: numeric(state.withdrawable),
      positions: state.assetPositions
        .map(({ position }) => ({
          coin: position.coin,
          size: Number(position.szi) || 0,
          entryPx: Number(position.entryPx) || 0,
          liquidationPx:
            position.liquidationPx === null
              ? null
              : Number(position.liquidationPx),
          unrealizedPnl: Number(position.unrealizedPnl) || 0,
          marginUsed: Number(position.marginUsed) || 0,
          leverage: position.leverage.value,
        }))
        .filter((position) => position.size !== 0),
    };
  }

  // Deliberate unlike account(): an unreadable answer here must not count as
  // approval, so failing closed is correct even though it reads as "not enabled".
  async agentApproved(master: string, agent: string): Promise<boolean> {
    try {
      const agents = await this.info.extraAgents({
        user: master as `0x${string}`,
      });
      return agents.some(
        (entry) => entry.address.toLowerCase() === agent.toLowerCase(),
      );
    } catch {
      return false;
    }
  }

  async approveAgent(
    approval: PerpsAgentApproval,
    signature: string,
  ): Promise<void> {
    const parts = Signature.from(signature);
    const response = (await this.transport.request(
      "exchange",
      {
        action: approval.action,
        signature: { r: parts.r, s: parts.s, v: parts.v },
        nonce: approval.action.nonce,
      },
      undefined,
    )) as { status?: string; response?: unknown };
    if (response.status !== "ok")
      throw Error(
        `Hyperliquid rejected the agent approval: ${JSON.stringify(response.response)}`,
      );
  }

  private exchange(agentKey: string) {
    return new ExchangeClient({
      transport: this.transport,
      wallet: new Wallet(agentKey),
    });
  }

  async updateLeverage(args: {
    agentKey: string;
    assetIndex: number;
    leverage: number;
  }): Promise<void> {
    await this.exchange(args.agentKey).updateLeverage({
      asset: args.assetIndex,
      isCross: false,
      leverage: args.leverage,
    });
  }

  async placeOrder(args: {
    agentKey: string;
    assetIndex: number;
    side: PerpsSide;
    size: string;
    limitPx: string;
    reduceOnly: boolean;
  }): Promise<VenueOrderResult> {
    const response = (await this.exchange(args.agentKey).order({
      orders: [
        {
          a: args.assetIndex,
          b: args.side === "long",
          p: args.limitPx,
          s: args.size,
          r: args.reduceOnly,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    })) as {
      response?: {
        data?: {
          statuses?: (
            | {
                filled: { oid: number; avgPx: string; totalSz: string };
              }
            | { resting: { oid: number } }
            | { error: string }
            | string
          )[];
        };
      };
    };
    const status = response?.response?.data?.statuses?.[0];
    if (!status) return { status: "pending" };
    if (typeof status === "string") return { status: "pending" };
    if ("filled" in status)
      return {
        status: "filled",
        oid: status.filled.oid,
        avgPx: Number(status.filled.avgPx),
        totalSz: Number(status.filled.totalSz),
      };
    if ("resting" in status)
      return { status: "resting", oid: status.resting.oid };
    if ("error" in status) return { status: "failed", error: status.error };
    return { status: "pending" };
  }

  async fills(master: string, since: number): Promise<VenueFill[]> {
    const fills = await this.info.userFills({
      user: master as `0x${string}`,
      aggregateByTime: true,
    });
    return fills
      .filter((fill) => fill.time >= since)
      .map((fill) => ({
        coin: fill.coin,
        px: Number(fill.px) || 0,
        sz: Number(fill.sz) || 0,
        side: fill.side,
        closedPnl: Number(fill.closedPnl) || 0,
        fee: (Number(fill.fee) || 0) + (Number(fill.builderFee) || 0),
        time: fill.time,
        dir: fill.dir,
        liquidation: !!fill.liquidation,
      }));
  }
}
