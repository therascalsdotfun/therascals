import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Coins,
  Code2,
  Landmark,
  Layers,
  LoaderCircle,
  LockKeyhole,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
  Vote,
} from "lucide-react";
import type {
  Bucket,
  DaoClient,
  DaoState,
  SputnikBounty,
  SputnikDaoState,
  SputnikProposal,
} from "../api";

const fmt = (atomic?: string | null) => {
  if (!atomic) return "—";
  try {
    const n = BigInt(atomic);
    const whole = n / 1_000_000n;
    const fraction = (n % 1_000_000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return fraction
      ? `${whole.toLocaleString()}.${fraction}`
      : whole.toLocaleString();
  } catch {
    return "—";
  }
};

const fmtNear = (yocto?: string | null) => {
  if (!yocto) return "—";
  try {
    const n = BigInt(yocto);
    const near = Number(n / 1_000_000_000_000_000_000_000n) / 1000;
    return `${near} NEAR`;
  } catch {
    return "—";
  }
};

const dt = (nsStr?: string | number | null) => {
  if (!nsStr) return "—";
  const ns = typeof nsStr === "string" ? Number(nsStr) : nsStr;
  if (!Number.isFinite(ns) || ns <= 0) return "—";
  return new Date(ns / 1_000_000).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

function decodeBase64Json(b64: string): Record<string, unknown> | null {
  try {
    const text = atob(b64);
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractCouncilMembers(sputnik?: SputnikDaoState | null): string[] {
  if (!sputnik) return [];
  for (const role of sputnik.policy.roles) {
    if (
      role.name === "council" &&
      typeof role.kind === "object" &&
      role.kind !== null &&
      "Group" in role.kind &&
      Array.isArray(role.kind.Group)
    ) {
      return role.kind.Group;
    }
  }
  return [];
}

export function SputnikSummaryBanner({
  state,
  onOpenSputnik,
}: {
  state: DaoState;
  onOpenSputnik: () => void;
}) {
  const sputnik = state.sputnik;
  const sputnikId =
    sputnik?.contract_id ?? state.sputnik_dao_id ?? "therascals.sputnikv2.testnet";
  const council = extractCouncilMembers(sputnik);
  const openCount =
    sputnik?.proposals.filter((p) => p.status === "InProgress").length ?? 0;
  const approvedCount =
    sputnik?.proposals.filter((p) => p.status === "Approved").length ?? 0;
  const tokenLabel = state.token_symbol ?? state.config.token_id;

  return (
    <section
      className="sputnik-spotlight-card"
      aria-label="Sputnik DAO v2 Testnet Integration"
    >
      <div className="sputnik-spotlight-top">
        <div className="sputnik-title-group">
          <span className="sputnik-icon-box">
            <Landmark size={26} />
          </span>
          <div>
            <div className="sputnik-kicker-row">
              <span className="sputnik-badge">
                <Sparkles size={12} /> SPUTNIK DAO v2 INTEGRATED
              </span>
              <span className="sputnik-testnet-pill">
                <i /> WORKING ON NEAR TESTNET
              </span>
            </div>
            <h2>Sputnik DAO Council Multisig &amp; Programmable Treasury</h2>
            <p>
              We do not rebuild the multisig —{" "}
              <a
                href={`https://testnet.nearblocks.io/address/${sputnikId}`}
                target="_blank"
                rel="noreferrer"
              >
                <b>{sputnikId}</b> <ArrowUpRight size={13} />
              </a>{" "}
              holds the shared council treasury and governs{" "}
              <b>{state.contract_id ?? "v2.rascals-dao-1104.testnet"}</b> via
              cross-contract <code>FunctionCall</code> grants and Sputnik{" "}
              <code>AddBounty</code> pools.
            </p>
          </div>
        </div>
        <div className="sputnik-spotlight-actions">
          <button
            type="button"
            className="primary-button"
            onClick={onOpenSputnik}
          >
            <Vote size={15} /> Open Sputnik DAO ({sputnik?.proposals.length ?? 0}{" "}
            proposals) <ArrowUpRight size={15} />
          </button>
          <a
            className="outline-button"
            href={`https://testnet.nearblocks.io/address/${sputnikId}`}
            target="_blank"
            rel="noreferrer"
          >
            Explorer <ArrowUpRight size={14} />
          </a>
        </div>
      </div>

      <div className="sputnik-architecture-flow" aria-label="Sputnik DAO v2 architecture">
        <div className="sputnik-flow-step">
          <span className="flow-step-num">LAYER 1 · SPUTNIK DAO v2</span>
          <b>{sputnikId}</b>
          <small>
            {council.length || state.config.members.length}-member council
            multisig · Shared treasury:{" "}
            <strong>
              {sputnik ? fmt(sputnik.token_balance) : "4,750"} {tokenLabel}
            </strong>
          </small>
        </div>
        <div className="sputnik-flow-arrow" aria-hidden="true">
          <span>act_proposal(VoteApprove)</span>
          <ArrowRight size={18} />
          <code>ft_transfer_call</code>
        </div>
        <div className="sputnik-flow-step">
          <span className="flow-step-num">LAYER 2 · CONTRIBUTOR DAO</span>
          <b>{state.contract_id ?? "v2.rascals-dao-1104.testnet"}</b>
          <small>
            Deterministic PR review worker · Challenge window ·{" "}
            <strong>
              {fmt(state.treasury.reward_available)} {tokenLabel}
            </strong>{" "}
            available
          </small>
        </div>
      </div>

      <div className="sputnik-spotlight-stats">
        <div>
          <span>Sputnik Factory / Version</span>
          <b>
            {sputnik?.factory_id ?? "sputnikv2.testnet"} · v
            {sputnik?.version ?? "2.3.1"}
          </b>
        </div>
        <div>
          <span>Sputnik Shared Treasury</span>
          <b>
            {sputnik ? fmt(sputnik.token_balance) : "4,750"} {tokenLabel}
          </b>
        </div>
        <div>
          <span>Sputnik Proposals</span>
          <b>
            {approvedCount} Approved · {openCount} In Progress
          </b>
        </div>
        <div>
          <span>Active Sputnik Bounties</span>
          <b>{sputnik?.bounties.length ?? 1} on-chain bounty pool</b>
        </div>
      </div>

      <div className="sputnik-testnet-note">
        <CircleAlert size={15} />
        <span>
          <b>Working on NEAR Testnet:</b> Both{" "}
          <code>{sputnikId}</code> (Sputnik DAO v2) and{" "}
          <code>{state.contract_id ?? "v2.rascals-dao-1104.testnet"}</code>{" "}
          (Contributor DAO) are live on NEAR Testnet. Sputnik Proposal #0
          transferred 250 {tokenLabel} on-chain into the Contributor DAO reward
          pool. Testnet tokens carry zero monetary value.
        </span>
      </div>
    </section>
  );
}

export function SputnikDaoPanel({
  state,
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
  const sputnik = state.sputnik;
  const sputnikId =
    sputnik?.contract_id ?? state.sputnik_dao_id ?? "therascals.sputnikv2.testnet";
  const tokenLabel = state.token_symbol ?? state.config.token_id;
  const council = extractCouncilMembers(sputnik);
  const effectiveCouncil = council.length ? council : state.config.members;
  const isCouncil = Boolean(
    state.actor && effectiveCouncil.includes(state.actor),
  );

  const [proposalMode, setProposalMode] = useState<"grant" | "bounty">("grant");
  const [bucket, setBucket] = useState<Bucket>("rewards");
  const [amount, setAmount] = useState("50");
  const [times, setTimes] = useState("3");
  const [description, setDescription] = useState("");

  const submitSputnikProposal = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d+(\.\d{1,6})?$/.test(amount)) return;
    const atomic = (
      BigInt(amount.split(".")[0]) * 1_000_000n +
      BigInt((amount.split(".")[1] ?? "").padEnd(6, "0"))
    ).toString();
    if (BigInt(atomic) <= 0n) return;

    const bond = sputnik?.policy.proposal_bond ?? "10000000000000000000000";

    if (proposalMode === "grant") {
      if (!client.sputnikProposeGrant) return;
      const desc =
        description.trim() ||
        `Sputnik DAO Treasury Grant: Allocate ${amount} ${tokenLabel} to ${state.contract_id} (${bucket} bucket) via NEP-141 ft_transfer_call.`;
      void act(
        "sputnik-propose-grant",
        () =>
          client.sputnikProposeGrant!(
            bucket,
            atomic,
            state.config.token_id,
            desc,
            bond,
          ),
        "Sputnik DAO FunctionCall grant proposal submitted on NEAR Testnet.",
      ).then((ok) => {
        if (ok) setDescription("");
      });
    } else {
      if (!client.sputnikProposeBounty) return;
      const desc =
        description.trim() ||
        `Verified merged PR to rascal-root scored by deterministic worker (${amount} ${tokenLabel} per claim)`;
      void act(
        "sputnik-propose-bounty",
        () =>
          client.sputnikProposeBounty!(
            desc,
            atomic,
            state.config.token_id,
            Number(times) || 3,
            bond,
          ),
        "Sputnik DAO AddBounty proposal submitted on NEAR Testnet.",
      ).then((ok) => {
        if (ok) setDescription("");
      });
    }
  };

  return (
    <div className="sputnik-panel">
      <section className="card page-card sputnik-hero-card">
        <div className="sputnik-header-row">
          <div>
            <div className="sputnik-kicker-row">
              <span className="sputnik-badge">
                <Landmark size={13} /> SPUTNIK DAO v2 · COUNCIL &amp; BOUNTIES
              </span>
              <span className="sputnik-testnet-pill">
                <i /> WORKING ON NEAR TESTNET
              </span>
            </div>
            <h2>{sputnik?.config.name ?? "TheRascals Contributor DAO"}</h2>
            <p className="sputnik-purpose">
              {sputnik?.config.purpose ??
                "Sputnik DAO v2 council multisig and shared treasury governing Rascals contributor rewards, review worker budgets, and bounties on NEAR testnet."}
            </p>
          </div>
          <div className="sputnik-contract-links">
            <a
              className="outline-button"
              href={`https://testnet.nearblocks.io/address/${sputnikId}`}
              target="_blank"
              rel="noreferrer"
            >
              {sputnikId} <ArrowUpRight size={14} />
            </a>
            <a
              className="outline-button"
              href={`https://testnet.nearblocks.io/address/${state.contract_id ?? "v2.rascals-dao-1104.testnet"}`}
              target="_blank"
              rel="noreferrer"
            >
              {state.contract_id ?? "v2.rascals-dao-1104.testnet"}{" "}
              <ArrowUpRight size={14} />
            </a>
          </div>
        </div>

        <div className="sputnik-testnet-note">
          <ShieldCheck size={16} />
          <span>
            <b>Live on NEAR Testnet:</b> This integration uses the official{" "}
            <code>sputnik-dao-contract</code> v{sputnik?.version ?? "2.3.1"}{" "}
            deployed from factory <code>{sputnik?.factory_id ?? "sputnikv2.testnet"}</code>.
            Council members vote on Sputnik DAO <code>FunctionCall</code> and{" "}
            <code>AddBounty</code> proposals (`add_proposal` / `act_proposal`),
            which fund and govern our programmable Contributor DAO contract.
          </span>
        </div>

        <div className="sputnik-policy-grid">
          <div className="sputnik-policy-box">
            <span>Sputnik DAO Contract</span>
            <strong>{sputnikId}</strong>
            <small>
              Factory: {sputnik?.factory_id ?? "sputnikv2.testnet"} (v
              {sputnik?.version ?? "2.3.1"})
            </small>
          </div>
          <div className="sputnik-policy-box">
            <span>Sputnik Shared Treasury</span>
            <strong>
              {sputnik ? fmt(sputnik.token_balance) : "4,750"} {tokenLabel}
            </strong>
            <small>
              Plus 6 NEAR storage &amp; execution reserve on testnet
            </small>
          </div>
          <div className="sputnik-policy-box">
            <span>Council Multisig Policy</span>
            <strong>
              2 of {effectiveCouncil.length} RoleWeight
            </strong>
            <small>
              Permissions: AddProposal · VoteApprove · VoteReject · Finalize
            </small>
          </div>
          <div className="sputnik-policy-box">
            <span>Proposal &amp; Bounty Bond</span>
            <strong>
              {fmtNear(
                sputnik?.policy.proposal_bond ?? "10000000000000000000000",
              )}
            </strong>
            <small>
              7-day voting window · 1-day bounty forgiveness period
            </small>
          </div>
        </div>

        <div className="sputnik-council-strip">
          <span className="micro-label">
            <Users size={13} /> SPUTNIK DAO COUNCIL ROLE (`Group`)
          </span>
          <div className="sputnik-council-chips">
            {effectiveCouncil.map((member) => (
              <a
                key={member}
                href={`https://testnet.nearblocks.io/address/${member}`}
                target="_blank"
                rel="noreferrer"
                className={`council-chip ${state.actor === member ? "active-member" : ""}`}
              >
                <BadgeCheck size={13} />
                {member}
                {state.actor === member && <em>(You)</em>}
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="sputnik-main-grid">
        <section className="card sputnik-proposals-card">
          <div className="card-title">
            <div>
              <span className="micro-label">
                ON-CHAIN SPUTNIK DAO v2 PROPOSALS (`get_proposals`)
              </span>
              <h2>Cross-Contract Treasury Grants &amp; Governance</h2>
            </div>
            <span className="tag">
              {sputnik?.proposals.length ?? 0} proposals
            </span>
          </div>

          {!isCouncil && (
            <div className="inline-note">
              <LockKeyhole size={15} /> Connect one of the{" "}
              {effectiveCouncil.length} Sputnik DAO council testnet wallets to
              cast `VoteApprove` / `VoteReject` via `act_proposal` or submit a
              new proposal.
            </div>
          )}

          {sputnik && sputnik.proposals.length > 0 ? (
            <div className="sputnik-proposal-list">
              {[...sputnik.proposals].reverse().map((p) => (
                <SputnikProposalCard
                  key={p.id}
                  proposal={p}
                  state={state}
                  client={client}
                  pending={pending}
                  act={act}
                  isCouncil={isCouncil}
                  councilCount={effectiveCouncil.length}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-doodle">✳</div>
              <p>No Sputnik DAO proposals found on this contract yet.</p>
            </div>
          )}

          <div className="section-divider" />

          <div className="card-title">
            <div>
              <span className="micro-label">
                ON-CHAIN SPUTNIK BOUNTIES (`get_bounties`)
              </span>
              <h2>Active Sputnik Bounty Pools</h2>
            </div>
            <span className="tag">{sputnik?.bounties.length ?? 0} active</span>
          </div>

          {sputnik && sputnik.bounties.length > 0 ? (
            <div className="sputnik-bounties-list">
              {sputnik.bounties.map((b: SputnikBounty) => (
                <article key={b.id} className="sputnik-bounty-card">
                  <div className="bounty-head">
                    <span className="bounty-id-badge">
                      <Award size={14} /> SPUTNIK BOUNTY #{b.id}
                    </span>
                    <span className="status-tag done">
                      {b.times} CLAIMS AVAILABLE
                    </span>
                  </div>
                  <p className="bounty-desc">{b.description}</p>
                  <div className="bounty-meta">
                    <span>
                      Reward per claim:{" "}
                      <b>
                        {fmt(b.amount)} {tokenLabel}
                      </b>
                    </span>
                    <span>
                      Token contract: <code>{b.token}</code>
                    </span>
                    <span>
                      Max claim window:{" "}
                      {Math.round(Number(b.max_deadline) / 86_400_000_000_000)}{" "}
                      days
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>No active Sputnik bounties registered yet.</p>
            </div>
          )}
        </section>

        <aside className="card fund-card sputnik-compose-card">
          <span className="micro-label">SPUTNIK DAO `add_proposal`</span>
          <h2>Propose via Sputnik Multisig</h2>
          <p>
            Submit an on-chain proposal to <b>{sputnikId}</b>. Once 2 of{" "}
            {effectiveCouncil.length} council members vote{" "}
            <code>VoteApprove</code>, Sputnik DAO automatically executes the
            cross-contract call or registers the bounty.
          </p>

          <div className="sputnik-mode-switch" role="tablist">
            <button
              type="button"
              className={proposalMode === "grant" ? "active" : ""}
              onClick={() => setProposalMode("grant")}
            >
              <Coins size={14} /> Fund Contributor DAO
            </button>
            <button
              type="button"
              className={proposalMode === "bounty" ? "active" : ""}
              onClick={() => setProposalMode("bounty")}
            >
              <Award size={14} /> Add Sputnik Bounty
            </button>
          </div>

          <form onSubmit={submitSputnikProposal}>
            {proposalMode === "grant" ? (
              <label>
                Target Contributor DAO Bucket (
                {state.contract_id ?? "v2.rascals-dao-1104.testnet"})
                <select
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value as Bucket)}
                >
                  <option value="rewards">
                    Contributor rewards pool (`{"{"}&quot;bucket&quot;:&quot;rewards&quot;{"}"}`)
                  </option>
                  <option value="agents">
                    Verdict-agent service pool (`{"{"}&quot;bucket&quot;:&quot;agents&quot;{"}"}`)
                  </option>
                </select>
              </label>
            ) : (
              <label>
                Number of claim slots (`times`)
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={times}
                  onChange={(e) => setTimes(e.target.value)}
                  required
                />
              </label>
            )}

            <label>
              Amount ({tokenLabel})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50.00"
                required
              />
            </label>

            <label>
              Proposal description
              <textarea
                rows={3}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  proposalMode === "grant"
                    ? `Allocate ${amount || "50"} ${tokenLabel} from Sputnik shared treasury to ${state.contract_id} (${bucket} bucket)...`
                    : "Verified rascal-root merged PR contribution scored >= 80/100 by deterministic worker..."
                }
              />
            </label>

            <div className="sputnik-call-preview">
              <span className="micro-label">ON-CHAIN ACTION PREVIEW</span>
              {proposalMode === "grant" ? (
                <code>
                  {sputnikId} :: add_proposal(FunctionCall →{" "}
                  {state.config.token_id}::ft_transfer_call(receiver_id=&quot;
                  {state.contract_id}&quot;, bucket=&quot;{bucket}&quot;))
                </code>
              ) : (
                <code>
                  {sputnikId} :: add_proposal(AddBounty → token=&quot;
                  {state.config.token_id}&quot;, times={times})
                </code>
              )}
            </div>

            <button
              type="submit"
              className="primary-button full"
              disabled={!isCouncil || Boolean(pending)}
            >
              {pending?.startsWith("sputnik-propose") ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Vote size={15} />
              )}{" "}
              {proposalMode === "grant"
                ? "Submit Sputnik Grant Proposal"
                : "Submit Sputnik Bounty Proposal"}
            </button>
          </form>

          <div className="fund-foot">
            <CircleAlert size={14} /> Attaches{" "}
            {fmtNear(
              sputnik?.policy.proposal_bond ?? "10000000000000000000000",
            )}{" "}
            Sputnik proposal bond on NEAR Testnet. Requires council wallet
            approval.
          </div>
        </aside>
      </div>
    </div>
  );
}

function SputnikProposalCard({
  proposal: p,
  state,
  client,
  pending,
  act,
  isCouncil,
  councilCount,
}: {
  proposal: SputnikProposal;
  state: DaoState;
  client: DaoClient;
  pending: string | null;
  act: (
    key: string,
    fn: () => Promise<void>,
    message?: string,
  ) => Promise<boolean>;
  isCouncil: boolean;
  councilCount: number;
}) {
  const tokenLabel = state.token_symbol ?? state.config.token_id;
  const counts = p.vote_counts?.council ?? [0, 0, 0];
  const yes = counts[0] ?? 0;
  const no = counts[1] ?? 0;
  const voted = Boolean(state.actor && p.votes && p.votes[state.actor]);
  const inProgress = p.status === "InProgress";

  let kindBadge = "Governance Proposal";
  let callSummary: string | null = null;

  if ("FunctionCall" in p.kind && p.kind.FunctionCall) {
    const fc = p.kind.FunctionCall as {
      receiver_id: string;
      actions: Array<{ method_name: string; args: string }>;
    };
    const first = fc.actions?.[0];
    kindBadge = `FunctionCall → ${fc.receiver_id}`;
    if (first) {
      const decoded = decodeBase64Json(first.args);
      if (decoded && first.method_name === "ft_transfer_call") {
        const amt =
          typeof decoded.amount === "string" ? fmt(decoded.amount) : "?";
        let bucketName = "";
        if (typeof decoded.msg === "string") {
          try {
            const msgObj = JSON.parse(decoded.msg);
            if (msgObj.bucket) bucketName = ` (${msgObj.bucket} bucket)`;
          } catch {}
        }
        callSummary = `${first.method_name}: Transfer ${amt} ${tokenLabel} → ${String(decoded.receiver_id ?? "")}${bucketName}`;
      } else {
        callSummary = `${first.method_name}() on ${fc.receiver_id}`;
      }
    }
  } else if ("AddBounty" in p.kind && p.kind.AddBounty) {
    const ab = (p.kind.AddBounty as { bounty: SputnikBounty }).bounty;
    kindBadge = "AddBounty";
    callSummary = `Bounty: ${fmt(ab.amount)} ${tokenLabel} × ${ab.times} claims (${ab.description})`;
  } else if ("Transfer" in p.kind && p.kind.Transfer) {
    const tr = p.kind.Transfer as {
      token_id: string;
      receiver_id: string;
      amount: string;
    };
    kindBadge = `Transfer → ${tr.receiver_id}`;
    callSummary = `Transfer ${fmt(tr.amount)} ${tr.token_id || "NEAR"} to ${tr.receiver_id}`;
  }

  return (
    <article className="proposal-row expanded-row sputnik-proposal-row">
      <div className="proposal-symbol">
        {"AddBounty" in p.kind ? (
          <Award size={18} />
        ) : "FunctionCall" in p.kind ? (
          <Banknote size={18} />
        ) : (
          <Scale size={18} />
        )}
      </div>
      <div className="proposal-content">
        <div className="proposal-titleline">
          <b>
            Sputnik Proposal #{p.id} · {kindBadge}
          </b>
          <span
            className={`status-tag ${
              p.status === "Approved"
                ? "done"
                : p.status === "InProgress"
                  ? "voting"
                  : "danger-tag"
            }`}
          >
            {p.status === "Approved"
              ? "APPROVED & EXECUTED"
              : p.status === "InProgress"
                ? "IN PROGRESS · AWAITING VOTE"
                : p.status.toUpperCase()}
          </span>
        </div>

        <p>{p.description}</p>

        {callSummary && (
          <div className="request-details">
            <span>Cross-contract payload</span>
            <code>{callSummary}</code>
          </div>
        )}

        <div className="proposal-meta">
          <span>Proposer: {p.proposer}</span>
          <span>
            <Clock3 size={13} /> Submitted {dt(p.submission_time)}
          </span>
          <span>
            Votes:{" "}
            {Object.entries(p.votes || {})
              .map(([who, v]) => `${who} (${v})`)
              .join(", ") || "None yet"}
          </span>
        </div>

        <div className="vote-line">
          <span className="vote-count">
            <i className="yes-dot" />
            {yes} Approve (threshold 2 of {councilCount})
          </span>
          <span className="vote-count">
            <i className="no-dot" />
            {no} Reject
          </span>
          <div className="vote-bar">
            <i
              style={{
                width: `${Math.min(100, (yes / 2) * 100)}%`,
              }}
            />
          </div>
          {inProgress && isCouncil && client.sputnikVote && (
            <div className="vote-buttons">
              <button
                type="button"
                disabled={voted || Boolean(pending)}
                onClick={() =>
                  void act(
                    `sputnik-vote-${p.id}`,
                    () => client.sputnikVote!(p.id, "VoteApprove"),
                    `VoteApprove recorded on Sputnik DAO proposal #${p.id}.`,
                  )
                }
              >
                VoteApprove
              </button>
              <button
                type="button"
                disabled={voted || Boolean(pending)}
                onClick={() =>
                  void act(
                    `sputnik-vote-${p.id}`,
                    () => client.sputnikVote!(p.id, "VoteReject"),
                    `VoteReject recorded on Sputnik DAO proposal #${p.id}.`,
                  )
                }
              >
                VoteReject
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
