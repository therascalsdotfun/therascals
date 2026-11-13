import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export type PerpsNetwork = "testnet" | "mainnet";
export type PerpsUniverse = "perp" | "meme" | "equity" | "custom";
export type PerpsSide = "long" | "short";

export const PERPS_MIN_NOTIONAL = 10;
export const PERPS_DEFAULT_CLOSE_SECONDS = 60;
export const PERPS_MAX_LEVERAGE = 50;
export const PERPS_DEFAULT_AMOUNT_CAP = 10;
export const PERPS_MAX_AMOUNT_CAP = 25;

export const PERPS_SIGNATURE_CHAIN: Record<PerpsNetwork, number> = {
  testnet: 421614,
  mainnet: 42161,
};

export const PERPS_MAJOR_MARKETS = Object.freeze([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "AVAX",
  "LINK",
  "LTC",
  "SUI",
  "APT",
  "ARB",
  "OP",
]);

export const PERPS_MEME_MARKETS = Object.freeze([
  "DOGE",
  "kPEPE",
  "WIF",
  "BOME",
  "POPCAT",
  "TURBO",
  "BRETT",
  "MEW",
  "PENGU",
  "FARTCOIN",
  "TRUMP",
  "MEME",
  "PEARL",
]);

export const PERPS_EQUITY_MARKETS = Object.freeze([
  "xyz:JIO",
  "xyz:RELIANCE",
  "JIO",
  "RELIANCE",
]);

export const PERPS_LEVERAGE_TIERS = Object.freeze(
  [
    { leverage: 3, weight: 2500 },
    { leverage: 5, weight: 2000 },
    { leverage: 8, weight: 1500 },
    { leverage: 10, weight: 1200 },
    { leverage: 15, weight: 1000 },
    { leverage: 20, weight: 800 },
    { leverage: 25, weight: 500 },
    { leverage: 30, weight: 300 },
    { leverage: 40, weight: 150 },
    { leverage: 50, weight: 50 },
  ].map((choice) => Object.freeze(choice)),
);

export const PERPS_AMOUNT_TIERS = Object.freeze(
  [
    { amount: 5, weight: 5000 },
    { amount: 10, weight: 3500 },
    { amount: 25, weight: 1500 },
  ].map((choice) => Object.freeze(choice)),
);

export type PerpsMarket = {
  name: string;
  display: string;
  universe: PerpsUniverse;
  maxLeverage: number;
  szDecimals: number;
};

export type PerpsMetaMarket = {
  name: string;
  maxLeverage: number;
  szDecimals: number;
};

export type PerpsRolls = {
  market: number;
  side: number;
  leverage: number;
  amount: number;
};

export type PerpsSpinConfig = {
  universe: PerpsUniverse;
  amountCap: number;
  closeSeconds: number | null;
  markets: PerpsMarket[];
};

export type PerpsSpinResult = {
  market: PerpsMarket;
  side: PerpsSide;
  leverage: number;
  amount: number;
  notional: number;
  closeSeconds: number | null;
};

export function perpsDisplayName(name: string): string {
  if (name.startsWith("xyz:")) return name.slice(4);
  return name === "kPEPE" ? "PEPE" : name;
}

export function classifyPerpsMarkets(
  metaMarkets: PerpsMetaMarket[],
): PerpsMarket[] {
  const byName = new Map(metaMarkets.map((market) => [market.name, market]));
  const output: PerpsMarket[] = [];
  const seen = new Set<string>();
  const add = (names: readonly string[], universe: PerpsUniverse) => {
    for (const name of names) {
      const meta = byName.get(name) ?? byName.get(`xyz:${name}`);
      if (!meta) continue;
      const display = perpsDisplayName(meta.name);
      if (seen.has(display)) continue;
      seen.add(display);
      output.push({
        name: meta.name,
        display,
        universe,
        maxLeverage: meta.maxLeverage,
        szDecimals: meta.szDecimals,
      });
    }
  };
  add(PERPS_MAJOR_MARKETS, "perp");
  add(PERPS_MEME_MARKETS, "meme");
  add(PERPS_EQUITY_MARKETS, "equity");
  return output;
}

