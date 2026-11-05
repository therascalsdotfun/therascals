import { useEffect, useRef, useState } from "react";
import {
  Coins,
  Gift,
  Megaphone,
  RefreshCw,
  Wallet,
  Trophy,
  X,
} from "lucide-react";
import { useWallets } from "../wallets/Wallets.tsx";
import { useRewards } from "./Rewards.tsx";
import { RewardWheel } from "./RewardWheel.tsx";
import {
  type RewardLane,
  POINTS_PER_DOLLAR,
  DAILY_POINTS_CAP,
  type PointsLeaderboard,
} from "../../../../packages/shared/src/rewards.ts";
import "./rewards.css";
export function RewardsChip({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="rewards-chip"
      onClick={onOpen}
      aria-label="Open leaderboard"
      title="Leaderboard"
    >
      <Trophy size={17} />
      <span>Leaderboard</span>
    </button>
  );
}
export function RewardNotice({ onOpen }: { onOpen: () => void }) {
  const rewards = useRewards(),
    entry = rewards?.latest;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (entry && !dialog.current?.open) dialog.current?.showModal();
  }, [entry?.id]);
  if (!entry) return null;
  return (
    <dialog
      ref={dialog}
      className="reward-dialog"
      aria-label="Trade points celebration"
      onCancel={(event) => {
        event.preventDefault();
        rewards?.dismiss();
      }}
    >
      <div className="reward-dialog-head">
        <b>Receipt verified ✓</b>
        <button
          aria-label="Close points celebration"
          onClick={rewards?.dismiss}
        >
          <X size={18} />
        </button>
      </div>
      <RewardWheel key={entry.id} entry={entry} />
      <button
        className="reward-dialog-leaderboard"
        onClick={() => {
          rewards?.dismiss();
          onOpen();
        }}
      >
        <Trophy size={16} /> View leaderboard
      </button>
    </dialog>
  );
}
function Leaderboard({ lane }: { lane: RewardLane }) {
  const rewards = useRewards();
  const [board, setBoard] = useState<PointsLeaderboard | null>(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const shownBoard = board;
  useEffect(() => {
    const controller = new AbortController();
    setBoard(null);
    setError("");
    fetch(`/api/rewards/leaderboard?lane=${lane}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Leaderboard unavailable.");
        if (!controller.signal.aborted) setBoard(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [lane, attempt, rewards?.snapshot]);
  return (
    <section className="points-leaderboard" aria-label="Points leaderboard">
      <div className="points-leaderboard-heading">
        <div>
          <Trophy size={22} />
          <h2>Earned points</h2>
        </div>
        <button
          aria-label={"Refresh leaderboard"}
          onClick={() => setAttempt((n) => n + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <p>{<>Top 50 · All-time earned trade points · {"Mainnet only"}</>}</p>

      {error ? (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      ) : !shownBoard ? (
        <div className="leaderboard-skeleton" aria-label="Loading leaderboard">
          {[1, 2, 3].map((n) => (
            <div key={n} />
          ))}
        </div>
      ) : !shownBoard.entries.length ? (
        <div className="leaderboard-empty">
          <Trophy size={32} />
          <strong>The scorebook is open</strong>
          <span>
            {
              "No verified trade points yet. Your first eligible buy starts your score."
            }
          </span>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Rascal</th>

              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {shownBoard.entries.map((row) => (
              <tr
                key={row.id}
                className={row.id === shownBoard.viewerId ? "is-you" : ""}
              >
                <td>{`#${row.rank}`}</td>
                <td>
                  {
                    <>
                      rascal-{row.id.slice(0, 8)}{" "}
                      {row.id === shownBoard.viewerId && <b>You</b>}
                    </>
                  }
                </td>

                <td>{row.points.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <small>
        {"Spending points never lowers your rank. Wallets use public aliases."}
      </small>
    </section>
  );
}
export function RewardsPage({
  lane,
  onPromote,
  onConnect,
}: {
  lane: RewardLane;
  onPromote: () => void;
  onConnect: () => void;
}) {
  const rewards = useRewards(),
    { identity } = useWallets();
  const error = "";
  const snapshot = rewards?.snapshot,
    entries = snapshot?.entries.filter((e) => e.lane === lane) ?? [];
  return (
    <section className="rewards-page">
      <div className="rewards-heading">
        <div>
          <span className="rewards-eyebrow">The rascal scorebook</span>
          <h1>Every trade, accounted for</h1>
          <p>
            Verified Solana USDC buys earn points. Your receipts show the work.
          </p>
        </div>
        <div className="scorebook-rate" aria-label="Trade points rate">
          <span>Executed volume</span>
          <strong>
            {POINTS_PER_DOLLAR}
            <small>pts / USDC</small>
          </strong>
          <span>
            Same rate · {DAILY_POINTS_CAP.toLocaleString()} pts / UTC day cap
          </span>
        </div>
      </div>
      <div className="points-disclaimer">
        Points only. No cash value, cash-out, token or promised airdrop.
      </div>

      <Leaderboard lane={lane} />
      {!identity ? (
        <div className="rewards-layout reward-guest-layout">
          <div className="reward-signin">
            <Wallet size={28} />
            <h2>Put your wallet in the scorebook</h2>
            <p>
              Verify ownership to see your balance and receipts. Sign-in grants
              no spending permission.
            </p>
            <button className="primary" onClick={onConnect}>
              Connect wallet
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="reward-balances">
            {(["mainnet"] as const).map((mode) => (
              <div key={mode} className={mode === lane ? "is-current" : ""}>
                <span>{"Available points"}</span>
                <strong>
                  {snapshot?.balances[mode].balance.toLocaleString() ?? "—"}
                  <Coins size={22} />
                </strong>
                <small>{"Spendable · verified Solana USDC buys"}</small>
              </div>
            ))}
          </div>
          {(error || rewards?.error) && (
            <p className="reward-error" role="alert">
              {error || rewards?.error}{" "}
              <button onClick={() => void rewards?.retry()}>
                <RefreshCw size={13} /> Retry same receipts
              </button>
            </p>
          )}
          <div className="rewards-layout rewards-settings">
            <div className="reward-utilities">
              <article className="reward-rule">
                <span className="reward-sticker">
                  <Gift size={25} />
                </span>
                <h2>Earn through executed trades</h2>
                <p>
                  <b>{POINTS_PER_DOLLAR} base points per 1 USDC</b> of actual
                  completed buy volume, at the same rate for every amount. Same
                  rule whether the position later wins or loses.
                </p>
                <p>
                  One receipt, one reward. Failed trades, free rolls, sells,
                  Intents funding and perp leverage earn no points in this first
                  version.
                </p>
                <small>
                  {DAILY_POINTS_CAP.toLocaleString()} trade points per wallet
                  per UTC day. Further volume earns no points after this cap.
                </small>
              </article>
              <article className="reward-shop">
                <Megaphone size={26} />
                <h2>Give a token the spotlight</h2>
                <p>
                  Market tag: <b>250 points / day</b>. Token spotlight:{" "}
                  <b>500 points / day</b>. Tokens still pass the same risk
                  checks and keep the same draw odds.
                </p>
                <button onClick={onPromote}>
                  Use points to promote <Megaphone size={15} />
                </button>
                <small>
                  {
                    "Live-point purchases create time-limited, labelled placements."
                  }
                </small>
              </article>
            </div>
          </div>
          <section className="reward-ledger">
            <h2>Your points ledger</h2>
            <span>
              {rewards?.loading
                ? "Refreshing…"
                : "Latest 100 account entries · current balance only"}
            </span>
            {entries.length ? (
              <ul>
                {entries.map((e) => (
                  <li key={e.id}>
                    <div>
                      <strong>{e.label}</strong>
                      <small>
                        {new Date(e.at).toLocaleString()}
                        {e.volumeAtomic
                          ? ` · ${Number(e.volumeAtomic) / 1e6} ${"USDC"} buy`
                          : ""}
                      </small>
                      {e.signature && (
                        <a
                          href={`https://explorer.solana.com/tx/${e.signature}${e.lane === "practice" ? "?cluster=devnet" : ""}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Trade receipt ↗
                        </a>
                      )}
                    </div>
                    <b>
                      {e.points > 0 ? "+" : ""}
                      {e.points.toLocaleString()} pts
                    </b>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No entries yet. Complete an eligible buy to record your first
                points.
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
