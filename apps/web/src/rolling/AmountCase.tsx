import { Banknote, Sparkles } from "lucide-react";
import {
  DEGEN_AMOUNTS,
  degenExpectedAmount,
} from "../../../../packages/shared/src/degen-amount.ts";
import { caseTokenAt, caseWindow } from "./case-motion.ts";
import { useReelMotion } from "./useReelMotion.ts";
import "./case-opening.css";
import "./full-degen.css";

const ids = DEGEN_AMOUNTS.map((choice) => String(choice.dollars));
export function AmountCase(props: {
  selected: number | null;
  phase: string;
  roll: number;
  onExtracted: (id: string, roll: number) => void;
  onTick?: () => void;
}) {
  const { frame, active, restored } = useReelMotion({
    ids,
    selectedId: props.selected === null ? null : String(props.selected),
    phase: props.phase,
    roll: props.roll,
    onExtracted: props.onExtracted,
    onTick: props.onTick,
  });
  const position = active ? frame.position : 0;
  const landed =
    active &&
    ["settling", "complete"].includes(frame.stage) &&
    String(props.selected) === caseTokenAt(ids, position);
  return (
    <div
      className={`case-machine amount-case ${active ? "is-rolling" : "is-idle"} ${landed ? "is-landed" : ""} ${restored ? "is-restored" : ""}`}
      data-case-stage={active ? frame.stage : "idle"}
    >
      <div className="case-kicker">
        <Banknote size={15} /> THE AMOUNT CASE{" "}
        <span>20 amounts · weighted odds</span>
      </div>
      <div className="case-stage-title">
        {landed
          ? `$${props.selected} is the pull.`
          : "How much are we sending?"}
      </div>
      <div
        className="case-runway"
        role="img"
        aria-label={
          landed
            ? `${props.selected} USDC landed at the amount pointer`
            : "Buy amounts move past the selection pointer"
        }
      >
        <div className="case-pointer" aria-hidden="true">
          <i />
          <span />
        </div>
        <div className="case-slot-glow" aria-hidden="true" />
        <div className="case-cards" aria-hidden="true">
          {caseWindow(position).map((index) => {
            const id = caseTokenAt(ids, index)!;
            const choice = DEGEN_AMOUNTS.find((c) => String(c.dollars) === id)!;
            const centered = Math.abs(index - position) < 0.49;
            return (
              <div
                key={index}
                className={`case-card amount-card ${centered ? "at-pointer" : ""} ${landed && centered ? "the-pull" : ""}`}
                style={
                  {
                    "--slot": index - position,
                    "--accent": choice.dollars >= 50 ? "#ffd56c" : "#f2b65e",
                  } as React.CSSProperties
                }
              >
                <div className="amount-card-odds">
                  {choice.weight / 100}% chance
                </div>
                <Banknote size={25} />
                <strong>${choice.dollars}</strong>
                <span className="case-card-name">USDC</span>
                <div className="amount-card-bottom">BUY AMOUNT</div>
              </div>
            );
          })}
        </div>
        {landed && !restored && (
          <div className="case-hit" key={props.roll} aria-hidden="true" />
        )}
      </div>
      <div className="case-readout" role="status">
        <span className={`case-signal ${!landed ? "active" : ""}`} />
        {landed
          ? "AMOUNT REVEALED · TEST FUNDS ONLY"
          : "BIGGER AMOUNTS. SMALLER ODDS."}
      </div>
    </div>
  );
}

export function DegenOdds() {
  return (
    <section className="degen-odds" aria-label="Full degen amount odds">
      <div className="degen-odds-heading">
        <Sparkles size={16} />
        <strong>Let the reels decide.</strong>
        <span>$1–$100</span>
      </div>
      <p>
        Chain → token → amount. Equal odds per eligible token; chain odds follow
        the pool. Higher amounts are rarer.
      </p>
      <div className="degen-odds-summary">
        <span>
          Maximum <strong>100 USDC</strong>
        </span>
        <span>
          Average <strong>{degenExpectedAmount().toFixed(2)}</strong>
        </span>
      </div>
      <details>
        <summary>All 20 amounts & odds</summary>
        <div className="degen-odds-grid">
          {DEGEN_AMOUNTS.map((choice) => (
            <div key={choice.dollars}>
              <strong>${choice.dollars}</strong>
              <span>{choice.weight / 100}%</span>
            </div>
          ))}
        </div>
        <p>
          Published odds sum to 100%. Each preview samples independently. The
          average is not a spending cap.
        </p>
      </details>
    </section>
  );
}
