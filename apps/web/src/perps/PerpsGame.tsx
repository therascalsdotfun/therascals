import { StatusJourney } from "../StatusJourney.tsx";
import { perpsJourney } from "../status-journey.ts";
import { PerpsIcon, PerpsTicker, TokenTicker } from "../TokenMedia.tsx";
import { tokenTicker } from "../../../../packages/shared/src/token-ticker.ts";
import { PerpsTokenPool } from "./PerpsTokenPool.tsx";
import { PerpsFundingQuote } from "./PerpsFundingQuote.tsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowDownRight,
  Dices,
  ArrowRightLeft,
  ArrowUpRight,
  ExternalLink,
  Flame,
  Globe,
  LoaderCircle,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import type {
  PerpsAgentView,
  PerpsCatalogView,
  PerpsNetwork,
  PerpsOperation,
  PerpsSpinResult,
  PerpsUniverse,
} from "../../../../packages/shared/src/perps.ts";
import {
  drawPerpsSpin,
  perpsCommit,
  perpsConfigHash,
  perpsLeverageChoices,
  perpsRolls,
  perpsSeedHash,
  PERPS_SIGNATURE_CHAIN,
} from "../../../../packages/shared/src/perps.ts";
import { useWallets } from "../wallets/Wallets.tsx";
import "./perps.css";

type SpinStart = {
  spinId: string;
  network: PerpsNetwork;
  universe: PerpsUniverse;
  amountCap: number;
  closeSeconds: number | null;
  clientSeedHash: string;
  commit: string;
  configHash: string;
  markets: {
    name: string;
    display: string;
    universe: PerpsUniverse;
    maxLeverage: number;
    leverageChoices: { leverage: number; weight: number }[];
  }[];
};

type Phase = "idle" | "spinning" | "opening" | "open" | "closed" | "revealed";

type Proof = {
  spinId: string;
  commit: string;
  clientSeed: string;
  serverSeed: string;
  configHash: string;
  commitVerified: boolean;
  resultVerified: boolean;
};

const SPIN_MS = 3200;
const CLOSE_OPTIONS: { value: number | null; label: string }[] = [
  { value: 30, label: "30 seconds" },
  { value: 60, label: "60 seconds" },
  { value: 300, label: "5 minutes" },
  { value: null, label: "Hold until I close" },
];

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { method: "GET" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error ?? "Perps request unavailable. Try again.");
  return data as T;
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text || "Perps request unavailable. Try again.";
}

function walletMessage(error: any): string {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED")
    return "Approval cancelled in MetaMask. Nothing was opened.";
  return message(error);
}

function randomSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function usd(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function price(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1000)
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toPrecision(4)}`;
}

export type PerpsGame = ReturnType<typeof usePerpsGame>;

export function usePerpsGame(
  enabled = true,
  expectedNetwork?: PerpsNetwork,
  testnetEnabled = false,
) {
  const { accounts, identity, connect, verify, evm } = useWallets();
  const [networkMode, setNetworkModeState] = useState<PerpsNetwork>(
    () =>
      expectedNetwork ??
      (enabled ? "mainnet" : testnetEnabled ? "testnet" : "mainnet"),
  );
  const userToggledNetwork = useRef(false);
  useEffect(() => {
    if (!testnetEnabled) {
      if (networkMode !== "mainnet") setNetworkModeState("mainnet");
      return;
    }
    if (
      !userToggledNetwork.current &&
      expectedNetwork &&
      expectedNetwork !== networkMode
    ) {
      setNetworkModeState(expectedNetwork);
    }
  }, [expectedNetwork, testnetEnabled, networkMode]);
  const isTestnetRoute = testnetEnabled && networkMode === "testnet";
  const apiBase = isTestnetRoute ? "/api/perps/testnet" : "/api/perps";
  const walletKey = identity
    ? `${networkMode}:${identity.kind}:${identity.address.toLowerCase()}:${identity.chainId ?? ""}`
    : `${networkMode}:guest`;
  const walletKeyRef = useRef(walletKey);
  walletKeyRef.current = walletKey;
  const [catalog, setCatalog] = useState<PerpsCatalogView | null>(null);
  const [agent, setAgent] = useState<PerpsAgentView | null>(null);
  const [operations, setOperations] = useState<PerpsOperation[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [spin, setSpin] = useState<SpinStart | null>(null);
  const [result, setResult] = useState<PerpsSpinResult | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [operation, setOperation] = useState<PerpsOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const universe: PerpsUniverse = "custom";
  const [marketNames, setMarketNames] = useState<string[]>([]);
  const selectedMarkets = useMemo(
    () => (catalog?.markets ?? []).filter((m) => marketNames.includes(m.name)),
    [catalog, marketNames],
  );
  const [amountCap, setAmountCap] = useState(10);
  const [closeSeconds, setCloseSeconds] = useState<number | null>(60);
  const [tick, setTick] = useState(0);
  const spinTimer = useRef<number | null>(null);
  const phaseRef = useRef(phase);
  const busyRef = useRef(busy);
  phaseRef.current = phase;
  busyRef.current = busy;

  const clearSpinTimer = useCallback(() => {
    if (spinTimer.current !== null) window.clearTimeout(spinTimer.current);
    spinTimer.current = null;
  }, []);

  useEffect(() => {
    if (!enabled && !isTestnetRoute) {
      setCatalog(null);
      return;
    }
    let cancelled = false;
    call<PerpsCatalogView>(`${apiBase}/catalog`)
      .then((view) => {
        if (!cancelled) {
          setCatalog(view);
          setError("");
          const defaults = [
            "BTC",
            "ETH",
            "SOL",
            "BNB",
            "SUI",
            "DOGE",
            "kPEPE",
            "WIF",
          ];
          const picks = view.markets.filter((m) => defaults.includes(m.name));
          setMarketNames(
            (picks.length >= 2 ? picks : view.markets.slice(0, 8)).map(
              (m) => m.name,
            ),
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError(message(e));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, isTestnetRoute, apiBase]);

  const refresh = useCallback(async () => {
    if (
      (!enabled && !isTestnetRoute) ||
      !identity ||
      (!isTestnetRoute && identity.kind !== "metamask")
    ) {
      setAgent(null);
      setOperations([]);
      return;
    }
    const scope = walletKeyRef.current;
    try {
      const [nextAgent, nextOperations] = await Promise.all([
        call<PerpsAgentView>(`${apiBase}/agent`),
        call<PerpsOperation[]>(`${apiBase}/positions`),
      ]);
      if (scope !== walletKeyRef.current) return;
      setAgent(nextAgent);
      setOperations(nextOperations);
      const active = nextOperations.find((entry) =>
        ["opening", "open", "closing"].includes(entry.phase),
      );
      if (active) {
        setOperation(active);
        if (phaseRef.current !== "spinning") setPhase("open");
      } else if (
        phaseRef.current === "opening" ||
        phaseRef.current === "open"
      ) {
        setPhase("closed");
      }
    } catch (e) {
      if (scope === walletKeyRef.current) setError(message(e));
    }
  }, [identity, enabled, isTestnetRoute, apiBase]);

  useEffect(() => {
    clearSpinTimer();
    setAgent(null);
    setOperations([]);
    setSpin(null);
    setResult(null);
    setProof(null);
    setOperation(null);
    setPhase("idle");
    setError("");
    void refresh();
  }, [identity, refresh, clearSpinTimer]);

  useEffect(() => {
    if (!identity) return;
    const hasActive =
      phase === "open" ||
      phase === "opening" ||
      operations.some((entry) =>
        ["opening", "open", "closing"].includes(entry.phase),
      );
    if (!hasActive) return;
    const id = window.setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [identity, refresh, phase, operations]);

  useEffect(() => {
    if (!operation?.closeAt && phase !== "open") return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [operation?.closeAt, phase]);

  useEffect(() => () => clearSpinTimer(), [clearSpinTimer]);

  async function connectWallet(preferredKind: "near" | "metamask" | "phantom" = "metamask") {
    setBusy(true);
    setError("");
    try {
      const targetKind = isTestnetRoute
        ? (Object.values(accounts)[0]?.kind ?? preferredKind)
        : "metamask";
      if (!accounts[targetKind]) await connect(targetKind);
      await verify(targetKind);
      await refresh();
    } catch (e) {
      setError(walletMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function setNetworkMode(next: PerpsNetwork) {
    if (busy || phase === "spinning" || phase === "opening") return;
    if (next === "testnet" && !testnetEnabled) return;
    userToggledNetwork.current = true;
    clearSpinTimer();
    setNetworkModeState(next);
    setSpin(null);
    setResult(null);
    setProof(null);
    setOperation(null);
    setPhase("idle");
    setError("");
  }

  async function approveAgent() {
    if (!identity || identity.kind !== "metamask") return;
    if (!evm) {
      setError("MetaMask is not available. Reconnect it and try again.");
      return;
    }
    if (
      accounts.metamask &&
      accounts.metamask.address.toLowerCase() !== identity.address.toLowerCase()
    ) {
      setError("MetaMask switched accounts. Verify the current account again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const chain = await evm.request({ method: "eth_chainId" });
      const expected =
        "0x" +
        PERPS_SIGNATURE_CHAIN[
          catalog?.network ?? expectedNetwork ?? "testnet"
        ].toString(16);
      if (String(chain).toLowerCase() !== expected)
        throw Error(
          "Switch MetaMask to the signing network and verify again before approving the agent.",
        );
      const prepared = await call<{
        agentAddress: string;
        approval: {
          action: { nonce: number };
          typedData: Record<string, unknown>;
        };
      }>("/api/perps/agent/prepare", {});
      const from = accounts.metamask?.address ?? identity.address;
      const signature = await evm.request({
        method: "eth_signTypedData_v4",
        params: [from, JSON.stringify(prepared.approval.typedData)],
      });
      await call<PerpsAgentView>("/api/perps/agent/approve", {
        signature,
        nonce: prepared.approval.action.nonce,
      });
      await refresh();
    } catch (e) {
      setError(walletMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function revokeAgent() {
    if (!identity || identity.kind !== "metamask") return;
    setBusy(true);
    setError("");
    try {
      const revoked = await call<PerpsAgentView>("/api/perps/agent/revoke", {});
      setAgent(revoked);
      setPhase("idle");
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function openSpin(spinId: string) {
    setPhase("opening");
    setBusy(true);
    try {
      const opened = await call<PerpsOperation>(
        `${apiBase}/spin/${spinId}/open`,
        {},
      );
      setOperation(opened);
      if (opened.phase === "failed") {
        setPhase("revealed");
        setError(opened.error ?? "Hyperliquid rejected the order.");
      } else {
        setPhase("open");
      }
      await refresh();
    } catch (e) {
      setPhase("revealed");
      setError(message(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function spinNow() {
    if (busy || phase === "spinning" || phase === "opening") return;
    if (selectedMarkets.length < 2) {
      setError("Add at least 2 tokens to your pool before spinning.");
      return;
    }
    if (!isTestnetRoute && !agent?.approved) {
      setError("Enable one-tap trading first.");
      return;
    }
    if (!isTestnetRoute && (agent?.withdrawable ?? 0) < 5) {
      setError(
        "Not enough available Hyperliquid USDC. Fund the account before spinning.",
      );
      return;
    }
    if (isTestnetRoute && !identity) {
      setError("Connect and verify your wallet first before spinning on Testnet.");
      return;
    }
    clearSpinTimer();
    setBusy(true);
    setError("");
    setOperation(null);
    setResult(null);
    setSpin(null);
    setProof(null);
    setPhase("idle");
    try {
      const clientSeed = randomSeed();
      const started = await call<SpinStart>(`${apiBase}/spin`, {
        universe,
        marketNames: selectedMarkets.map((m) => m.name),
        amountCap,
        closeSeconds,
        clientSeedHash: perpsSeedHash(clientSeed),
      });
      const expected = selectedMarkets.map((m) => m.name).sort();
      if (
        started.universe !== "custom" ||
        started.markets.length !== expected.length ||
        started.markets
          .map((m) => m.name)
          .sort()
          .some((name, i) => name !== expected[i]) ||
        started.amountCap !== amountCap ||
        started.closeSeconds !== closeSeconds
      ) {
        throw new Error(
          "The returned token pool or limits changed. No position was opened. Review your pool and try again.",
        );
      }
      const revealed = await call<{
        result: PerpsSpinResult;
        serverSeed: string;
        clientSeed: string;
        commit: string;
        configHash: string;
      }>(`${apiBase}/spin/${started.spinId}/reveal`, { clientSeed });
      setSpin(started);
      setResult(revealed.result);
      const snapshot = started.markets.map((market) => ({
        name: market.name,
        display: market.display,
        universe: market.universe,
        maxLeverage: market.maxLeverage,
        szDecimals: 0,
      }));
      const configHash = perpsConfigHash({
        universe: started.universe,
        amountCap: started.amountCap,
        closeSeconds: started.closeSeconds,
        markets: snapshot,
      });
      const seedHashVerified =
        perpsSeedHash(clientSeed) === started.clientSeedHash;
      const commitVerified =
        perpsCommit(revealed.serverSeed, started.spinId) === started.commit;
      const rolls = perpsRolls({
        serverSeed: revealed.serverSeed,
        clientSeed,
        spinId: started.spinId,
        configHash: started.configHash,
      });
      const recomputed = drawPerpsSpin({
        markets: snapshot,
        universe: started.universe,
        amountCap: started.amountCap,
        closeSeconds: started.closeSeconds,
        rolls,
      });
      const resultVerified =
        configHash === started.configHash &&
        recomputed.market.name === revealed.result.market.name &&
        recomputed.side === revealed.result.side &&
        recomputed.leverage === revealed.result.leverage &&
        recomputed.amount === revealed.result.amount;
      setProof({
        spinId: started.spinId,
        commit: started.commit,
        clientSeed,
        serverSeed: revealed.serverSeed,
        configHash: revealed.configHash,
        commitVerified,
        resultVerified,
      });
      if (!seedHashVerified || !commitVerified || !resultVerified) {
        setPhase("revealed");
        setError(
          "The spin proof did not verify. No position was opened. Spin again.",
        );
        return;
      }
      setPhase("spinning");
      const wait = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 250
        : SPIN_MS;
      spinTimer.current = window.setTimeout(
        () => void openSpin(started.spinId),
        wait,
      );
    } catch (e) {
      setPhase("idle");
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function closeNow() {
    if (!operation || busy) return;
    setBusy(true);
    setError("");
    try {
      const closed = await call<PerpsOperation>(
        `${apiBase}/positions/${operation.id}/close`,
        {},
      );
      setOperation(closed);
      setPhase(
        closed.phase === "closed" || closed.phase === "liquidated"
          ? "closed"
          : "open",
      );
      await refresh();
    } catch (e) {
      setError(message(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function changePool(names: string[]) {
    if (
      busy ||
      phase === "spinning" ||
      phase === "opening" ||
      phase === "open" ||
      (operation && ["opening", "open", "closing"].includes(operation.phase))
    )
      return;
    setMarketNames(
      [...new Set(names)]
        .filter((name) => catalog?.markets.some((m) => m.name === name))
        .slice(0, 32),
    );
    setSpin(null);
    setResult(null);
    setProof(null);
    setPhase("idle");
  }

  function changeAmountCap(next: number) {
    if (busy || phase === "spinning" || phase === "opening" || phase === "open")
      return;
    setAmountCap(next);
  }

  function changeCloseSeconds(next: number | null) {
    if (busy || phase === "spinning" || phase === "opening" || phase === "open")
      return;
    setCloseSeconds(next);
  }

  const activeOperation =
    operation ??
    operations.find((entry) =>
      ["opening", "open", "closing"].includes(entry.phase),
    ) ??
    agent?.activeOperation ??
    null;
  const manualApproved = isTestnetRoute ? !!identity : !!agent?.approved;
  const canSpin =
    (enabled || isTestnetRoute) &&
    selectedMarkets.length >= 2 &&
    manualApproved &&
    (isTestnetRoute || (agent?.withdrawable ?? 0) >= 5) &&
    !busy &&
    (phase === "idle" || phase === "closed" || phase === "revealed");
  const lastOperation = operations[0] ?? null;

  async function switchSigningNetwork() {
    if (!evm || busy) return;
    setBusy(true);
    setError("");
    try {
      await evm.request({
        method: "wallet_switchEthereumChain",
        params: [
          {
            chainId:
              "0x" +
              PERPS_SIGNATURE_CHAIN[
                catalog?.network ?? expectedNetwork ?? "testnet"
              ].toString(16),
          },
        ],
      });
    } catch (e) {
      setError(walletMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return {
    network: networkMode,
    mainnetEnabled: enabled,
    testnetEnabled,
    testnetRoute: isTestnetRoute,
    setNetworkMode,
    catalog,
    agent,
    operations,
    phase,
    spin,
    result,
    proof,
    operation: activeOperation,
    busy,
    error,
    universe,
    selectedMarkets,
    amountCap,
    closeSeconds,
    tick,
    canSpin,
    lastOperation,
    connectWallet,
    switchSigningNetwork,
    approveAgent,
    revokeAgent,
    spinNow,
    closeNow,
    retryOpen: () => {
      if (spin && proof?.commitVerified && proof.resultVerified)
        void openSpin(spin.spinId);
    },
    refresh,
    changePool,
    changeAmountCap,
    changeCloseSeconds,
    clearError: () => setError(""),
  };
}

const FEATURED_PERP_MARKETS = [
  {
    symbol: "JIO",
    name: "Jio Platforms (India’s biggest IPO)",
    maxLeverage: "10x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid × trade.xyz",
    category: "equity",
    tag: "IPO PERP",
  },
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    maxLeverage: "10x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid × trade.xyz",
    category: "equity",
    tag: "EQUITY PERP",
  },
  {
    symbol: "PEARL",
    name: "Pearl",
    maxLeverage: "10x",
    href: "https://perps.near.com/",
    venue: "NEAR × Hyperliquid",
    category: "ecosystem",
    tag: "NEAR NATIVE",
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    maxLeverage: "40x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid L1",
    category: "major",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    maxLeverage: "40x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid L1",
    category: "major",
  },
  {
    symbol: "SOL",
    name: "Solana",
    maxLeverage: "20x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid L1",
    category: "major",
  },
  {
    symbol: "NEAR",
    name: "NEAR Protocol",
    maxLeverage: "20x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid L1",
    category: "ecosystem",
  },
  {
    symbol: "SUI",
    name: "Sui",
    maxLeverage: "20x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid L1",
    category: "major",
  },
  {
    symbol: "DOGE",
    name: "Dogecoin",
    maxLeverage: "20x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid L1",
    category: "meme",
  },
  {
    symbol: "PEPE",
    name: "Pepe",
    maxLeverage: "10x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid L1",
    category: "meme",
  },
  {
    symbol: "AVAX",
    name: "Avalanche",
    maxLeverage: "20x",
    href: "https://perps.near.com/",
    venue: "Hyperliquid L1",
    category: "major",
  },
];

const MARKET_CATEGORIES = [
  { id: "all", label: "All Markets" },
  { id: "equity", label: "Pre-IPO & Equities" },
  { id: "ecosystem", label: "NEAR Ecosystem" },
  { id: "major", label: "Majors" },
  { id: "meme", label: "Memes" },
];

function PerpsVerificationBox({ op }: { op: PerpsOperation }) {
  const explorerUrl =
    op.explorerUrl ??
    (op.txHash ? `https://testnet.nearblocks.io/txns/${op.txHash}` : undefined);
  const nearPerpsUrl = op.nearPerpsUrl ?? "https://perps.near.com/";
  const hlPositionUrl =
    op.hyperliquidPositionUrl ??
    (op.network === "testnet"
      ? `https://app.hyperliquid-testnet.xyz/trade/${op.display}`
      : `https://app.hyperliquid.xyz/trade/${op.display}`);

  return (
    <div
      className="perps-verification-box"
      role="region"
      aria-label="Rolled Perp Transaction & Position Verification"
    >
      <div className="perps-verification-head">
        <strong>
          <ShieldCheck size={14} /> Position &amp; Explorer Verification (
          {op.display}-PERP {op.side.toUpperCase()} {op.leverage}x · $
          {op.amount})
        </strong>
        <span>
          {op.network === "testnet"
            ? "NEAR Perps Testnet × HL Testnet"
            : "Mainnet"}
        </span>
      </div>
      {op.settlementContract && (
        <p className="perps-verification-sub">
          Settled on NEAR Testnet contract{" "}
          <code>{op.settlementContract}</code> at mark price{" "}
          <b>{price(op.entryPx)}</b>.
        </p>
      )}
      <div className="perps-verification-links">
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="perps-verify-link primary-verify"
          >
            View Open Tx on Explorer (
            {op.txHash ? `${op.txHash.slice(0, 8)}…` : "NearBlocks"}){" "}
            <ExternalLink size={12} />
          </a>
        )}
        {op.closeExplorerUrl && (
          <a
            href={op.closeExplorerUrl}
            target="_blank"
            rel="noreferrer"
            className="perps-verify-link"
          >
            View Close Tx on Explorer (
            {op.closeTxHash ? `${op.closeTxHash.slice(0, 8)}…` : "NearBlocks"}){" "}
            <ExternalLink size={12} />
          </a>
        )}
        <a
          href={nearPerpsUrl}
          target="_blank"
          rel="noreferrer"
          className="perps-verify-link"
        >
          Check Position on NEAR Perps <ExternalLink size={12} />
        </a>
        <a
          href={hlPositionUrl}
          target="_blank"
          rel="noreferrer"
          className="perps-verify-link"
        >
          Check {op.display}-PERP on Hyperliquid{" "}
          {op.network === "testnet" ? "Testnet" : ""}{" "}
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

