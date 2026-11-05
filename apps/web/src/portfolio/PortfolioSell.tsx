import { SolanaRecovery, useSolanaRecovery } from "../SolanaRecovery.tsx";
import { assertNoPendingSolana } from "../solana-recovery.ts";
import { ReportedSwapJourney } from "../ReportedSwapJourney.tsx";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { WalletAsset } from "../wallets/providers.ts";
import { useWallets } from "../wallets/Wallets.tsx";
import { loadJupiterPlugin } from "../JupiterTrade.tsx";
import {
  atomicAmount,
  decimalAmount,
  percentageAtomic,
  SELL_PERCENTAGES,
} from "../../../../packages/shared/src/portfolio-position.ts";
import { sellWalletContext } from "./sell-wallet.ts";
import { recordPortfolioReceipt } from "./receipts.ts";
import {
  SOLANA_SELL_OUTPUTS,
  matchesSellEstimate,
  type SellOutput,
} from "../../../../packages/shared/src/sell-output.ts";
import { useSellEstimate } from "./useSellEstimate.ts";
import { AssetIcon, AssetLabel } from "./AssetIcon.tsx";
const USDC = SOLANA_SELL_OUTPUTS.USDC.mint;
const SOL = SOLANA_SELL_OUTPUTS.SOL.mint;
export function sellForm(
  mint: string,
  raw: string,
  output: SellOutput = "USDC",
) {
  if (
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ||
    !SOLANA_SELL_OUTPUTS[output] ||
    mint === SOLANA_SELL_OUTPUTS[output].mint ||
    !/^\d{1,80}$/.test(raw) ||
    BigInt(raw) <= 0n
  )
    throw Error("Invalid sale amount or token");
  return {
    swapMode: "ExactIn",
    initialInputMint: mint,
    initialOutputMint: SOLANA_SELL_OUTPUTS[output].mint,
    initialAmount: raw,
    fixedMint: mint,
    fixedAmount: true,
  };
}
export function PortfolioSell({
  asset,
  wallet,
  available,
  reason,
  onComplete,
}: {
  asset: WalletAsset;
  wallet: string;
  available: boolean;
  reason?: string;
  onComplete: () => void;
}) {
  const { accounts, connect, disconnect } = useWallets();
  const [open, setOpen] = useState(false),
    [amount, setAmount] = useState(""),
    [percent, setPercent] = useState<number | null>(25),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [signing, setSigning] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(""),
    [output, setOutput] = useState<SellOutput>(
      asset.mint === USDC ? "SOL" : "USDC",
    ),
    [lockedAmount, setLockedAmount] = useState("");
  const recovery = useSolanaRecovery(wallet);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null),
    plugin = useRef<any>(null),
    generation = useRef(0);
  const latest = useRef({
    wallet: accounts.phantom?.address,
    mint: asset.mint,
    raw: asset.raw,
    open,
  });
  latest.current = {
    wallet: accounts.phantom?.address,
    mint: asset.mint,
    raw: asset.raw,
    open,
  };
  const id = "portfolio-sell-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const supported = available && BigInt(asset.raw) > 0n;
  const inputMint = asset.mint === "native" ? SOL : asset.mint;
  let raw = "",
    validation = "";
  try {
    raw = atomicAmount(amount, asset.decimals);
    if (BigInt(raw) > BigInt(asset.raw))
      validation = "Amount exceeds the available balance.";
  } catch (e) {
    validation = e instanceof Error ? e.message : "Invalid amount";
  }
  const estimate = useSellEstimate(
    open && !review && !validation && supported,
    inputMint,
    output,
    raw,
  );
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(
    () => () => {
      generation.current++;
      plugin.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (open && (accounts.phantom?.address !== wallet || !available)) {
      generation.current++;
      plugin.current?.close();
      setReview(false);
      setOpen(false);
    }
  }, [accounts.phantom?.address, wallet, available, open]);
  function close() {
    if (busy || signing) return;
    generation.current++;
    plugin.current?.close();
    setOpen(false);
    setReview(false);
  }
  async function confirm() {
    if (
      recovery.blocked ||
      validation ||
      !supported ||
      busy ||
      review ||
      inFlight.current ||
      !matchesSellEstimate(estimate.quote, inputMint, output, raw)
    )
      return;
    inFlight.current = true;
    const op = ++generation.current,
      selectedMint = asset.mint,
      selectedBalance = asset.raw,
      selectedRaw = raw,
      selectedOutput = output;
    const current = () =>
      op === generation.current &&
      latest.current.open &&
      latest.current.wallet === wallet &&
      latest.current.mint === selectedMint &&
      latest.current.raw === selectedBalance;
    setBusy(true);
    setError("");
    setStatus("Preparing your exact-token sale…");
    setReceipt("");
    try {
      // Re-read balance before opening a route. A stale page cannot sell an old balance.
      const r = await fetch(
          "/api/portfolio/solana/" + encodeURIComponent(wallet),
          { signal: AbortSignal.timeout(25000) },
        ),
        data = await r.json();
      const fresh = data.assets?.find(
        (a: WalletAsset) => a.mint === selectedMint,
      );
      if (
        !r.ok ||
        data.address !== wallet ||
        !fresh ||
        fresh.decimals !== asset.decimals ||
        BigInt(fresh.raw) < BigInt(selectedRaw)
      )
        throw Error(
          "Balance changed or could not be checked. Refresh your holdings.",
        );
      assertNoPendingSolana(wallet);
      const jupiter = await loadJupiterPlugin();
      if (!current()) throw Error("Wallet or holdings changed. Review again.");
      setLockedAmount(decimalAmount(selectedRaw, asset.decimals));
      setReview(true);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (!current()) throw Error("Sale cancelled.");
      const context = sellWalletContext({
        address: wallet,
        current,
        status: setStatus,
        signing: setSigning,
        connect: () => connect("phantom"),
        disconnect: () => disconnect("phantom"),
      });
      jupiter.init({
        displayMode: "integrated",
        integratedTargetId: id,
        localStoragePrefix: "rascals-portfolio-sell",
        enableWalletPassthrough: true,
        passthroughWalletContextState: context,
        onRequestConnectWallet: () => connect("phantom"),
        formProps: sellForm(
          selectedMint === "native" ? SOL : selectedMint,
          selectedRaw,
          selectedOutput,
        ),
        onSuccess: ({ txid }: any) => {
          if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(txid ?? "")) return;
          recordPortfolioReceipt(wallet, txid);
          if (current()) {
            setReceipt(txid);
            setStatus(
              "Transaction submitted. Open its receipt for chain confirmation.",
            );
            onComplete();
          }
        },
        onSwapError: () =>
          setError(
            "Swap incomplete or submission status unknown. Check the original transaction before trying again.",
          ),
      });
      plugin.current = jupiter;
      setStatus(
        "Review the receive amount and route in Jupiter, then approve in Phantom.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sale unavailable");
      plugin.current?.close();
      setReview(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="holding-sell"
        disabled={!supported}
        title={reason}
        onClick={() => {
          setAmount(
            decimalAmount(percentageAtomic(asset.raw, 25), asset.decimals),
          );
          setPercent(25);
          setOutput(asset.mint === USDC ? "SOL" : "USDC");
          setError("");
          setStatus("");
          setReceipt("");
          setReview(false);
          setOpen(true);
        }}
      >
        Sell
      </button>
      <dialog
        ref={dialog}
        className="portfolio-sell-dialog"
        aria-label={`Sell ${asset.symbol}`}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClose={() => {
          if (!busy && !signing) setOpen(false);
        }}
      >
        <div className="dialog-head">
          <h2>
            Sell <AssetLabel asset={asset} network="Solana mainnet" size={24} />
          </h2>
          <button
            type="button"
            aria-label="Close sell"
            disabled={busy || signing}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          Available: {decimalAmount(asset.raw, asset.decimals)}{" "}
          <AssetLabel asset={asset} network="Solana mainnet" />
        </p>
        <SolanaRecovery wallet={wallet} onResolved={onComplete} />
        {!review && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <label htmlFor={id + "-amount"}>Amount to sell</label>
            <div className="sell-amount-input">
              <input
                id={id + "-amount"}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                disabled={busy}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setPercent(null);
                  setError("");
                }}
              />
              <span className="sell-token-label">
                <AssetIcon asset={asset} network="Solana mainnet" />
                {asset.symbol}
              </span>
            </div>
            <div
              className="sell-percentages"
              role="group"
              aria-label="Sell percentage"
            >
              {SELL_PERCENTAGES.map((p) => (
                <button
                  type="button"
                  key={p}
                  disabled={busy}
                  aria-pressed={p === percent}
                  onClick={() => {
                    setPercent(p);
                    setAmount(
                      decimalAmount(
                        percentageAtomic(asset.raw, p),
                        asset.decimals,
                      ),
                    );
                    setError("");
                  }}
                >
                  {p}%
                </button>
              ))}
            </div>
            {amount && validation && (
              <p className="error" role="alert">
                {validation}
              </p>
            )}
            <div className="sell-receive">
              <span id={id + "-receive"} className="sell-receive-label">
                Receive
              </span>
              <div
                className="sell-output-choices"
                role="group"
                aria-labelledby={id + "-receive"}
              >
                {(Object.keys(SOLANA_SELL_OUTPUTS) as SellOutput[])
                  .filter((s) => SOLANA_SELL_OUTPUTS[s].mint !== inputMint)
                  .map((s) => (
                    <button
                      type="button"
                      key={s}
                      aria-pressed={output === s}
                      disabled={busy}
                      onClick={() => {
                        setOutput(s);
                        setError("");
                      }}
                    >
                      <AssetLabel
                        asset={{ mint: SOLANA_SELL_OUTPUTS[s].mint, symbol: s }}
                        network="Solana mainnet"
                        size={20}
                      />
                    </button>
                  ))}
              </div>
              <div className="sell-estimate" role="status" aria-live="polite">
                <span>Estimated receive</span>
                <strong>
                  {estimate.quote && (
                    <AssetIcon
                      asset={{
                        mint: SOLANA_SELL_OUTPUTS[output].mint,
                        symbol: output,
                      }}
                      network="Solana mainnet"
                    />
                  )}
                  {estimate.quote
                    ? `≈ ${decimalAmount(estimate.quote.outAmount, SOLANA_SELL_OUTPUTS[output].decimals)} ${output}`
                    : validation
                      ? "Enter a valid amount"
                      : estimate.error
                        ? "Estimate unavailable"
                        : "Getting quote…"}
                </strong>
              </div>
              {estimate.error && (
                <>
                  <p className="error">{estimate.error}</p>
                  <button type="button" onClick={estimate.retry}>
                    Retry quote
                  </button>
                </>
              )}
            </div>
            <p className="disclosure">
              Estimate only, not a guaranteed return. The route starts with{" "}
              <AssetLabel
                asset={{
                  mint: SOLANA_SELL_OUTPUTS[output].mint,
                  symbol: output,
                }}
                network="Solana mainnet"
                size={14}
              />{" "}
              as the output. Review the final output, slippage and network fees
              before approving in Phantom.
            </p>
            {asset.mint === "native" && (
              <p className="disclosure">
                Leave{" "}
                <AssetLabel
                  asset={{ mint: SOL, symbol: "SOL" }}
                  network="Solana mainnet"
                  size={14}
                />{" "}
                for network fees. Selling 100% may fail preflight.
              </p>
            )}
            <button
              className="primary sell-confirm"
              disabled={
                recovery.blocked ||
                busy ||
                !!validation ||
                !supported ||
                !estimate.quote
              }
            >
              {busy ? "Checking balance…" : "Confirm"}
            </button>
          </form>
        )}
        {review && (
          <>
            <p className="sell-locked-amount">
              Selling {lockedAmount}{" "}
              <AssetLabel asset={asset} network="Solana mainnet" /> →{" "}
              <AssetLabel
                asset={{
                  mint: SOLANA_SELL_OUTPUTS[output].mint,
                  symbol: output,
                }}
                network="Solana mainnet"
              />
            </p>
            <div id={id} className="portfolio-sell-plugin" />
          </>
        )}
        {status && (
          <ReportedSwapJourney
            input={asset.symbol}
            output={output}
            inputIcon={
              <AssetIcon asset={asset} network="Solana mainnet" size={32} />
            }
            outputIcon={
              <AssetIcon
                asset={{
                  mint: SOLANA_SELL_OUTPUTS[output].mint,
                  symbol: output,
                }}
                network="Solana mainnet"
                size={32}
              />
            }
            submitted={!!receipt}
            busy={signing}
            error={!!error}
            detail={status}
          />
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {receipt && (
          <a
            href={"https://explorer.solana.com/tx/" + receipt}
            target="_blank"
            rel="noreferrer"
          >
            Open sale receipt ↗
          </a>
        )}
      </dialog>
    </>
  );
}
