import { RascalMark, RascalWorld, RascalStickers } from "./RascalWorld.tsx";
import { tokenTicker } from "../../../packages/shared/src/token-ticker.ts";
import { accessibleToken } from "../../../packages/shared/src/chain-access.ts";
import type { IntentsCatalog } from "../../../packages/shared/src/intents.ts";
import type { SettleReport } from "./lottery/release-clock.ts";
import { LoadingSkeleton } from "./LoadingSkeleton.tsx";
import {
  discoveryLoading,
  type DiscoveryRequest,
} from "./discovery-loading.ts";
import {
  chainsForRoll,
  type RollStyle,
} from "../../../packages/shared/src/roll-chain-selection.ts";
import { responseMatchesWallet } from "./wallets/response-scope.ts";
import {
  TokenPoolEditor,
  ChainPicker,
  ChainPoolStatus,
} from "./TokenPoolEditor.tsx";
import {
  selectedChains,
  chainName,
  tokenChain,
  tokenKey,
  tokenExplorer,
} from "../../../packages/shared/src/token-selection.ts";
import { SlotMachine } from "./rolling/SlotMachine.tsx";
import { DrawOutcome } from "./DrawOutcome.tsx";
import { useMarketEnergy } from "./useMarketEnergy.ts";
import { WalletLogo } from "./Icons.tsx";
import {
  Wallet,
  Code2,
  Dices,
  ChartNoAxesCombined,
  BriefcaseBusiness,
  SlidersHorizontal,
  Activity,
  Pause,
  Play,
  Volume2,
  VolumeX,
  ChevronDown,
  Clock3,
  Coins,
  Info,
  PackageOpen,
  CircleDot,
  Flame,
  ShieldCheck,
  Megaphone,
  Globe,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  FilterSpec,
  MarketResponse,
  TokenObservation,
} from "../../../packages/shared/src/market.ts";
import { decodeFilterCode } from "../../../packages/shared/src/filter-code.ts";
import { RevealCelebration } from "./lottery/RevealCelebration.tsx";
import { Cage } from "./lottery/Cage.tsx";
import { CaseOpening } from "./rolling/CaseOpening.tsx";
import {
  DEGEN_AMOUNTS,
  DEGEN_ODDS_VERSION,
} from "../../../packages/shared/src/degen-amount.ts";
import { dexChartUrl } from "./dex-chart.ts";
import { SourceChart } from "./SourceChart.tsx";
import { TradeChartFlow } from "./TradeChartFlow.tsx";
import { Portfolio } from "./Portfolio.tsx";
import { PromoteToken } from "./PromoteToken.tsx";
import { RewardTierBar } from "./rewards/RewardTierBar.tsx";
import {
  RewardsPage,
  RewardsChip,
  RewardNotice,
} from "./rewards/RewardsPage.tsx";
import {
  RascalPromotionTag,
  PointsSpotlights,
} from "./rewards/PointsPromotions.tsx";
import { MainnetTrading } from "./MainnetTrading.tsx";
import {
  initialReleaseNetwork,
  type AppNetwork,
} from "../../../packages/shared/src/app-network.ts";
import { useWallets, WalletConnections } from "./wallets/Wallets.tsx";
import { filterChangeAllowed } from "./filter-input.ts";
import { ActivityBar } from "./ActivityBar.tsx";
import { displayPrice } from "./display-price.ts";
import { TokenIcon, TokenTicker } from "./TokenMedia.tsx";
import {
  drawReadiness,
  PromotionTag,
  RiskBadge,
  DrawdownBadge,
  IdentityTag,
} from "./TokenScreening.tsx";
import { MemeTypePicker } from "./DiscoveryControls.tsx";
import { PerpsPage, usePerpsGame } from "./perps/PerpsGame.tsx";
import { AdvancedTrading } from "./AdvancedTrading.tsx";
import { presetFor } from "../../../packages/shared/src/discovery-presets.ts";
import { FilterSettings } from "./FilterSettings.tsx";
import {
  JustHootChartView,
  JustHootDrawControl,
  JustHootLeaderboardTable,
} from "./JustHootDraw.tsx";
import {
  JUSTHOOT_ALL_LEADERBOARD_KEYS,
  JUSTHOOT_DEFAULT_TOP3_KEYS,
  findJustHootEntry,
  justHootTokenObservations,
} from "../../../packages/shared/src/justhoot-tokens.ts";
import {
  inferMemeTypes,
  MEME_TYPES,
} from "../../../packages/shared/src/meme-types.ts";
import "./style.css";
import "./draw-polish.css";
import "./rascals.css";
import "./status-theme.css";
import "./rewards/scorebook.css";
import "./portfolio/portfolio-table.css";
const compact = (v: number | null) =>
  v === null
    ? "Unknown"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(v);
const dollars = (v: number | null) =>
  v === null ? "Unknown" : "$" + compact(v);
const short = (s: string) => s.slice(0, 5) + "…" + s.slice(-5);
const walletAddressLabel = (address: string) =>
  address.length <= 18 ? address : short(address);
const walletChainLabel = (wallet: { kind: string; chainId?: string }) =>
  wallet.kind === "near"
    ? "NEAR"
    : wallet.kind === "phantom"
      ? "Solana"
      : ({ "0x1": "Ethereum", "0x2105": "Base", "0x38": "BNB" } as const)[
          (wallet.chainId?.toLowerCase() ?? "") as "0x1"
        ] ?? "EVM";
const age = (s: string | null) =>
  !s
    ? "Unknown"
    : Math.max(0, Math.floor((Date.now() - Date.parse(s)) / 60000)) + "m";
