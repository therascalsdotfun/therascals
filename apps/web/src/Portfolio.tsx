import { HoldingsTable } from "./portfolio/HoldingsTable.tsx";
import { MainnetHistory } from "./MainnetHistory.tsx";
import { useEffect, useState } from "react";
import {
  useWallets,
  WalletConnections,
  type ConnectedWallet,
} from "./wallets/Wallets.tsx";
import {
  readEvmPortfolio,
  switchToBase,
  formatUnits,
  type WalletPortfolio,
} from "./wallets/providers.ts";
import { walletRequest } from "./wallets/requests.ts";
import { WalletLogo, SolanaLogo, ChainLogo } from "./Icons.tsx";
import { RefreshCw, Search, Wallet, ArrowLeft } from "lucide-react";
const money = (n: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(n);
function WalletHolding({
  wallet,
  onChart,
  readOnly = false,
}: {
  wallet: ConnectedWallet;
  onChart: (mint: string, symbol: string) => void;
  readOnly?: boolean;
}) {
  const { evm } = useWallets(),
    [record, setRecord] = useState<{
      key: string;
      data: WalletPortfolio;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [switchingBase, setSwitchingBase] = useState(false);
  const key =
    wallet.kind +
    ":" +
    wallet.address +
    ":" +
    (wallet.chainId ?? "") +
    ":" +
    false;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const read = async (signal: AbortSignal) => {
      if (wallet.kind === "metamask") {
        if (!evm) throw Error("MetaMask provider unavailable");
        let tracked = [];
        let catalogUnavailable = false;
        if (["0x2105", "0x38"].includes(wallet.chainId?.toLowerCase() ?? "")) {
          try {
            const r = await fetch(
              `/api/evm/tokens/${wallet.chainId?.toLowerCase() === "0x38" ? "bsc" : "base"}`,
              {
                signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
              },
            );
            if (!r.ok) throw Error("Catalog unavailable");
            tracked = (await r.json()).tokens ?? [];
          } catch {
            if (signal.aborted) throw signal.reason;
            catalogUnavailable = true;
          }
        }
        try {
          const saved = JSON.parse(
            localStorage.getItem("rascals-evm-mainnet-trades-v1") ?? "[]",
          );
          if (Array.isArray(saved))
            tracked = [
              ...tracked,
              ...saved
                .filter(
                  (t) =>
                    t?.quote?.wallet?.toLowerCase() ===
                      wallet.address.toLowerCase() &&
                    (t.quote.chain === "base"
                      ? "0x2105"
                      : t.quote.chain === "bsc"
                        ? "0x38"
                        : "") === wallet.chainId?.toLowerCase() &&
                    /^0x[0-9a-fA-F]{64}$/.test(t.hash ?? ""),
                )
                .map((t) => ({
                  address: t.quote.mint,
                  symbol: t.quote.symbol,
                  name: t.quote.symbol,
                })),
            ];
        } catch {
          /* Indexed contracts still remain available. */
        }
        const portfolio = await readEvmPortfolio(evm, wallet.address, tracked);
        if (catalogUnavailable)
          portfolio.warnings = [
            ...(portfolio.warnings ?? []),
            "Token index unavailable. Only native assets and known stablecoins were checked.",
          ];
        return portfolio;
      }
      const r = await fetch(
          `/api/portfolio/${wallet.kind === "phantom" ? "solana" : "near"}/${encodeURIComponent(wallet.address)}`,
          { signal },
        ),
        d = await r.json();
      if (!r.ok) throw Error(d.error ?? "Portfolio unavailable");
      if (d.address !== wallet.address)
        throw Error("Portfolio account mismatch");
      return d;
    };
    void walletRequest((signal) => read(signal), {
      signal: controller.signal,
      timeoutMs: 25000,
    })
      .then((data) => {
        if (active) setRecord({ key, data });
      })
      .catch((e) => {
        if (active)
          setError(
            e?.code === "REQUEST_TIMEOUT"
              ? "Balance request timed out. Try refreshing; any previous balances below keep their original timestamp."
              : "Balances are unavailable. Check your wallet/network and try refreshing.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, evm, reload]);
  useEffect(() => {
    const refresh = () => setReload((n) => n + 1);
    window.addEventListener("rascals-evm-trades", refresh);
    window.addEventListener("rascals-portfolio-trades", refresh);
    return () => {
      window.removeEventListener("rascals-evm-trades", refresh);
      window.removeEventListener("rascals-portfolio-trades", refresh);
    };
  }, []);
  const data = record?.key === key ? record.data : null,
    priced = data?.assets.filter((a) => a.valueUsd != null) ?? [];
  const explorer =
    wallet.kind === "phantom"
      ? "https://solscan.io/account/"
      : wallet.kind === "near"
        ? "https://nearblocks.io/address/"
        : ({
            "0x1": "https://etherscan.io/address/",
            "0xaa36a7": "https://sepolia.etherscan.io/address/",
            "0x2105": "https://basescan.org/address/",
            "0x38": "https://bscscan.com/address/",
            "0xa": "https://optimistic.etherscan.io/address/",
            "0xa4b1": "https://arbiscan.io/address/",
          }[wallet.chainId ?? ""] ?? null);
  return (
    <section className="wallet-holding">
      <div className="wallet-holding-head">
        <div>
          <h2 className="icon-label">
            {readOnly ? (
              <SolanaLogo size={25} />
            ) : (
              <WalletLogo kind={wallet.kind} size={25} />
            )}
            {readOnly
              ? "Solana address"
              : wallet.kind === "phantom"
                ? "Phantom"
                : wallet.kind === "near"
                  ? "NEAR"
                  : "MetaMask"}
          </h2>
          <p>
            {data?.network ?? wallet.network}
            {readOnly ? " · read-only address, not connected" : ""}
          </p>
          {explorer ? (
            <a
              className="mint-link"
              href={explorer + encodeURIComponent(wallet.address) + ""}
              target="_blank"
              rel="noreferrer"
            >
              {wallet.address.slice(0, 14)}…{wallet.address.slice(-8)} ↗
            </a>
          ) : (
            <small className="mint-link">{wallet.address}</small>
          )}
        </div>
        <button
          className="text-link"
          disabled={loading}
          onClick={() => setReload((n) => n + 1)}
        >
          <RefreshCw size={15} className={loading ? "icon-spin" : ""} />{" "}
          {loading ? "Reading balances…" : "Refresh"}
        </button>
      </div>
      {wallet.kind === "metamask" &&
        wallet.chainId?.toLowerCase() !== "0x2105" && (
          <button
            className="pool-edit-button"
            disabled={loading || switchingBase || !evm}
            onClick={async () => {
              if (!evm) return;
              setSwitchingBase(true);
              setError("");
              try {
                await walletRequest(() => switchToBase(evm), {
                  timeoutMs: 60000,
                });
                setReload((n) => n + 1);
              } catch {
                setError(
                  "Base network switch cancelled or unavailable. Choose Base in MetaMask and refresh.",
                );
              } finally {
                setSwitchingBase(false);
              }
            }}
          >
            <ChainLogo chain="base" size={19} />
            {switchingBase
              ? "Confirm Base in MetaMask…"
              : "Switch MetaMask to Base"}
          </button>
        )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && !data ? (
        <p className="portfolio-loading">
          <i className="spinner" /> Reading actual on-chain balances…
        </p>
      ) : data ? (
        <>
          {priced.length > 0 && (
            <p className="wallet-priced">
              {money(priced.reduce((n, a) => n + (a.valueUsd ?? 0), 0))}{" "}
              <span>
                priced assets · {data.assets.length - priced.length} unpriced
              </span>
            </p>
          )}
          <HoldingsTable
            data={data}
            wallet={wallet}
            readOnly={readOnly}
            stale={
              loading || !!error || Date.now() - Date.parse(data.asOf) > 120000
            }
            onChart={onChart}
            onRefresh={() => setReload((n) => n + 1)}
          />

          <p className="disclosure">{data.coverage}</p>
          {data.warnings?.map((w) => (
            <p className="disclosure" key={w}>
              {w}
            </p>
          ))}
          <p className="portfolio-asof">
            Read {new Date(data.asOf).toLocaleTimeString()}
          </p>
        </>
      ) : null}
    </section>
  );
}
export function Portfolio({
  onChart,
}: {
  onChart: (mint: string, symbol: string) => void;
}) {
  const { accounts } = useWallets(),
    [watchAddress, setWatchAddress] = useState(
      () => new URLSearchParams(location.search).get("portfolioWallet") ?? "",
    ),
    [watch, setWatch] = useState(
      () => new URLSearchParams(location.search).get("portfolioWallet") ?? "",
    ),
    [watchError, setWatchError] = useState(""),
    wallets = Object.values(accounts);
  return (
    <section className="portfolio-page">
      <div className="page-heading">
        <div>
          <h1>Your portfolio</h1>
          <p>{"Your tokens, tracked entry and unrealized performance."}</p>
        </div>
        <a href="#draw" className="text-link">
          <ArrowLeft size={16} /> Back to the draw
        </a>
      </div>

      <p className="portfolio-scope">
        {wallets.length} connected {wallets.length === 1 ? "wallet" : "wallets"}
      </p>
      {
        <>
          {wallets.map((w) => (
            <WalletHolding
              key={w.kind + w.address}
              wallet={w}
              onChart={onChart}
            />
          ))}
          <MainnetHistory />
          <details className="portfolio-wallet-settings" open={!wallets.length}>
            <summary>Wallet connections</summary>
            <WalletConnections />
          </details>
          <section className="watch-wallet">
            <h2 className="icon-label">
              <Search size={19} /> Inspect a Solana address
            </h2>
            <p>
              Read balances without connecting or verifying. This does not grant
              account access.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(watchAddress)) {
                  setWatchError("Enter a valid Solana address.");
                  return;
                }
                setWatchError("");
                setWatch(watchAddress);
              }}
            >
              <label htmlFor="watch-address">Public address</label>
              <div>
                <input
                  id="watch-address"
                  value={watchAddress}
                  onChange={(e) => setWatchAddress(e.target.value)}
                  placeholder="Paste wallet address"
                  spellCheck={false}
                />
                <button className="secondary">
                  <Search size={16} /> View balances
                </button>
              </div>
            </form>
            {watchError && (
              <p className="error" role="alert">
                {watchError}
              </p>
            )}
          </section>
          {watch &&
            !wallets.some(
              (w) => w.kind === "phantom" && w.address === watch,
            ) && (
              <WalletHolding
                key={"watch:" + watch}
                wallet={{ kind: "phantom", address: watch, network: "Solana" }}
                onChart={onChart}
                readOnly
              />
            )}
        </>
      }
    </section>
  );
}
