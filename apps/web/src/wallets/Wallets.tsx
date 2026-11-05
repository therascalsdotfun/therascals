import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { confirmLogout } from "./logout.ts";
import { ExclusiveWallet } from "./exclusive.ts";
import { WalletLogo } from "../Icons.tsx";
import {
  ShieldCheck,
  Unplug,
  LogOut,
  Wallet,
  ArrowRightLeft,
} from "lucide-react";
import { WalletLifecycle } from "./lifecycle.ts";
import {
  selectMetaMask,
  phantomProvider,
  walletError,
  type Announcement,
  type EvmProvider,
} from "./providers.ts";
import {
  WalletRequestGate,
  walletRequest,
  throwIfCancelled,
  WalletRequestError,
} from "./requests.ts";
import {
  authenticateWallet,
  retryWalletIssue,
  type AuthStage,
} from "./auth-client.ts";
import {
  sameWallet,
  type WalletIdentity,
  type WalletKind,
} from "../../../../packages/shared/src/wallet-auth.ts";
export type { WalletKind };
export type ConnectedWallet = {
  kind: WalletKind;
  address: string;
  network: string;
  chainId?: string;
};
type Issue = {
  kind: WalletKind;
  action: "connect" | "verify" | "logout";
  message: string;
};
type Pending = {
  kind: WalletKind;
  action: "connect" | "verify" | "disconnect";
  stage: string;
};
type WalletContext = {
  signIntentsSession: (
    challenge: import("./intents-auth.ts").IntentsSessionChallenge,
  ) => Promise<string>;
  accounts: Partial<Record<WalletKind, ConnectedWallet>>;
  pending: WalletKind | null;
  pendingInfo: Pending | null;
  identity: WalletIdentity | null;
  error: string;
  issue: Issue | null;
  connect: (kind: WalletKind) => Promise<void>;
  verify: (kind: WalletKind) => Promise<void>;
  disconnect: (kind: WalletKind) => Promise<void>;
  signOut: () => Promise<void>;
  cancel: () => void;
  evm: EvmProvider | null;
  clearError: () => void;
  sendNearTransfer: (request: {
    signerId: string;
    receiverId: string;
    amount: string;
  }) => Promise<string>;
};
const Context = createContext<WalletContext | null>(null),
  key = "jackpot-connected-wallets-v1",
  logoutKey = "jackpot-auth-logout-pending";
let nearPromise: Promise<NearConnector> | null = null;
/** The built document publishes its `script-src` nonce in a meta tag. The
 * connector's `srcdoc` iframe inherits the page policy, and a script element's
 * own nonce attribute is blanked once it runs, so the meta is the only channel
 * the bridge can still read. */
const pageCspNonce = () =>
  document.querySelector('meta[name="csp-nonce"]')?.getAttribute("content") ??
  undefined;