const readable = (s: string) => s.replaceAll("_", " ");
const SAVED_DISCOVERY_KEY = "rascals-saved-discovery-v1";
type SavedDiscoveryState = {
  ticket: string;
  preset: string;
  filters?: FilterSpec;
  presetId?: string | null;
};
function readSavedDiscovery(): SavedDiscoveryState | null {
  try {
    const raw = localStorage.getItem(SAVED_DISCOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ticket: typeof parsed.ticket === "string" ? parsed.ticket : "5",
      preset: typeof parsed.preset === "string" ? parsed.preset : "strict",
      filters:
        parsed.filters && typeof parsed.filters === "object"
          ? (parsed.filters as FilterSpec)
          : undefined,
      presetId:
        typeof parsed.presetId === "string" ? parsed.presetId : null,
    };
  } catch {
    return null;
  }
}
function writeSavedDiscovery(state: SavedDiscoveryState) {
  try {
    localStorage.setItem(SAVED_DISCOVERY_KEY, JSON.stringify(state));
  } catch {}
}
export default function App() {
  const {
    accounts,
    identity: walletIdentity,
    pendingInfo: walletPending,
    verify: verifyWallet,
    cancel: cancelWalletRequest,
    error: walletError,
  } = useWallets();
  const connectedWallet = Object.values(accounts)[0];
  const [perpsAvailability, setPerpsAvailability] = useState<
    "loading" | "mainnet" | "unavailable"
  >("loading");
  const [perpsTestnetEnabled, setPerpsTestnetEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/runtime", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (r) => {
        if (!r.ok) throw Error("Runtime unavailable");
        return r.json();
      })
      .then((r) => {
        if (!controller.signal.aborted) {
          setPerpsAvailability(
            r.perps?.enabled === true && r.perps.network === "mainnet"
              ? "mainnet"
              : "unavailable",
          );
          setPerpsTestnetEnabled(Boolean(r.perps?.testnetEnabled));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPerpsAvailability("unavailable");
          setPerpsTestnetEnabled(false);
        }
      });
    return () => controller.abort();
  }, []);
  const perps = usePerpsGame(
    perpsAvailability === "mainnet",
    perpsAvailability === "mainnet"
      ? "mainnet"
      : perpsTestnetEnabled
        ? "testnet"
        : "mainnet",
    perpsTestnetEnabled,
  );
  const walletScope = JSON.stringify({
    accounts,
    identity: walletIdentity
      ? {
          kind: walletIdentity.kind,
          address: walletIdentity.address,
          chainId: walletIdentity.chainId,
        }
      : null,
  });
  const scopeRef = useRef(walletScope),
    identityRef = useRef(walletIdentity),
    marketRead = useRef(0),
    marketFetch = useRef<AbortController | null>(null);
  scopeRef.current = walletScope;
  identityRef.current = walletIdentity;
  const [walletDialog, setWalletDialog] = useState(false),
    [chartToken, setChartToken] = useState<{
      mint: string;
      symbol: string;
      source?: TokenObservation;
    } | null>(null);
  const resumeSetup = useRef(false);
  const walletRef = useRef<HTMLDialogElement>(null),
    chartRef = useRef<HTMLDialogElement>(null);
  const [network] = useState<AppNetwork>(() =>
    initialReleaseNetwork(location.search, null),
  );
  const [, setMainnetBusy] = useState(false);
  const networkRef = useRef(network);
  networkRef.current = network;
  const [data, setData] = useState<MarketResponse | null>(null),
    [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [executionReadError, setExecutionReadError] = useState(""),
    [tab, updateTab] = useState(() =>
      [
        "portfolio",
        "markets",
        "promote",
        "perps",
        "leaderboard",
        "dao",
      ].includes(
        location.hash === "#rewards" ? "leaderboard" : location.hash.slice(1),
      )
        ? location.hash === "#rewards"
          ? "leaderboard"
          : location.hash.slice(1)
        : "draw",
    ),
    [dialog, setDialog] = useState(false),
    [setup] = useState(false),
    [ticket, setTicket] = useState(() => readSavedDiscovery()?.ticket ?? "5"),
    [preset, setPreset] = useState(
      () => readSavedDiscovery()?.preset ?? "strict",
    ),
    [draft, setDraft] = useState<FilterSpec | null>(null),
    [activePresetId, setActivePresetId] = useState<string | null>(null),
    [activePresetTitle, setActivePresetTitle] = useState<string | null>(null),
    [pendingRequest, setPendingRequest] = useState<DiscoveryRequest>(null),
    [sound, setSound] = useState(false),
    [ambientMotion, setAmbientMotion] = useState(true),
    [rollStyle, setRollStyle] = useState<RollStyle>(() => {
      try {
        const saved = localStorage.getItem("jackpot-roll-style");
        return saved === "case" || saved === "degen" ? saved : "lottery";
      } catch {
        return "lottery";
      }
    }),
    [degenAmount, setDegenAmount] = useState<number | null>(null),
    [phase, setPhase] = useState<"idle" | "mixing" | "extracting" | "reveal">(
      "idle",
    ),
    [selected, setSelected] = useState<TokenObservation | null>(null),
    [frozen, setFrozen] = useState<TokenObservation[]>([]),
    [roll, setRoll] = useState(0),
    [celebration, setCelebration] = useState(0);
  const syncing = pendingRequest !== null;
  const [intentsCatalog, setIntentsCatalog] = useState<IntentsCatalog | null>(
    null,
  );
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/intents/tokens", { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c?.assets && !abort.signal.aborted) setIntentsCatalog(c);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [walletScope]);
  useEffect(() => {
    try {
      const presetParam = new URLSearchParams(window.location.search).get("preset");
      if (!presetParam) return;
      fetch(`/api/presets/${presetParam}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (!p || !p.code) return;
          const decoded = decodeFilterCode(p.code);
          setDraft(decoded);
          setActivePresetId(p.id);
          setActivePresetTitle(p.title);
          setDialog(true);
        })
        .catch(() => {});
    } catch {}
  }, []);
  const [execution, setExecution] = useState<any>(null),
    [stageKind, setStageKind] = useState<"preview">("preview"),
    [acting, setActing] = useState(false);
  const filtersRef = useRef<HTMLDialogElement>(null),
    setupRef = useRef<HTMLDialogElement>(null),
    audio = useRef<AudioContext | null>(null),
    mounted = useRef(true),
    ticketDirty = useRef(false);
  const stageOp = useRef(""),
    stageSource = useRef(""),
    stageKindRef = useRef("preview"),
    execRead = useRef(0);
  const celebrateNextReveal = useRef(false);
  const degenLandingComplete = useRef(false);
  const chartJump = useRef("");
  const lotteryPending = useRef<"preview" | null>(null);
  const lotteryConfiguration = useRef("");
  const rollId = useRef<string | null>(null);
  // Awaiting this, not a bare ref, keeps a quick release from revealing the previous roll.
  const rollOpening = useRef<Promise<string | null> | null>(null);
  const [releaseStatus, setReleaseStatus] = useState("");
  function startLottery(kind: "preview"): boolean {
    if (lotteryPending.current) return true;
    if (!canPreview) return false;
    lotteryPending.current = kind;
    lotteryConfiguration.current = data!.configurationHash;
    setFrozen(accessiblePool);
    setSelected(null);
    setStageKind(kind);
    stageKindRef.current = kind;
    setRoll((n) => n + 1);
    setPhase("mixing");
    setActionError("");
    setReleaseStatus("Turn the handle. Release to settle for 4 seconds.");
    // Commit before the cage moves, so the winner exists before anyone can act on it.
    rollId.current = null;
    rollOpening.current = beginRoll();
    return true;
  }
  async function releaseLottery(settle: SettleReport): Promise<void> {
    const kind = lotteryPending.current;
    const scope = scopeRef.current;
    if (!kind) return;
    setReleaseStatus("Preparing your reveal…");
    const id = rollId.current ?? (await (rollOpening.current ?? beginRoll()));
    rollOpening.current = null;
    if (!id) {
      if (scope === scopeRef.current) {
        lotteryPending.current = null;
        setPhase("idle");
        setReleaseStatus("");
      }
      return;
    }
    const revealed = await revealRoll(id);
    if (!revealed) {
      if (scope === scopeRef.current) {
        lotteryPending.current = null;
        setPhase("idle");
        setReleaseStatus("");
      }
      return;
    }
    if (scope === scopeRef.current) lotteryPending.current = null;
  }
  useEffect(() => {
    if (tab !== "draw" || phase !== "reveal" || !selected) return;
    const identity = `${walletScope}:${stageKind}:${roll}:${selected.mint}`;
    if (chartJump.current === identity) return;
    const timer = setTimeout(() => {
      const chart = document.getElementById("trade-chart-flow");
      if (!chart) return;
      chartJump.current = identity;
      chart.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }, 320);
    return () => clearTimeout(timer);
  }, [tab, phase, selected?.mint, roll, walletScope, stageKind]);
  const chartTransition = useRef(0);
  function setTab(next: string) {
    location.hash = next;
    updateTab(next);
  }
  function resetDraw() {
    setPhase("idle");
    setSelected(null);
    setDegenAmount(null);
  }
  function jumpTo(selector: string) {
    document.querySelector(selector)?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }
  function openChart(mint: string, symbol: string, source?: TokenObservation) {
    if (mint) {
      chartTransition.current++;
      chartRef.current?.getAnimations().forEach((a) => a.cancel());
      setChartToken({ mint, symbol: symbol || "Token", source });
    }
  }
  async function closeChart() {
    const dialog = chartRef.current,
      sequence = ++chartTransition.current;
    if (!dialog) return;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      try {
        await dialog.animate(
          [
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(12px)" },
          ],
          { duration: 300, easing: "ease-in", fill: "forwards" },
        ).finished;
      } catch {
        return;
      }
    }
    if (sequence === chartTransition.current) {
      setChartToken(null);
      dialog.getAnimations().forEach((a) => a.cancel());
    }
  }
  useEffect(() => {
    const changed = () =>
      updateTab(
        [
          "portfolio",
          "markets",
          "promote",
          "perps",
          "leaderboard",
          "dao",
        ].includes(
          location.hash === "#rewards" ? "leaderboard" : location.hash.slice(1),
        )
          ? location.hash === "#rewards"
            ? "leaderboard"
            : location.hash.slice(1)
          : "draw",
      );
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);
  useEffect(() => {
    if (walletDialog) walletRef.current?.showModal();
    else walletRef.current?.close();
  }, [walletDialog]);
  useEffect(() => {
    if (chartToken) chartRef.current?.showModal();
    else chartRef.current?.close();
  }, [chartToken]);
  async function load(background = false) {
    // Polling must not supersede a slow request every ten seconds: doing so
    // prevents its timeout from ever reaching the user. Explicit actions may
    // replace it so settings and wallet changes cannot show an older result.
    if (background && marketFetch.current) return;
    marketFetch.current?.abort();
    const controller = new AbortController();
    marketFetch.current = controller;
    const sequence = ++marketRead.current,
      scope = scopeRef.current;
    try {
      const r = await fetch("/api/markets?matchingOnly=true", {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(25000),
        ]),
      });
      if (!r.ok) throw new Error("Live feed is temporarily unavailable");
      const d = await r.json();
      if (!responseMatchesWallet(d, identityRef.current)) return;
      if (
        mounted.current &&
        sequence === marketRead.current &&
        scope === scopeRef.current
      ) {
        setData(d);
        if (!ticketDirty.current)
          setTicket(String(Number(d.ticketAtomic) / 1e6));
        setError("");
      }
    } catch (e) {
      if (
        mounted.current &&
        sequence === marketRead.current &&
        scope === scopeRef.current
      )
        setError(
          e instanceof Error && e.name === "TimeoutError"
            ? "Live data took too long to respond. Retry to check again."
            : e instanceof Error
              ? e.message
              : "Connection lost",
        );
    } finally {
      if (marketFetch.current === controller) marketFetch.current = null;
    }
  }
  useEffect(() => {
    mounted.current = true;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const t = setInterval(refreshVisible, 10000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      mounted.current = false;
      marketFetch.current?.abort();
      clearInterval(t);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);
  useEffect(() => {
    execRead.current++;
    marketRead.current++;
    lotteryPending.current = null;
    setReleaseStatus("");
    setExecution(null);
    const keepReveal = phase === "reveal" && !!selected;
    if (!keepReveal) {
      setSelected(null);
      setFrozen([]);
      setDegenAmount(null);
      degenLandingComplete.current = false;
      setPhase("idle");
      stageOp.current = "";
      stageSource.current = "";
      stageKindRef.current = "preview";
      setStageKind("preview");
      celebrateNextReveal.current = false;
    }
    const saved = readSavedDiscovery();
    setTicket(saved?.ticket ?? "5");
    setPreset(saved?.preset ?? "strict");
    setDraft(null);
    setDialog(false);
    setChartToken(null);
    setActionError("");
    setExecutionReadError("");
    setActing(false);
    setPendingRequest(null);
    ticketDirty.current = false;
    if (saved?.filters) {
      void configure(
        saved.ticket ?? "5",
        saved.preset ?? "strict",
        saved.filters,
        rollStyle,
        saved.presetId ?? null,
        keepReveal,
      );
    } else {
      void load();
    }
  }, [walletScope]);
  useEffect(() => {
    if (dialog) {
      filtersRef.current?.showModal();
      filtersRef.current
        ?.querySelector(".manual-pool-section")
        ?.removeAttribute("open");
      if (filtersRef.current) filtersRef.current.scrollTop = 0;
    } else filtersRef.current?.close();
  }, [dialog]);
  useEffect(() => {
    if (setup) setupRef.current?.showModal();
    else setupRef.current?.close();
  }, [setup]);
  function openFilterSettings() {
    setDraft(data?.filters ?? null);
    setActionError("");
    setDialog(true);
  }
  async function configure(
    nextTicket: string,
    nextPreset: string,
    filters?: FilterSpec,
    style: RollStyle = rollStyle,
    presetId?: string | null,
    preserveStage = false,
  ) {
    if (!filterChangeAllowed(phase)) {
      setActionError(
        "Wait for the selected ball to leave the cage before changing filters.",
      );
      return;
    }
    const scope = scopeRef.current;
    marketFetch.current?.abort();
    marketFetch.current = null;
    marketRead.current++;
    const appliedFilters = filters
      ? chainsForRoll(filters, style)
      : data?.filters;
    if (appliedFilters && data) {
      const optimisticJustHoot =
        appliedFilters.includeBondingCurve &&
        appliedFilters.tokenSelection?.manualOnly &&
        appliedFilters.tokenSelection.included?.length
          ? justHootTokenObservations(Date.now()).filter((t) =>
              appliedFilters.tokenSelection!.included.includes(
                `near:${t.mint}`,
              ),
            )
          : null;
      setData((prev) =>
        prev
          ? {
              ...prev,
              filters: appliedFilters,
              ticketAtomic: String(Math.round(Number(nextTicket) * 1e6)),
              ...(optimisticJustHoot && optimisticJustHoot.length >= 2
                ? {
                    pool: optimisticJustHoot,
                    eligible: optimisticJustHoot.length,
                  }
                : {}),
            }
          : prev,
      );
    }
    setPendingRequest("discovery");
    setActionError("");
    try {
      const r = await fetch("/api/discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticket: nextTicket,
          preset: nextPreset === "custom" ? "broad" : nextPreset,
          ...(appliedFilters ? { filters: appliedFilters } : {}),
          ...(presetId ? { presetId } : {}),
        }),
      });
      if (scope !== scopeRef.current) return;
      if (!r.ok) {
        const errData = await r.json().catch(() => null);
        throw new Error(errData?.error || "Check your amount and filter ranges");
      }
      const payload = await r.json().catch(() => null);
      if (
        payload?.snapshot &&
        typeof payload.snapshot === "object" &&
        Array.isArray(payload.snapshot.pool)
      ) {
        if (
          mounted.current &&
          scope === scopeRef.current &&
          responseMatchesWallet(payload.snapshot, identityRef.current)
        ) {
          (marketFetch.current as AbortController | null)?.abort();
          marketFetch.current = null;
          marketRead.current++;
          setData(payload.snapshot);
          setError("");
        }
      } else {
        await load();
      }
      if (scope !== scopeRef.current) return;
      writeSavedDiscovery({
        ticket: nextTicket,
        preset: nextPreset,
        ...(appliedFilters ? { filters: appliedFilters } : {}),
        presetId: presetId ?? null,
      });
      setTicket(nextTicket);
      ticketDirty.current = false;
      setPreset(nextPreset);
      if (!preserveStage) {
        setSelected(null);
        setPhase("idle");
      }
      setDialog(false);
      return true;
    } catch (e) {
      if (scope === scopeRef.current)
        setActionError(
          e instanceof Error ? e.message : "Cannot update filters",
        );
    } finally {
      if (scope === scopeRef.current) setPendingRequest(null);
    }
  }
  async function changeRollStyle(style: RollStyle) {
    if (
      style === rollStyle ||
      phase !== "idle" ||
      acting ||
      syncing ||
      execution?.busy
    )
      return;
    setRollStyle(style);
    setDegenAmount(null);
    if (style === "degen" && data) {
      setTicket(String(Number(data.ticketAtomic) / 1e6));
      ticketDirty.current = false;
    }
    try {
      localStorage.setItem("jackpot-roll-style", style);
    } catch {}
  }
  function prepareAudio() {
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
      return audio.current;
    } catch {
      return null;
    }
  }
  function tone() {
    if (!sound) return;
    const context = prepareAudio();
    if (!context) return;
    [440, 660, 880].forEach((f, i) => {
      const o = context.createOscillator(),
        g = context.createGain(),
        t = context.currentTime + i * 0.08;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.025, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(context.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
  }
  function caseTick() {
    if (!sound || !audio.current) return;
    const context = audio.current;
    if (context.state !== "running") return;
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(950, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      340,
      context.currentTime + 0.025,
    );
    gain.gain.setValueAtTime(0.012, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.035);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.04);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  function onExtracted(mint: string, completedRoll: number) {
    if (completedRoll !== roll || selected?.mint !== mint) return;
    setPhase("reveal");
    degenLandingComplete.current = true;
    if (celebrateNextReveal.current) {
      setCelebration((n) => n + 1);
      celebrateNextReveal.current = false;
    }
    tone();
  }
  /** Ask the server to freeze a field and commit to a winner. Returns the roll id. */
  async function beginRoll(): Promise<string | null> {
    if (!data || data.pool.length < 2 || syncing) return null;
    const scope = scopeRef.current;
    setPendingRequest("draw");
    setActionError("");
    try {
      const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            configurationHash:
              lotteryConfiguration.current || data.configurationHash,
            poolKeys: accessiblePool.map(tokenKey),
            amountMode: rollStyle === "degen" ? "full_degen" : "fixed",
          }),
        }),
        result = await response.json();
      if (scope !== scopeRef.current) return null;
      if (!response.ok) throw new Error(result.error ?? "Preview unavailable");
      rollId.current = result.id;
      setFrozen(result.pool);
      setSelected(null);
      return result.id as string;
    } catch (e) {
      if (scope !== scopeRef.current) return null;
      setActionError(e instanceof Error ? e.message : "Preview unavailable");
      void load();
      return null;
    } finally {
      if (scope === scopeRef.current) setPendingRequest(null);
    }
  }
  /** Reveal the committed winner; the cage then guides that ball to the gate. */
  async function revealRoll(id: string) {
    const scope = scopeRef.current;
    setPendingRequest("draw");
    setActionError("");
    try {
      const response = await fetch("/api/preview/reveal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rollId: id }),
        }),
        result = await response.json();
      if (scope !== scopeRef.current) return null;
      if (!response.ok) throw new Error(result.error ?? "Reveal unavailable");
      const sampledAmount = Number(result.ticketAtomic) / 1e6;
      if (
        rollStyle === "degen" &&
        (result.amountMode !== "full_degen" ||
          result.manifest?.amountOddsVersion !== DEGEN_ODDS_VERSION ||
          !DEGEN_AMOUNTS.some((choice) => choice.dollars === sampledAmount))
      )
        throw new Error("Invalid Full degen amount result");
      celebrateNextReveal.current = true;
      // A Full degen buy is drawn by the contract, which seeds from chain
      // randomness the server cannot know — so promise no amount until it lands.
      const previewOnly = true;
      setDegenAmount(
        rollStyle === "degen" && previewOnly ? sampledAmount : null,
      );
      setSelected(result.selected);
      return result;
    } catch (e) {
      if (scope !== scopeRef.current) return null;
      setActionError(e instanceof Error ? e.message : "Reveal unavailable");
      return null;
    } finally {
      if (scope === scopeRef.current) setPendingRequest(null);
    }
  }
  /** No crank: commit, settle straight away, then animate the extraction. */
  async function preview() {
    setStageKind("preview");
    stageKindRef.current = "preview";
    const id = await beginRoll();
    if (!id) return;
    setRoll((x) => x + 1);
    setPhase("mixing");
    tone();
    await revealRoll(id);
  }
  const accessiblePool = (data?.pool ?? []).filter((t) =>
    t.launchpad === "justhoot" ||
    (data?.filters.includeBondingCurve && tokenChain(t) === "near") ||
    (!accounts.phantom && !accounts.metamask && tokenChain(t) === "solana")
      ? true
      : Object.keys(accounts).length === 0
        ? tokenChain(t) === "solana"
        : accessibleToken(t, accounts, intentsCatalog),
  );
  const previewOnlyPool = !!data?.filters.chains?.some((c) => c !== "solana");
  const [sourceWaitExpired, setSourceWaitExpired] = useState(false);
  const [sourceRetryKey, setSourceRetryKey] = useState(0);
  const inMotion = phase === "mixing" || phase === "extracting",
    configBusy = syncing,
    chainMismatch = !!(data && accessiblePool.length !== data.pool.length),
    pool =
      phase === "idle" && pendingRequest !== "draw" ? accessiblePool : frozen,
    sourcesPending = discoveryLoading(
      data,
      data && data.pool.length >= 2 ? null : pendingRequest,
      !!error,
    ),
    readiness = error
      ? {
          title: "Market data unavailable",
          detail: "Live data could not load. Retry to check again.",
        }
      : sourceWaitExpired && sourcesPending
        ? {
            title: "Market data is taking longer than expected",
            detail:
              "Retry live data or adjust your filters while sources recover.",
          }
        : data && data.pool.length >= 2 && accessiblePool.length < 2
          ? {
              title: "Connect a wallet for these coins",
              detail: `${data.pool.length - accessiblePool.length} screened ${[
                ...new Set(
                  data.pool
                    .filter((t) => !accessiblePool.includes(t))
                    .map((t) => chainName(tokenChain(t))),
                ),
              ].join(" + ")} coins need their chain wallet or an exact Intents asset`,
            }
          : drawReadiness(data),
    tokensLoading = sourcesPending && !sourceWaitExpired,
    live = !error && data?.health.state === "live",
    ticketValid =
      /^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/.test(ticket) && Number(ticket) <= 100,
    ticketMatches =
      ticketValid &&
      !!data &&
      Number.isFinite(Number(ticket)) &&
      Number(ticket) >= 1 &&
      Number(ticket) <= 100 &&
      String(Math.round(Number(ticket) * 1e6)) === data.ticketAtomic,
    canPreview =
      !!data &&
      data.pool.length >= 2 &&
      (rollStyle === "degen" || ticketMatches) &&
      !syncing &&
      accessiblePool.length >= 2 &&
      !tokensLoading &&
      !inMotion &&
      !execution?.busy &&
      !acting &&
      !error;
  useEffect(() => {
    setSourceWaitExpired(false);
    if (!sourcesPending) return;
    const timer = setTimeout(() => setSourceWaitExpired(true), 30000);
    return () => clearTimeout(timer);
  }, [sourcesPending, data?.configurationHash, pendingRequest, sourceRetryKey]);
  return (
    <>
      <RascalWorld />
      <ActivityBar onToken={openChart} />
      <div className="app" data-ui>
        <header>
          <a
            href="#"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              setTab("draw");
            }}
            aria-label="therascals.fun home"
          >
            <RascalMark className="rascal-brand-mark" />
            <span className="rascal-wordmark">
              therascals<span>.fun</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <button
              className={tab === "draw" ? "active" : ""}
              aria-current={tab === "draw" ? "page" : undefined}
              title="DEX · spot-token draws"
              onClick={() => setTab("draw")}
            >
              <Dices size={17} /> DEX
            </button>

            <button
              className={tab === "perps" ? "active" : ""}
              aria-current={tab === "perps" ? "page" : undefined}
              onClick={() => setTab("perps")}
            >
              <Flame size={17} /> Perp
            </button>
            <button
              className={tab === "markets" ? "active" : ""}
              onClick={() => setTab("markets")}
            >
              <Activity size={17} /> Live markets{" "}
              <span>{data?.observed ?? "—"}</span>
            </button>
            <button
              className={tab === "portfolio" ? "active" : ""}
              onClick={() => setTab("portfolio")}
            >
              <BriefcaseBusiness size={17} /> Portfolio
            </button>
            <button
              className={tab === "promote" ? "active" : ""}
              onClick={() => setTab("promote")}
            >
              <Megaphone size={17} /> Promote
            </button>
            {
              <button
                className={tab === "dao" ? "active" : ""}
                aria-current={tab === "dao" ? "page" : undefined}
                onClick={() => setTab("dao")}
              >
                <Code2 size={17} /> DAO · Sputnik
              </button>
            }
          </nav>
          {tab !== "dao" && (
            <>
              <RewardsChip onOpen={() => setTab("leaderboard")} />

              <button
                className="connect-wallet"
                aria-label={
                  connectedWallet
                    ? `${walletChainLabel(connectedWallet)} wallet ${connectedWallet.address}${walletIdentity ? " · verified" : " · verify or manage wallet"}`
                    : "Connect wallet"
                }
                title={walletIdentity?.address ?? "Connect or manage wallet"}
                onClick={() => setWalletDialog(true)}
              >
                {Object.values(accounts)[0] ? (
                  <WalletLogo
                    kind={Object.values(accounts)[0]!.kind}
                    size={20}
                  />
                ) : (
                  <Wallet size={19} />
                )}
                <span className="wallet-button-label">
                  {connectedWallet
                    ? `${walletAddressLabel(connectedWallet.address)} · ${walletChainLabel(connectedWallet)}${walletIdentity ? " ✓" : " · Verify"}`
                    : "Connect wallet"}
                </span>
                <span>↗</span>
              </button>
            </>
          )}
        </header>
        <RewardNotice
          onOpen={() => {
            setTab("leaderboard");
          }}
        />
        {tab === "markets" && <PointsSpotlights lane={"mainnet"} />}
        <main>
          {!["perps", "leaderboard", "promote", "dao"].includes(tab) && (
            <div className="discovery-utility">
              <div className="discovery-notice" role="note">
                {<Globe size={14} />}
                <span>
                  <b>{"Mainnet"}</b> · {"Your wallet. Your approval."}
                </span>
                <button
                  className="quiet"
                  aria-label={"How mainnet trading works"}
                  onClick={() =>
                    document
                      .querySelector(".start-guide")
                      ?.setAttribute("open", "")
                  }
                >
                  <Info size={14} />
                </button>
              </div>
              <details className="start-guide compact-guide">
                <summary>
                  How to play <ChevronDown size={13} />
                </summary>
                <ol>
                  <li>
                    <b>01 · Filter</b>
                    <p>Pick your coins and amount.</p>
                  </li>
                  <li>
                    <b>02 · Shake</b>
                    <p>Preview for free, or draw on NEAR.</p>
                  </li>
                  <li>
                    <b>03 · Send</b>
                    <p>
                      {"Review the selected token and approve in your wallet."}
                    </p>
                  </li>
                </ol>
              </details>
            </div>
          )}
          {connectedWallet && !walletIdentity && !walletPending && (
            <div
              className="wallet-verify-banner"
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
                padding: "10px 14px",
                marginBottom: "14px",
                borderRadius: "10px",
                background: "#fff4ec",
                border: "1.5px solid #d4551f",
                color: "#7a2e0e",
                fontSize: "13px",
              }}
            >
              <span>
                <b>Mandatory wallet verification required:</b> Verify{" "}
                <code>{walletAddressLabel(connectedWallet.address)}</code> with
                a free sign-in message so your wallet can roll, swap, and trade.
              </span>
              <button
                type="button"
                className="primary"
                style={{ padding: "6px 12px", fontSize: "12px" }}
                onClick={() => void verifyWallet(connectedWallet.kind)}
              >
                Verify Wallet Now
              </button>
            </div>
          )}
          {walletPending && !walletDialog && (
            <div className="wallet-request-status" role="status">
              <i className="spinner" />
              <div>
                <strong>{walletPending.stage}</strong>
                <p>
                  Wallet access and a free sign-in message; no deposit or token
                  approval.
                </p>
              </div>
              <button className="text-link" onClick={cancelWalletRequest}>
                Cancel request
              </button>
            </div>
          )}
          {resumeSetup.current &&
            !walletDialog &&
            !walletPending &&
            !walletIdentity && (
              <button
                className="text-link wallet-resume"
                onClick={() => setWalletDialog(true)}
              >
                Continue wallet sign-in →
              </button>
            )}
          {walletError && !walletDialog && (
            <p className="error" role="alert">
              {walletError}
            </p>
          )}
          {actionError && tab !== "draw" && (
            <p className="error" role="alert">
              {actionError}
            </p>
          )}
          {executionReadError && (
            <p className="error" role="status">
              {executionReadError}
            </p>
          )}
          {tab === "draw" ? (
            <div
              className={
                "draw-layout" +
                (rollStyle === "degen" ? " full-degen-layout" : "")
              }
            >
              <section className="stage">
                <div className="stage-head">
                  <h1>
                    {phase === "mixing"
                      ? rollStyle === "degen"
                        ? "Let the reels decide."
                        : rollStyle === "case"
                          ? "Let it rip."
                          : "Let it fly."
                      : phase === "extracting"
                        ? "Here comes your bag."
                        : phase === "reveal"
                          ? rollStyle === "degen"
                            ? "Three reels. One bag."
                            : rollStyle === "case"
                              ? "Case cracked."
                              : "Fresh out the cage."
                          : rollStyle === "degen"
                            ? "Three reels. Full send."
                            : rollStyle === "case"
                              ? "Crack it. Send it."
                              : "Good luck, rascal."}
                  </h1>
                  <div className="stage-options">
                    <button
                      className="quiet motion-toggle"
                      aria-pressed={ambientMotion}
                      aria-label={
                        ambientMotion
                          ? "Pause ambient 3D motion"
                          : "Resume ambient 3D motion"
                      }
                      onClick={() => setAmbientMotion((x) => !x)}
                    >
                      {ambientMotion ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button
                      className="quiet sound"
                      onClick={() => {
                        if (!sound) prepareAudio();
                        setSound(!sound);
                      }}
                      aria-pressed={sound}
                      aria-label={sound ? "Turn sound off" : "Turn sound on"}
                    >
                      {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                  </div>
                </div>
                <p className="stage-intro">
                  {"Pick your mischief. Set your amount. Give it a spin."}
                </p>
                <div
                  className="roll-picker"
                  role="group"
                  aria-label="Roll animation"
                >
                  {(["lottery", "case", "degen"] as const).map((style) => (
                    <button
                      key={style}
                      className={
                        style === "degen"
                          ? "degen-mode"
                          : style === "case"
                            ? "case-mode"
                            : ""
                      }
                      aria-pressed={rollStyle === style}
                      disabled={
                        phase !== "idle" ||
                        !!execution?.busy ||
                        acting ||
                        configBusy
                      }
                      title={
                        phase !== "idle"
                          ? "Return to the machine to change style"
                          : style === "degen"
                            ? "Three reels: chain, token and a weighted $1–$100 amount"
                            : style === "lottery"
                              ? "Mix chains in the lottery"
                              : "Mix chains · equal token odds"
                      }
                      onClick={() => void changeRollStyle(style)}
                    >
                      {style === "degen" ? (
                        <Flame size={16} />
                      ) : style === "case" ? (
                        <PackageOpen size={16} />
                      ) : (
                        <CircleDot size={16} />
                      )}
                      {style === "degen"
                        ? "Full degen"
                        : style === "case"
                          ? "Case opening"
                          : "Lottery"}
                    </button>
                  ))}
                </div>
                <JustHootDrawControl
                  filters={data?.filters}
                  disabled={
                    phase !== "idle" ||
                    !!execution?.busy ||
                    acting ||
                    configBusy
                  }
                  onApplyFilters={(nextFilters) =>
                    void configure(
                      ticket,
                      nextFilters.includeBondingCurve ? "broad" : preset,
                      nextFilters,
                    )
                  }
                />
                {data && (
                  <div
                    className="stage-chain-selection"
                    aria-label="Roll chain selection"
                  >
                    {Object.keys(accounts).length === 0 ? (
                      <button
                        className="text-link"
                        onClick={() => setWalletDialog(true)}
                      >
                        <Wallet size={14} /> Connect wallet to mix chains · free
                        Solana preview available
                      </button>
                    ) : (
                      <small className="chain-access-note">
                        Connected wallet chains + exact Intents assets ·
                        {"buy after wallet review"}
                      </small>
                    )}
                    {chainMismatch && (
                      <p className="preview-chain-note" role="status">
                        {data.pool.length - accessiblePool.length} tokens
                        excluded: connect their chain wallet or use an exact
                        supported Intents asset.
                      </p>
                    )}
                  </div>
                )}
                {phase === "idle" && !tokensLoading && (
                  <button
                    className="mobile-filter-shortcut text-link"
                    disabled={configBusy}
                    onClick={() => {
                      openFilterSettings();
                    }}
                  >
                    <SlidersHorizontal size={14} /> {data?.eligible ?? 0} coins
                    ready · Filters
                  </button>
                )}
                <div
                  className={`machine machine-${rollStyle}`}
                  aria-busy={
                    (tokensLoading && phase === "idle") ||
                    pendingRequest === "draw"
                  }
                >
                  {tokensLoading && phase === "idle" ? (
                    <LoadingSkeleton kind="machine" />
                  ) : rollStyle === "degen" ? (
                    <SlotMachine
                      tokens={pool}
                      currencyLabel={"USDC"}
                      chains={
                        pool.length
                          ? selectedChains(
                              data?.filters ?? ({} as FilterSpec),
                            ).filter((chain) =>
                              pool.some((t) => tokenChain(t) === chain),
                            )
                          : selectedChains(data?.filters ?? ({} as FilterSpec))
                      }
                      selected={selected}
                      amount={degenAmount}
                      phase={phase}
                      roll={roll}
                      onExtractionStart={() => setPhase("extracting")}
                      onExtracted={onExtracted}
                      onTick={caseTick}
                      previewChains
                    />
                  ) : rollStyle === "case" ? (
                    <CaseOpening
                      tokens={pool}
                      selected={selected}
                      phase={phase}
                      roll={roll}
                      ambientMotion={ambientMotion}
                      onExtractionStart={() => setPhase("extracting")}
                      onExtracted={onExtracted}
                      onTick={caseTick}
                    />
                  ) : (
                    <Cage
                      tokens={pool}
                      selected={selected}
                      phase={phase}
                      roll={roll}
                      ambientMotion={ambientMotion && pool.length >= 2}
                      proximity
                      selectionArmed={phase !== "idle"}
                      onReleaseSelection={releaseLottery}
                      onExtractionStart={() => {
                        setPhase("extracting");
                        setReleaseStatus(
                          "Ball selected · dropping through the bottom gate",
                        );
                      }}
                      onExtracted={onExtracted}
                    />
                  )}
                  <RascalStickers />
                  <RevealCelebration
                    trigger={celebration}
                    enabled={phase === "reveal" && ambientMotion}
                  />
                  {phase === "idle" && !tokensLoading && pool.length < 2 && (
                    <div
                      className="empty-note"
                      role="status"
                      aria-live="polite"
                    >
                      <span>{readiness.detail}</span>
                      <strong>{readiness.title}</strong>
                      <button
                        className="text-link"
                        disabled={configBusy}
                        onClick={() => {
                          setSourceRetryKey((n) => n + 1);
                          setSourceWaitExpired(false);
                          void configure(ticket, preset, data?.filters);
                        }}
                      >
                        Retry live data ↻
                      </button>
                      <button
                        className="text-link"
                        onClick={() => {
                          openFilterSettings();
                        }}
                      >
                        Adjust filters ↗
                      </button>
                    </div>
                  )}
                </div>
                {!tokensLoading && phase !== "reveal" && (
                  <div className="draw-settings" aria-label="Trade settings">
                    {rollStyle === "degen" ? (
                      <p className="slot-amount-note">
                        Amount: $1–$100 {"USDC"} · weighted odds
                      </p>
                    ) : (
                      <>
                        <div className="amount-section">
                          <label htmlFor="ticket">
                            Buy amount <span>{"USD budget"}</span>
                          </label>
                          <div className="amount-input">
                            <span>$</span>
                            <input
                              id="ticket"
                              inputMode="decimal"
                              value={ticket}
                              disabled={inMotion || configBusy}
                              onChange={(e) => {
                                ticketDirty.current = true;
                                setTicket(e.target.value);
                              }}
                              onBlur={() => {
                                if (
                                  /^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/.test(
                                    ticket,
                                  ) &&
                                  Number(ticket) <= 100 &&
                                  !ticketMatches
                                )
                                  void configure(ticket, preset, data?.filters);
                              }}
                              aria-invalid={!ticketValid}
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  ticketValid &&
                                  !ticketMatches
                                )
                                  void configure(ticket, preset, data?.filters);
                              }}
                              aria-describedby="amount-note"
                            />
                            <span>{"USD"}</span>
                          </div>
                          {!ticketValid && (
                            <p className="amount-validation" role="status">
                              Enter 1–100, with up to two decimal places.
                            </p>
                          )}
                          <div className="amounts">
                            {["1", "5", "25", "100"].map((n) => (
                              <button
                                key={n}
                                disabled={inMotion || configBusy}
                                aria-pressed={n === ticket}
                                className={n === ticket ? "chosen" : ""}
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={() =>
                                  void configure(n, preset, data?.filters)
                                }
                              >
                                ${n}
                              </button>
                            ))}
                          </div>
                          <p id="amount-note" className="sr-only">
                            USDC · routes checked at this size
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {rollStyle === "lottery" && inMotion && (
                  <p className="lottery-release-status" role="status">
                    {releaseStatus}
                  </p>
                )}
                {actionError && (
                  <div className="draw-action-error error" role="alert">
                    <span>
                      {actionError.includes("two fresh, two-way")
                        ? "The live pool changed. Wait for two ready coins or loosen your filters, then try again."
                        : actionError}
                    </span>
                    <button
                      className="text-link"
                      aria-label="Dismiss draw error"
                      onClick={() => setActionError("")}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {tokensLoading && phase === "idle" ? (
                  <LoadingSkeleton kind="summary" />
                ) : phase !== "reveal" ? (
                  <div
                    className="cta-group cage-actions"
                    aria-label="Draw play controls"
                  >
                    <button
                      className="primary draw-action play-action"
                      disabled={!canPreview}
                      onClick={() =>
                        rollStyle === "lottery"
                          ? startLottery("preview")
                          : void preview()
                      }
                    >
                      <span
                        className="action-icon draw-action-icon"
                        aria-hidden="true"
                      >
                        {<Dices size={21} />}
                      </span>
                      <span className="action-label">
                        {pendingRequest === "draw"
                          ? "Drawing…"
                          : acting
                            ? "Sending…"
                            : inMotion
                              ? phase === "extracting"
                                ? "Dropping…"
                                : "Mixing…"
                              : rollStyle === "degen"
                                ? "Spin preview"
                                : "Draw a token"}
                      </span>
                    </button>

                    <p className="cta-note">
                      {
                        "Free reveal · every mainnet purchase needs wallet approval."
                      }
                    </p>
                  </div>
                ) : (
                  <DrawOutcome
                    symbol={selected?.symbol ?? "Token"}
                    icon={selected?.dex?.icon ?? selected?.icon}
                    mint={selected?.mint}
                    chain={selected?.chain}
                    onReset={resetDraw}
                    onQuote={() => jumpTo("#mainnet-trading")}
                    previewActionLabel={"Review mainnet routes"}
                  />
                )}
                <div
                  className="cage-facts"
                  hidden={tokensLoading && phase === "idle"}
                >
                  <span>
                    <Clock3 size={12} /> ≤24h
                  </span>
                  <span>
                    <Coins size={12} /> MC &lt;$100m
                  </span>
                  {rollStyle !== "lottery" && (
                    <span
                      title={
                        rollStyle === "degen"
                          ? "Coins have equal odds. Buy amounts follow the published weighted odds."
                          : "Every eligible coin has equal draw odds. Card colors are decorative."
                      }
                    >
                      {rollStyle === "degen" ? "Weighted amount" : "Equal odds"}
                    </span>
                  )}
                </div>
                <p className="screening-note">
                  <ShieldCheck size={11} /> RugCheck / GoPlus · flagged &
                  unknown excluded
                </p>
                <div className="stage-caption" aria-live="polite">
                  <i />
                  {tokensLoading && phase === "idle" ? (
                    <LoadingSkeleton kind="summary" />
                  ) : phase === "extracting" ? (
                    "One ticker. Coming in hot."
                  ) : phase === "mixing" ? (
                    rollStyle === "degen" ? (
                      "Landing chain, token and amount…"
                    ) : (
                      `${rollStyle === "case" ? "Rolling" : "Shaking"} ${frozen.length} tickers…`
                    )
                  ) : phase === "reveal" ? (
                    <>
                      <TokenTicker
                        symbol={selected?.symbol ?? "Token"}
                        src={selected?.dex?.icon ?? selected?.icon}
                        size={16}
                      />{" "}
                      · preview only
                    </>
                  ) : pool.length >= 2 ? (
                    `${pool.length} coins. One little menace.`
                  ) : (
                    "Waiting for eligible coins…"
                  )}
                </div>
              </section>
              <aside className="controls">
                {phase === "idle" && data && !tokensLoading && (
                  <>
                    <button
                      className="pool-edit-button"
                      disabled={inMotion || acting || configBusy}
                      onClick={openFilterSettings}
                    >
                      <SlidersHorizontal size={14} />
                      <span>Filters & token pool</span>
                      <b>{data.pool.length}</b>
                    </button>
                  </>
                )}
                {data && !(tokensLoading && phase === "idle") && (
                  <ChainPoolStatus
                    mainnet
                    data={{ ...data, pool: accessiblePool }}
                  />
                )}
                {
                  <MainnetTrading
                    token={phase === "reveal" ? selected : null}
                    rollId={rollId.current}
                    amount={
                      rollStyle === "degen" && degenAmount
                        ? String(degenAmount)
                        : ticket
                    }
                    onConnect={() => setWalletDialog(true)}
                    onBusy={setMainnetBusy}
                  />
                }
                <RewardTierBar
                  amount={rollStyle === "degen" ? degenAmount : Number(ticket)}
                  lane={"mainnet"}
                />
              </aside>
            </div>
          ) : tab === "perps" ? (
            <PerpsPage game={perps} />
          ) : tab === "dao" ? (
            <section
              className="dao-integrated"
              aria-label="Rascals Contributor DAO"
            >
              <div className="dao-sputnik-strip" role="note">
                <div className="dao-sputnik-strip-main">
                  <span className="dao-sputnik-pill">
                    SPUTNIK DAO v2 INTEGRATED
                  </span>
                  <span className="dao-testnet-pill">
                    <i /> WORKING ON NEAR TESTNET
                  </span>
                  <span className="dao-sputnik-text">
                    Sputnik DAO v2 council multisig &amp; shared treasury (
                    <code>therascals.sputnikv2.testnet</code>) governing
                    programmable Contributor DAO rewards (
                    <code>v2.rascals-dao-1104.testnet</code>)
                  </span>
                </div>
                <div className="dao-sputnik-strip-links">
                  <a
                    href="https://testnet.nearblocks.io/address/therascals.sputnikv2.testnet"
                    target="_blank"
                    rel="noreferrer"
                  >
                    therascals.sputnikv2.testnet ↗
                  </a>
                  <a
                    href="https://testnet.nearblocks.io/address/v2.rascals-dao-1104.testnet"
                    target="_blank"
                    rel="noreferrer"
                  >
                    v2.rascals-dao-1104.testnet ↗
                  </a>
                </div>
              </div>
              <iframe
                title="Rascals Contributor DAO"
                src={
                  import.meta.env.DEV
                    ? "http://127.0.0.1:5190/?embedded=1"
                    : "/dao/?embedded=1"
                }
              />
            </section>
          ) : tab === "promote" ? (
            <PromoteToken
              suggestedToken={selected ?? data?.pool[0]}
              pointsLane={"mainnet"}
              onConnect={() => setWalletDialog(true)}
            />
          ) : tab === "leaderboard" ? (
            <RewardsPage
              lane={"mainnet"}
              onPromote={() => setTab("promote")}
              onConnect={() => setWalletDialog(true)}
            />
          ) : tab === "portfolio" ? (
            <>
              <Portfolio
                key={walletScope + ":" + network}
                onChart={openChart}
              />
            </>
          ) : (
            <section className="markets-section">
              <div className="market-heading">
                <div>
                  <h1>Fresh from your chains.</h1>
                  <p>Fresh coins. Your rules.</p>
                </div>
                <button
                  className="secondary"
                  disabled={inMotion || configBusy}
                  onClick={() => {
                    openFilterSettings();
                  }}
                >
                  <SlidersHorizontal size={16} /> Filters
                </button>
              </div>
              <MarketTable
                data={data}
                onChart={openChart}
                pointsLane={"mainnet"}
              />
            </section>
          )}
          {tab === "draw" && phase === "reveal" && selected && (
            <TradeChartFlow
              key={`${stageKind}:${roll}:${selected.mint}`}
              token={selected}
              baseChart={
                tokenChain(selected) !== "solana" ? (
                  <BaseSource token={selected} />
                ) : undefined
              }
            />
          )}
          {tab === "draw" &&
            phase === "reveal" &&
            selected &&
            tokenChain(selected) === "solana" && (
              <AdvancedTrading token={selected} />
            )}
          {(tab === "draw" || tab === "markets") && (
            <section className="feed-section">
              <div className="feed-heading">
                <h2>{tab === "draw" ? "Your coin pile" : "Feed health"}</h2>
                <div className="feed-status">
                  <i className={live ? "live" : ""} />
                  {live
                    ? "Updating live"
                    : error
                      ? "Connection lost"
                      : data?.health.state === "rate_limited"
                        ? "Provider cooling down"
                        : "Waiting for feed"}
                  <span>{data?.health.requests ?? 0} requests</span>
                </div>
              </div>
              {tab === "draw" && (
                <>
                  {data?.filters.includeBondingCurve && (
                    <JustHootLeaderboardTable
                      filters={data.filters}
                      disabled={
                        phase !== "idle" ||
                        !!execution?.busy ||
                        acting ||
                        configBusy
                      }
                      onChart={(entry) => {
                        const source =
                          data.pool.find((c) => c.mint === entry.mint) ??
                          justHootTokenObservations(Date.now()).find(
                            (t) => t.mint === entry.mint,
                          );
                        openChart(entry.mint, entry.symbol, source);
                      }}
                      onToggleToken={(key) => {
                        const currentIncluded =
                          data.filters.tokenSelection?.included?.length
                            ? data.filters.tokenSelection.included
                            : JUSTHOOT_DEFAULT_TOP3_KEYS;
                        const exists = currentIncluded.includes(key);
                        const nextIncluded = exists
                          ? currentIncluded.length <= 2
                            ? currentIncluded
                            : currentIncluded.filter((k) => k !== key)
                          : [...currentIncluded, key];
                        void configure(ticket, "broad", {
                          ...data.filters,
                          chains: ["near"],
                          includeBondingCurve: true,
                          poolSize: Math.max(
                            data.filters.poolSize ?? 12,
                            nextIncluded.length,
                          ),
                          tokenSelection: {
                            included: nextIncluded,
                            excluded: [],
                            manualOnly: true,
                          },
                        });
                      }}
                      onLoadAll={() => {
                        void configure(ticket, "broad", {
                          ...data.filters,
                          chains: ["near"],
                          includeBondingCurve: true,
                          poolSize: Math.max(data.filters.poolSize ?? 12, 12),
                          tokenSelection: {
                            included: [...JUSTHOOT_ALL_LEADERBOARD_KEYS],
                            excluded: [],
                            manualOnly: true,
                          },
                        });
                      }}
                    />
                  )}
                  <MarketTable
                    data={data}
                    compactView
                    onChart={openChart}
                    pointsLane={"mainnet"}
                  />
                </>
              )}
              <details className="coverage source-details">
                <summary>
                  <Info size={13} /> Data & coverage <ChevronDown size={13} />
                </summary>
                <p>
                  {data?.coverage.description ??
                    "Connecting to Jupiter’s recent-token feed."}{" "}
                  {data?.coverage.oldestObservation &&
                    `Observing since ${new Date(data.coverage.oldestObservation).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`}
                </p>
                <a
                  href="https://developers.jup.ag/docs/tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  Data: Jupiter ↗
                </a>
              </details>
              {(error || data?.health.error) && (
                <p className="error" role="alert">
                  {error || data?.health.error}. Existing records remain
                  visible; stale tokens cannot enter a draw.
                </p>
              )}
            </section>
          )}
        </main>
        <footer>
          <span>
            {tab === "leaderboard"
              ? "A little pocket chaos."
              : "Your filters. The cage decides."}
          </span>
          <span>
            {tab === "leaderboard"
              ? "Points only / No cash value"
              : tab === "dao"
                ? "Contributor governance / NEAR testnet"
                : "Mainnet / Wallet approval required"}
          </span>
        </footer>
        <dialog
          ref={walletRef}
          className="wallet-dialog"
          onCancel={() => {
            resumeSetup.current = false;
            setWalletDialog(false);
          }}
          onClose={() => setWalletDialog(false)}
        >
          <div className="dialog-head">
            <h2>
              {resumeSetup.current
                ? "Sign in to continue."
                : "Connect a wallet."}
            </h2>
            <button
              className="close"
              aria-label="Close wallets"
              onClick={() => {
                resumeSetup.current = false;
                setWalletDialog(false);
              }}
            >
              ×
            </button>
          </div>
          <WalletConnections
            onConnectStart={(kind) => {
              if (kind === "near") setWalletDialog(false);
            }}
          />
        </dialog>
        <dialog
          ref={chartRef}
          className="chart-dialog"
          onCancel={(e) => {
            e.preventDefault();
            void closeChart();
          }}
          onClose={() => setChartToken(null)}
        >
          <div className="dialog-head">
            <h2>Source market.</h2>
            <button
              className="close"
              aria-label="Close chart"
              onClick={() => void closeChart()}
            >
              ×
            </button>
          </div>
          {chartToken &&
            (!chartToken.source ||
            tokenChain(chartToken.source) === "solana" ? (
              <SourceChart
                mint={chartToken.mint}
                symbol={chartToken.symbol}
                source={chartToken.source}
              />
            ) : (
              <BaseSource token={chartToken.source} />
            ))}
        </dialog>
        <dialog
          ref={filtersRef}
          className="filter-dialog"
          onCancel={() => setDialog(false)}
          onClose={() => setDialog(false)}
        >
          <div className="dialog-head">
            <h2>Your degen settings.</h2>
            <button
              className="close"
              aria-label="Close filters"
              onClick={() => setDialog(false)}
            >
              ×
            </button>
          </div>
          <p>
            Pick a preset, then move the sliders to tune your coin pool. Tap a
            value to type an exact amount. Changes apply when you’re ready.
          </p>
          {actionError && (
            <p className="error" role="alert">
              {actionError}
            </p>
          )}
          {draft && (
            <>
              <form
                id="game-filter-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void configure(ticket, presetFor(draft), draft, rollStyle, activePresetId);
                }}
              >
                <ChainPicker
                  mainnet
                  filters={draft}
                  accounts={accounts}
                  catalog={intentsCatalog}
                  multiple
                  disabled={configBusy || inMotion || acting}
                  onChange={setDraft}
                />
                <FilterSettings
                  value={draft}
                  activePresetId={activePresetId}
                  activePresetTitle={activePresetTitle}
                  onPresetSelect={(id, title) => {
                    setActivePresetId(id);
                    setActivePresetTitle(title ?? null);
                  }}
                  userAddress={Object.values(accounts)[0]?.address}
                  disabled={configBusy || inMotion || acting}
                  onChange={(next) => {
                    setActivePresetId(null);
                    setActivePresetTitle(null);
                    setDraft(next);
                  }}
                >
                  <MemeTypePicker
                    value={draft.memeTypes}
                    onChange={(memeTypes) => setDraft({ ...draft, memeTypes })}
                  />
                </FilterSettings>
                <p className="disclosure">
                  Pools must be under 24 hours old, with a known market cap
                  below $100m. Risk and route checks always apply. “Any” removes
                  only your optional limit. Social links are presence signals.
                </p>
              </form>
              <details className="manual-pool-section">
                <summary>Individual tokens · add or exclude</summary>
                <p className="disclosure">
                  Optional picks and exclusions. The currently applied pool is
                  shown below; changes take effect with Apply filters.
                </p>
                <TokenPoolEditor
                  key={walletScope}
                  mainnet
                  showChains={false}
                  data={
                    data
                      ? {
                          ...data,
                          filters: draft,
                          pool: accessiblePool,
                          eligible: accessiblePool.length,
                        }
                      : null
                  }
                  multipleChains
                  accounts={accounts}
                  catalog={intentsCatalog}
                  disabled={
                    configBusy || inMotion || acting || !!execution?.busy
                  }
                  onChange={async (next) => {
                    setDraft(next);
                  }}
                />
              </details>
              <div className="filter-dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={configBusy}
                  onClick={() => setDialog(false)}
                >
                  Cancel
                </button>
                <button
                  form="game-filter-form"
                  type="submit"
                  className="primary"
                  disabled={configBusy || inMotion || acting}
                >
                  {syncing ? "Updating…" : "Apply filters"}
                  <span>↗</span>
                </button>
              </div>
            </>
          )}
        </dialog>
      </div>
    </>
  );
}
function MarketTable({
  data,
  compactView = false,
  onChart,
  pointsLane = "mainnet",
}: {
  data: MarketResponse | null;
  compactView?: boolean;
  onChart: (mint: string, symbol: string, source?: TokenObservation) => void;
  pointsLane?: "practice" | "mainnet";
}) {
  const { identity } = useWallets();
  const expectedIdentity = useRef(identity);
  expectedIdentity.current = identity;
  const [all, setAll] = useState(false),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState<MarketResponse | null>(null),
    [loading, setLoading] = useState(false),
    [pageError, setPageError] = useState("");
  useEffect(() => {
    setOffset(0);
    setPage(null);
  }, [data?.configurationHash, all]);
  useEffect(() => {
    if (!all && offset === 0) {
      setPage(null);
      return;
    }
    let active = true;
    setLoading(true);
    setPageError("");
    fetch(
      `/api/markets?matchingOnly=${!all}&offset=${offset}&limit=${compactView ? 5 : 100}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error("Cannot load this page");
        return r.json();
      })
      .then((d) => {
        if (active && responseMatchesWallet(d, expectedIdentity.current))
          setPage(d);
      })
      .catch((e) => {
        if (active) setPageError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [all, offset, data?.now, compactView]);
  const current = all || offset ? page : data;
  const rows = current?.rows ?? [],
    visible = rows.slice(0, compactView ? 5 : 100);
  const energy = useMarketEnergy(
    visible,
    `${current?.configurationHash}:${all}:${offset}:${compactView}`,
  );
  return (
    <>
      <div className="table-switch">
        <button className={!all ? "active" : ""} onClick={() => setAll(false)}>
          Matching {data?.matching ?? 0}
        </button>
        <button className={all ? "active" : ""} onClick={() => setAll(true)}>
          All observed {data?.observed ?? 0}
        </button>
      </div>
      {!compactView && (
        <div className="market-energy-bar">
          <span className="icon-label">
            <Activity size={16} /> Activity lifts{" "}
            <small>
              {energy.paused
                ? "Paused while browsing"
                : energy.reduced
                  ? "Reduced motion"
                  : "Live provider updates"}
            </small>
          </span>
        </div>
      )}
      {pageError ? (
        <p className="error" role="alert">
          {pageError}
        </p>
      ) : loading && !current ? (
        <LoadingSkeleton kind="rows" />
      ) : visible.length ? (
        <div
          className="table-scroll energy-table"
          onMouseEnter={() => energy.setPaused(true)}
          onMouseLeave={() => energy.setPaused(false)}
          onFocusCapture={() => energy.setPaused(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              energy.setPaused(false);
          }}
        >
          <details className="table-source table-source-detail">
            <summary>
              <Info size={12} /> Source notes
            </summary>
            <p>
              Solana metrics · Jupiter. Other chains · DEX Screener reference
              pool. Images and paid boosts · DEX Screener. Risk reports ·
              RugCheck (Solana) / GoPlus (Base, BNB). NEAR screening is not
              connected and its tokens are excluded. Base/BNB mainnet buys
              require an executable route and wallet approval. Promoted labels
              never change draw odds.
            </p>
          </details>
          <table role="table" aria-label="Live token markets">
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">Pool age / theme</th>
                <th scope="col">Market cap</th>
                <th scope="col">5m volume</th>
                <th scope="col">Liquidity / holders</th>
                <th scope="col">Draw status</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody ref={energy.body}>
              {energy.ordered.map((r) => (
                <tr
                  key={r.token.mint}
                  data-mint={r.token.mint}
                  className={
                    energy.pops.includes(r.token.mint) ? "market-pop" : ""
                  }
                >
                  <td className="market-token-cell" data-label="Token">
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={tokenExplorer(r.token)}
                    >
                      <TokenIcon
                        src={r.token.dex?.icon ?? r.token.icon}
                        symbol={r.token.symbol}
                      />
                      <span>
                        <b>
                          {tokenTicker(r.token.symbol)}{" "}
                          <small className="chain-tag">
                            {chainName(tokenChain(r.token)).toUpperCase()}
                          </small>{" "}
                          <PromotionTag dex={r.token.dex} />{" "}
                          <RascalPromotionTag
                            token={r.token}
                            lane={pointsLane}
                          />
                          {energy.pops.includes(r.token.mint) && (
                            <span className="pop-badge">
                              <Activity size={10} />
                              {"ACTIVE"}
                            </span>
                          )}
                        </b>
                        <span className="token-name">
                          {r.token.dex?.name ?? r.token.name}
                        </span>
                        <small>{short(r.token.mint)}</small>
                      </span>
                    </a>
                    <div className="token-screening-line">
                      <RiskBadge risk={r.token.security} mint={r.token.mint} />
                      <DrawdownBadge evidence={r.token.drawdown} />
                      <IdentityTag token={r.token} />
                    </div>
                  </td>
                  <td className="market-age-cell" data-label="Pool age / theme">
                    {age(r.token.firstPoolCreatedAt)}
                    <small
                      className="inferred-theme"
                      title="Inferred from name and ticker; unverified"
                    >
                      {inferMemeTypes(r.token)
                        .map((c) => MEME_TYPES.find((t) => t.id === c)?.label)
                        .join(" · ")}{" "}
                      <i>inferred</i>
                    </small>
                  </td>
                  <td className="market-cap-cell" data-label="Market cap">
                    {dollars(r.token.marketCap.value)}
                  </td>
                  <td className="market-volume-cell" data-label="5m volume">
                    {dollars(r.token.volume5m.value)}
                    <small className="trade-counts">
                      <span>{r.token.buys5m.value ?? "—"} buys</span> /{" "}
                      <span>{r.token.sells5m.value ?? "—"} sells</span>
                    </small>
                    {r.token.partialWindow5m && <small>Partial window</small>}
                  </td>
                  <td
                    className="market-liquidity-cell"
                    data-label="Liquidity / holders"
                  >
                    {dollars(r.token.liquidity.value)}
                    <small>{compact(r.token.holders.value)} holders</small>
                  </td>
                  <td className="market-status-cell" data-label="Draw status">
                    <span
                      className={
                        r.matches &&
                        !r.admissionReasons.length &&
                        r.route?.status === "eligible"
                          ? "success"
                          : ""
                      }
                    >
                      {!r.matches
                        ? readable(r.reasons[0])
                        : r.admissionReasons.length
                          ? readable(r.admissionReasons[0])
                          : tokenChain(r.token) !== "solana"
                            ? "Preview only"
                            : r.route?.status === "eligible"
                              ? "Two-way route ✓"
                              : r.route?.status === "unavailable"
                                ? "No valid route"
                                : r.route?.status === "stale"
                                  ? "Quote expired"
                                  : "Checking routes"}
                    </span>
                  </td>
                  <td className="market-price-cell" data-label="Price">
                    <button
                      className="text-link"
                      onClick={() =>
                        onChart(r.token.mint, r.token.symbol, r.token)
                      }
                    >
                      <ChartNoAxesCombined size={15} /> Chart
                    </button>
                    <small
                      className="token-price"
                      title={`${displayPrice(r.token).source} price · ${displayPrice(r.token).at ?? "Unknown timestamp"}${displayPrice(r.token).stale ? " · cached" : ""}`}
                    >
                      {displayPrice(r.token).value === null
                        ? "Unknown"
                        : new Intl.NumberFormat("en", {
                            style: "currency",
                            currency: "USD",
                            maximumSignificantDigits: 4,
                          }).format(displayPrice(r.token).value!)}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !data || (loading && !current) ? (
        <LoadingSkeleton kind="rows" />
      ) : (
        <div className="table-empty">
          <strong>No matches yet.</strong>
          <p>
            {!data
              ? "Fresh launches will appear here."
              : "New launches may need time to meet your age, volume and liquidity filters. Try “Fresh & liquid” or view all observed tokens."}
          </p>
        </div>
      )}
      {!compactView && current && (
        <div className="table-switch">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            ← Previous
          </button>
          <span>
            Showing {current.page.total ? offset + 1 : 0}–
            {Math.min(offset + 100, current.page.total)} of {current.page.total}
          </span>
          <button
            disabled={offset + 100 >= current.page.total}
            onClick={() => setOffset(offset + 100)}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
function BaseSource({ token }: { token: TokenObservation }) {
  const jh = findJustHootEntry(token.mint);
  const chartUrl = dexChartUrl(
    tokenChain(token),
    token.dex?.pool ?? token.firstPoolId ?? "",
  );
  return (
    <section className="source-chart base-source">
      <div className="chart-heading">
        <h2>
          <TokenTicker
            symbol={token.symbol}
            src={token.dex?.icon ?? token.icon}
            size={24}
          />{" "}
          · {jh ? "JustHoot · NEAR" : chainName(tokenChain(token))}
        </h2>
        <a
          className="text-link"
          target="_blank"
          rel="noreferrer"
          href={
            jh
              ? `https://justhoot.fun/token/${token.mint}`
              : "https://dexscreener.com/" +
                tokenChain(token) +
                "/" +
                encodeURIComponent(token.dex?.pool ?? token.mint)
          }
        >
          {jh ? "Open on JustHoot.fun ↗" : "Open source chart ↗"}
        </a>
      </div>
      <p>
        {jh
          ? `JustHoot NEAR launchpad · ${jh.subtitle} · 24h change ${jh.change24h >= 0 ? `+${jh.change24h.toFixed(1)}%` : `${jh.change24h.toFixed(1)}%`} · ${jh.holders} holders.`
          : "Real source pool data · preview only. No position was opened."}
      </p>
      <div className="quote-context">
        <div>
          <span>Market cap</span>
          <strong>
            {jh ? jh.marketCapLabel : dollars(token.marketCap.value)}
          </strong>
        </div>
        <div>
          <span>{jh ? "24h volume" : "5m volume"}</span>
          <strong>
            {jh ? jh.volume24hLabel : dollars(token.volume5m.value)}
          </strong>
        </div>
        <div>
          <span>{jh ? "Holders" : "Liquidity"}</span>
          <strong>
            {jh ? `${jh.holders} (${jh.ageLabel})` : dollars(token.liquidity.value)}
          </strong>
        </div>
      </div>
      {jh ? (
        <JustHootChartView entry={jh} />
      ) : chartUrl ? (
        <iframe
          className="dex-pair-chart"
          title={`${token.symbol} DEX Screener chart`}
          src={chartUrl}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      ) : (
        <p>No supported reference pair is available for this chart.</p>
      )}
      <p className="disclosure">
        {jh
          ? "JustHoot · Ref Finance DCL v2 reference data (NEAR Mainnet). Launchpad bonding-curve and hatched pools are screened by JustHoot room status rather than GoPlus EVM checks."
          : "DEX Screener provides this external chart. If embedding is unavailable, use Open source chart. Prices are reference-pool metrics. BNB/Base use GoPlus; NEAR risk checks are not connected."}
      </p>
    </section>
  );
}
