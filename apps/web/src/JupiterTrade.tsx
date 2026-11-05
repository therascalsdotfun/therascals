import { SolanaRecovery, useSolanaRecovery } from "./SolanaRecovery.tsx";
import {
  assertNoPendingSolana,
  rememberSolanaSubmission,
} from "./solana-recovery.ts";
import { ReportedSwapJourney } from "./ReportedSwapJourney.tsx";
import { TokenIcon, TokenTicker } from "./TokenMedia.tsx";
import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { ArrowUpRight, ArrowRightLeft, Wallet, X } from "lucide-react";
import { useWallets } from "./wallets/Wallets.tsx";
import { phantomProvider } from "./wallets/providers.ts";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import { tokenChain } from "../../../packages/shared/src/token-selection.ts";
import { selectedPairLinks } from "../../../packages/shared/src/trading-links.ts";
import { queueMainnetReward } from "./rewards/Rewards.tsx";
import { SOLANA_MAINNET_GENESIS } from "../../../packages/shared/src/solana-network.ts";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
let pluginFlight: Promise<any> | null = null;
export function loadJupiterPlugin(): Promise<any> {
  if ((window as any).Jupiter?.init)
    return Promise.resolve((window as any).Jupiter);
  if (pluginFlight) return pluginFlight;
  pluginFlight = new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-jackpot-jupiter]",
    );
    if (!script) {
      script = document.createElement("script");
      script.src = "https://plugin.jup.ag/plugin-v1.js";
      script.async = true;
      script.dataset.jackpotJupiter = "1";
      document.head.append(script);
    }
    const timeout = setTimeout(() => {
      pluginFlight = null;
      script?.remove();
      reject(
        Error(
          "Jupiter took too long to load. Retry or use the exact-pair link.",
        ),
      );
    }, 20000);
    script.addEventListener(
      "load",
      () => {
        clearTimeout(timeout);
        if (!(window as any).Jupiter?.init) {
          pluginFlight = null;
          reject(Error("Jupiter plugin is unavailable."));
        } else resolve((window as any).Jupiter);
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        pluginFlight = null;
        script?.remove();
        reject(
          Error("Could not load Jupiter. Check the connection and retry."),
        );
      },
      { once: true },
    );
  });
  return pluginFlight;
}
export function jupiterForm(mint: string, amount: string) {
  if (
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ||
    !/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/.test(amount) ||
    Number(amount) > 100
  )
    throw Error("Invalid token or USDC amount");
  return {
    swapMode: "ExactIn",
    initialInputMint: USDC,
    initialOutputMint: mint,
    initialAmount: String(Math.round(Number(amount) * 1e6)),
    fixedMint: mint,
    fixedAmount: true,
  };
}
export function JupiterTrade({
  token,
  rollId,
  amount,
  onBusy,
}: {
  token?: TokenObservation | null;
  rollId?: string | null;
  amount: string;
  onBusy?: (busy: boolean) => void;
}) {
  const { accounts, identity, connect, disconnect, pending } = useWallets(),
    address = accounts.phantom?.address;
  const recovery = useSolanaRecovery(address);
  const latest = useRef(address);
  latest.current = address;
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [signing, setSigning] = useState(false),
    [error, setError] = useState(""),
    [preflight, setPreflight] = useState(""),
    [receipt, setReceipt] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    instance = useRef<any>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
    onBusy?.(open);
    return () => onBusy?.(false);
  }, [open]);
  useEffect(() => () => instance.current?.close(), []);
  useEffect(() => setReceipt(""), [address]);
  useEffect(() => {
    if (
      open &&
      instance.current?.walletAddress &&
      address !== instance.current.walletAddress &&
      !signing
    ) {
      instance.current.close();
      setOpen(false);
      setError("Wallet changed. Reopen the trade with the current account.");
    }
  }, [address, open, signing]);
  async function launch() {
    if (
      !token ||
      tokenChain(token) !== "solana" ||
      !address ||
      recovery.blocked
    )
      return;
    if (!rollId) {
      setError(
        "Run a draw first: the token to buy comes from a committed roll.",
      );
      return;
    }
    setError("");
    setLoading(true);
    setReceipt("");
    try {
      const r = await fetch("/api/mainnet/recheck", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rollId, mint: token.mint, amount }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error ?? "Token check unavailable");
      const plugin = await loadJupiterPlugin();
      if (latest.current !== address)
        throw Error("Wallet changed. Review the new account first.");
      setOpen(true);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const provider = phantomProvider();
      if (provider?.publicKey?.toString() !== address)
        throw Error("Reconnect Phantom before trading");
      async function sign(tx: any, batchSignatures?: string[]) {
        const batch = !!batchSignatures;
        if (!batch) assertNoPendingSolana(address!);
        if (
          latest.current !== address ||
          provider.publicKey?.toString() !== address
        )
          throw Error("Phantom account changed");
        setSigning(true);
        try {
          setPreflight("Simulating this transaction on Solana mainnet…");
          const bytes = tx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          });
          if (bytes.length > 1232)
            throw Error(
              "Route exceeds Solana's transaction limit. Choose a smaller route in Jupiter.",
            );
          const result = await fetch("/api/mainnet/solana/simulate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              wallet: address,
              transaction: btoa(
                Array.from(bytes as Uint8Array, (b) =>
                  String.fromCharCode(b),
                ).join(""),
              ),
            }),
            signal: AbortSignal.timeout(20000),
          });
          const simulation = await result.json();
          if (!result.ok || simulation.status !== "passed")
            throw Error(
              simulation.error ??
                "Mainnet preflight failed. No wallet approval requested.",
            );
          if (
            latest.current !== address ||
            provider.publicKey?.toString() !== address
          )
            throw Error("Wallet changed during simulation");
          setPreflight(
            `Simulation passed · slot ${simulation.slot}. Review and approve in Phantom.`,
          );
          const before = tx.message
            ? tx.message.serialize()
            : tx.serializeMessage();
          const signed = await provider.signTransaction(tx);
          const after = signed.message
            ? signed.message.serialize()
            : signed.serializeMessage();
          if (
            before.length !== after.length ||
            before.some((b: number, i: number) => b !== after[i])
          )
            throw Error(
              "Wallet returned a different transaction. Nothing was submitted by Rascals.",
            );
          if (
            latest.current !== address ||
            provider.publicKey?.toString() !== address
          )
            throw Error("Wallet changed before submission");
          if (!batch) assertNoPendingSolana(address!);
          // A batch may contain setup transactions. Only a single-swap signing
          // callback can retain a reward ticket here; batch awards use onSuccess.
          const saved = await rememberSolanaSubmission(
            address!,
            signed,
            simulation.blockhashSlot,
            batch ? undefined : d.rewardTicket?.id,
            batchSignatures ?? [],
          );
          batchSignatures?.push(saved.signature);
          return signed;
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Wallet request failed";
          setPreflight(message);
          setError(message);
          throw e;
        } finally {
          setSigning(false);
        }
      }
      const adapter = {
        name: "Phantom",
        url: "https://phantom.app",
        icon: "https://phantom.app/favicon.ico",
        readyState: "Installed",
        publicKey: new PublicKey(address),
        connected: true,
        connecting: false,
        connect: async () => connect("phantom"),
        disconnect: async () => disconnect("phantom"),
        signTransaction: (tx: any) => sign(tx),
        signAllTransactions: async (txs: any[]) => {
          assertNoPendingSolana(address!);
          const batchSignatures: string[] = [];
          const out = [];
          for (const tx of txs) out.push(await sign(tx, batchSignatures));
          return out;
        },
        sendTransaction: async (tx: any, c: any, opts: any) => {
          if ((await c.getGenesisHash()) !== SOLANA_MAINNET_GENESIS)
            throw Error("Jupiter connection is not mainnet");
          return c.sendRawTransaction((await sign(tx)).serialize(), opts);
        },
      };
      const walletContext = {
        wallets: [],
        wallet: { adapter, readyState: "Installed" },
        publicKey: adapter.publicKey,
        connected: true,
        connecting: false,
        disconnecting: false,
        autoConnect: false,
        select: () => {},
        connect: adapter.connect,
        disconnect: adapter.disconnect,
        signTransaction: adapter.signTransaction,
        signAllTransactions: adapter.signAllTransactions,
        sendTransaction: adapter.sendTransaction,
      };
      plugin.init({
        displayMode: "integrated",
        integratedTargetId: "jackpot-jupiter-plugin",
        localStoragePrefix: "jackpot-jupiter-mainnet",
        enableWalletPassthrough: true,
        passthroughWalletContextState: walletContext,
        onRequestConnectWallet: () => connect("phantom"),
        formProps: jupiterForm(token.mint, amount),
        onSuccess: ({ txid, quoteResponseMeta, swapResult }: any) => {
          if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(txid)) return;
          if (latest.current === address) setReceipt(txid);
          if (d.rewardTicket?.id)
            queueMainnetReward({
              wallet: address,
              ticketId: d.rewardTicket.id,
              signature: txid,
            });
          try {
            const list = JSON.parse(
              localStorage.getItem("jackpot-mainnet-receipts") ?? "[]",
            );
            localStorage.setItem(
              "jackpot-mainnet-receipts",
              JSON.stringify(
                [
                  {
                    signature: txid,
                    wallet: address,
                    inputMint:
                      quoteResponseMeta?.original?.inputMint ??
                      swapResult?.inputAddress ??
                      null,
                    outputMint:
                      quoteResponseMeta?.original?.outputMint ??
                      swapResult?.outputAddress ??
                      null,
                    quotedInputAtomic:
                      quoteResponseMeta?.original?.inAmount ?? null,
                    quotedOutputAtomic:
                      quoteResponseMeta?.original?.outAmount ?? null,
                    at: new Date().toISOString(),
                    provider: "Jupiter",
                  },
                  ...(Array.isArray(list)
                    ? list.filter((r: any) => r.signature !== txid)
                    : []),
                ].slice(0, 50),
              ),
            );
          } catch {}
          window.dispatchEvent(new Event("rascals-portfolio-trades"));
        },
        onSwapError: () =>
          setError(
            (previous) =>
              previous ||
              "Jupiter could not complete the swap. Inspect the original transaction before trying again.",
          ),
      });
      instance.current = plugin;
      plugin.walletAddress = address;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade unavailable");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="jupiter-trade">
      <div className="mainnet-panel-heading">
        <ArrowRightLeft size={19} />
        <h2>
          Trade{" "}
          {token ? (
            <TokenTicker
              symbol={token.symbol}
              src={token.dex?.icon ?? token.icon}
              size={23}
            />
          ) : (
            "your draw"
          )}
        </h2>
        <span>SOLANA</span>
      </div>
      {!token ? (
        <p className="disclosure">
          Roll a token, then review a live swap and approve it in Phantom.
        </p>
      ) : tokenChain(token) !== "solana" ? (
        <p className="route-unavailable">
          This token is on another chain. Use an exact supported Intents route
          below.
        </p>
      ) : (
        <>
          <p className="disclosure">
            Start with {amount} <TokenTicker symbol="USDC" size={16} branded />.
            Jupiter prepares the real swap; you approve the final details in
            Phantom.
          </p>
          <p className="reward-trade-hint">
            {identity?.kind === "phantom"
              ? "Verified USDC buys trigger an automatic points spin after finality."
              : "Verify Phantom before buying to earn points. Trades work without points sign-in."}
          </p>
          <button
            className="primary"
            disabled={recovery.blocked || loading || !!pending}
            onClick={() => (address ? void launch() : void connect("phantom"))}
          >
            {loading ? (
              <i className="spinner" />
            ) : address ? (
              <ArrowRightLeft size={16} />
            ) : (
              <Wallet size={16} />
            )}
            {loading
              ? "Checking route…"
              : address
                ? "Review mainnet trade"
                : "Connect Phantom to buy"}
          </button>
          {token && (
            <a
              className="text-link"
              target="_blank"
              rel="noreferrer"
              href={selectedPairLinks(token.mint)?.jupiter}
            >
              Open exact pair on Jupiter
              <ArrowUpRight size={13} />
            </a>
          )}
        </>
      )}
      {address && <SolanaRecovery wallet={address} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <dialog
        ref={dialog}
        className="jupiter-dialog"
        onCancel={(e) => {
          if (signing) e.preventDefault();
          else {
            instance.current?.close();
            setOpen(false);
          }
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-head">
          <h2>Approve in Phantom</h2>
          <button
            className="close"
            aria-label="Close mainnet swap"
            disabled={signing}
            onClick={() => {
              instance.current?.close();
              setOpen(false);
            }}
          >
            <X size={18} />
          </button>
        </div>
        <p className="disclosure">
          Solana mainnet · spends your real wallet funds
        </p>
        <div id="jackpot-jupiter-plugin" />
        {open && token && (
          <ReportedSwapJourney
            input="USDC"
            output={token.symbol}
            inputIcon={<TokenIcon symbol="USDC" size={32} branded />}
            outputIcon={
              <TokenIcon
                symbol={token.symbol}
                src={token.dex?.icon ?? token.icon}
                size={32}
              />
            }
            submitted={!!receipt}
            busy={signing}
            error={!!error}
            detail={preflight || undefined}
          />
        )}
        {receipt && (
          <a
            className="mainnet-receipt"
            href={`https://explorer.solana.com/tx/${receipt}`}
            target="_blank"
            rel="noreferrer"
          >
            Jupiter reported a successful swap · verify receipt
            <code>{receipt}</code>
            <ArrowUpRight size={13} />
          </a>
        )}
      </dialog>
    </section>
  );
}