export function perpsMarketsFor(
  markets: readonly PerpsMarket[],
  universe: PerpsUniverse,
): PerpsMarket[] {
  return universe === "custom"
    ? [...markets]
    : markets.filter((market) => market.universe === universe);
}

export function weightedChoice<T>(
  choices: readonly { value: T; weight: number }[],
  roll: number,
): T {
  if (!choices.length) throw Error("No eligible choices");
  if (!Number.isInteger(roll) || roll < 0 || roll >= 10_000)
    throw Error("Roll must be an integer in 0..9999");
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  if (total <= 0 || choices.some((choice) => choice.weight < 0))
    throw Error("Invalid choice weights");
  let boundary = (roll * total) / 10_000;
  for (const choice of choices) {
    if (boundary < choice.weight) return choice.value;
    boundary -= choice.weight;
  }
  return choices[choices.length - 1]!.value;
}

export function perpsLeverageChoices(maxLeverage: number) {
  const cap = Math.max(1, Math.min(maxLeverage, PERPS_MAX_LEVERAGE));
  const allowed = PERPS_LEVERAGE_TIERS.filter(
    (choice) => choice.leverage <= cap,
  );
  if (allowed.length) return allowed;
  return [{ leverage: cap, weight: 10_000 }];
}

export function perpsAmountChoices(capDollars: number) {
  const cap = Math.floor(capDollars);
  if (!Number.isFinite(cap) || cap < 5)
    throw Error("Amount cap must be at least $5");
  const allowed = PERPS_AMOUNT_TIERS.filter((choice) => choice.amount <= cap);
  if (allowed.length) return allowed;
  return [{ amount: Math.min(5, cap), weight: 10_000 }];
}

export function perpsExpectedLeverage(maxLeverage: number): number {
  const choices = perpsLeverageChoices(maxLeverage);
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  return (
    choices.reduce(
      (sum, choice) => sum + (choice.leverage * choice.weight) / total,
      0,
    ) || 0
  );
}

export function drawPerpsSpin(args: {
  markets: readonly PerpsMarket[];
  universe: PerpsUniverse;
  amountCap: number;
  closeSeconds: number | null;
  rolls: PerpsRolls;
}): PerpsSpinResult {
  const pool = perpsMarketsFor(args.markets, args.universe);
  if (!pool.length) throw Error("No markets for this universe");
  const market = weightedChoice<PerpsMarket>(
    pool.map((value) => ({ value, weight: 1 })),
    args.rolls.market,
  );
  const side = weightedChoice<PerpsSide>(
    [
      { value: "long", weight: 5000 },
      { value: "short", weight: 5000 },
    ],
    args.rolls.side,
  );
  const leverage = weightedChoice<number>(
    perpsLeverageChoices(market.maxLeverage).map((choice) => ({
      value: choice.leverage,
      weight: choice.weight,
    })),
    args.rolls.leverage,
  );
  const amount = weightedChoice<number>(
    perpsAmountChoices(args.amountCap).map((choice) => ({
      value: choice.amount,
      weight: choice.weight,
    })),
    args.rolls.amount,
  );
  const notional = amount * leverage;
  if (notional < PERPS_MIN_NOTIONAL)
    throw Error("Position is below Hyperliquid's $10 minimum");
  return {
    market,
    side,
    leverage,
    amount,
    notional,
    closeSeconds: args.closeSeconds,
  };
}

export function perpsConfigHash(config: PerpsSpinConfig): string {
  return sha256Hex(
    JSON.stringify({
      v: 1,
      universe: config.universe,
      amountCap: config.amountCap,
      closeSeconds: config.closeSeconds,
      markets: config.markets
        .map((market) => [market.name, market.maxLeverage])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    }),
  );
}

export function perpsCommit(serverSeed: string, spinId: string): string {
  if (!/^[0-9a-f]{64}$/i.test(serverSeed))
    throw Error("Server seed must be 32 bytes of hex");
  return sha256Hex(`jackpot-perps|${spinId}|${serverSeed}`);
}

