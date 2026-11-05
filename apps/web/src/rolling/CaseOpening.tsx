import { tokenTicker } from "../../../../packages/shared/src/token-ticker.ts";
import { PackageOpen } from "lucide-react";
import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
import {
  chainName,
  tokenChain,
} from "../../../../packages/shared/src/token-selection.ts";
import { ChainLogo } from "../Icons.tsx";
import { TokenIcon } from "../TokenMedia.tsx";
import { PromotionTag } from "../TokenScreening.tsx";
import { caseTokenAt, caseWindow } from "./case-motion.ts";
import "./case-opening.css";
import { useReelMotion } from "./useReelMotion.ts";

type Props = {
  tokens: TokenObservation[];
  selected: TokenObservation | null;
  phase: string;
  roll: number;
  ambientMotion?: boolean;
  onExtractionStart?: () => void;
  onExtracted?: (mint: string, roll: number) => void;
  onTick?: () => void;
};
const accents = ["#d6f15c", "#9bbde1", "#e4a6bf", "#e9ba77", "#bdade1"];
const cap = (value: number | null) =>
  value === null
    ? "MC —"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 1,
      }).format(value) + " MC";

export function CaseOpening(props: Props) {
  const { frame, active, restored } = useReelMotion({
    ids: props.tokens.map((token) => token.mint),
    selectedId: props.selected?.mint ?? null,
    phase: props.phase,
    roll: props.roll,
    onExtractionStart: props.onExtractionStart,
    onExtracted: props.onExtracted,
    onTick: props.onTick,
  });
  const position = active ? frame.position : 0;
  const landed =
    active &&
    (frame.stage === "settling" || frame.stage === "complete") &&
    !!props.selected &&
    caseTokenAt(props.tokens, position)?.mint === props.selected.mint;
  return (
    <div
      className={`case-machine ${active ? "is-rolling" : "is-idle"} ${landed ? "is-landed" : ""} ${restored ? "is-restored" : ""}`}
      data-case-stage={active ? frame.stage : "idle"}
    >
      <div className="case-kicker">
        <PackageOpen size={15} /> THE MEME CASE{" "}
        <span>{props.tokens.length} tickers · equal odds</span>
      </div>
      <div className="case-stage-title">
        {landed
          ? "That's your pull."
          : active
            ? "Let it rip."
            : "What's in your next bag?"}
      </div>
      <div
        className="case-runway"
        role="img"
        aria-label={
          landed && props.selected
            ? `${props.selected.symbol} landed at the case pointer`
            : "Token cards move past a fixed selection pointer"
        }
      >
        <div className="case-pointer" aria-hidden="true">
          <i />
          <span />
        </div>
        <div className="case-slot-glow" aria-hidden="true" />
        <div className="case-cards" aria-hidden="true">
          {caseWindow(position).map((index) => {
            const token = caseTokenAt(props.tokens, index);
            if (!token) return null;
            const distance = index - position;
            const centered = Math.abs(distance) < 0.49;
            return (
              <div
                key={index}
                className={`case-card ${centered ? "at-pointer" : ""} ${landed && centered ? "the-pull" : ""}`}
                style={
                  {
                    "--slot": distance,
                    "--accent":
                      accents[
                        (((index % props.tokens.length) + props.tokens.length) %
                          props.tokens.length) %
                          accents.length
                      ],
                  } as React.CSSProperties
                }
              >
                <PromotionTag dex={token.dex} />
                <div className="case-card-cap">
                  {cap(token.marketCap.value)}
                </div>
                <TokenIcon
                  src={token.dex?.icon ?? token.icon}
                  symbol={token.symbol}
                  size={96}
                />
                <strong>{tokenTicker(token.symbol)}</strong>
                <span className="case-card-name">
                  {token.dex?.name ?? token.name}
                </span>
                <div className="case-card-footer">
                  <ChainLogo chain={tokenChain(token)} size={12} />{" "}
                  {chainName(tokenChain(token)).toUpperCase()} <span>●</span>
                </div>
              </div>
            );
          })}
        </div>
        {landed && !restored && (
          <div className="case-hit" key={props.roll} aria-hidden="true" />
        )}
      </div>
      <div className="case-readout" role="status">
        <span
          className={active && !landed ? "case-signal active" : "case-signal"}
        />
        {landed
          ? "SELECTED · CHECK YOUR RESULT BELOW"
          : active && !props.selected
            ? "WAITING FOR THE DRAW RESULT"
            : active
              ? "ONE CARD. YOUR NEXT DISCOVERY."
              : "PICK YOUR FILTERS. CRACK THE CASE."}
      </div>
      <div className="case-contents" aria-label="Case contents">
        {props.tokens.slice(0, 8).map((token) => (
          <span key={token.mint} title={token.name}>
            <TokenIcon
              src={token.dex?.icon ?? token.icon}
              symbol={token.symbol}
              size={23}
            />
            <span>{tokenTicker(token.symbol)}</span>
          </span>
        ))}
        {props.tokens.length > 8 && <span>+{props.tokens.length - 8}</span>}
      </div>
    </div>
  );
}