function nearConnector() {
  return (nearPromise ??= import("@hot-labs/near-connect")
    .then(
      ({ NearConnector }) =>
        new NearConnector({
          network: "mainnet",
          features: { signInWithoutAddKey: true, signMessage: true },
          autoConnect: false,
          cspNonce: pageCspNonce(),
          excludedWallets: ["ethereum-wallets", "wallet-connect", "near-cli"],
        }),
    )
    .catch((e) => {
      nearPromise = null;
      throw e;
    }));
}
function readRemembered(): WalletKind[] {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(data)
      ? data
          .filter((x) => ["near", "metamask", "phantom"].includes(x))
          .slice(-1)
      : [];
  } catch {
    return [];
  }
}
function logoutMarker(on?: boolean) {
  try {
    if (on === true) localStorage.setItem(logoutKey, "1");
    else if (on === false) localStorage.removeItem(logoutKey);
    return localStorage.getItem(logoutKey) === "1";
  } catch {
    return false;
  }
}
const labels = { near: "NEAR", metamask: "MetaMask", phantom: "Phantom" };
export function WalletProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<
      Partial<Record<WalletKind, ConnectedWallet>>
    >({}),
    [pending, setPending] = useState<Pending | null>(null),
    [identity, setIdentity] = useState<WalletIdentity | null>(null),
    [issue, setIssue] = useState<Issue | null>(null),
    [evm, setEvm] = useState<EvmProvider | null>(null),
    [solanaProvider, setSolanaProvider] = useState<any>(() =>
      phantomProvider(),
    );
  const accountRef = useRef(accounts),
    identityRef = useRef<WalletIdentity | null>(null),
    remembered = useRef(new Set(readRemembered())),
    exclusive = useRef(new ExclusiveWallet(readRemembered())),
    restoring = useRef(new Set(readRemembered())),
    active = useRef(true),
    near = useRef<NearConnector | null>(null),
    nearCleanup = useRef<() => void>(() => {}),
    announcements = useRef<Announcement[]>([]),
    gate = useRef(new WalletRequestGate()),
    requestEpoch = useRef(0),
    authEpoch = useRef(0),
    logoutPending = useRef(logoutMarker()),
    logoutWork = useRef<Promise<boolean> | null>(null),
    logoutFailure = useRef<unknown>(null),
    operation = useRef<Pending | null>(null),
    lifecycle = useRef({
      near: new WalletLifecycle(),
      metamask: new WalletLifecycle(),
      phantom: new WalletLifecycle(),
    });
  function showIdentity(value: WalletIdentity | null) {
    identityRef.current = value;
    if (active.current) setIdentity(value);
  }
  function remember(kind: WalletKind, on: boolean) {
    if (on) {
      remembered.current.clear();
      remembered.current.add(kind);
    } else remembered.current.delete(kind);
    try {
      localStorage.setItem(key, JSON.stringify([...remembered.current]));
    } catch {}
  }
  async function revokeSession(): Promise<boolean> {
    ++authEpoch.current;
    showIdentity(null);
    logoutPending.current = true;
    logoutMarker(true);
    if (logoutWork.current) return logoutWork.current;
    const work = walletRequest(
      async (signal) => {
        await confirmLogout(signal);
        return true;
      },
      { timeoutMs: 10000 },
    ).then(
      () => {
        logoutFailure.current = null;
        logoutPending.current = false;
        logoutMarker(false);
        return true;
      },
      (error) => {
        logoutFailure.current =
          error instanceof WalletRequestError &&
          error.code === "REQUEST_TIMEOUT"
            ? { code: "LOGOUT_TIMEOUT" }
            : error;
        return false;
      },
    );
    logoutWork.current = work;
    const ok = await work;
    if (logoutWork.current === work) logoutWork.current = null;
    return ok;
  }
  function report(kind: WalletKind, action: Issue["action"], error: unknown) {
    if (active.current) setIssue({ kind, action, message: walletError(error) });
  }
  function cancel(
    reason: unknown = new WalletRequestError("REQUEST_CANCELLED", "Cancelled"),
  ) {
    const op = operation.current;
    if (!op) return;
    ++requestEpoch.current;
    operation.current = null;
    gate.current.cancel();
    if (op.action === "connect") {
      lifecycle.current[op.kind].disconnect();
      exclusive.current.clear(op.kind);
      remember(op.kind, false);
      account(op.kind, null);
    }
    if (active.current) setPending(null);
    report(op.kind, op.action === "verify" ? "verify" : "connect", reason);
    if (op.action === "verify")
      void revokeSession().then((ok) => {
        if (!ok)
          report(
            op.kind,
            "logout",
            logoutFailure.current ?? { code: "LOGOUT_UNCONFIRMED" },
          );
      });
  }
  function account(kind: WalletKind, address: string | null, chainId?: string) {
    if (!active.current || (address && !exclusive.current.accepts(kind)))
      return;
    const prior = accountRef.current[kind],
      next = address
        ? {
            kind,
            address,
            network:
              kind === "near"
                ? "NEAR mainnet"
                : kind === "phantom"
                  ? "Solana mainnet"
                  : "EVM " + (chainId ?? ""),
            ...(chainId ? { chainId } : {}),
          }
        : null;
    accountRef.current = next ? {} : { ...accountRef.current };
    if (next) accountRef.current[kind] = next;
    else delete accountRef.current[kind];
    setAccounts(accountRef.current);
    if (
      operation.current?.kind === kind &&
      operation.current.action === "verify" &&
      !sameWallet(prior, next)
    )
      cancel({ code: "ACCOUNT_CHANGED" });
    if (
      identityRef.current?.kind === kind &&
      !sameWallet(identityRef.current, next)
    )
      void revokeSession().then((ok) =>
        report(kind, ok ? "verify" : "logout", {
          code: ok ? "ACCOUNT_CHANGED" : "LOGOUT_UNCONFIRMED",
        }),
      );
  }
  async function refreshIdentity() {
    if (!active.current || operation.current) return;
    if (logoutPending.current || logoutMarker()) {
      const ok = await revokeSession();
      if (!ok)
        report(
          "phantom",
          "logout",
          logoutFailure.current ?? { code: "LOGOUT_UNCONFIRMED" },
        );
      return;
    }
    const stamp = authEpoch.current;
    try {
      const data = await walletRequest(
        async (signal) => {
          const r = await fetch("/api/auth/session", {
            credentials: "same-origin",
            cache: "no-store",
            signal,
          });
          if (!r.ok) throw Error();
          return r.json();
        },
        { timeoutMs: 8000 },
      );
      if (!active.current || stamp !== authEpoch.current || operation.current)
        return;
      const value = data.identity as WalletIdentity | null;
      if (!value) {
        if (identityRef.current)
          report(identityRef.current.kind, "verify", {
            code: "SESSION_EXPIRED",
          });
        showIdentity(null);
        return;
      }
      // A passive tab may not expose the connector that authenticated another tab.
      // Only explicit account/network events or sign-out revoke server identity.
      showIdentity(
        sameWallet(value, accountRef.current[value.kind]) &&
          Date.parse(value.expiresAt) > Date.now()
          ? value
          : null,
      );
    } catch {
      if (
        active.current &&
        stamp === authEpoch.current &&
        identityRef.current
      ) {
        const kind = identityRef.current.kind;
        showIdentity(null);
        report(kind, "verify", { code: "AUTH_UNAVAILABLE" });
      }
    }
  }
  async function ensureNear() {
    const c = await nearConnector();
    if (near.current !== c && active.current) {
      near.current = c;
      const signedIn = ({ accounts: a }: any) => {
          lifecycle.current.near.accountChanged(a?.[0]?.accountId ?? null);
          if (
            !lifecycle.current.near.connecting &&
            remembered.current.has("near")
          )
            account("near", a?.[0]?.accountId ?? null);
        },
        signedOut = () => {
          lifecycle.current.near.disconnect();
          account("near", null);
        };
      c.on("wallet:signIn", signedIn);
      c.on("wallet:signOut", signedOut);
      nearCleanup.current = () => {
        c.off("wallet:signIn", signedIn);
        c.off("wallet:signOut", signedOut);
      };
    }
    return c;
  }
  useEffect(() => {
    active.current = true;
    const announced = (event: Event) => {
      const detail = (event as CustomEvent<Announcement>).detail;
      if (!detail?.info?.rdns || !detail.provider?.request) return;
      if (
        !announcements.current.some(
          (a) =>
            a.info.uuid === detail.info.uuid && a.provider === detail.provider,
        )
      )
        announcements.current.push(detail);
      const p = selectMetaMask(announcements.current, (window as any).ethereum);
      if (p) setEvm(p);
    };
    const crossTab = (event: StorageEvent) => {
      if (event.key === logoutKey && event.newValue === "1") {
        ++authEpoch.current;
        showIdentity(null);
        if (operation.current?.action === "verify") cancel();
      }
    };
    window.addEventListener("eip6963:announceProvider", announced);
    window.addEventListener("storage", crossTab);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setEvm(selectMetaMask(announcements.current, (window as any).ethereum));
    const nearStamp = lifecycle.current.near.stamp();
    if (remembered.current.has("near"))
      void walletRequest(
        async () => {
          const c = await ensureNear();
          return c.getConnectedWallet();
        },
        { timeoutMs: 15000 },
      )
        .then(({ accounts: a }) => {
          if (
            remembered.current.has("near") &&
            lifecycle.current.near.isCurrent(nearStamp)
          )
            account("near", a[0]?.accountId ?? null);
        })
        .catch(() => {})
        .finally(() => {
          restoring.current.delete("near");
          void refreshIdentity();
        });
    void refreshIdentity();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshIdentity();
    }, 30000);
    const focus = () => void refreshIdentity();
    window.addEventListener("focus", focus);
    return () => {
      active.current = false;
      ++requestEpoch.current;
      ++authEpoch.current;
      gate.current.cancel();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("storage", crossTab);
      window.removeEventListener("eip6963:announceProvider", announced);
      nearCleanup.current();
      near.current = null;
      Object.values(lifecycle.current).forEach((l) => l.disconnect());
    };
  }, []);
  useEffect(() => {
    if (!evm) {
      restoring.current.delete("metamask");
      return;
    }
    const life = lifecycle.current.metamask;
    async function refresh(stamp: number) {
      if (!remembered.current.has("metamask") || life.connecting) return;
      account("metamask", null);
      try {
        const result = await walletRequest(
          async () => ({
            a: await evm!.request({ method: "eth_accounts" }),
            chain: await evm!.request({ method: "eth_chainId" }),
          }),
          { timeoutMs: 12000 },
        );
        if (life.isCurrent(stamp) && remembered.current.has("metamask"))
          account("metamask", result.a?.[0] ?? null, result.chain);
      } catch {
      } finally {
        restoring.current.delete("metamask");
        void refreshIdentity();
      }
    }
    const changed = (a: string[]) => {
        const stamp = life.accountChanged(a?.[0] ?? null);
        void refresh(stamp);
      },
      chainChanged = (chain: string) => {
        const stamp = life.chainChanged(chain);
        void refresh(stamp);
      },
      disconnected = () => {
        life.disconnect();
        account("metamask", null);
      };
    evm.on?.("accountsChanged", changed);
    evm.on?.("chainChanged", chainChanged);
    evm.on?.("disconnect", disconnected);
    if (remembered.current.has("metamask")) void refresh(life.stamp());
    return () => {
      evm.removeListener?.("accountsChanged", changed);
      evm.removeListener?.("chainChanged", chainChanged);
      evm.removeListener?.("disconnect", disconnected);
      life.disconnect();
    };
  }, [evm]);
  useEffect(() => {
    const p = solanaProvider;
    if (!p) {
      restoring.current.delete("phantom");
      return;
    }
    const life = lifecycle.current.phantom,
      changed = (pk: any) => {
        const address = pk?.toBase58?.() ?? pk?.toString?.() ?? null;
        life.accountChanged(address);
        if (!life.connecting && remembered.current.has("phantom"))
          account("phantom", address);
      },
      disconnected = () => {
        life.disconnect();
        account("phantom", null);
      },
      connected = () => {
        if (p.publicKey) changed(p.publicKey);
      };
    p.on?.("accountChanged", changed);
    p.on?.("connect", connected);
    p.on?.("disconnect", disconnected);
    const stamp = life.stamp();
    if (remembered.current.has("phantom") && !life.connecting)
      void walletRequest(() => p.connect({ onlyIfTrusted: true }), {
        timeoutMs: 12000,
      })
        .then((r: any) => {
          if (life.isCurrent(stamp) && remembered.current.has("phantom"))
            account(
              "phantom",
              r.publicKey?.toBase58?.() ?? r.publicKey?.toString?.() ?? null,
            );
        })
        .catch(() => {})
        .finally(() => {
          restoring.current.delete("phantom");
          void refreshIdentity();
        });
    return () => {
      p.removeListener?.("accountChanged", changed);
      p.removeListener?.("connect", connected);
      p.removeListener?.("disconnect", disconnected);
      life.disconnect();
    };
  }, [solanaProvider]);
  async function connect(kind: WalletKind) {
    if (operation.current || gate.current.pending) return;
    const stamp = ++requestEpoch.current,
      life = lifecycle.current[kind],
      connection = life.beginConnect(),
      op: Pending = {
        kind,
        action: "connect",
        stage: "Approve account access in your wallet",
      };
    operation.current = op;
    setPending(op);
    setIssue(null);
    try {
      const result = await gate.current.run(async (signal) => {
        const oldKind = exclusive.current.current;
        if (oldKind && oldKind !== kind) {
          if (!(await revokeSession()))
            throw new WalletRequestError(
              "LOGOUT_UNCONFIRMED",
              "Switch requires sign-out",
            );
          throwIfCancelled(signal);
          lifecycle.current[oldKind].disconnect();
          remember(oldKind, false);
          account(oldKind, null);
          // Local ownership is cleared before requesting the new connector.
          // A slow extension permission revoke does not hold the new popup hostage.
          void walletRequest(
            async () => {
              if (oldKind === "near") await near.current?.disconnect();
              if (oldKind === "phantom") await phantomProvider()?.disconnect();
            },
            { timeoutMs: 5000 },
          ).catch(() => {});
        }
        throwIfCancelled(signal);
        exclusive.current.select(kind);
        let address: string, chainId: string | undefined;
        if (kind === "near") {
          const c = await ensureNear();
          throwIfCancelled(signal);
          await c.connect();
          throwIfCancelled(signal);
          const a = await c.getConnectedWallet();
          address = a.accounts[0]?.accountId;
        } else if (kind === "metamask") {
          const p =
            evm ??
            selectMetaMask(announcements.current, (window as any).ethereum);
          if (!p)
            throw new WalletRequestError(
              "PROVIDER_MISSING",
              "MetaMask missing",
            );
          setEvm(p);
          const a = await p.request({ method: "eth_requestAccounts" });
          throwIfCancelled(signal);
          address = a?.[0];
          chainId = await p.request({ method: "eth_chainId" });
        } else {
          const p = phantomProvider();
          if (!p)
            throw new WalletRequestError("PROVIDER_MISSING", "Phantom missing");
          setSolanaProvider(p);
          const r = await p.connect();
          address = r.publicKey?.toBase58?.() ?? r.publicKey?.toString?.();
        }
        throwIfCancelled(signal);
        if (!address)
          throw new WalletRequestError(
            "PROVIDER_MISSING",
            "No account returned",
          );
        return { address, chainId };
      });
      if (active.current && stamp === requestEpoch.current) {
        const current = life.finishConnect(
          connection,
          result.address,
          result.chainId,
        );
        if (current) {
          remember(kind, true);
          restoring.current.delete(kind);
          account(kind, current.address, current.chainId);
        }
      }
    } catch (e) {
      life.cancelConnect(connection);
      if (stamp === requestEpoch.current) {
        exclusive.current.clear(kind);
        remember(kind, false);
        account(kind, null);
        report(kind, "connect", e);
      }
    } finally {
      if (active.current && stamp === requestEpoch.current) {
        operation.current = null;
        setPending(null);
        void refreshIdentity();
      }
    }
  }
  async function verify(kind: WalletKind) {
    const wallet = accountRef.current[kind];
    if (!wallet || operation.current || gate.current.pending) return;
    const stamp = ++requestEpoch.current,
      op: Pending = { kind, action: "verify", stage: "Preparing sign-in" };
    operation.current = op;
    setPending(op);
    setIssue(null);
    try {
      const result = await gate.current.run(async (signal) => {
        if (!(await revokeSession()))
          throw new WalletRequestError(
            "LOGOUT_UNCONFIRMED",
            "Sign-out unavailable",
          );
        throwIfCancelled(signal);
        const providers = {
          evm,
          phantom: phantomProvider(),
          ...(kind === "near"
            ? { near: (await (await ensureNear()).getConnectedWallet()).wallet }
            : {}),
        };
        throwIfCancelled(signal);
        return authenticateWallet(wallet, providers, {
          origin: location.origin,
          signal,
          onStage: (stage: AuthStage) => {
            if (stamp === requestEpoch.current && active.current) {
              const next = {
                ...op,
                stage: {
                  challenge: "Preparing a fresh sign-in message",
                  signature: "Approve the sign-in message in your wallet",
                  verification: "Checking signature and account ownership",
                }[stage],
              };
              operation.current = next;
              setPending(next);
            }
          },
        });
      });
      if (
        active.current &&
        stamp === requestEpoch.current &&
        sameWallet(wallet, accountRef.current[kind])
      ) {
        ++authEpoch.current;
        showIdentity(result);
      } else await revokeSession();
    } catch (e) {
      if (stamp === requestEpoch.current) {
        await revokeSession();
        report(
          kind,
          logoutPending.current ? "logout" : "verify",
          logoutPending.current
            ? (logoutFailure.current ?? { code: "LOGOUT_UNCONFIRMED" })
            : e,
        );
      }
    } finally {
      if (active.current && stamp === requestEpoch.current) {
        operation.current = null;
        setPending(null);
      }
    }
  }
  async function signOut() {
    const kind = identityRef.current?.kind ?? issue?.kind ?? "phantom";
    if (operation.current) cancel();
    const ok = await revokeSession();
    if (ok) setIssue(null);
    else
      report(
        kind,
        "logout",
        logoutFailure.current ?? { code: "LOGOUT_UNCONFIRMED" },
      );
  }
  async function disconnect(kind: WalletKind) {
    if (operation.current?.kind === kind) cancel();
    lifecycle.current[kind].disconnect();
    exclusive.current.clear(kind);
    remember(kind, false);
    account(kind, null);
    if (identityRef.current?.kind === kind) await revokeSession();
    try {
      await walletRequest(
        async () => {
          if (kind === "near") await near.current?.disconnect();
          if (kind === "phantom") await phantomProvider()?.disconnect();
        },
        { timeoutMs: 5000 },
      );
    } catch (e) {
      report(kind, "connect", e);
    }
  }
  async function sendNearTransfer(request: {
    signerId: string;
    receiverId: string;
    amount: string;
  }) {
    if (
      accountRef.current.near?.address !== request.signerId ||
      identityRef.current?.kind !== "near" ||
      identityRef.current.address !== request.signerId
    )
      throw new Error("Connect and verify the original NEAR wallet.");
    if (
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(request.receiverId) ||
      request.receiverId.length > 64 ||
      !/^[1-9]\d{0,29}$/.test(request.amount)
    )
      throw new Error("Invalid NEAR deposit transfer.");
    const c = await ensureNear(),
      connected = await c.getConnectedWallet();
    if (connected.accounts[0]?.accountId !== request.signerId)
      throw new Error("NEAR account changed before approval.");
    const result: any = await connected.wallet.signAndSendTransaction({
      network: "mainnet",
      signerId: request.signerId,
      receiverId: request.receiverId,
      actions: [{ type: "Transfer", params: { deposit: request.amount } }],
    });
    const hash = result?.transaction?.hash ?? result?.transaction_outcome?.id;
    if (typeof hash !== "string")
      throw new Error(
        "The wallet returned no transaction hash. Check the original swap before sending again.",
      );
    return hash;
  }
  async function signIntentsSession(
    challenge: import("./intents-auth.ts").IntentsSessionChallenge,
  ) {
    const address = challenge.address;
    const current = () =>
      active.current &&
      identityRef.current?.kind === "phantom" &&
      identityRef.current.address === address &&
      accountRef.current.phantom?.address === address;
    if (!current() || operation.current)
      throw new Error("Connect and verify your Phantom wallet first.");
    const { signIntentsSession: sign } = await import("./intents-auth.ts");
    return gate.current.run(async () =>
      sign(phantomProvider(), challenge, address, current),
    );
  }
  return (
    <Context.Provider
      value={{
        accounts,
        pending: pending?.kind ?? null,
        pendingInfo: pending,
        identity,
        error: issue?.message ?? "",
        issue,
        connect,
        verify,
        disconnect,
        signOut,
        cancel: () => cancel(),
        evm,
        clearError: () => setIssue(null),
        sendNearTransfer,
        signIntentsSession,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWallets() {
  const c = useContext(Context);
  if (!c) throw Error("WalletProvider is missing");
  return c;
}
export function WalletConnections({
  onConnectStart,
}: { onConnectStart?: (kind: WalletKind) => void } = {}) {
  const {
    accounts,
    pending,
    pendingInfo,
    identity,
    error,
    issue,
    connect,
    verify,
    disconnect,
    signOut,
    cancel,
    clearError,
  } = useWallets();
  return (
    <div className="wallet-connections">
      <p>One wallet at a time. Verify ownership with a free sign-in message.</p>
      {(["near", "metamask", "phantom"] as const).map((kind) => {
        const wallet = accounts[kind],
          verified = sameWallet(identity, wallet),
          working = pending === kind;
        return (
          <div
            className={"wallet-option" + (verified ? " wallet-verified" : "")}
            key={kind}
          >
            <span className={"wallet-logo " + kind}>
              <WalletLogo kind={kind} size={30} />
            </span>
            <div className="wallet-account-info">
              <strong>
                {labels[kind]}{" "}
                {verified && <span className="verified-badge">Verified ✓</span>}
              </strong>
              <small>
                {wallet?.address ??
                  (kind === "near"
                    ? "Choose a NEAR wallet · mainnet"
                    : kind === "metamask"
                      ? "Base and other EVM networks"
                      : "Solana mainnet · Phantom")}
              </small>
              {wallet && (
                <small>
                  {wallet.network} ·{" "}
                  {verified
                    ? "Sign-in expires " +
                      new Date(identity!.expiresAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Account access only"}
                </small>
              )}
            </div>
            <div className="wallet-option-actions">
              {wallet ? (
                <>
                  <button
                    className="secondary"
                    disabled={
                      !!pending || (!verified && issue?.action === "logout")
                    }
                    title={
                      !verified && issue?.action === "logout"
                        ? "Retry server sign-out before verifying"
                        : undefined
                    }
                    onClick={() => {
                      if (!verified) onConnectStart?.(kind);
                      void (verified ? signOut() : verify(kind));
                    }}
                  >
                    {verified ? (
                      <LogOut size={15} />
                    ) : (
                      <ShieldCheck size={15} />
                    )}
                    {verified ? "Sign out" : "Verify wallet"}
                  </button>
                  <button
                    className="text-link"
                    disabled={!!pending && pending !== kind}
                    onClick={() => void disconnect(kind)}
                  >
                    <Unplug size={14} /> Disconnect
                  </button>
                </>
              ) : (
                <button
                  className="secondary"
                  disabled={!!pending}
                  onClick={() => {
                    onConnectStart?.(kind);
                    void connect(kind);
                  }}
                >
                  {Object.keys(accounts).length ? (
                    <ArrowRightLeft size={15} />
                  ) : (
                    <Wallet size={15} />
                  )}
                  {working
                    ? "Check wallet…"
                    : Object.keys(accounts).length
                      ? "Switch wallet"
                      : "Connect"}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {pendingInfo && (
        <div className="wallet-request-status" role="status" aria-live="polite">
          <i className="spinner" />
          <div>
            <strong>
              {labels[pendingInfo.kind]} ·{" "}
              {pendingInfo.action === "verify"
                ? "Verify identity"
                : "Connect wallet"}
            </strong>
            <p>{pendingInfo.stage}</p>
            <small>
              You can cancel here. A wallet popup may need closing separately.
            </small>
          </div>
          <button className="text-link" onClick={cancel}>
            Cancel request
          </button>
        </div>
      )}
      {error && (
        <div className="wallet-request-error" role="alert">
          <p>{error}</p>
          <div>
            <button
              className="secondary"
              disabled={!!pending}
              onClick={() =>
                void (issue
                  ? retryWalletIssue(issue, !!accounts[issue.kind], {
                      connect,
                      verify,
                      signOut,
                    })
                  : undefined)
              }
            >
              {issue?.action === "logout"
                ? "Retry sign-out"
                : issue?.action === "verify" && accounts[issue.kind]
                  ? "Try verification again"
                  : "Try connection again"}
            </button>
            <button className="text-link" onClick={clearError}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      <p className="disclosure">
        Sign-in never deposits funds or approves tokens. MetaMask and Phantom
        need their wallet browser or extension.
      </p>
      {location.protocol === "https:" && (
        <a
          className="text-link"
          href={`https://phantom.com/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`}
        >
          Open in Phantom browser ↗
        </a>
      )}
    </div>
  );
}
