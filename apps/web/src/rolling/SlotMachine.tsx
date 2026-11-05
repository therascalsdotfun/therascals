import { tokenTicker } from "../../../../packages/shared/src/token-ticker.ts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CircleDollarSign, Coins, Sparkles } from "lucide-react";
import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
import {
  tokenKey,
  chainName,
  tokenChain,
  type DiscoveryChain,
} from "../../../../packages/shared/src/token-selection.ts";
import { DEGEN_AMOUNTS } from "../../../../packages/shared/src/degen-amount.ts";
import { ThreeReelMotion } from "./slot-motion.ts";
import { caseTokenAt } from "./case-motion.ts";
import { TokenIcon, TokenTicker } from "../TokenMedia.tsx";
import { ChainLogo } from "../Icons.tsx";
import "./slot-machine.css";
const amounts = DEGEN_AMOUNTS.map((c) => String(c.dollars));
type Props = {
  tokens: TokenObservation[];
  chains: DiscoveryChain[];
  selected: TokenObservation | null;
  amount: number | null;
  phase: string;
  roll: number;
  onExtracted: (mint: string, roll: number) => void;
  onExtractionStart: () => void;
  onTick?: () => void;
  previewChains: boolean;
  currencyLabel?: "USDC" | "USDC";
};
export function SlotMachine(props: Props) {
  const currencyLabel = props.currencyLabel ?? "USDC";
  const latest = useRef(props);
  latest.current = props;
  const [frames, setFrames] = useState([
    { position: 0, stage: "spinning" },
    { position: 0, stage: "spinning" },
    { position: 0, stage: "spinning" },
  ]);
  const active = ["mixing", "extracting", "reveal"].includes(props.phase),
    identity = props.tokens.map(tokenKey).join(",") + props.chains.join(",");
  useEffect(() => {
    if (!active) {
      setFrames([
        { position: 0, stage: "spinning" },
        { position: 0, stage: "spinning" },
        { position: 0, stage: "spinning" },
      ]);
      return;
    }
    const p = latest.current,
      ids = [p.chains, p.tokens.map(tokenKey), amounts];
    if (p.phase === "reveal") {
      setFrames(
        ids.map((list, i) => ({
          position: Math.max(
            0,
            list.indexOf(
              i === 0
                ? tokenChain(p.selected ?? {})
                : i === 1
                  ? p.selected
                    ? tokenKey(p.selected)
                    : ""
                  : String(p.amount),
            ),
          ),
          stage: "complete",
        })),
      );
      return;
    }
    const motion = new ThreeReelMotion(
        p.chains,
        p.tokens.map(tokenKey),
        amounts,
      ),
      reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0,
      clock = 0,
      previous = performance.now(),
      started = false,
      lastTick = -1,
      lastSound = 0;
    const render = (at: number) => {
      const dt = document.hidden ? 0 : Math.min(40, Math.max(0, at - previous));
      previous = at;
      if (!document.hidden) {
        clock += dt;
        const c = latest.current;
        const result = motion.sample(
          clock,
          [
            c.selected ? tokenChain(c.selected) : null,
            c.selected ? tokenKey(c.selected) : null,
            c.amount === null ? null : String(c.amount),
          ],
          reduced.matches,
        );
        setFrames(result.frames);
        if (!started && result.frames.some((f) => f.stage !== "spinning")) {
          started = true;
          c.onExtractionStart();
        }
        const tick = Math.round(result.frames[1].position);
        if (!reduced.matches && tick !== lastTick && clock - lastSound > 70) {
          c.onTick?.();
          lastSound = clock;
        }
        lastTick = tick;
        if (result.complete && c.selected) {
          c.onExtracted(c.selected.mint, c.roll);
          return;
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [active, props.roll, identity]);
  const landed = props.phase === "reveal";
  const ids = [props.chains, props.tokens.map(tokenKey), amounts];
  const current = frames.findIndex((f) => f.stage !== "complete");
  return (
    <div
      className={`slot-cabinet ${active && !landed ? "is-spinning" : ""} ${landed ? "is-landed" : ""}`}
      aria-label="Full Degen three-reel slot machine"
      data-slot-state={landed ? "landed" : active ? "spinning" : "idle"}
    >
      <div className="slot-bulbs" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => (
          <i key={i} style={{ "--bulb": i } as CSSProperties} />
        ))}
      </div>
      <div className="slot-marquee">
        <span>RASCALS ORIGINALS</span>
        <strong>
          FULL DEGEN<span>✦</span>
        </strong>
        <small>THREE REELS. ONE BAG.</small>
      </div>
      <div className="slot-reel-labels">
        <span>01 / CHAIN</span>
        <span>02 / TOKEN</span>
        <span>03 / AMOUNT</span>
      </div>
      <div className="slot-windows">
        {ids.map((list, i) => {
          const f = frames[i],
            position = active ? f.position : 0,
            stop = active && (f.stage === "settling" || f.stage === "complete");
          return (
            <div
              key={i}
              className={`slot-window ${stop ? "reel-stopped" : ""}`}
              data-reel={["chain", "token", "amount"][i]}
              data-state={landed ? "complete" : active ? f.stage : "idle"}
            >
              <div className="slot-reel-track" aria-hidden="true">
                {[-2, -1, 0, 1, 2].map((offset) => {
                  const index = Math.floor(position) + offset,
                    id = caseTokenAt(list, index);
                  const token =
                    i === 1
                      ? props.tokens.find((t) => tokenKey(t) === id)
                      : null;
                  return (
                    <div
                      className="slot-symbol"
                      key={index}
                      style={{ "--reel-y": index - position } as CSSProperties}
                    >
                      {i === 0 ? (
                        <>
                          <ChainLogo
                            chain={(id ?? props.chains[0]) as DiscoveryChain}
                            size={48}
                          />
                          <strong>
                            {chainName(
                              (id ?? props.chains[0]) as DiscoveryChain,
                            )}
                          </strong>
                          <small>
                            {props.previewChains
                              ? "LIVE DATA · PREVIEW"
                              : "TEST BUY ENABLED"}
                          </small>
                        </>
                      ) : i === 1 ? (
                        token ? (
                          <>
                            <TokenIcon
                              src={token.dex?.icon ?? token.icon}
                              symbol={token.symbol}
                              size={64}
                            />
                            <strong>{tokenTicker(token.symbol)}</strong>
                            <small>
                              {chainName(tokenChain(token)).toUpperCase()}
                            </small>
                          </>
                        ) : (
                          <>
                            <Coins size={42} />
                            <strong>YOUR PICK</strong>
                            <small>ADD TWO COINS</small>
                          </>
                        )
                      ) : (
                        <>
                          <CircleDollarSign size={38} />
                          <strong className="slot-money">${id ?? "1"}</strong>
                          <small>{currencyLabel}</small>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="slot-payline" aria-hidden="true" />
              <span className="slot-reel-status">{stop ? "LOCKED" : "◆"}</span>
            </div>
          );
        })}
      </div>
      <div className="slot-bottom" role="status">
        <Sparkles size={15} />
        <span>
          {landed ? (
            <>
              {chainName(tokenChain(props.selected ?? {}))} ·{" "}
              <TokenTicker
                symbol={props.selected?.symbol ?? "Token"}
                src={props.selected?.dex?.icon ?? props.selected?.icon}
                size={18}
              />{" "}
              · ${props.amount} {currencyLabel}
            </>
          ) : active ? (
            current === 0 ? (
              "Choosing the chain…"
            ) : current === 1 ? (
              "Finding your ticker…"
            ) : (
              "Landing the amount…"
            )
          ) : (
            "Pick your chains. Let the reels decide."
          )}
        </span>
        <b>{props.previewChains ? "PREVIEW" : "TESTNET"}</b>
      </div>
    </div>
  );
}