/** The client commits to its seed before the server seed is revealed. */
export function perpsSeedHash(seed: string): string {
  if (!/^[0-9a-f]{64}$/i.test(seed))
    throw Error("Client seed must be 32 bytes of hex");
  return sha256Hex(`jackpot-perps-seed|${seed}`);
}

export function perpsRolls(args: {
  serverSeed: string;
  clientSeed: string;
  spinId: string;
  configHash: string;
}): PerpsRolls {
  const hash = sha256(
    utf8ToBytes(
      `jackpot-perps-result|${args.spinId}|${args.serverSeed}|${args.clientSeed}|${args.configHash}`,
    ),
  );
  const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
  return {
    market: view.getUint32(0) % 10_000,
    side: view.getUint32(4) % 10_000,
    leverage: view.getUint32(8) % 10_000,
    amount: view.getUint32(12) % 10_000,
  };
}

export function perpsCommitValid(args: {
  serverSeed: string;
  spinId: string;
  commit: string;
}): boolean {
  return perpsCommit(args.serverSeed, args.spinId) === args.commit;
}

export function perpsLiquidationPrice(
  side: PerpsSide,
  entryPrice: number,
  leverage: number,
): number {
  if (!(entryPrice > 0) || !(leverage > 0))
    throw Error("Entry price and leverage must be positive");
  const move = 1 / leverage;
  return side === "long"
    ? Math.max(0, entryPrice * (1 - move))
    : entryPrice * (1 + move);
}

export function perpsOrderSize(
  notional: number,
  price: number,
  szDecimals: number,
): { size: string; notional: number } {
  if (!(notional > 0) || !(price > 0))
    throw Error("Notional and price must be positive");
  const factor = 10 ** szDecimals;
  const units = Math.floor((notional / price) * factor) / factor;
  if (!(units > 0)) throw Error("Position size rounds to zero");
  const size = units.toFixed(szDecimals);
  const rounded = Number(size) * price;
  if (rounded < PERPS_MIN_NOTIONAL)
    throw Error("Position is below Hyperliquid's $10 minimum");
  return { size, notional: rounded };
}

export function perpsLimitPrice(
  markPrice: number,
  side: PerpsSide,
  slippageBps = 100,
  szDecimals = 0,
): string {
  if (!(markPrice > 0) || slippageBps < 0 || slippageBps > 1000)
    throw Error("Invalid mark price or slippage");
  const raw =
    markPrice *
    (side === "long" ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000);
  const significant = Number(raw.toPrecision(5));
  const decimals = Math.max(0, 6 - Math.max(0, szDecimals));
  const tick = 10 ** -decimals;
  const steps = significant / tick;
  let rounded = (side === "long" ? Math.ceil(steps) : Math.floor(steps)) * tick;
  if (!(rounded > 0)) rounded = tick;
  const fixed = rounded.toFixed(decimals);
  return fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
}

/** Hyperliquid accepts at most five significant figures for perp prices. */
export function perpsPriceString(value: number): string {
  if (!(value > 0)) throw Error("Price must be positive");
  const rounded = Number(value.toPrecision(5));
  return new Intl.NumberFormat("en-US", {
    useGrouping: false,
    maximumFractionDigits: 20,
  }).format(rounded);
}

export type PerpsOperationPhase =
  "opening" | "open" | "closing" | "closed" | "failed" | "liquidated";

export type PerpsOperation = {
  id: string;
  owner: string;
  network: PerpsNetwork;
  spinId: string;
  master: string;
  agentAddress: string;
  market: string;
  display: string;
  side: PerpsSide;
  leverage: number;
  amount: number;
  notional: number;
  closeSeconds: number | null;
  phase: PerpsOperationPhase;
  orderId?: number;
  entryPx?: number;
  size?: string;
  liquidationPx?: number;
  markPx?: number;
  unrealizedPnl?: number;
  openedAt?: number;
  closeAt?: number;
  closedAt?: number;
  exitPx?: number;
  realizedPnl?: number;
  fees?: number;
  error?: string;
  txHash?: string;
  explorerUrl?: string;
  closeTxHash?: string;
  closeExplorerUrl?: string;
  nearPerpsUrl?: string;
  hyperliquidPositionUrl?: string;
  settlementAccount?: string;
  settlementContract?: string;
  createdAt: number;
  updatedAt: number;
};

