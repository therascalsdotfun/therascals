import { ArrowUpRight, ChevronDown, Flame } from "lucide-react";
import { WalletLogo, SolanaLogo } from "./Icons.tsx";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import { selectedPairLinks } from "../../../packages/shared/src/trading-links.ts";
import { TokenTicker } from "./TokenMedia.tsx";
import { AssetLabel } from "./portfolio/AssetIcon.tsx";
import { SOLANA_SELL_OUTPUTS } from "../../../packages/shared/src/sell-output.ts";
export function AdvancedTrading({
  token,
}: {
  token?: TokenObservation | null;
}) {
  if (!token) return null;
  const pair = selectedPairLinks(token.mint);
  if (!pair) return null;
  return (
    <section
      className="advanced-handoff compact-handoff"
      aria-label="Advanced trading"
    >
      <div>
        <span>Go deeper</span>
        <strong>
          Trade{" "}
          <TokenTicker
            symbol={token.symbol}
            src={token.dex?.icon ?? token.icon}
            size={18}
          />{" "}
          elsewhere
        </strong>
        <details className="handoff-details">
          <summary>
            External mainnet apps <ChevronDown size={12} />
          </summary>
          <p>
            Jupiter opens the exact{" "}
            <AssetLabel
              asset={{ mint: SOLANA_SELL_OUTPUTS.USDC.mint, symbol: "USDC" }}
              network="Solana mainnet"
              size={16}
            />{" "}
            /{" "}
            <TokenTicker
              symbol={token.symbol}
              src={token.dex?.icon ?? token.icon}
              size={16}
            />{" "}
            pair. NEAR has a separate asset catalog. Opening a link submits no
            trade and transfers no funds.
          </p>
          <p>
            To trade perpetual futures with up to 40x leverage, use confidential perps on
            near.com powered by Hyperliquid and settled via NEAR Intents.
          </p>
          <code className="handoff-mint">{token.mint}</code>
        </details>
      </div>
      <div className="handoff-actions">
        <a
          className="secondary"
          href={pair.jupiter}
          target="_blank"
          rel="noreferrer"
        >
          <SolanaLogo size={16} /> Jupiter <ArrowUpRight size={15} />
        </a>
        <a
          className="secondary"
          href="https://near.com/home"
          target="_blank"
          rel="noreferrer"
        >
          <WalletLogo kind="near" size={16} /> NEAR <ArrowUpRight size={15} />
        </a>
        <a
          className="secondary perps-action-btn"
          href="https://perps.near.com/"
          target="_blank"
          rel="noreferrer"
          title="Trade confidential 40x perps on near.com powered by Hyperliquid"
        >
          <Flame size={16} /> 40x Perps <ArrowUpRight size={15} />
        </a>
      </div>
    </section>
  );
}
