import { useState } from "react";
import { ArrowRightLeft, Globe } from "lucide-react";
import type { TokenObservation } from "../../../packages/shared/src/market.ts";
import { IntentsQuote } from "./IntentsQuote.tsx";
import { IntentsSwap } from "./IntentsSwap.tsx";
import { JupiterTrade } from "./JupiterTrade.tsx";
import { EvmTrade } from "./EvmTrade.tsx";
import { tokenChain } from "../../../packages/shared/src/token-selection.ts";
import "./mainnet.css";
export function MainnetTrading({
  token,
  rollId,
  amount,
  onConnect,
  onBusy,
}: {
  token?: TokenObservation | null;
  rollId?: string | null;
  amount: string;
  onConnect: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [route, setRoute] = useState<"jupiter" | "intents">("jupiter"),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  function pending(value: boolean) {
    setBusy(value);
    onBusy(value);
  }
  return (
    <div className="mainnet-trading" id="mainnet-trading">
      <div
        className="mainnet-route-tabs"
        role="group"
        aria-label="Mainnet route"
      >
        <button
          disabled={busy}
          aria-pressed={route === "jupiter"}
          onClick={() => setRoute("jupiter")}
        >
          <ArrowRightLeft size={15} />
          Token swap
        </button>
        <button
          disabled={busy}
          aria-pressed={route === "intents"}
          onClick={() => setRoute("intents")}
        >
          <Globe size={15} />
          NEAR Intents
        </button>
      </div>
      {route === "jupiter" ? (
        token && ["base", "bsc"].includes(tokenChain(token)) ? (
          <EvmTrade token={token} amount={amount} onBusy={pending} />
        ) : !token ? (
          <div className="mainnet-connect">
            <h3>Trade your draw</h3>
            <p>
              Roll a token first. Then review a live route and approve in
              Phantom or MetaMask. NEAR Intents has a separate deposit review.
            </p>
          </div>
        ) : (
          <JupiterTrade
            token={token}
            rollId={rollId}
            amount={amount}
            onBusy={pending}
          />
        )
      ) : (
        <>
          <IntentsSwap token={token} onConnect={onConnect} onBusy={pending} />
          {!busy && (
            <details
              className="intents-preview"
              onToggle={(e) => setPreview(e.currentTarget.open)}
            >
              <summary>Try a quote without a wallet</summary>
              {preview && <IntentsQuote token={token} />}
            </details>
          )}
        </>
      )}
    </div>
  );
}
