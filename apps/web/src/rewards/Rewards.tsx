import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWallets } from "../wallets/Wallets.tsx";
import type {
  RewardEntry,
  RewardsSnapshot,
  PointsPromotion,
} from "../../../../packages/shared/src/rewards.ts";
const UPDATE = "rascals:reward-claim",
  STORAGE = "rascals.pending-rewards.v1";
const volatilePending = new Map<string, PendingBuy>();
type PendingBuy = { wallet: string; ticketId: string; signature: string };
function pendingBuys(): PendingBuy[] {
  let stored: PendingBuy[] = [];
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
    stored = Array.isArray(list)
      ? list
          .slice(0, 20)
          .filter(
            (p) =>
              typeof p.wallet === "string" &&
              typeof p.signature === "string" &&
              typeof p.ticketId === "string",
          )
      : [];
  } catch {}
  return [
    ...new Map(
      [...stored, ...volatilePending.values()].map((p) => [p.signature, p]),
    ).values(),
  ].slice(-20);
}
/** Recovery hints only. Server receipt verification decides all credit and volume. */
export function queueMainnetReward(buy: PendingBuy) {
  volatilePending.set(buy.signature, buy);
  while (volatilePending.size > 20)
    volatilePending.delete(volatilePending.keys().next().value!);
  try {
    localStorage.setItem(
      STORAGE,
      JSON.stringify(
        [
          buy,
          ...pendingBuys().filter((p) => p.signature !== buy.signature),
        ].slice(0, 20),
      ),
    );
  } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE, { detail: buy }));
}
type RewardsContext = {
  snapshot: RewardsSnapshot | null;
  publicPromotions: PointsPromotion[];
  loading: boolean;
  error: string;
  latest: RewardEntry | null;
  dismiss: () => void;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
  action: <T>(path: string, body: unknown) => Promise<T>;
};
const Context = createContext<RewardsContext | null>(null);
export function useRewards() {
  return useContext(Context);
}
export function RewardsProvider({ children }: { children: ReactNode }) {
  const { identity } = useWallets();
  const scope = identity
    ? `${identity.kind}:${identity.address}:${identity.chainId ?? ""}`
    : "";
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [record, setRecord] = useState<{
    scope: string;
    data: RewardsSnapshot;
  } | null>(null);
  const [publicPromotions, setPublic] = useState<PointsPromotion[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [recent, setRecent] = useState<{ scope: string; entry: RewardEntry }[]>(
    [],
  );
  const inFlight = useRef(new Set<string>());
  const delivered = useRef(new Set<string>());
  const retryAttempts = useRef(new Map<string, number>());
  const readSequence = useRef(0);
  const snapshot = record?.scope === scope ? record.data : null;
  async function refresh() {
    if (!scope) return;
    const expected = scope,
      sequence = ++readSequence.current;
    setLoading(true);
    try {
      const response = await fetch("/api/rewards", {
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Points unavailable.");
      if (scopeRef.current === expected && sequence === readSequence.current) {
        setRecord({ scope: expected, data });
        setError("");
      }
    } catch (e) {
      if (scopeRef.current === expected && sequence === readSequence.current)
        setError(e instanceof Error ? e.message : "Points unavailable.");
    } finally {
      if (scopeRef.current === expected && sequence === readSequence.current)
        setLoading(false);
    }
  }
  async function refreshPublic() {
    try {
      const response = await fetch("/api/rewards/promotions", {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.promotions)) setPublic(data.promotions);
    } catch {}
  }
  async function action<T>(path: string, body: unknown): Promise<T> {
    if (!scope) throw Error("Connect and verify your wallet first.");
    const expected = scope;
    const response = await fetch("/api/rewards/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    const data = await response.json();
    if (scopeRef.current !== expected)
      throw Error(
        "Wallet changed. Refresh this wallet's points before retrying.",
      );
    if (!response.ok) throw Error(data.error || "Points update unavailable.");
    await refresh();
    void refreshPublic();
    return data as T;
  }
  async function claim(key: string, body: unknown) {
    if (!scope || inFlight.current.has(scope + key)) return;
    const expected = scope,
      operationKey = scope + key;
    inFlight.current.add(operationKey);
    try {
      const entry = await action<RewardEntry>("claim", body);
      if (scopeRef.current !== expected) return;
      const deliveryKey = expected + ":" + entry.id;
      let seen = delivered.current.has(deliveryKey);
      try {
        seen =
          seen ||
          sessionStorage.getItem("rascals.reward-seen." + entry.id) === "1";
      } catch {}
      if (!seen) {
        delivered.current.add(deliveryKey);
        setRecent((queue) => [...queue, { scope: expected, entry }]);
        try {
          sessionStorage.setItem("rascals.reward-seen." + entry.id, "1");
        } catch {}
      }
      return entry;
    } catch (e) {
      if (scopeRef.current === expected)
        setError(e instanceof Error ? e.message : "Reward check unavailable.");
    } finally {
      inFlight.current.delete(operationKey);
    }
  }
  async function claimBuy(buy: PendingBuy) {
    if (identity?.kind !== "phantom" || identity.address !== buy.wallet) return;
    const entry = await claim(buy.signature, {
      lane: "mainnet",
      ticketId: buy.ticketId,
      signature: buy.signature,
    });
    if (entry) {
      retryAttempts.current.delete(buy.signature);
      volatilePending.delete(buy.signature);
      try {
        localStorage.setItem(
          STORAGE,
          JSON.stringify(
            pendingBuys().filter((p) => p.signature !== buy.signature),
          ),
        );
      } catch {}
    }
  }
  async function retry() {
    await refresh();
    retryAttempts.current.clear();
    for (const buy of pendingBuys().filter(
      (p) => p.wallet === identity?.address,
    ))
      await claimBuy(buy);
  }
  useEffect(() => {
    setError("");
    setLoading(false);
    setRecord(null);
    setRecent([]);
    if (scope) void retry();
    const handler = (event: Event) => {
      const buy = (event as CustomEvent<PendingBuy>).detail;
      if (buy) void claimBuy(buy);
    };
    window.addEventListener(UPDATE, handler);
    // A plugin callback can arrive before RPC finality. Retry the same receipt,
    // never submit another trade. Bounded retries avoid hammering an unavailable RPC.
    const timer = setInterval(() => {
      const next = pendingBuys().find(
        (buy) =>
          buy.wallet === identity?.address &&
          (retryAttempts.current.get(buy.signature) ?? 0) < 10 &&
          !inFlight.current.has(scope + buy.signature),
      );
      if (next) {
        retryAttempts.current.set(
          next.signature,
          (retryAttempts.current.get(next.signature) ?? 0) + 1,
        );
        void claimBuy(next);
      }
    }, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener(UPDATE, handler);
    };
  }, [scope]);
  useEffect(() => {
    void refreshPublic();
    const id = setInterval(() => void refreshPublic(), 60000);
    return () => clearInterval(id);
  }, []);
  return (
    <Context.Provider
      value={{
        snapshot,
        publicPromotions,
        loading,
        error,
        latest:
          recent.find(
            (item) => item.scope === scope && item.entry.lane === "mainnet",
          )?.entry ?? null,
        dismiss: () =>
          setRecent((queue) =>
            queue.filter(
              (item, i) =>
                i !== queue.findIndex((next) => next.scope === scope),
            ),
          ),
        refresh,
        retry,
        action,
      }}
    >
      {children}
    </Context.Provider>
  );
}
