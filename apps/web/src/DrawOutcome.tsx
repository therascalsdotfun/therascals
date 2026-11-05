import { assetBrand } from "./portfolio/asset-art.ts";
import type { DiscoveryChain } from "../../../packages/shared/src/token-selection.ts";
import { StatusJourney } from "./StatusJourney.tsx";
import { SlidersHorizontal, Dices } from "lucide-react";
import { TokenIcon } from "./TokenMedia.tsx";
import { tokenTicker } from "../../../packages/shared/src/token-ticker.ts";
import { ArrowRight, RefreshCw } from "lucide-react";
export function DrawOutcome({
  symbol,
  icon,
  mint,
  chain = "solana",
  onReset,
  onQuote,
  previewActionLabel,
}: {
  symbol: string;
  icon?: string | null;
  mint?: string;
  chain?: DiscoveryChain;
  onReset: () => void;
  onQuote: () => void;
  previewActionLabel?: string;
}) {
  const brand = assetBrand(
    mint ?? "",
    chain === "solana"
      ? "Solana mainnet"
      : chain === "near"
        ? "NEAR mainnet"
        : "EVM mainnet",
    chain === "base" ? "0x2105" : chain === "bsc" ? "0x38" : undefined,
  );
  const art = (size: number) => (
    <TokenIcon
      symbol={brand ?? symbol}
      src={icon}
      size={size}
      branded={!!brand}
    />
  );
  return (
    <div className="cage-actions draw-outcome" aria-label="Draw result">
      <StatusJourney
        headline={
          <>
            {art(22)}
            {tokenTicker(symbol)} pulled.
          </>
        }
        badge="Roll complete"
        tone="success"
        detail="Free preview · nothing bought. Review the token and route before approving a trade."
        nodes={[
          {
            id: "pool",
            name: "Your filters",
            label: "Your filters",
            icon: <SlidersHorizontal size={25} />,
            state: "complete",
            detail: "Pool set",
          },
          {
            id: "draw",
            name: "Draw",
            label: "Draw",
            icon: <Dices size={25} />,
            state: "complete",
            detail: "Revealed",
          },
          {
            id: "token",
            name: tokenTicker(symbol),
            label: tokenTicker(symbol),
            icon: art(32),
            state: "complete",
            detail: "Pulled",
          },
        ]}
      />
      <div className="outcome-buttons">
        <button className="primary play-action" onClick={onQuote}>
          <ArrowRight size={18} />
          {previewActionLabel ?? "Review mainnet routes"}
        </button>
        <button className="secondary play-action" onClick={onReset}>
          <RefreshCw size={16} />
          Roll again
        </button>
      </div>
    </div>
  );
}
