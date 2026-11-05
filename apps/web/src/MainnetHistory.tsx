import { useEffect, useState } from "react";
import { useWallets } from "./wallets/Wallets.tsx";
import { ArrowUpRight } from "lucide-react";
import {
  EVM_MAINNET,
  sameEvm,
} from "../../../packages/shared/src/evm-mainnet.ts";
export function MainnetHistory() {
  const { accounts } = useWallets(),
    address = accounts.phantom?.address,
    evmAddress = accounts.metamask?.address,
    [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    const read = () => {
      try {
        const data = JSON.parse(
          localStorage.getItem("jackpot-mainnet-receipts") ?? "[]",
        );
        const solana = Array.isArray(data)
          ? data
              .filter(
                (r) =>
                  r.wallet === address &&
                  /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(r.signature),
              )
              .slice(0, 20)
          : [];
        const raw = JSON.parse(
          localStorage.getItem("rascals-evm-mainnet-trades-v1") ?? "[]",
        );
        const evm = Array.isArray(raw)
          ? raw
              .filter(
                (r) =>
                  ["base", "bsc"].includes(r?.quote?.chain) &&
                  sameEvm(r?.quote?.wallet, evmAddress) &&
                  /^0x[0-9a-fA-F]{64}$/.test(r.hash ?? ""),
              )
              .slice(0, 20)
              .map((r) => ({
                signature: r.hash,
                href: `${EVM_MAINNET[r.quote.chain as "base" | "bsc"].explorer}/tx/${r.hash}`,
                at: r.requestedAt,
                provider: `${EVM_MAINNET[r.quote.chain as "base" | "bsc"].name} · ${r.status}`,
              }))
          : [];
        setItems(
          [...solana, ...evm]
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
            .slice(0, 20),
        );
      } catch {
        setItems([]);
      }
    };
    read();
    window.addEventListener("rascals-evm-trades", read);
    window.addEventListener("storage", read);
    window.addEventListener("rascals-portfolio-trades", read);
    return () => {
      window.removeEventListener("rascals-evm-trades", read);
      window.removeEventListener("storage", read);
      window.removeEventListener("rascals-portfolio-trades", read);
    };
  }, [address, evmAddress]);
  if (!items.length) return null;
  return (
    <section className="mainnet-history">
      <h2>Recent mainnet trades</h2>
      <p className="disclosure">
        Saved on this browser. Open each receipt for chain confirmation and
        actual token deltas.
      </p>
      {items.map((r) => (
        <a
          href={r.href ?? `https://explorer.solana.com/tx/${r.signature}`}
          key={r.signature}
          target="_blank"
          rel="noreferrer"
        >
          {new Date(r.at).toLocaleString()} · {r.provider ?? "Jupiter"}
          <code>{r.signature}</code>
          <ArrowUpRight size={13} />
        </a>
      ))}
    </section>
  );
}
