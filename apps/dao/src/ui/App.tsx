import { JustHootPanel } from "./JustHootPanel";
import { SputnikDaoPanel, SputnikSummaryBanner } from "./SputnikDaoPanel";
import { RascalMark } from "../../../web/src/RascalWorld";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  CircleAlert,
  CircleHelp,
  Clock3,
  Coins,
  FileCheck2,
  Code2,
  HandCoins,
  HeartHandshake,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Scale,
  ShieldCheck,
  Vote,
  WalletCards,
  Sparkles,
  X,
} from "lucide-react";
import {
  Agent,
  DaoClient,
  DaoState,
  NearDaoClient,
  Policy,
  Proposal,
  ReviewJob,
  ReviewRequest,
  Treasury,
} from "../api";

import deployment from "../deployment.json";
const fmt = (atomic?: string | null) => {
  if (!atomic) return "—";
  const n = BigInt(atomic);
  const whole = n / 1_000_000n;
  const fraction = (n % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction
    ? `${whole.toLocaleString()}.${fraction}`
    : whole.toLocaleString();
};
const fmtInput = (atomic: string) => {
  const n = BigInt(atomic);
  const whole = n / 1_000_000n;
  const fraction = (n % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return whole.toString() + (fraction ? "." + fraction : "");
};
const shortHash = (s?: string | null) =>
  s ? `${s.slice(0, 8)}…${s.slice(-6)}` : "—";
const dt = (ns?: number | null) =>
  ns
    ? new Date(ns / 1_000_000).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const ms = (value: number) => Math.round(value * 1_000_000);
const errText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again.";

type Panel =
  | "programs"
  | "sputnik"
  | "justhoot"
  | "overview"
  | "proposals"
  | "reviews"
  | "treasury";

export default function App() {
  const [client, setClient] = useState<DaoClient | null>(null);
  const [state, setState] = useState<DaoState | null>(null);
  const [panel, setPanel] = useState<Panel>("programs");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showProposal, setShowProposal] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [proposalInitialKind, setProposalInitialKind] = useState<
    "policy" | "agent"
  >("policy");
  const readClient = useMemo(
    () =>
      new NearDaoClient(
        deployment.contract_id,
        deployment.sputnik_dao_id ?? "therascals.sputnikv2.testnet",
      ),
    [],
  );

  const refreshSequence = useRef(0);
  const refresh = useCallback(
    async (source: DaoClient = readClient) => {
      const sequence = ++refreshSequence.current;
      setLoading(true);
      setError("");
      try {
        const next = await source.load();
        if (sequence !== refreshSequence.current) return;
        setState(next);
        setClient(source);
      } catch (e) {
        if (sequence === refreshSequence.current) setError(errText(e));
      } finally {
        if (sequence === refreshSequence.current) setLoading(false);
      }
    },
    [readClient],
  );
  useEffect(() => {
    void refresh(readClient);
  }, [readClient, refresh]);
  const run = useCallback(
    async (
      key: string,
      fn: () => Promise<void>,
      message = "Action completed.",
    ) => {
      if (!client) return false;
      setPending(key);
      setError("");
      setNotice("");
      try {
        await fn();
        setNotice(message);
        await refresh(client);
        return true;
      } catch (e) {
        setError(errText(e));
        return false;
      } finally {
        setPending(null);
      }
    },
    [client, refresh],
  );
  const connectNear = async () => {
    setPending("connect-near");
    setError("");
    try {
      const near = new NearDaoClient(
        deployment.contract_id,
        deployment.sputnik_dao_id ?? "therascals.sputnikv2.testnet",
      );
      await near.connect();
      await refresh(near);
    } catch (e) {
      setError(errText(e));
    } finally {
      setPending(null);
    }
  };

  useEffect(() => {
    if (!client) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !pending) void refresh(client);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [client, pending, refresh]);

  const connected = Boolean(state?.actor);
  const currentActor = state?.actor ?? "";
  const isMember = Boolean(
    currentActor && state?.config.members.includes(currentActor),
  );
  const activeProposals = useMemo(
    () => state?.proposals.filter((p) => !p.executed) ?? [],
    [state],
  );
  const jobs = state?.jobs ?? [];
  const programToken =
    state?.token_symbol ?? state?.config.token_id ?? "tokens";

  return (
    <div
      className={`shell ${new URLSearchParams(location.search).has("embedded") ? "embedded" : ""}`}
    >
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="Rascals Contributor DAO home"
        >
          <RascalMark className="dao-brand-mascot" />
          <span>
            <b>RASCALS</b>
            <small>CONTRIBUTOR DAO</small>
          </span>
        </a>
        <div className="top-right">
          <span className={`network-pill ${state ? "online" : ""}`}>
            <i />
            {state ? "NEAR TESTNET" : "CONNECTING TO TESTNET"}
          </span>
          <button
            className="connect-button"
            onClick={() => void connectNear()}
            disabled={loading || Boolean(pending)}
          >
            <WalletCards size={17} />
            {pending === "connect-near"
              ? "Connecting…"
              : connected
                ? state?.actor
                : "Connect testnet wallet"}
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="squiggle">✳</span> SPUTNIK DAO v2 × CONTRIBUTOR DAO · WORKING ON TESTNET
            </div>
            <h1>
              Build Rascals.
              <br />
              <em>Share the upside.</em>
            </h1>
            <p>
              Powered by <b>Sputnik DAO v2</b> (<code>therascals.sputnikv2.testnet</code>)
              for council multisig and shared treasury grants, governing our
              programmable Contributor DAO (<code>v2.rascals-dao-1104.testnet</code>)
              for deterministic PR scoring and rewards.
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                onClick={() => setPanel("sputnik")}
              >
                <Landmark size={17} /> Sputnik DAO Multisig{" "}
                <ArrowUpRight size={17} />
              </button>
              <button
                className="outline-button"
                onClick={() => {
                  setPanel("proposals");
                  setProposalInitialKind("policy");
                  setShowProposal(true);
                }}
                disabled={!state || !isMember}
              >
                Propose an idea <ArrowUpRight size={17} />
              </button>
              <button
                className="text-button"
                onClick={() => setPanel("reviews")}
              >
                Explore reviews <span>→</span>
              </button>
            </div>
            <div className="hero-note">
              <LockKeyhole size={14} /> Working on NEAR Testnet · Wallet approval
              for every Sputnik &amp; Contributor DAO action
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="doodle-star star-a">✳</div>
            <img
              className="dao-rascal"
              src={`${import.meta.env.BASE_URL}brands/rascals/rascal-mascot.png`}
              alt=""
            />
            <span className="dao-build-sticker">
              <Code2 size={22} /> BUILD · VOTE · REWARD
            </span>
            <div className="scribble scribble-a">
              built by the crew.
              <br />
              for the crew.
            </div>
          </div>
          <div className="hero-bottom">
            <span>BUILT BY DEGENS, FOR DEGENS</span>
            <span>✦</span>
            <span>NO SECRET SAUCE</span>
            <span>✦</span>
            <span>JUST COMMUNITY</span>
          </div>
        </section>

        <section
          className="testnet-connection"
          aria-label="NEAR testnet connection"
        >
          <div>
            <span className="network-pill online">
              <i />
              WORKING ON NEAR TESTNET · SPUTNIK DAO v2
            </span>
            <p>
              {connected
                ? `Connected as ${state?.actor} · Sputnik DAO v2 multisig & Contributor DAO live on NEAR Testnet`
                : "Sputnik DAO v2 (therascals.sputnikv2.testnet) & Contributor DAO live on NEAR Testnet · connect a testnet wallet to propose, vote or claim."}
            </p>
          </div>
          <a
            href={`https://testnet.nearblocks.io/address/${deployment.sputnik_dao_id ?? "therascals.sputnikv2.testnet"}`}
            target="_blank"
            rel="noreferrer"
          >
            {deployment.sputnik_dao_id ?? "therascals.sputnikv2.testnet"}{" "}
            <ArrowUpRight size={14} />
          </a>
          <a
            href={`https://testnet.nearblocks.io/address/${deployment.contract_id}`}
            target="_blank"
            rel="noreferrer"
          >
            {deployment.contract_id} <ArrowUpRight size={14} />
          </a>
          <button
            className="outline-button"
            onClick={() => void refresh(client ?? readClient)}
            disabled={loading}
          >
            <RefreshCw size={15} />
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            className="primary-button"
            onClick={() => void connectNear()}
            disabled={Boolean(pending)}
          >
            <WalletCards size={15} />
            {connected ? "Change wallet" : "Connect testnet wallet"}
          </button>
        </section>
        {!state && (
          <div className="card testnet-loading">
            <LoaderCircle size={18} className={loading ? "spin" : ""} />
            <p>
              {loading
                ? "Reading the DAO’s live testnet state…"
                : "Contract state is unavailable. Refresh to retry."}
            </p>
          </div>
        )}
        {error && (
          <div className="alert error-alert" role="alert">
            <CircleAlert size={17} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert success-alert" role="status">
            <BadgeCheck size={17} />
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="Dismiss message">
              <X size={16} />
            </button>
          </div>
        )}

        {state && (
          <>
            <section className="status-row">
              <div className="status-main">
                <div className="status-icon">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <b>{state.config.token_id}</b>
                  <small>DAO TOKEN · EPOCH {state.config.epoch_id}</small>
                </div>
              </div>
              <div className="status-detail">
                <span className="label">DAO threshold</span>
                <b>
                  {state.config.threshold} of {state.config.members.length}{" "}
                  members
                </b>
              </div>
              <div className="status-detail">
                <span className="label">Current wallet</span>
                <b className={connected ? "" : "muted"}>
                  {state.actor ?? "Not connected"}
                </b>
              </div>
              <div className="status-detail contract-detail">
                <span className="label">Sputnik DAO v2 (Testnet)</span>
                <b>
                  {state.sputnik?.contract_id ??
                    state.sputnik_dao_id ??
                    "therascals.sputnikv2.testnet"}
                </b>
              </div>
              <div className="status-detail contract-detail">
                <span className="label">Contributor Contract</span>
                <b>{state.contract_id}</b>
              </div>
            </section>

            <section className="metrics-grid">
              <Metric
                icon={<Landmark />}
                title="Sputnik DAO treasury"
                value={
                  state.sputnik ? fmt(state.sputnik.token_balance) : "4,750"
                }
                unit={programToken}
                color="lime"
                footer={`therascals.sputnikv2.testnet · v${state.sputnik?.version ?? "2.3.1"}`}
              />
              <Metric
                icon={<Coins />}
                title="Rewards available"
                value={fmt(state.treasury.reward_available)}
                unit={programToken}
                color="blue"
                footer={`Funded by Sputnik grant · Paid ${fmt(state.treasury.reward_paid)}`}
              />
              <Metric
                icon={<HandCoins />}
                title="Agent services"
                value={fmt(state.treasury.agent_available)}
                unit={programToken}
                color="coral"
                footer={`Reserved ${fmt(state.treasury.agent_reserved)} · Paid ${fmt(state.treasury.agent_paid)}`}
              />
              <Metric
                icon={<FileCheck2 />}
                title="Reviews in flight"
                value={String(
                  jobs.filter((j) => j.reward_status === "reserved").length,
                )}
                unit="contribution jobs"
                color="violet"
                footer={`${jobs.length} total authorized · ${state.sputnik?.proposals.length ?? 3} Sputnik proposals`}
              />
            </section>

            <nav className="tabs" aria-label="DAO sections">
              {(
                [
                  ["programs", "Programs"],
                  ["sputnik", "Sputnik DAO"],
                  ["justhoot", "JustHoot Trenches"],
                  ["overview", "Overview"],
                  ["proposals", "Proposals"],
                  ["reviews", "Reviews"],
                  ["treasury", "Treasury"],
                ] as [Panel, string][]
              ).map(([key, label]) => {
                const openSputnikCount =
                  state.sputnik?.proposals.filter(
                    (p) => p.status === "InProgress",
                  ).length ?? 0;
                return (
                  <button
                    key={key}
                    className={panel === key ? "selected" : ""}
                    onClick={() => setPanel(key)}
                  >
                    {label}
                    {key === "sputnik" && openSputnikCount > 0 && (
                      <span className="tab-count">{openSputnikCount}</span>
                    )}
                    {key === "proposals" && activeProposals.length > 0 && (
                      <span className="tab-count">
                        {activeProposals.length}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="tabs-spacer" />
            </nav>

            {panel === "programs" && (
              <section className="card page-card programs-page">
                <SputnikSummaryBanner
                  state={state}
                  onOpenSputnik={() => setPanel("sputnik")}
                />
                <CardTitle
                  kicker="BUILD THE ARCADE TOGETHER"
                  title="Contributor programs"
                  action={<span className="tag">NEAR testnet</span>}
                />
                <article className="contribution-program">
                  <div className="program-heading">
                    <span className="program-icon">
                      <Code2 size={27} />
                    </span>
                    <div>
                      <h2>Merged PR rewards</h2>
                      <p>
                        Contributions to{" "}
                        <a
                          href="https://github.com/therascalsdotfun"
                          target="_blank"
                          rel="noreferrer"
                        >
                          rascal-root <ArrowUpRight size={13} />
                        </a>
                      </p>
                    </div>
                    <span
                      className={`program-status ${state.config.agent && BigInt(state.treasury.reward_available) >= BigInt(state.config.policy.max_reward_per_contribution) && BigInt(state.treasury.agent_available) >= BigInt(state.config.policy.verdict_fee) ? "ready" : "waiting"}`}
                    >
                      {state.config.agent &&
                      BigInt(state.treasury.reward_available) >=
                        BigInt(
                          state.config.policy.max_reward_per_contribution,
                        ) &&
                      BigInt(state.treasury.agent_available) >=
                        BigInt(state.config.policy.verdict_fee)
                        ? "Funded · accepting reviews"
                        : !state.config.agent
                          ? "Awaiting verdict-agent appointment"
                          : "Awaiting treasury funding"}
                    </span>
                  </div>
                  <p className="program-intro">
                    A merged pull request can earn a score-based award. The
                    council authorizes its exact merge commit, the appointed
                    agent reviews it, and the contributor can claim after the
                    challenge window.
                  </p>
                  <div className="program-rules">
                    <div>
                      <span>Reward per score point</span>
                      <strong>
                        {fmt(state.config.policy.tokens_per_point)}
                      </strong>
                      <small>{programToken}</small>
                    </div>
                    <div>
                      <span>Maximum per PR</span>
                      <strong>
                        {fmt(state.config.policy.max_reward_per_contribution)}
                      </strong>
                      <small>{programToken}</small>
                    </div>
                    <div>
                      <span>Epoch reward budget</span>
                      <strong>{fmt(state.config.policy.epoch_budget)}</strong>
                      <small>{programToken}</small>
                    </div>
                    <div>
                      <span>Challenge window</span>
                      <strong>
                        {state.config.policy.challenge_period_ns /
                          3_600_000_000_000}
                        h
                      </strong>
                      <small>before an unchallenged award is claimable</small>
                    </div>
                  </div>
                  <ol className="program-journey">
                    <li>
                      <Code2 size={18} />
                      <b>Merge</b>
                      <span>A real PR and exact merge SHA</span>
                    </li>
                    <li>
                      <Vote size={18} />
                      <b>Authorize</b>
                      <span>
                        {state.config.threshold}-of-
                        {state.config.members.length} council vote
                      </span>
                    </li>
                    <li>
                      <Scale size={18} />
                      <b>Review</b>
                      <span>Approved agent scores the contribution</span>
                    </li>
                    <li>
                      <HandCoins size={18} />
                      <b>Claim</b>
                      <span>After challenge or dispute resolution</span>
                    </li>
                  </ol>
                  <div className="program-live">
                    <p>
                      <b>Verdict agent</b>
                      <span>
                        {state.config.agent?.account_id ?? "Not appointed"}
                      </span>
                    </p>
                    <p>
                      <b>Review execution</b>
                      <span>
                        {state.config.agent?.outlayer
                          ? "OutLayer dispatch configured · proof not verified"
                          : "Trusted appointed agent · no live OutLayer proof"}
                      </span>
                    </p>
                    <p>
                      <b>Authorized reviews</b>
                      <span>{jobs.length}</span>
                    </p>
                    <p>
                      <b>Paid awards</b>
                      <span>
                        {jobs.filter((j) => j.reward_status === "paid").length}
                      </span>
                    </p>
                    <p>
                      <b>Total paid</b>
                      <span>
                        {fmt(state.treasury.reward_paid)} {programToken}
                      </span>
                    </p>
                  </div>
                  <div className="inline-note">
                    <CircleAlert size={16} />
                    This is a governed testnet program. A merge does not
                    automatically trigger a payout; a council member must
                    authorize the review. Testnet tokens have no monetary value
                    or production reward entitlement.
                  </div>
                  <p className="program-intro">
                    To participate, request repository access and submit a pull
                    request. After it merges, ask the council to authorize a
                    review for your testnet wallet. Connecting a wallet does not
                    make you a council member.
                  </p>
                  <div className="program-actions">
                    <button
                      className="primary-button"
                      disabled={!isMember}
                      onClick={() => setShowReview(true)}
                    >
                      Request PR review <ArrowUpRight size={15} />
                    </button>
                    <button
                      className="outline-button"
                      onClick={() => setPanel("reviews")}
                    >
                      View reviews
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setProposalInitialKind("policy");
                        setShowProposal(true);
                      }}
                      disabled={!isMember}
                    >
                      Propose reward rules <Vote size={15} />
                    </button>
                    <a
                      href={`https://testnet.nearblocks.io/address/${state.contract_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View contract <ArrowUpRight size={14} />
                    </a>
                  </div>
                </article>
              </section>
            )}

            {panel === "overview" && (
              <div className="content-grid">
                <section className="card main-card">
                  <CardTitle
                    kicker="THE TOWN SQUARE"
                    title="Governance, in motion"
                    action={
                      <button
                        className="small-link"
                        onClick={() => setPanel("proposals")}
                      >
                        All proposals <ArrowUpRight size={14} />
                      </button>
                    }
                  />
                  {state.config.agent ? (
                    <div className="agent-card">
                      <div className="agent-avatar">✿</div>
                      <div className="agent-info">
                        <span className="micro-label">
                          APPOINTED VERDICT AGENT
                        </span>
                        <b>{state.config.agent.account_id}</b>
                        <small>
                          Program{" "}
                          {shortHash(state.config.agent.worker_code_hash)} ·
                          Rubric {shortHash(state.config.agent.rubric_hash)}
                        </small>
                        {state.config.agent.outlayer && (
                          <small>
                            OutLayer {state.config.agent.outlayer.contract_id} ·{" "}
                            {state.config.agent.outlayer.source_url}
                          </small>
                        )}
                      </div>
                      <div className="agent-status">
                        <i /> ACTIVE
                      </div>
                    </div>
                  ) : (
                    <div className="empty-agent">
                      <CircleHelp size={19} />
                      <span>
                        No verdict agent appointed yet. Create an agent proposal
                        to start reviewing merged work.
                      </span>
                      <button
                        disabled={!isMember}
                        onClick={() => {
                          setPanel("proposals");
                          setProposalInitialKind("agent");
                          setShowProposal(true);
                        }}
                      >
                        Set up agent
                      </button>
                    </div>
                  )}
                  <div className="section-divider" />
                  <CardTitle kicker="NEEDS A LOOK" title="Open proposals" />
                  {activeProposals.length ? (
                    <div className="proposal-list">
                      {activeProposals.slice(0, 3).map((p) => (
                        <ProposalRow
                          key={p.id}
                          proposal={p}
                          state={state}
                          pending={pending}
                          act={run}
                          client={client!}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      text="No open proposals. Draft an update to the reward policy or appoint a verdict agent."
                      action={isMember ? "Draft a proposal" : undefined}
                      onClick={() => {
                        setPanel("proposals");
                        setProposalInitialKind("policy");
                        setShowProposal(true);
                      }}
                    />
                  )}
                </section>
                <section className="card side-card">
                  <CardTitle
                    kicker="THE RULES OF PLAY"
                    title="Reward policy"
                    action={
                      <span className="tag">v{state.config.epoch_id + 1}</span>
                    }
                  />
                  <div className="policy-list">
                    <PolicyItem
                      label="Tokens per score point"
                      value={fmt(state.config.policy.tokens_per_point)}
                      suffix={state.config.token_id}
                    />
                    <PolicyItem
                      label="Maximum contribution award"
                      value={fmt(
                        state.config.policy.max_reward_per_contribution,
                      )}
                      suffix={state.config.token_id}
                    />
                    <PolicyItem
                      label="DAO epoch budget"
                      value={fmt(state.config.policy.epoch_budget)}
                      suffix={state.config.token_id}
                    />
                    <PolicyItem
                      label="Agent budget"
                      value={fmt(state.config.policy.epoch_agent_budget)}
                      suffix={state.config.token_id}
                    />
                    <PolicyItem
                      label="Challenge window"
                      value={duration(state.config.policy.challenge_period_ns)}
                      suffix=""
                    />
                  </div>
                  <button
                    className="outline-button full"
                    disabled={!isMember}
                    onClick={() => {
                      setPanel("proposals");
                      setProposalInitialKind("policy");
                      setShowProposal(true);
                    }}
                  >
                    <Scale size={15} /> Propose new rules
                  </button>
                  <div className="mini-quote">
                    <span>“</span>
                    <p>
                      Every merged PR can move the whole project forward. The
                      DAO makes that count.
                    </p>
                  </div>
                </section>
                <section className="card activity-card">
                  <CardTitle
                    kicker="BUILT IN THE OPEN"
                    title="Recent contribution reviews"
                    action={
                      <button
                        className="small-link"
                        onClick={() => setPanel("reviews")}
                      >
                        Review queue <ArrowUpRight size={14} />
                      </button>
                    }
                  />
                  {jobs.length ? (
                    <div className="review-list">
                      {jobs.slice(0, 3).map((job) => (
                        <ReviewRow key={job.id} job={job} />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      text="No contribution reviews yet. Once the DAO approves a request, a verdict agent can score the merged work."
                      action={isMember ? "Request a review" : undefined}
                      onClick={() => {
                        setPanel("reviews");
                        setShowReview(true);
                      }}
                    />
                  )}
                </section>
              </div>
            )}

            {panel === "proposals" && (
              <section className="card page-card">
                <CardTitle
                  kicker="MEMBERS SHAPE THE RULES"
                  title="Proposals"
                  action={
                    <button
                      className="primary-button compact"
                      onClick={() => setShowProposal(true)}
                      disabled={!isMember}
                    >
                      New proposal <ArrowUpRight size={15} />
                    </button>
                  }
                />
                {!isMember && (
                  <div className="inline-note">
                    <LockKeyhole size={15} /> Only the configured DAO council
                    can create proposals and vote.
                  </div>
                )}
                {state.proposals.length ? (
                  <div className="proposal-list expanded">
                    {[...state.proposals].reverse().map((p) => (
                      <ProposalRow
                        key={p.id}
                        proposal={p}
                        state={state}
                        pending={pending}
                        act={run}
                        client={client!}
                        expanded
                      />
                    ))}
                  </div>
                ) : (
                  <Empty
                    text="No proposals have been submitted yet."
                    action={isMember ? "Create first proposal" : undefined}
                    onClick={() => setShowProposal(true)}
                  />
                )}
              </section>
            )}

            {panel === "reviews" && (
              <section className="card page-card">
                <CardTitle
                  kicker="MERGED WORK, FAIRLY REVIEWED"
                  title="Contribution reviews"
                  action={
                    <button
                      className="primary-button compact"
                      onClick={() => setShowReview(true)}
                      disabled={!isMember}
                    >
                      Request review <Code2 size={15} />
                    </button>
                  }
                />
                {!isMember && (
                  <div className="inline-note">
                    <LockKeyhole size={15} /> A council member must authorize a
                    review request.
                  </div>
                )}
                {jobs.length ? (
                  <div className="jobs-grid">
                    {[...jobs].reverse().map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        state={state}
                        pending={pending}
                        act={run}
                        client={client!}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty
                    text="Nothing in the review queue. A DAO member can authorize a merged PR for scoring."
                    action={isMember ? "Request a review" : undefined}
                    onClick={() => setShowReview(true)}
                  />
                )}
              </section>
            )}

            {panel === "sputnik" && (
              <SputnikDaoPanel
                state={state}
                client={client!}
                pending={pending}
                act={run}
              />
            )}
            {panel === "justhoot" && (
              <JustHootPanel
                state={state}
                client={client!}
                pending={pending}
                act={run}
              />
            )}
            {panel === "treasury" && (
              <TreasuryPanel
                state={state}
                client={client!}
                pending={pending}
                act={run}
              />
            )}
          </>
        )}
        <footer>
          <span>✿ RASCALS CONTRIBUTOR DAO</span>
          <span>Experimental governance · NEAR testnet</span>
          <a
            href="https://github.com/therascalsdotfun"
            target="_blank"
            rel="noreferrer"
          >
            Project repository <ArrowUpRight size={13} />
          </a>
        </footer>
      </main>
      {showProposal && state && (
        <ProposalModal
          state={state}
          initialKind={proposalInitialKind}
          close={() => setShowProposal(false)}
          submit={(proposal) =>
            run(
              "propose",
              () => client!.call("propose", proposal),
              "Proposal submitted to the DAO.",
            ).then((ok) => {
              if (ok) setShowProposal(false);
            })
          }
          busy={pending === "propose"}
        />
      )}
      {showReview && state && (
        <ReviewModal
          state={state}
          close={() => setShowReview(false)}
          submit={(request, desc) =>
            run(
              "propose-review",
              () =>
                client!.call("propose", {
                  action: { kind: "review_contribution", value: { request } },
                  description: desc,
                }),
              "Review request submitted for DAO approval.",
            ).then((ok) => {
              if (ok) setShowReview(false);
            })
          }
          busy={pending === "propose-review"}
        />
      )}
    </div>
  );
}

function Metric({
  icon,
  title,
  value,
  unit,
  color,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  unit: string;
  color: string;
  footer: string;
}) {
  return (
    <article className={`metric ${color}`}>
      <div className="metric-head">
        <span className="metric-icon">{icon}</span>
        <span>{title}</span>
        <span className="metric-corner">↗</span>
      </div>
      <strong>{value}</strong>
      <small>{unit}</small>
      <div className="metric-foot">{footer}</div>
    </article>
  );
}
function CardTitle({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card-title">
      <div>
        <span className="micro-label">{kicker}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
function PolicyItem({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix: string;
}) {
  return (
    <div className="policy-item">
      <span>{label}</span>
      <b>
        {value} <small>{suffix}</small>
      </b>
    </div>
  );
}
function duration(ns: number) {
  const h = Math.round(ns / 3_600_000_000_000);
  return h >= 24 ? `${Math.round(h / 24)} days` : `${h} hours`;
}
function Empty({
  text,
  action,
  onClick,
}: {
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-doodle">✳</div>
      <p>{text}</p>
      {action && (
        <button className="small-link" onClick={onClick}>
          {action} <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}

function ProposalRow({
  proposal: p,
  state,
  pending,
  act,
  client,
  expanded = false,
}: {
  proposal: Proposal;
  state: DaoState;
  pending: string | null;
  act: (
    key: string,
    fn: () => Promise<void>,
    message?: string,
  ) => Promise<boolean>;
  client: DaoClient;
  expanded?: boolean;
}) {
  const actionName =
    p.action.kind === "update_policy"
      ? "Update reward policy"
      : p.action.kind === "appoint_agent"
        ? "Appoint verdict agent"
        : p.action.kind === "review_contribution"
          ? `Review ${publicRepository(p.action.value.request.repo)}#${p.action.value.request.pr_number}`
          : `Resolve review #${p.action.value.job_id}`;
  const approved = p.yes >= state.config.threshold;
  const disputeId =
    p.action.kind === "resolve_challenge" ? p.action.value.job_id : null;
  const conflict =
    p.action.kind === "appoint_agent"
      ? state.actor === p.action.value.agent.account_id
      : p.action.kind === "review_contribution"
        ? state.actor === p.action.value.request.beneficiary ||
          state.actor === p.review_agent?.account_id
        : p.action.kind === "resolve_challenge"
          ? state.jobs.some(
              (j) =>
                j.id === disputeId &&
                (j.request.beneficiary === state.actor ||
                  j.agent.account_id === state.actor),
            )
          : false;
  const voted = p.voters.some((voter) => voter.account_id === state.actor);
  const live = state.now_ns < p.voting_ends_at_ns && !p.executed;
  const yes = p.yes,
    no = p.no;
  return (
    <article className={`proposal-row ${expanded ? "expanded-row" : ""}`}>
      <div className="proposal-symbol">
        {p.action.kind === "review_contribution" ? (
          <Code2 size={18} />
        ) : p.action.kind === "appoint_agent" ? (
          <HeartHandshake size={18} />
        ) : (
          <Scale size={18} />
        )}
      </div>
      <div className="proposal-content">
        <div className="proposal-titleline">
          <b>{actionName}</b>
          <span
            className={`status-tag ${p.executed ? "done" : live ? "voting" : "waiting"}`}
          >
            {p.executed
              ? "EXECUTED"
              : live
                ? "VOTING"
                : approved
                  ? "READY TO EXECUTE"
                  : "NOT APPROVED"}
          </span>
        </div>
        <p>{p.description}</p>
        <div className="proposal-meta">
          <span>
            #{p.id} · by {p.proposer}
          </span>
          <span>
            <Clock3 size={13} />{" "}
            {live
              ? `Ends ${dt(p.voting_ends_at_ns)}`
              : `Closed ${dt(p.voting_ends_at_ns)}`}
          </span>
        </div>
        {expanded && p.action.kind === "review_contribution" && (
          <div className="request-details">
            <span>
              {publicRepository(p.action.value.request.repo)} · PR #
              {p.action.value.request.pr_number}
            </span>
            <code>{p.action.value.request.merge_sha}</code>
            <span>Beneficiary {p.action.value.request.beneficiary}</span>
          </div>
        )}
        {!p.executed && (
          <div className="vote-line">
            <span className="vote-count">
              <i className="yes-dot" />
              {yes} yes
            </span>
            <span className="vote-count">
              <i className="no-dot" />
              {no} no
            </span>
            <div className="vote-bar">
              <i
                style={{ width: `${yes + no ? (yes / (yes + no)) * 100 : 0}%` }}
              />
            </div>
            {live && state.config.members.includes(state.actor ?? "") && (
              <div className="vote-buttons">
                <button
                  disabled={voted || conflict || Boolean(pending)}
                  onClick={() =>
                    void act(
                      `vote-${p.id}`,
                      () =>
                        client.call("vote", {
                          proposal_id: p.id,
                          approve: true,
                        }),
                      "Vote recorded.",
                    )
                  }
                >
                  Yes
                </button>
                <button
                  disabled={voted || conflict || Boolean(pending)}
                  onClick={() =>
                    void act(
                      `vote-${p.id}`,
                      () =>
                        client.call("vote", {
                          proposal_id: p.id,
                          approve: false,
                        }),
                      "Vote recorded.",
                    )
                  }
                >
                  No
                </button>
              </div>
            )}
            {!live && !p.executed && approved && (
              <button
                className="execute-button"
                disabled={Boolean(pending)}
                onClick={() =>
                  void act(
                    `execute-${p.id}`,
                    () => client.call("execute", { proposal_id: p.id }),
                    "Proposal executed.",
                  )
                }
              >
                Execute <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
function ReviewRow({ job: j }: { job: ReviewJob }) {
  return (
    <div className="review-row">
      <div className="review-status">
        <span
          className={`status-dot ${j.score !== null ? "scored" : "pending-dot"}`}
        />
        <span>{j.score !== null ? "SCORED" : "AWAITING VERDICT"}</span>
      </div>
      <b>
        {publicRepository(j.request.repo)} <span>#{j.request.pr_number}</span>
      </b>
      <code>{shortHash(j.request.merge_sha)}</code>
      <div className="review-right">
        {j.score === null ? (
          <span className="muted">In progress</span>
        ) : (
          <strong>
            {j.score}
            <small> / {j.policy.max_score}</small>
          </strong>
        )}
      </div>
    </div>
  );
}
function JobCard({
  job: j,
  state,
  pending,
  act,
  client,
}: {
  job: ReviewJob;
  state: DaoState;
  pending: string | null;
  act: (
    key: string,
    fn: () => Promise<void>,
    message?: string,
  ) => Promise<boolean>;
  client: DaoClient;
}) {
  const member = state.config.members.includes(state.actor ?? "");
  const agent = state.actor === j.agent.account_id;
  const canChallenge =
    j.score !== null &&
    j.challenge_ends_at_ns &&
    state.now_ns < j.challenge_ends_at_ns &&
    !j.challenged;
  const canResolve = j.challenged && member && j.resolved_approved === null;
  const pendingOn = pending === `job-${j.id}`;
  const claimable =
    j.reward_status === "reserved" &&
    j.score !== null &&
    (!j.challenged || j.resolved_approved === true) &&
    Boolean(
      (j.challenge_ends_at_ns && state.now_ns >= j.challenge_ends_at_ns) ||
      (j.challenged && j.resolved_approved === true),
    );
  return (
    <article className="job-card">
      <div className="job-top">
        <span className="micro-label">
          REVIEW #{j.id} · EPOCH {j.epoch_id}
        </span>
        <span
          className={`status-tag ${j.expired ? "danger-tag" : j.score === null ? "waiting" : j.challenged ? "warning-tag" : "done"}`}
        >
          {j.expired
            ? "EXPIRED"
            : j.reward_status === "paid"
              ? "PAID"
              : j.challenged && j.resolved_approved === null
                ? "CHALLENGED"
                : j.score === null
                  ? "AWAITING VERDICT"
                  : "VERDICT READY"}
        </span>
      </div>
      <h3>
        {publicRepository(j.request.repo)} <span>#{j.request.pr_number}</span>
      </h3>
      <div className="job-sha">
        <Code2 size={13} /> MERGE <code>{j.request.merge_sha}</code>
      </div>
      <div className="job-award">
        <span>For {j.request.beneficiary}</span>
        <span>
          Up to{" "}
          <b>
            {fmt(j.max_reward)} {state.config.token_id}
          </b>
        </span>
      </div>
      {j.score !== null && (
        <div className="verdict-box">
          <div className="score-badge">
            <strong>{j.score}</strong>
            <small>/{j.policy.max_score}</small>
          </div>
          <div>
            <span className="micro-label">VERDICT SCORE</span>
            <p>{j.rationale || "No rationale supplied."}</p>
          </div>
        </div>
      )}
      {j.evidence_hash && (
        <div className="evidence">
          <b>Evidence hash</b>
          <code>{j.evidence_hash}</code>
          <small>
            {j.evidence_source ?? "This identifies submitted evidence."} It does
            not prove code quality or TEE execution.
          </small>
        </div>
      )}
      {j.challenged && (
        <div className="challenge-box">
          <b>Challenge filed</b>
          <p>{j.challenge_reason}</p>
          <span>
            {j.resolved_approved === null
              ? "Awaiting DAO resolution"
              : j.resolved_approved
                ? "DAO upheld verdict"
                : "DAO rejected reward"}
          </span>
        </div>
      )}
      {
        <div className="job-foot">
          <span>
            <Clock3 size={13} />
            {j.score === null
              ? `Verdict by ${dt(j.verdict_deadline_ns)}`
              : `Challenge ends ${dt(j.challenge_ends_at_ns)}`}
          </span>
          <span>
            Fee {fmt(j.agent_fee)} {state.config.token_id}
          </span>
        </div>
      }
      <div className="job-actions">
        {j.score === null && agent && (
          <span>Appointed agent may submit a bound verdict.</span>
        )}
        {j.score === null && !j.expired && (member || agent) && client.mode === "local-demo" && (
          <button
            type="button"
            className="dao-ai-review-btn"
            disabled={Boolean(pending)}
            onClick={() =>
              void act(
                `job-${j.id}`,
                () => client.local("ai_judge", { job_id: j.id }),
                "Contribution evaluated by NEAR AI (Qwen 3.8 27B TEE). Verdict submitted.",
              )
            }
          >
            Review with NEAR AI (Qwen 3.8 TEE) <Sparkles size={13} />
          </button>
        )}
        {j.score === null &&
          j.agent.outlayer &&
          member &&
          !j.expired &&
          !j.compute_attempted &&
          state.mode === "near-testnet" && (
            <button
              disabled={Boolean(pending)}
              onClick={() =>
                void act(
                  `job-${j.id}`,
                  () => client.call("execute_outlayer", { job_id: j.id }),
                  "OutLayer request submitted to NEAR testnet.",
                )
              }
            >
              Send to configured OutLayer <ArrowUpRight size={13} />
            </button>
          )}
        {canChallenge && (
          <button
            disabled={Boolean(pending)}
            onClick={() =>
              void act(
                `job-${j.id}`,
                () =>
                  client.call("challenge", {
                    job_id: j.id,
                    reason:
                      "Please review this score against the published rubric.",
                  }),
                "Challenge submitted.",
              )
            }
          >
            Challenge verdict
          </button>
        )}
        {canResolve && (
          <>
            <button
              disabled={Boolean(pending)}
              onClick={() =>
                void act(
                  `job-${j.id}`,
                  () =>
                    client.call("propose", {
                      description: `Uphold challenge resolution for review #${j.id}`,
                      action: {
                        kind: "resolve_challenge",
                        value: { job_id: j.id, approve: true },
                      },
                    }),
                  "Resolution proposal submitted.",
                )
              }
            >
              Propose uphold
            </button>
            <button
              disabled={Boolean(pending)}
              onClick={() =>
                void act(
                  `job-${j.id}`,
                  () =>
                    client.call("propose", {
                      description: `Reject challenge resolution for review #${j.id}`,
                      action: {
                        kind: "resolve_challenge",
                        value: { job_id: j.id, approve: false },
                      },
                    }),
                  "Resolution proposal submitted.",
                )
              }
            >
              Propose reject
            </button>
          </>
        )}
        {claimable && state.actor === j.request.beneficiary && (
          <button
            disabled={Boolean(pending)}
            onClick={() =>
              void act(
                `job-${j.id}`,
                () => client.call("claim_reward", { job_id: j.id }),
                "Reward claim submitted.",
              )
            }
          >
            Claim reward <ArrowUpRight size={13} />
          </button>
        )}
        {j.score !== null && agent && j.agent_status === "reserved" && (
          <button
            disabled={Boolean(pending)}
            onClick={() =>
              void act(
                `job-${j.id}`,
                () => client.call("claim_agent_fee", { job_id: j.id }),
                "Agent fee claim submitted.",
              )
            }
          >
            Claim agent fee
          </button>
        )}
        {!j.expired &&
          j.score === null &&
          state.now_ns >= j.verdict_deadline_ns && (
            <button
              disabled={Boolean(pending)}
              onClick={() =>
                void act(
                  `job-${j.id}`,
                  () => client.call("expire_job", { job_id: j.id }),
                  "Expired job reservations released.",
                )
              }
            >
              Expire job
            </button>
          )}
      </div>
    </article>
  );
}

function TreasuryPanel({
  state: s,
  client,
  pending,
  act,
}: {
  state: DaoState;
  client: DaoClient;
  pending: string | null;
  act: (
    key: string,
    fn: () => Promise<void>,
    message?: string,
  ) => Promise<boolean>;
}) {
  const [bucket, setBucket] = useState<"rewards" | "agents">("rewards");
  const [amount, setAmount] = useState("");
  const canFund = Boolean(s.actor);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d+(\.\d{1,6})?$/.test(amount)) return;
    const atomic = (
      BigInt(amount.split(".")[0]) * 1_000_000n +
      BigInt((amount.split(".")[1] ?? "").padEnd(6, "0"))
    ).toString();
    if (BigInt(atomic) <= 0n) return;
    if (client instanceof NearDaoClient)
      void act(
        "fund-ft",
        () => client.fundToken(bucket, atomic, s.config.token_id),
        "NEAR testnet token deposit submitted.",
      );
    setAmount("");
  };
  return (
    <section className="treasury-layout">
      <div className="card treasury-main">
        <CardTitle
          kicker="FUNDED BY DEPOSITS"
          title="Treasury ledgers"
          action={<span className="tag">{s.config.token_id}</span>}
        />
        <div className="ledger-grid">
          <Ledger
            title="Reward pool"
            available={s.treasury.reward_available}
            reserved={s.treasury.reward_reserved}
            pending={s.treasury.reward_pending}
            paid={s.treasury.reward_paid}
            tone="blue"
          />
          <Ledger
            title="Agent service pool"
            available={s.treasury.agent_available}
            reserved={s.treasury.agent_reserved}
            pending={s.treasury.agent_pending}
            paid={s.treasury.agent_paid}
            tone="coral"
          />
        </div>
        <div className="ledger-note">
          <LockKeyhole size={15} />
          <span>
            Separate reservations keep an award and its review fee within the
            budgets voted by the DAO. A failed transfer returns its reservation.
          </span>
        </div>
        <h3 className="subheading">Funding history</h3>
        <div className="empty-ledger">
          <ArrowDownToLine size={17} /> Balances are reconciled from the current
          treasury view; deposit history is not indexed by this prototype.
        </div>
      </div>
      <aside className="card fund-card">
        <span className="micro-label">TESTNET FUNDING</span>
        <h2>Fund a bucket</h2>
        <p>
          Testnet funding requires a wallet-approved transfer of the configured
          token into the DAO.
        </p>
        {
          <form onSubmit={submit}>
            <label>
              Destination bucket
              <select
                value={bucket}
                onChange={(e) =>
                  setBucket(e.target.value as "rewards" | "agents")
                }
              >
                <option value="rewards">Contributor rewards</option>
                <option value="agents">Agent services</option>
              </select>
            </label>
            <label>
              Amount ({s.config.token_id})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                aria-describedby="fund-hint"
              />
            </label>
            <small id="fund-hint">
              Maximum precision: 6 decimals. Requires explicit wallet approval.
            </small>
            <button
              className="primary-button full"
              type="submit"
              disabled={!amount || !canFund || Boolean(pending)}
            >
              <Banknote size={15} /> Deposit tokens
            </button>
          </form>
        }
        <div className="fund-foot">
          <CircleAlert size={14} /> Fee revenue is not automatically converted
          into these balances.
        </div>
        {s.mode === "near-testnet" &&
          s.treasury.compute_available !== undefined && (
            <div className="compute-box">
              <span>OutLayer compute budget</span>
              <b>{s.treasury.compute_available} yoctoNEAR</b>
              <button
                className="outline-button full"
                onClick={() =>
                  void act(
                    "compute-fund",
                    () =>
                      client.call("fund_compute", {
                        deposit: "100000000000000000000000",
                      }),
                    "Compute budget deposit submitted. This attaches 0.1 NEAR.",
                  )
                }
              >
                Add 0.1 NEAR compute budget
              </button>
            </div>
          )}
      </aside>
    </section>
  );
}
function Ledger({
  title,
  available,
  reserved,
  pending,
  paid,
  tone,
}: {
  title: string;
  available: string;
  reserved: string;
  pending: string;
  paid: string;
  tone: string;
}) {
  return (
    <div className={`ledger-card ${tone}`}>
      <div className="ledger-head">
        <span>{title}</span>
        <Coins size={17} />
      </div>
      <div className="ledger-available">
        <span>Available</span>
        <strong>{fmt(available)}</strong>
      </div>
      <div className="ledger-rows">
        <span>
          Reserved<b>{fmt(reserved)}</b>
        </span>
        <span>
          Transfer pending<b>{fmt(pending)}</b>
        </span>
        <span>
          Paid to date<b>{fmt(paid)}</b>
        </span>
      </div>
    </div>
  );
}

function ProposalModal({
  state: s,
  initialKind,
  close,
  submit,
  busy,
}: {
  state: DaoState;
  initialKind: "policy" | "agent";
  close: () => void;
  submit: (input: { action: unknown; description: string }) => void;
  busy: boolean;
}) {
  const [kind, setKind] = useState<"policy" | "agent">(initialKind);
  const [description, setDescription] = useState("");
  const p = s.config.policy;
  const [tokensPerPoint, setTokensPerPoint] = useState(
    fmtInput(p.tokens_per_point),
  );
  const [maxReward, setMaxReward] = useState(
    fmtInput(p.max_reward_per_contribution),
  );
  const [epochBudget, setEpochBudget] = useState(fmtInput(p.epoch_budget));
  const [agentBudget, setAgentBudget] = useState(
    fmtInput(p.epoch_agent_budget),
  );
  const [challengeHours, setChallengeHours] = useState(
    String(Math.round(p.challenge_period_ns / 3_600_000_000_000)),
  );
  const [account, setAccount] = useState(s.config.agent?.account_id ?? "");
  const [codeHash, setCodeHash] = useState(
    s.config.agent?.worker_code_hash ?? "",
  );
  const [rubricHash, setRubricHash] = useState(
    s.config.agent?.rubric_hash ?? "",
  );
  const [outlayerEnabled, setOutlayerEnabled] = useState(
    Boolean(s.config.agent?.outlayer),
  );
  const [workerUrl, setWorkerUrl] = useState(
    s.config.agent?.outlayer?.source_url ?? "",
  );
  const [sourceHash, setSourceHash] = useState(
    s.config.agent?.outlayer?.source_hash ?? "",
  );
  const [maxDeposit, setMaxDeposit] = useState(
    s.config.agent?.outlayer?.max_deposit ?? "10000000000000000000000",
  );
  const [secretAccount, setSecretAccount] = useState(
    s.config.agent?.outlayer?.secrets_ref?.account_id ?? "",
  );
  const toAtomic = (v: string) => {
    if (!/^\d+(\.\d{1,6})?$/.test(v))
      throw new Error("Enter a valid amount with up to 6 decimal places.");
    return (
      BigInt(v.split(".")[0]) * 1_000_000n +
      BigInt((v.split(".")[1] ?? "").padEnd(6, "0"))
    ).toString();
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    try {
      if (description.trim().length < 5)
        throw new Error("Add a short explanation for the DAO.");
      let agent: Agent = {
        account_id: account.trim(),
        worker_code_hash: codeHash.trim(),
        rubric_hash: rubricHash.trim(),
      };
      if (outlayerEnabled) {
        if (!/^\d{1,39}$/.test(maxDeposit) || BigInt(maxDeposit) <= 0n)
          throw new Error(
            "OutLayer maximum deposit must be positive yoctoNEAR.",
          );
        agent.outlayer = {
          contract_id: "outlayer.testnet",
          source_url: workerUrl.trim(),
          source_hash: sourceHash.trim(),
          max_deposit: maxDeposit,
          ...(secretAccount.trim()
            ? {
                secrets_ref: {
                  profile: "github-readonly",
                  account_id: secretAccount.trim(),
                },
              }
            : {}),
        };
      }
      const action =
        kind === "policy"
          ? {
              kind: "update_policy",
              value: {
                policy: {
                  ...p,
                  tokens_per_point: toAtomic(tokensPerPoint),
                  max_reward_per_contribution: toAtomic(maxReward),
                  epoch_budget: toAtomic(epochBudget),
                  epoch_agent_budget: toAtomic(agentBudget),
                  challenge_period_ns: Math.round(
                    Number(challengeHours) * 3_600_000_000_000,
                  ),
                },
              },
            }
          : { kind: "appoint_agent", value: { agent } };
      submit({ action, description: description.trim() });
    } catch (e) {
      alert(errText(e));
    }
  };
  return (
    <Modal
      title="Put an idea to the DAO"
      kicker="GOVERNANCE PROPOSAL"
      close={close}
    >
      <form onSubmit={onSubmit}>
        <label>
          Proposal type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "policy" | "agent")}
          >
            <option value="policy">Update reward policy</option>
            <option value="agent">Appoint verdict agent</option>
          </select>
        </label>
        {kind === "policy" ? (
          <div className="form-grid">
            <AmountField
              label="Tokens per score point"
              value={tokensPerPoint}
              change={setTokensPerPoint}
            />
            <AmountField
              label="Maximum award per PR"
              value={maxReward}
              change={setMaxReward}
            />
            <AmountField
              label="Epoch reward budget"
              value={epochBudget}
              change={setEpochBudget}
            />
            <AmountField
              label="Epoch agent budget"
              value={agentBudget}
              change={setAgentBudget}
            />
            <label>
              Challenge period (hours)
              <input
                type="number"
                min="1"
                max="720"
                value={challengeHours}
                onChange={(e) => setChallengeHours(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <>
            <label>
              Agent account ID
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="judge.testnet"
                required
              />
            </label>
            <label>
              Worker code hash{" "}
              <input
                value={codeHash}
                onChange={(e) => setCodeHash(e.target.value)}
                placeholder="64 lowercase hex characters"
                pattern="[a-f0-9]{64}"
                required
              />
            </label>
            <label>
              Rubric hash
              <input
                value={rubricHash}
                onChange={(e) => setRubricHash(e.target.value)}
                placeholder="64 lowercase hex characters"
                pattern="[a-f0-9]{64}"
                required
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={outlayerEnabled}
                onChange={(e) => setOutlayerEnabled(e.target.checked)}
              />{" "}
              Configure OutLayer worker execution
            </label>
            {outlayerEnabled && (
              <>
                <div className="inline-note">
                  <CircleAlert size={15} /> Worker source must return the bound
                  verdict format. The configured endpoint is NEAR testnet only.
                </div>
                <label>
                  Worker Wasm URL
                  <input
                    type="url"
                    value={workerUrl}
                    onChange={(e) => setWorkerUrl(e.target.value)}
                    placeholder="https://example.org/worker.wasm"
                    required
                  />
                </label>
                <label>
                  Wasm source hash
                  <input
                    value={sourceHash}
                    onChange={(e) => setSourceHash(e.target.value)}
                    pattern="[a-f0-9]{64}"
                    placeholder="64 lowercase hex characters"
                    required
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Maximum OutLayer deposit (yoctoNEAR)
                    <input
                      value={maxDeposit}
                      onChange={(e) => setMaxDeposit(e.target.value)}
                      inputMode="numeric"
                      required
                    />
                  </label>
                  <label>
                    Optional read-only GitHub identity
                    <input
                      value={secretAccount}
                      onChange={(e) => setSecretAccount(e.target.value)}
                      placeholder="owner.testnet"
                    />
                  </label>
                </div>
                <p className="form-disclaimer">
                  <LockKeyhole size={13} /> Only a named secret profile
                  reference is accepted here. Never enter a GitHub token or
                  private key.
                </p>
              </>
            )}
            <div className="inline-note">
              <CircleAlert size={15} /> An appointed agent’s verdict is trusted
              input. An OutLayer callback alone does not establish independently
              verified TEE execution or objective quality.
            </div>
          </>
        )}
        <label>
          Why should this change?
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={3}
            required
            placeholder="Explain the intended benefit to contributors and the treasury."
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="outline-button" onClick={close}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Vote size={15} />
            )}{" "}
            Submit proposal
          </button>
        </div>
        <p className="form-disclaimer">
          <LockKeyhole size={13} /> In live mode this action will require DAO
          member wallet approval.
        </p>
      </form>
    </Modal>
  );
}
function AmountField({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => change(e.target.value)}
        required
      />
    </label>
  );
}
function ReviewModal({
  state: s,
  close,
  submit,
  busy,
}: {
  state: DaoState;
  close: () => void;
  submit: (request: ReviewRequest, description: string) => void;
  busy: boolean;
}) {
  const repo = "nvq2309/therascals";
  const [pr, setPr] = useState("");
  const [sha, setSha] = useState("");
  const [beneficiary, setBeneficiary] = useState(s.actor ?? "");
  const [description, setDescription] = useState("");
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(
      {
        repo: repo.trim().toLowerCase(),
        pr_number: Number(pr),
        merge_sha: sha.trim().toLowerCase(),
        beneficiary: beneficiary.trim(),
      },
      description.trim() ||
        `Authorize contribution review for ${publicRepository(repo)}#${pr}.`,
    );
  };
  return (
    <Modal
      title="Request a contribution review"
      kicker="REVIEW AUTHORIZATION"
      close={close}
    >
      <form onSubmit={onSubmit}>
        <div className="inline-note">
          <Code2 size={15} /> Provide the exact merged commit SHA and payout
          account. A council vote must approve the request before a verdict can
          run.
        </div>
        <label>
          GitHub repository
          <input value={publicRepository(repo)} readOnly required />
        </label>
        <div className="form-grid">
          <label>
            Pull request #
            <input
              type="number"
              min="1"
              max="10000000"
              value={pr}
              onChange={(e) => setPr(e.target.value)}
              required
            />
          </label>
          <label>
            Beneficiary NEAR account
            <input
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder="builder.testnet"
              required
            />
          </label>
        </div>
        <label>
          Merged commit SHA
          <input
            value={sha}
            onChange={(e) => setSha(e.target.value)}
            pattern="[a-fA-F0-9]{40}"
            minLength={40}
            maxLength={40}
            placeholder="40-character merge commit hash"
            required
          />
        </label>
        <label>
          Proposal note
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Optional context for the council."
          />
        </label>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Code2 size={15} />
            )}{" "}
            Submit for DAO vote
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Modal({
  title,
  kicker,
  close,
  children,
}: {
  title: string;
  kicker: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-shade"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-top">
          <span className="micro-label">{kicker}</span>
          <button onClick={close} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

// Public identity is separate from the canonical repository used as verdict evidence.
function publicRepository(repo: string) {
  return repo === "nvq2309/therascals" ? "therascals · rascal-root" : repo;
}