export type PerpsPositionView = {
  coin: string;
  size: number;
  entryPx: number;
  liquidationPx: number | null;
  unrealizedPnl: number;
  marginUsed: number;
  leverage: number;
};

export type PerpsAgentView = {
  network: PerpsNetwork;
  master: string;
  agentAddress: string | null;
  approved: boolean;
  revokedAgent: PerpsRevokedAgent | null;
  revokedAgents: PerpsRevokedAgent[];
  accountValue: number;
  withdrawable: number;
  positions: PerpsPositionView[];
  activeOperation: PerpsOperation | null;
};

/**
 * An agent key Jackpot forgot for this wallet. Hyperliquid has no
 * master-signed removal, so the approval itself is only gone once the owner
 * revokes this address in their own agent settings.
 */
export type PerpsRevokedAgent = {
  owner: string;
  network: PerpsNetwork;
  master: string;
  agentAddress: string;
  revokedAt: number;
};

export type PerpsCatalogView = {
  network: PerpsNetwork;
  markets: PerpsMarket[];
  minNotional: number;
  defaultAmountCap: number;
  maxAmountCap: number;
  defaultCloseSeconds: number;
  closeOptions: (number | null)[];
};

export type PerpsAgentApproval = {
  action: {
    type: "approveAgent";
    signatureChainId: string;
    hyperliquidChain: "Mainnet" | "Testnet";
    agentAddress: string;
    agentName: string;
    nonce: number;
  };
  typedData: {
    domain: {
      name: "HyperliquidSignTransaction";
      version: "1";
      chainId: number;
      verifyingContract: "0x0000000000000000000000000000000000000000";
    };
    types: {
      EIP712Domain: { name: string; type: string }[];
      "HyperliquidTransaction:ApproveAgent": { name: string; type: string }[];
    };
    primaryType: "HyperliquidTransaction:ApproveAgent";
    message: {
      hyperliquidChain: "Mainnet" | "Testnet";
      agentAddress: string;
      agentName: string;
      nonce: number;
    };
  };
};

export function perpsAgentApproval(args: {
  network: PerpsNetwork;
  agentAddress: string;
  nonce: number;
  agentName?: string;
}): PerpsAgentApproval {
  if (!/^0x[0-9a-f]{40}$/i.test(args.agentAddress))
    throw Error("Agent address must be a 20-byte hex address");
  const agentName = args.agentName ?? "jackpot";
  if (agentName.length < 1 || agentName.length > 16)
    throw Error("Agent name must be 1..16 characters");
  const chainId = PERPS_SIGNATURE_CHAIN[args.network];
  const hyperliquidChain = args.network === "testnet" ? "Testnet" : "Mainnet";
  const agentAddress = args.agentAddress.toLowerCase();
  return {
    action: {
      type: "approveAgent",
      signatureChainId: `0x${chainId.toString(16)}`,
      hyperliquidChain,
      agentAddress,
      agentName,
      nonce: args.nonce,
    },
    typedData: {
      domain: {
        name: "HyperliquidSignTransaction",
        version: "1",
        chainId,
        verifyingContract: "0x0000000000000000000000000000000000000000",
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        "HyperliquidTransaction:ApproveAgent": [
          { name: "hyperliquidChain", type: "string" },
          { name: "agentAddress", type: "address" },
          { name: "agentName", type: "string" },
          { name: "nonce", type: "uint64" },
        ],
      },
      primaryType: "HyperliquidTransaction:ApproveAgent",
      message: {
        hyperliquidChain,
        agentAddress,
        agentName,
        nonce: args.nonce,
      },
    },
  };
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}