export function PerpsPage({ game }: { game: PerpsGame }) {
  const [view, setView] = useState<"portal" | "arcade">("portal");
  const [category, setCategory] = useState("all");
  const isTestnet = game.network === "testnet";

  const displayedMarkets = useMemo(() => {
    return category === "all"
      ? FEATURED_PERP_MARKETS
      : FEATURED_PERP_MARKETS.filter((m) => m.category === category);
  }, [category]);

  const latestOp = game.operation ?? game.lastOperation ?? null;

  return (
    <section className="perps-page">
      <div className="perps-top-controls">
        <div
          className="perps-mode-toggle"
          role="tablist"
          aria-label="Perpetuals viewing mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "portal"}
            className={`perps-tab-btn ${view === "portal" ? "active" : ""}`}
            onClick={() => setView("portal")}
          >
            <Flame size={15} /> Confidential Hub (near.com)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "arcade"}
            className={`perps-tab-btn ${view === "arcade" ? "active" : ""}`}
            onClick={() => setView("arcade")}
          >
            <Dices size={15} /> Arcade Slot Mode
          </button>
        </div>

        {game.testnetEnabled && (
          <div
            className="perps-network-switch"
            role="group"
            aria-label="Perps network route"
          >
            <span className="perps-network-label">Route:</span>
            <button
              type="button"
              aria-pressed={isTestnet}
              className={`perps-net-btn ${isTestnet ? "active testnet" : ""}`}
              onClick={() => {
                game.setNetworkMode?.("testnet");
                setView("arcade");
              }}
            >
              Testnet · NEAR Perps × HL Testnet
            </button>
            <button
              type="button"
              aria-pressed={!isTestnet}
              className={`perps-net-btn ${!isTestnet ? "active mainnet" : ""}`}
              onClick={() => game.setNetworkMode?.("mainnet")}
            >
              Mainnet · near.com × HL L1
            </button>
          </div>
        )}
      </div>

      {latestOp && <PerpsVerificationBox op={latestOp} />}

      {view === "portal" ? (
        <div className="perps-portal-hub">
          <div className="perps-hero perps-hub-hero">
            <div>
              <span className="perps-eyebrow">
                RASCALS × NEAR.COM × HYPERLIQUID × TRADE.XYZ
              </span>
              <h1>Trade Perps, Confidentially</h1>
              <p>
                &gt;&gt; Up to 40x leverage across 50+ perpetual markets, 24/7
                pre-IPO equities ($JIO, $RELIANCE), and ecosystem tokens
                ($PEARL). Powered by Hyperliquid &amp; trade.xyz. Fund from any
                chain and any asset through NEAR Intents. Nobody can trace your
                position back to you.
              </p>
            </div>
            <div className="perps-hero-actions">
              {game.testnetEnabled && (
                <button
                  type="button"
                  className="secondary perps-testnet-cta"
                  onClick={() => {
                    game.setNetworkMode?.("testnet");
                    setView("arcade");
                  }}
                >
                  <Dices size={16} /> Roll on Perps Testnet (NEAR × HL)
                </button>
              )}
              <a
                href="https://perps.near.com/"
                target="_blank"
                rel="noreferrer"
                className="primary perps-launch-cta"
              >
                Launch near.com Perps <ArrowUpRight size={16} />
              </a>
            </div>
          </div>

          <div className="perps-features-grid">
            <div className="perps-feature-card">
              <div className="feature-icon-wrap">
                <Flame size={20} />
              </div>
              <h4>Up to 40x Leverage</h4>
              <p>
                Trade majors and trending memecoins with isolated margin,
                dynamic liquidation protection, and custom take profit / stop
                loss levels.
              </p>
            </div>
            <div className="perps-feature-card">
              <div className="feature-icon-wrap">
                <Sparkles size={20} />
              </div>
              <h4>Pre-IPO &amp; Equities 24/7</h4>
              <p>
                Trade India’s biggest IPO ($JIO) and conglomerate equities
                ($RELIANCE) 24/7, out of public view. Powered by trade.xyz HIP-3
                order books on Hyperliquid.
              </p>
            </div>
            <div className="perps-feature-card">
              <div className="feature-icon-wrap">
                <Zap size={20} />
              </div>
              <h4>Cross-Chain via NEAR Intents</h4>
              <p>
                Deposit from 30+ chains (SOL, ETH, BTC, NEAR, USDC). Assets are
                auto-swapped into HyperCore USDC margin without manual bridging.
              </p>
            </div>
            <div className="perps-feature-card">
              <div className="feature-icon-wrap">
                <Lock size={20} />
              </div>
              <h4>Confidential Trading</h4>
              <p>
                Dedicated trading account on Hyperliquid. Deposits and
                withdrawals route through NEAR Intents so positions cannot be
                traced back to you.
              </p>
            </div>
            <div className="perps-feature-card">
              <div className="feature-icon-wrap">
                <Globe size={20} />
              </div>
              <h4>Zero Seed Phrase</h4>
              <p>
                Sign on your device with passkey support. No wallet extensions,
                KYC, or seed phrases to write down. Ready in seconds.
              </p>
            </div>
          </div>

          <div className="perps-markets-section">
            <div className="section-title-wrap">
              <div className="markets-section-header">
                <div>
                  <h3>Featured Perpetual Markets</h3>
                  <p className="disclosure">
                    {isTestnet
                      ? "Testnet route active: roll positions on NEAR Perps Testnet × Hyperliquid Testnet or inspect live markets on perps.near.com."
                      : "Live perpetual contracts settling on Hyperliquid L1 & trade.xyz order books via perps.near.com."}
                  </p>
                </div>
                <div
                  className="market-category-filters"
                  role="tablist"
                  aria-label="Market categories"
                >
                  {MARKET_CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      aria-selected={category === c.id}
                      className={`cat-filter-btn ${category === c.id ? "active" : ""}`}
                      onClick={() => setCategory(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="perps-markets-grid">
              {displayedMarkets.map((m) => (
                <div key={m.symbol} className="perp-market-card">
                  <div className="market-header">
                    <div className="market-brand-wrap">
                      <PerpsIcon symbol={m.symbol} size={28} />
                      <div>
                        <div className="market-symbol-row">
                          <span className="market-symbol">{m.symbol}-PERP</span>
                          {m.tag && (
                            <span className="market-tag-pill">{m.tag}</span>
                          )}
                        </div>
                        <span className="market-name">{m.name}</span>
                      </div>
                    </div>
                    <span className="leverage-pill">{m.maxLeverage}</span>
                  </div>
                  <div className="market-footer">
                    <span className="venue-tag">
                      {isTestnet
                        ? "NEAR Perps × HL Testnet"
                        : (m.venue ?? "Hyperliquid L1")}
                    </span>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {isTestnet && (
                        <a
                          href={`https://app.hyperliquid-testnet.xyz/trade/${m.symbol}`}
                          target="_blank"
                          rel="noreferrer"
                          className="market-trade-link"
                        >
                          HL Testnet <ArrowUpRight size={12} />
                        </a>
                      )}
                      <a
                        href={m.href}
                        target="_blank"
                        rel="noreferrer"
                        className="market-trade-link"
                      >
                        Trade on near.com <ArrowUpRight size={13} />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="perps-calculator-section">
            <div className="section-title-wrap">
              <h3>NEAR Intents Margin Calculator</h3>
              <p className="disclosure">
                Calculate your cross-chain deposit into HyperCore USDC margin
                before entering a position.
              </p>
            </div>
            <PerpsFundingQuote />
          </div>

          <p className="perps-risk">
            <ShieldAlert size={15} /> Leveraged perpetual contracts carry
            substantial risk of loss and liquidation. Trades execute on
            Hyperliquid L1; cross-chain deposits route via NEAR Intents. The
            official portal is accessible at{" "}
            <a
              href="https://perps.near.com/"
              target="_blank"
              rel="noreferrer"
            >
              https://perps.near.com/
            </a>
            .
          </p>
        </div>
      ) : (
        <div className="perps-arcade-hub">
          <div className="perps-hero">
            <div>
              <span className="perps-eyebrow">
                {isTestnet
                  ? "RASCALS × NEAR PERPS TESTNET × HYPERLIQUID TESTNET"
                  : "RASCALS ORIGINALS"}
              </span>
              <h1>Perp slot machine</h1>
              <p>
                {isTestnet
                  ? "Four reels. On-chain NEAR Testnet receipt + live Hyperliquid Testnet mark price."
                  : "Four reels. A little chaos. One Hyperliquid position."}
              </p>
            </div>
            <span className="perps-badge">
              {isTestnet
                ? "NEAR PERPS × HL TESTNET"
                : "HYPERLIQUID · MAINNET"}
            </span>
          </div>
          {!isTestnet && game.mainnetEnabled === false && (
            <div className="perps-note" role="status" style={{ marginBottom: 14 }}>
              Mainnet Perps execution is disabled on this server (no
              Hyperliquid Mainnet credentials configured).{" "}
              {game.testnetEnabled
                ? "Switch Route to Testnet above to run the NEAR × Hyperliquid Testnet arcade."
                : "Use the Confidential Hub tab for near.com markets."}
            </div>
          )}
          <div className="perps-layout">
            <PerpsSlot game={game} />
            <PerpsPanel game={game} />
          </div>
          <PerpsFundingQuote />
          <p className="perps-risk">
            <ShieldAlert size={14} /> Random leverage can erase the stake.
            Hyperliquid enforces a $10 minimum order, isolated margin and
            liquidation. The agent wallet can trade and close but cannot
            withdraw.
          </p>
        </div>
      )}
    </section>
  );
}

export function PerpsSlot({ game }: { game: PerpsGame }) {
  const { phase, spin, result, selectedMarkets, amountCap } = game;
  const usingSpin =
    !!spin && ["spinning", "opening", "open", "revealed"].includes(phase);
  const marketOptions = useMemo(() => {
    if (usingSpin && spin)
      return spin.markets.map((market) => ({
        value: market.display,
        market,
      }));
    return selectedMarkets.map((market) => ({
      value: market.display,
      market: {
        name: market.name,
        display: market.display,
        universe: market.universe,
        maxLeverage: market.maxLeverage,
        leverageChoices: [] as { leverage: number; weight: number }[],
      },
    }));
  }, [usingSpin, spin, selectedMarkets]);
  const sideOptions = ["LONG", "SHORT"];
  const leverageOptions = useMemo(() => {
    const values = new Set<number>();
    if (usingSpin && spin) {
      spin.markets.forEach((market) =>
        market.leverageChoices.forEach((choice) => values.add(choice.leverage)),
      );
    } else {
      selectedMarkets.forEach((market) =>
        perpsLeverageChoices(market.maxLeverage).forEach((choice) =>
          values.add(choice.leverage),
        ),
      );
    }
    if (!values.size) [3, 5, 8, 10, 15, 20, 25].forEach((x) => values.add(x));
    return [...values].sort((a, b) => a - b);
  }, [usingSpin, spin, selectedMarkets]);
  const amountOptions = [5, 10, 25].filter(
    (value) => value <= (usingSpin && spin ? spin.amountCap : amountCap),
  );
  const lists = useMemo<unknown[][]>(
    () => [marketOptions, sideOptions, leverageOptions, amountOptions],
    [marketOptions, leverageOptions, amountCap],
  );
  const targets = useMemo(() => {
    if (!result || !usingSpin) return [0, 0, 0, 0];
    return [
      Math.max(
        0,
        marketOptions.findIndex(
          (option) => option.market?.name === result.market.name,
        ),
      ),
      result.side === "long" ? 0 : 1,
      Math.max(0, leverageOptions.indexOf(result.leverage)),
      Math.max(0, amountOptions.indexOf(result.amount)),
    ];
  }, [result, usingSpin, marketOptions, leverageOptions, amountOptions]);
  const [positions, setPositions] = useState([0, 0, 0, 0]);
  const [stopped, setStopped] = useState([true, true, true, true]);
  const stateRef = useRef({ lists, targets });
  stateRef.current = { lists, targets };

  useEffect(() => {
    const current = stateRef.current;
    if (phase !== "spinning" || !spin) {
      setPositions(result && usingSpin ? current.targets : [0, 0, 0, 0]);
      setStopped([true, true, true, true]);
      return;
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPositions(current.targets);
      setStopped([true, true, true, true]);
      return;
    }
    const intervals: number[] = [];
    const timeouts: number[] = [];
    setStopped([false, false, false, false]);
    for (let reel = 0; reel < 4; reel++) {
      const length = Math.max(1, current.lists[reel]!.length);
      intervals.push(
        window.setInterval(
          () => {
            setPositions((previous) => {
              const next = [...previous];
              next[reel] = Math.floor(Math.random() * length);
              return next;
            });
          },
          70 + reel * 11,
        ),
      );
      timeouts.push(
        window.setTimeout(
          () => {
            window.clearInterval(intervals[reel]!);
            setPositions((previous) => {
              const next = [...previous];
              next[reel] = current.targets[reel]!;
              return next;
            });
            setStopped((previous) => {
              const next = [...previous];
              next[reel] = true;
              return next;
            });
          },
          1450 + reel * 430,
        ),
      );
    }
    return () => {
      intervals.forEach((id) => window.clearInterval(id));
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, [spin?.spinId, phase]);

  const landed = phase !== "idle" && phase !== "spinning";
  const status =
    phase === "spinning"
      ? "Choosing market, side, leverage and stake…"
      : phase === "opening"
        ? "Opening the position on Hyperliquid…"
        : phase === "open" && result
          ? `${tokenTicker(result.market.display)} · ${result.side.toUpperCase()} ${result.leverage}x · ${usd(result.amount, 0)}`
          : phase === "closed" && game.operation
            ? `Round closed · ${game.operation.phase === "liquidated" ? "liquidated" : usd(game.operation.realizedPnl ?? 0)}`
            : phase === "revealed"
              ? "Result locked · open it or spin again"
              : "Set your stake cap, then spin.";

  return (
    <div
      className={`slot-cabinet perps-slot ${phase === "spinning" ? "is-spinning" : ""} ${landed ? "is-landed" : ""}`}
      aria-label="Perps four-reel slot machine"
      data-slot-state={phase}
    >
      <div className="slot-bulbs" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <i key={index} style={{ "--bulb": index } as CSSProperties} />
        ))}
      </div>
      <div className="slot-marquee">
        <span>RASCALS ORIGINALS</span>
        <strong>
          PERPS<span>✦</span>
        </strong>
        <small>FOUR REELS. ONE POSITION.</small>
      </div>
      <div className="slot-reel-labels">
        <span>01 / TOKEN</span>
        <span>02 / SIDE</span>
        <span>03 / LEVERAGE</span>
        <span>04 / STAKE</span>
      </div>
      <div className="slot-windows">
        {lists.map((list, reel) => {
          const position = positions[reel] ?? 0;
          return (
            <div
              key={reel}
              className={`slot-window ${stopped[reel] && phase !== "idle" ? "reel-stopped" : ""}`}
              data-reel={["market", "side", "leverage", "amount"][reel]}
              data-state={
                landed ? "complete" : phase === "spinning" ? "spinning" : "idle"
              }
            >
              <div className="slot-reel-track" aria-hidden="true">
                {[-2, -1, 0, 1, 2].map((offset) => {
                  const index = position + offset;
                  const value: any =
                    list[((index % list.length) + list.length) % list.length];
                  return (
                    <div
                      className="slot-symbol perps-symbol"
                      key={index}
                      style={{ "--reel-y": offset } as CSSProperties}
                    >
                      {reel === 0 ? (
                        <>
                          <strong>
                            <PerpsTicker
                              symbol={value?.value ?? "TOKEN"}
                              size={34}
                            />
                          </strong>
                          <small>
                            {value?.market
                              ? value.market.universe === "meme"
                                ? "HYPERLIQUID · MEME"
                                : "HYPERLIQUID · PERP"
                              : "HYPERLIQUID"}
                          </small>
                        </>
                      ) : reel === 1 ? (
                        <>
                          {value === "SHORT" ? (
                            <ArrowDownRight size={36} />
                          ) : (
                            <ArrowUpRight size={36} />
                          )}
                          <strong
                            className={
                              value === "SHORT" ? "perps-short" : "perps-long"
                            }
                          >
                            {value ?? "—"}
                          </strong>
                          <small>50 / 50</small>
                        </>
                      ) : reel === 2 ? (
                        <>
                          <strong className="perps-lev">
                            {value ? `${value}x` : "—"}
                          </strong>
                          <small>WEIGHTED</small>
                        </>
                      ) : (
                        <>
                          <strong className="slot-money">
                            {value ? `$${value}` : "—"}
                          </strong>
                          <small>USDC STAKE</small>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="slot-payline" aria-hidden="true" />
              <span className="slot-reel-status">
                {phase === "spinning"
                  ? stopped[reel]
                    ? "LOCKED"
                    : "◆"
                  : landed
                    ? "LOCKED"
                    : "READY"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="slot-bottom" role="status">
        {phase === "opening" ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Sparkles size={15} />
        )}
        <span>{status}</span>
        <b>{game.network === "mainnet" ? "MAINNET" : "TESTNET"}</b>
      </div>
    </div>
  );
}

export function PerpsPanel({ game }: { game: PerpsGame }) {
  const { accounts, identity, error: walletIssue } = useWallets();
  const [revokeArmed, setRevokeArmed] = useState(false);
  const isNearTestnet = (game as any).testnetRoute === true;
  const connectedAny = Object.values(accounts)[0];
  const account = isNearTestnet ? connectedAny : accounts.metamask;
  const agent = game.agent;
  const operation = game.operation;
  const busy = game.busy;
  const shownError = game.error || walletIssue;
  const remaining = operation?.closeAt
    ? Math.max(0, Math.ceil((operation.closeAt - Date.now()) / 1000))
    : null;
  const approved = isNearTestnet ? !!identity : !!agent?.approved;
  const revokedAgents = [
    ...(agent?.revokedAgents ?? []),
    ...(agent?.revokedAgent ? [agent.revokedAgent] : []),
  ];
  const removableAgentAddresses = [
    ...new Set([
      ...(approved && agent?.agentAddress ? [agent.agentAddress] : []),
      ...revokedAgents.map((revoked) => revoked.agentAddress),
    ]),
  ];
  const balance = agent?.withdrawable ?? (isNearTestnet ? 1000 : 0);
  const active =
    operation && ["opening", "open", "closing"].includes(operation.phase);

  return (
    <aside className="perps-panel" aria-label="Perps controls">
      <div className="perps-panel-heading">
        <div>
          <span className="perps-eyebrow">
            {isNearTestnet ? "NEAR PERPS × HYPERLIQUID" : "HYPERLIQUID"}
          </span>
          <h2>Perp slot</h2>
        </div>
        <span className="perps-badge small">
          {game.network === "mainnet" ? "MAINNET" : "TESTNET"}
        </span>
      </div>

      <PerpsTokenPool game={game} />

      {!account ? (
        <div className="perps-wallet">
          {isNearTestnet ? (
            <>
              <p>
                Connect your NEAR (Meteor), MetaMask, or Phantom wallet and
                verify ownership first to roll on NEAR Perps Testnet ×
                Hyperliquid Testnet.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void game.connectWallet("near")}
              >
                <Wallet size={15} />
                {busy ? "Connecting…" : "Connect & Verify NEAR Wallet"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void game.connectWallet("metamask")}
              >
                <Wallet size={15} /> Connect MetaMask
              </button>
            </>
          ) : (
            <>
              <p>
                MetaMask is the Hyperliquid signer. Phantom and NEAR wallets
                cannot sign these orders.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void game.connectWallet()}
              >
                <Wallet size={15} />
                {busy ? "Connecting…" : "Connect MetaMask"}
              </button>
            </>
          )}
        </div>
      ) : !identity || (!isNearTestnet && identity.kind !== "metamask") ? (
        <div className="perps-wallet">
          <p>
            {isNearTestnet
              ? `Mandatory step: Verify ${account.address} with a free sign-in message before rolling on Perps Testnet.`
              : `Verify ${account.address.slice(0, 6)}…${account.address.slice(-4)} to load its Hyperliquid account.`}
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void game.connectWallet(account.kind)}
          >
            <ShieldCheck size={15} />
            {busy ? "Verifying…" : "Verify wallet"}
          </button>
        </div>
      ) : !isNearTestnet &&
        !approved &&
        identity.chainId?.toLowerCase() !==
          "0x" + PERPS_SIGNATURE_CHAIN[game.network].toString(16) ? (
        <div className="perps-wallet">
          <p>
            MetaMask must use{" "}
            {game.network === "mainnet" ? "Arbitrum One" : "Arbitrum Sepolia"}{" "}
            for this agent approval. Switching networks does not deposit funds
            or approve trading.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void game.switchSigningNetwork()}
          >
            Switch signing network
          </button>
        </div>
      ) : !approved ? (
        <div className="perps-wallet">
          <div className="perps-account">
            <div>
              <small>
                Available <TokenTicker symbol="USDC" branded size={16} />
              </small>
              <strong>
                {agent
                  ? usd(balance)
                  : game.error
                    ? "Account unavailable"
                    : !isNearTestnet && game.mainnetEnabled === false
                      ? "Mainnet disabled"
                      : "Loading…"}
              </strong>
            </div>
          </div>
          <p>
            Approve a trade-only agent once. It can open and close positions for
            this Hyperliquid account, but it cannot withdraw funds.
          </p>
          <button
            className="primary"
            disabled={busy || !agent || balance < 5}
            onClick={() => void game.approveAgent()}
          >
            <ShieldAlert size={15} />
            {busy
              ? "Waiting for MetaMask…"
              : !agent
                ? !isNearTestnet && game.mainnetEnabled === false
                  ? "Mainnet Perps disabled on server"
                  : "Loading account…"
                : balance < 5
                  ? "Fund Hyperliquid to enable trading"
                  : "Enable one-tap trading"}
          </button>
          <p className="perps-note">
            {game.network === "mainnet"
              ? "Deposit USDC to your Hyperliquid account before enabling trading. "
              : "Fund your Hyperliquid testnet account before enabling trading. "}
            <a
              href={
                game.network === "mainnet"
                  ? "https://app.hyperliquid.xyz"
                  : "https://app.hyperliquid-testnet.xyz/faucet"
              }
              target="_blank"
              rel="noreferrer"
            >
              {game.network === "mainnet"
                ? "Open Hyperliquid"
                : "Open the testnet faucet"}{" "}
              <ExternalLink size={11} />
            </a>
          </p>
        </div>
      ) : (
        <>
          <div className="perps-account">
            <div>
              <small>Available</small>
              <strong>{usd(balance)}</strong>
            </div>
            <div>
              <small>Account value</small>
              <strong>{usd(agent?.accountValue ?? balance)}</strong>
            </div>
            <button
              className="quiet"
              aria-label="Refresh Hyperliquid account"
              disabled={busy}
              onClick={() => void game.refresh()}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {balance < 5 && (
            <p className="perps-note warn">
              Not enough available USDC. Fund your Hyperliquid account before
              spinning.{" "}
              <a
                href={
                  game.network === "mainnet"
                    ? "https://app.hyperliquid.xyz"
                    : "https://app.hyperliquid-testnet.xyz/faucet"
                }
                target="_blank"
                rel="noreferrer"
              >
                {game.network === "mainnet"
                  ? "Open Hyperliquid"
                  : "Open the faucet"}{" "}
                <ExternalLink size={11} />
              </a>
            </p>
          )}

          {!active && (
            <>
              <div className="perps-field">
                <span>Stake cap</span>
                <div
                  className="perps-segment"
                  role="group"
                  aria-label="Stake cap"
                >
                  {[5, 10, 25].map((value) => (
                    <button
                      key={value}
                      aria-pressed={game.amountCap === value}
                      disabled={busy || game.phase === "spinning"}
                      onClick={() => game.changeAmountCap(value)}
                    >
                      ${value}
                    </button>
                  ))}
                </div>
              </div>
              <label className="perps-field">
                <span>Close window</span>
                <select
                  value={
                    game.closeSeconds === null ? "hold" : game.closeSeconds
                  }
                  disabled={busy || game.phase === "spinning"}
                  onChange={(event) =>
                    game.changeCloseSeconds(
                      event.target.value === "hold"
                        ? null
                        : Number(event.target.value),
                    )
                  }
                >
                  {CLOSE_OPTIONS.map((option) => (
                    <option
                      key={option.label}
                      value={option.value === null ? "hold" : option.value}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="perps-note">
                Leverage is weighted around 10x across 3x–50x, then capped by
                each market's Hyperliquid maximum. The stake reel picks $5, $10
                or $25 within your cap.
              </p>
              <button
                className="primary perps-spin"
                disabled={!game.canSpin}
                onClick={() => void game.spinNow()}
              >
                {game.phase === "spinning" ? (
                  <>
                    <LoaderCircle className="spin" size={16} /> Spinning…
                  </>
                ) : game.phase === "opening" ? (
                  <>
                    <LoaderCircle className="spin" size={16} /> Opening…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />{" "}
                    {game.phase === "closed" ? "Spin again" : "Spin & open"}
                  </>
                )}
              </button>
            </>
          )}

          {game.phase === "spinning" && (
            <p className="perps-note">
              The result is already committed. The position opens automatically
              when the reels land.
            </p>
          )}

          {operation && (
            <div className={`perps-position ${operation.phase}`}>
              <StatusJourney
                {...perpsJourney(operation.phase)}
                nodes={[
                  {
                    id: "draw",
                    name: "Draw",
                    label: "Draw",
                    icon: <Dices size={25} />,
                    state: "complete",
                    detail:
                      operation.side.toUpperCase() +
                      " " +
                      operation.leverage +
                      "x",
                  },
                  {
                    id: "venue",
                    name: "Hyperliquid",
                    label: "Hyperliquid",
                    icon: <ArrowRightLeft size={26} />,
                    state: perpsJourney(operation.phase).states[1],
                    detail: operation.network,
                  },
                  {
                    id: "position",
                    name: operation.display,
                    label: operation.display,
                    icon: <PerpsIcon symbol={operation.display} size={32} />,
                    state: perpsJourney(operation.phase).states[2],
                    detail: operation.phase,
                  },
                ]}
              />
              <div className="perps-position-head">
                <strong>
                  <PerpsTicker symbol={operation.display} />{" "}
                  <span
                    className={operation.side === "long" ? "long" : "short"}
                  >
                    {operation.side.toUpperCase()} {operation.leverage}x
                  </span>
                </strong>
                <small>{operation.phase.toUpperCase()}</small>
              </div>
              <dl>
                <div>
                  <dt>Stake</dt>
                  <dd>{usd(operation.amount, 0)}</dd>
                </div>
                <div>
                  <dt>Entry</dt>
                  <dd>{price(operation.entryPx)}</dd>
                </div>
                <div>
                  <dt>Liquidation</dt>
                  <dd>{price(operation.liquidationPx)}</dd>
                </div>
                <div>
                  <dt>Mark</dt>
                  <dd>{price(operation.markPx)}</dd>
                </div>
                {operation.phase === "open" && (
                  <div>
                    <dt>Unrealized</dt>
                    <dd
                      className={
                        (operation.unrealizedPnl ?? 0) >= 0 ? "long" : "short"
                      }
                    >
                      {usd(operation.unrealizedPnl)}
                    </dd>
                  </div>
                )}
                {(operation.phase === "closed" ||
                  operation.phase === "liquidated") && (
                  <>
                    <div>
                      <dt>Exit</dt>
                      <dd>{price(operation.exitPx)}</dd>
                    </div>
                    <div>
                      <dt>Realized</dt>
                      <dd
                        className={
                          (operation.realizedPnl ?? 0) >= 0 ? "long" : "short"
                        }
                      >
                        {usd(operation.realizedPnl)}
                      </dd>
                    </div>
                    <div>
                      <dt>Fees</dt>
                      <dd>{usd(operation.fees)}</dd>
                    </div>
                  </>
                )}
              </dl>
              {operation.phase === "open" && (
                <div className="perps-position-actions">
                  <span>
                    {remaining === null
                      ? "Hold until you close"
                      : remaining > 0
                        ? `Auto-close in ${remaining}s`
                        : "Closing…"}
                  </span>
                  <button
                    className="secondary"
                    disabled={busy || remaining === 0}
                    onClick={() => void game.closeNow()}
                  >
                    {busy ? "Closing…" : "Close now"}
                  </button>
                </div>
              )}
              {operation.phase === "opening" && (
                <p className="perps-note">
                  Waiting for Hyperliquid to confirm the position.
                </p>
              )}
              <PerpsVerificationBox op={operation} />
            </div>
          )}

          {game.phase === "revealed" &&
            game.result &&
            game.proof?.commitVerified &&
            game.proof.resultVerified && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => game.retryOpen()}
              >
                Open{" "}
                <PerpsTicker symbol={game.result.market.display} size={18} />{" "}
                {game.result.side.toUpperCase()} {game.result.leverage}x
              </button>
            )}

          {game.proof && (
            <details className="perps-proof">
              <summary>
                Spin proof{" "}
                <b
                  className={
                    game.proof.commitVerified && game.proof.resultVerified
                      ? "ok"
                      : "bad"
                  }
                >
                  {game.proof.commitVerified && game.proof.resultVerified
                    ? "proof verified"
                    : "proof mismatch"}
                </b>
              </summary>
              <p>
                {game.proof.resultVerified
                  ? "The commit and the derived result both verify."
                  : "The derived result does not match the committed seeds."}
              </p>
              <dl>
                <div>
                  <dt>Commit</dt>
                  <dd>
                    <code>{game.proof.commit}</code>
                  </dd>
                </div>
                <div>
                  <dt>Client seed</dt>
                  <dd>
                    <code>{game.proof.clientSeed}</code>
                  </dd>
                </div>
                <div>
                  <dt>Server seed</dt>
                  <dd>
                    <code>{game.proof.serverSeed}</code>
                  </dd>
                </div>
              </dl>
              <p>
                The server committed to its seed before revealing the result.
                The reels are derived from both seeds and the market snapshot.
              </p>
            </details>
          )}

          {!operation && game.lastOperation && (
            <>
              <p className="perps-note">
                Last round:{" "}
                <PerpsTicker symbol={game.lastOperation.display} size={18} />{" "}
                {game.lastOperation.side.toUpperCase()}{" "}
                {game.lastOperation.leverage}x ·{" "}
                <span
                  className={
                    (game.lastOperation.realizedPnl ?? 0) >= 0 ? "long" : "short"
                  }
                >
                  {usd(game.lastOperation.realizedPnl)}
                </span>
              </p>
              <PerpsVerificationBox op={game.lastOperation} />
            </>
          )}
          {!active && !isNearTestnet && (
            <div className="perps-agent-controls">
              {revokeArmed ? (
                <>
                  <p className="perps-note warn">
                    Jackpot will stop signing orders for this wallet and forget
                    the key. Approve a new agent before spinning again.
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setRevokeArmed(false);
                      void game.revokeAgent();
                    }}
                  >
                    {busy ? "Revoking…" : "Confirm revoke"}
                  </button>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => setRevokeArmed(false)}
                  >
                    Keep the agent
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => setRevokeArmed(true)}
                  >
                    <ShieldAlert size={14} /> Revoke trading agent
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {identity?.kind === "metamask" &&
        agent &&
        removableAgentAddresses.length > 0 && (
          <p className="perps-note muted perps-agent-guidance">
            Hyperliquid has no way to remove an agent by API, so revoking here
            only makes Jackpot forget the key. Also revoke{" "}
            {removableAgentAddresses.map((address, index) => (
              <span key={address}>
                {index > 0 && ", "}
                <code>{address}</code>
              </span>
            ))}{" "}
            in the agent settings of{" "}
            <a
              href={
                agent.network === "mainnet"
                  ? "https://app.hyperliquid.xyz"
                  : "https://app.hyperliquid-testnet.xyz"
              }
              target="_blank"
              rel="noreferrer"
            >
              your Hyperliquid account <ExternalLink size={11} />
            </a>
            .
          </p>
        )}

      {shownError && (
        <p className="perps-error" role="alert">
          {shownError}
        </p>
      )}
      <p className="perps-note muted">
        Orders use isolated margin. A random high-leverage round can be
        liquidated; never stake more than you can lose.
      </p>
    </aside>
  );
}
