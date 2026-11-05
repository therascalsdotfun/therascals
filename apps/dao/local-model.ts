/** Loopback simulator only. No chain funds, GitHub verification or TEE attestation. */
import { createHash } from "node:crypto";
export type Policy = {
  tokens_per_point: string;
  max_score: number;
  max_reward_per_contribution: string;
  epoch_budget: string;
  epoch_agent_budget: string;
  epoch_duration_ns: number;
  challenge_period_ns: number;
  voting_period_ns: number;
  verdict_timeout_ns: number;
  verdict_fee: string;
};
type Agent = {
  account_id: string;
  worker_code_hash: string;
  rubric_hash: string;
  outlayer?: unknown;
};
type Request = {
  repo: string;
  pr_number: number;
  merge_sha: string;
  beneficiary: string;
};
type Action =
  | { kind: "update_policy"; value: { policy: Policy } }
  | { kind: "appoint_agent"; value: { agent: Agent } }
  | { kind: "review_contribution"; value: { request: Request } }
  | { kind: "resolve_challenge"; value: { job_id: number; approve: boolean } };
type Proposal = {
  id: number;
  proposer: string;
  description: string;
  action: Action;
  created_at_ns: number;
  voting_ends_at_ns: number;
  yes: number;
  no: number;
  voters: { account_id: string; approve: boolean }[];
  executed: boolean;
  job_id: number | null;
  review_policy?: Policy | null;
  review_agent?: Agent | null;
};
type Job = {
  id: number;
  request: Request;
  policy: Policy;
  agent: Agent;
  created_at_ns: number;
  verdict_deadline_ns: number;
  epoch_id: number;
  max_reward: string;
  agent_fee: string;
  score: number | null;
  rationale: string | null;
  evidence_hash: string | null;
  challenge_ends_at_ns: number | null;
  challenged: boolean;
  challenge_reason: string | null;
  resolved_approved: boolean | null;
  expired: boolean;
  reward_amount: string;
  reward_status: string;
  agent_status: string;
  evidence_source: string;
};
export type LocalState = {
  version: 1;
  offset_ms: number;
  active_actor?: string;
  epoch_origin_ns: number;
  config: {
    members: string[];
    threshold: number;
    token_id: string;
    policy: Policy;
    agent: Agent | null;
    epoch_id: number;
  };
  treasury: Record<string, string>;
  proposals: Proposal[];
  jobs: Job[];
  epochs: Record<
    string,
    {
      reward_limit: string;
      agent_limit: string;
      reward_used: string;
      agent_used: string;
    }
  >;
};
const ns = (ms: number) => Math.floor(ms * 1e6),
  clone = <T>(v: T): T => structuredClone(v);
function require(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function amount(v: unknown) {
  require(typeof v === "string" &&
    /^\d{1,39}$/.test(v), "Use an unsigned atomic amount string");
  let n = BigInt(v);
  require(n < 2n ** 128n, "Amount exceeds u128");
  return n;
}
function text(v: unknown, max: number, label: string) {
  require(typeof v === "string" &&
    v.trim().length > 0 &&
    new TextEncoder().encode(v).length <= max, `Invalid ${label}`);
  return v.trim();
}
function acct(v: unknown) {
  let s = text(v, 64, "testnet account");
  require(/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(
    s,
  ), "Use a named testnet account");
  return s;
}
function hash(v: unknown) {
  require(typeof v === "string" &&
    /^[a-f0-9]{64}$/.test(v), "Use a 64-character lowercase hash");
  return v;
}
function policy(v: Policy) {
  require(v && typeof v === "object", "Policy required");
  for (const k of [
    "tokens_per_point",
    "max_reward_per_contribution",
    "epoch_budget",
    "epoch_agent_budget",
    "verdict_fee",
  ] as const)
    amount(v[k]);
  require(Number.isInteger(v.max_score) &&
    v.max_score >= 1 &&
    v.max_score <= 1000, "Score cap must be 1–1000");
  for (const k of [
    "epoch_duration_ns",
    "challenge_period_ns",
    "voting_period_ns",
    "verdict_timeout_ns",
  ] as const)
    require(Number.isSafeInteger(v[k]) &&
      v[k] >= 1e9 &&
      v[k] <= 30 * 86400e9, "Duration must be between 1 second and 30 days");
  require(amount(v.tokens_per_point) > 0n &&
    amount(v.max_reward_per_contribution) >
      0n, "Positive reward terms required");
  require(amount(v.tokens_per_point) * BigInt(v.max_score) <=
    amount(v.max_reward_per_contribution), "Score value exceeds reward cap");
  require(amount(v.epoch_budget) >= amount(v.max_reward_per_contribution) &&
    amount(v.epoch_agent_budget) >=
      amount(v.verdict_fee), "Epoch budget below job cap");
  return clone(v);
}
function request(v: Request) {
  require(v && typeof v === "object", "Review request required");
  require(typeof v.repo === "string" &&
    /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(
      v.repo,
    ), "Use owner/repository");
  require(Number.isInteger(v.pr_number) &&
    v.pr_number > 0 &&
    v.pr_number <= 2147483647, "Invalid PR number");
  require(v.repo === v.repo.toLowerCase(), "Use lowercase repository identity");
  require(/^[a-f0-9]{40}$/.test(
    v.merge_sha,
  ), "Use the exact 40-character merge SHA");
  acct(v.beneficiary);
  return clone(v);
}
function agent(v: Agent) {
  require(v && typeof v === "object", "Agent required");
  acct(v.account_id);
  hash(v.worker_code_hash);
  hash(v.rubric_hash);
  return clone(v);
}
export function initialState(): LocalState {
  return {
    version: 1,
    offset_ms: 0,
    epoch_origin_ns: ns(Date.now()),
    config: {
      members: ["alice.testnet", "bob.testnet", "carol.testnet"],
      threshold: 2,
      token_id: "local-reward.testnet",
      policy: {
        tokens_per_point: "1000000",
        max_score: 100,
        max_reward_per_contribution: "100000000",
        epoch_budget: "1000000000",
        epoch_agent_budget: "10000000",
        epoch_duration_ns: 86400e9,
        challenge_period_ns: 3600e9,
        voting_period_ns: 3600e9,
        verdict_timeout_ns: 86400e9,
        verdict_fee: "1000000",
      },
      agent: null,
      epoch_id: 0,
    },
    treasury: {
      reward_available: "0",
      reward_reserved: "0",
      reward_pending: "0",
      reward_paid: "0",
      agent_available: "0",
      agent_reserved: "0",
      agent_pending: "0",
      agent_paid: "0",
      compute_available: "0",
      compute_pending: "0",
      compute_spent: "0",
    },
    proposals: [],
    jobs: [],
    epochs: {},
  };
}
export class LocalDao {
  state: LocalState;
  constructor(
    state: LocalState | undefined = undefined,
    private clock: () => number = Date.now,
  ) {
    this.state = clone(state ?? initialState());
    if (!state) this.state.epoch_origin_ns = this.now();
  }
  now() {
    return ns(this.clock() + this.state.offset_ms);
  }
  member(a: string) {
    require(this.state.config.members.includes(a), "Council member required");
  }
  private add(k: string, n: bigint) {
    const value = amount(this.state.treasury[k] ?? "0") + n;
    require(value < 2n ** 128n, "Treasury overflow");
    this.state.treasury[k] = value.toString();
  }
  private take(k: string, n: bigint) {
    require(amount(this.state.treasury[k] ?? "0") >=
      n, "Insufficient funded budget");
    this.state.treasury[k] = (amount(this.state.treasury[k]) - n).toString();
  }
  private releaseEpochReward(j: Job, n: bigint) {
    const e = this.state.epochs[j.epoch_id];
    if (e) e.reward_used = (amount(e.reward_used) - n).toString();
  }
  private job(id: unknown) {
    require(Number.isInteger(id), "Invalid job ID");
    const j = this.state.jobs.find((j) => j.id === id);
    require(j, "Job not found");
    return j;
  }
  private validateAction(a: Action) {
    require(a && typeof a === "object", "Action required");
    switch (a.kind) {
      case "update_policy":
        policy(a.value.policy);
        break;
      case "appoint_agent":
        agent(a.value.agent);
        break;
      case "review_contribution":
        request(a.value.request);
        require(this.state.config.agent, "Appoint an agent first");
        require(a.value.request.beneficiary !==
          this.state.config.agent.account_id, "Agent cannot judge own reward");
        break;
      case "resolve_challenge":
        this.job(a.value.job_id);
        require(typeof a.value.approve === "boolean", "Resolution required");
        break;
      default:
        throw Error("Unsupported proposal kind");
    }
    return clone(a);
  }
  /** Mutations roll back on any validation/accounting failure, like a contract call. */
  call(method: string, args: any, actor: string) {
    acct(actor);
    const before = clone(this.state);
    try {
      const result = this.perform(method, args ?? {}, actor);
      this.state.active_actor = actor;
      return result;
    } catch (e) {
      this.state = before;
      throw e;
    }
  }
  private perform(method: string, args: any, actor: string): unknown {
    const c = this.state.config,
      t = this.now();
    if (method === "fund") {
      this.member(actor);
      require(args.bucket === "rewards" ||
        args.bucket === "agents", "Unknown budget bucket");
      let n = amount(args.amount);
      require(n > 0n, "Positive deposit required");
      this.add(
        args.bucket === "rewards" ? "reward_available" : "agent_available",
        n,
      );
      return { simulated: true };
    }
    if (method === "advance_time") {
      this.member(actor);
      require(Number.isInteger(args.seconds) &&
        args.seconds > 0 &&
        args.seconds <= 30 * 86400, "Advance 1 second to 30 days");
      this.state.offset_ms += args.seconds * 1000;
      return null;
    }
    if (method === "reset") {
      this.member(actor);
      this.state = initialState();
      this.state.epoch_origin_ns = this.now();
      return null;
    }
    if (method === "propose") {
      this.member(actor);
      require(this.state.proposals.length < 1000, "Proposal cap reached");
      const p: Proposal = {
        id: this.state.proposals.length,
        proposer: actor,
        description: text(args.description, 1024, "description"),
        action: this.validateAction(args.action),
        created_at_ns: t,
        voting_ends_at_ns: t + c.policy.voting_period_ns,
        yes: 0,
        no: 0,
        voters: [],
        executed: false,
        job_id: null,
        review_policy:
          args.action.kind === "review_contribution" ? clone(c.policy) : null,
        review_agent:
          args.action.kind === "review_contribution" ? clone(c.agent) : null,
      };
      this.state.proposals.push(p);
      return p.id;
    }
    if (method === "vote" || method === "execute") {
      const p = this.state.proposals.find((p) => p.id === args.proposal_id);
      require(p, "Proposal not found");
      require(!p.executed, "Proposal already executed");
      if (method === "vote") {
        this.member(actor);
        require(t < p.voting_ends_at_ns, "Voting closed");
        require(typeof args.approve === "boolean", "Vote required");
        require(!p.voters.some((v) => v.account_id === actor), "Already voted");
        const a = p.action;
        if (a.kind === "appoint_agent")
          require(a.value.agent.account_id !== actor, "Agent must recuse");
        if (a.kind === "review_contribution")
          require(a.value.request.beneficiary !== actor &&
            p.review_agent?.account_id !==
              actor, "Beneficiary and agent must recuse");
        if (a.kind === "resolve_challenge")
          require(this.job(a.value.job_id).request.beneficiary !== actor &&
            this.job(a.value.job_id).agent.account_id !==
              actor, "Beneficiary and agent must recuse");
        p.voters.push({ account_id: actor, approve: args.approve });
        args.approve ? p.yes++ : p.no++;
        return p;
      }
      require(t >= p.voting_ends_at_ns, "Voting still open");
      require(p.yes >= c.threshold, "Approval threshold not met");
      const a = this.validateAction(p.action);
      if (a.kind === "update_policy") {
        require(a.value.policy.epoch_duration_ns ===
          c.policy.epoch_duration_ns, "Epoch duration immutable");
        c.policy = policy(a.value.policy);
      }
      if (a.kind === "appoint_agent") c.agent = agent(a.value.agent);
      if (a.kind === "review_contribution") {
        require(JSON.stringify(p.review_policy) === JSON.stringify(c.policy) &&
          JSON.stringify(p.review_agent) ===
            JSON.stringify(
              c.agent,
            ), "Review policy or agent changed; create a new proposal");
        require(c.agent, "Appoint an agent first");
        const r = a.value.request;
        require(!this.state.jobs.some(
          (j) =>
            j.request.repo.toLowerCase() === r.repo.toLowerCase() &&
            j.request.pr_number === r.pr_number,
        ), "PR already authorized");
        const epoch = Math.floor(
            (t - this.state.epoch_origin_ns) / c.policy.epoch_duration_ns,
          ),
          max = amount(c.policy.max_reward_per_contribution),
          fee = amount(c.policy.verdict_fee);
        const e = this.state.epochs[epoch] ?? {
          reward_limit: c.policy.epoch_budget,
          agent_limit: c.policy.epoch_agent_budget,
          reward_used: "0",
          agent_used: "0",
        };
        require(amount(e.reward_used) + max <=
          amount(e.reward_limit), "Epoch reward cap exceeded");
        require(amount(e.agent_used) + fee <=
          amount(e.agent_limit), "Epoch agent cap exceeded");
        this.take("reward_available", max);
        this.take("agent_available", fee);
        this.add("reward_reserved", max);
        this.add("agent_reserved", fee);
        e.reward_used = (amount(e.reward_used) + max).toString();
        e.agent_used = (amount(e.agent_used) + fee).toString();
        this.state.epochs[epoch] = e;
        this.state.jobs.push({
          id: p.id,
          request: r,
          policy: clone(c.policy),
          agent: clone(c.agent),
          created_at_ns: t,
          verdict_deadline_ns: t + c.policy.verdict_timeout_ns,
          epoch_id: epoch,
          max_reward: max.toString(),
          agent_fee: fee.toString(),
          score: null,
          rationale: null,
          evidence_hash: null,
          challenge_ends_at_ns: null,
          challenged: false,
          challenge_reason: null,
          resolved_approved: null,
          expired: false,
          reward_amount: max.toString(),
          reward_status: "reserved",
          agent_status: fee === 0n ? "paid" : "reserved",
          evidence_source: "not-yet-judged",
        });
        p.job_id = p.id;
      }
      if (a.kind === "resolve_challenge") {
        const j = this.job(a.value.job_id);
        require(j.challenged &&
          j.resolved_approved === null, "No unresolved challenge");
        require(j.reward_status === "reserved" ||
          (j.reward_status === "released" &&
            j.reward_amount === "0"), "Reward already settled");
        j.resolved_approved = a.value.approve;
        if (!a.value.approve) {
          this.take("reward_reserved", amount(j.reward_amount));
          this.add("reward_available", amount(j.reward_amount));
          this.releaseEpochReward(j, amount(j.reward_amount));
          j.reward_status = "released";
        }
      }
      p.executed = true;
      return p;
    }
    const j = this.job(args.job_id);
    if (method === "judge") {
      require(this.state.config.members.includes(actor) ||
        actor === j.agent.account_id, "Appointed agent or council required");
      require(j.agent.account_id, "Agent not appointed");
      // Explicit local/manual program judgment. Never labelled GitHub-verified or attested.
      const assessment = args.assessment ?? {
        impact: 3,
        security: 3,
        verification: 3,
        maintenance: 3,
      };
      const weights = {
        impact: 8,
        security: 5,
        verification: 5,
        maintenance: 2,
      };
      let total = 0;
      for (const [key, weight] of Object.entries(weights)) {
        require(Number.isInteger(assessment[key]) &&
          assessment[key] >= 0 &&
          assessment[key] <= 5, "Assessment dimensions must be integers 0–5");
        total += assessment[key] * weight;
      }
      const score = Math.min(
        j.policy.max_score,
        Math.floor((total * j.policy.max_score) / 100),
        Number(amount(j.max_reward) / amount(j.policy.tokens_per_point)),
      );
      return this.perform(
        "submit_verdict",
        {
          job_id: j.id,
          score,
          rationale:
            "Local program verdict (manual assessment): " +
            JSON.stringify(assessment) +
            ". Weighted 8/5/5/2 for impact/security/verification/maintenance. Simulation only: no GitHub merge or TEE proof asserted.",
          evidence_hash: createHash("sha256")
            .update(
              JSON.stringify({
                request: j.request,
                assessment,
                weights,
                rubric_hash: j.agent.rubric_hash,
                source: "local-manual-program",
              }),
            )
            .digest("hex"),
          merge_sha: j.request.merge_sha,
          worker_code_hash: j.agent.worker_code_hash,
          rubric_hash: j.agent.rubric_hash,
        },
        j.agent.account_id,
      );
    }
    if (method === "submit_verdict") {
      require(actor === j.agent.account_id, "Appointed agent required");
      require(j.score === null &&
        !j.expired, "Verdict already submitted or expired");
      require(t < j.verdict_deadline_ns, "Verdict deadline passed");
      require(args.merge_sha === j.request.merge_sha &&
        args.worker_code_hash === j.agent.worker_code_hash &&
        args.rubric_hash === j.agent.rubric_hash, "Verdict binding mismatch");
      hash(args.evidence_hash);
      require(Number.isInteger(args.score) &&
        args.score >= 0 &&
        args.score <= j.policy.max_score, "Invalid score");
      j.rationale = text(args.rationale, 4096, "rationale");
      j.evidence_hash = args.evidence_hash;
      j.score = args.score;
      const reward = amount(j.policy.tokens_per_point) * BigInt(args.score);
      require(reward <= amount(j.max_reward), "Reward exceeds reserved cap");
      const unused = amount(j.max_reward) - reward;
      this.take("reward_reserved", unused);
      this.add("reward_available", unused);
      this.releaseEpochReward(j, unused);
      j.reward_amount = reward.toString();
      if (reward === 0n) j.reward_status = "released";
      j.challenge_ends_at_ns = t + j.policy.challenge_period_ns;
      j.evidence_source = "local-authorized-agent / no-attestation";
      return j;
    }
    if (method === "challenge") {
      require(j.score !== null && !j.expired, "No valid verdict");
      require(!j.challenged &&
        t < (j.challenge_ends_at_ns ?? 0), "Challenge period closed");
      j.challenged = true;
      j.challenge_reason = text(args.reason, 2048, "challenge reason");
      return j;
    }
    if (method === "expire_job") {
      require(j.score === null &&
        !j.expired &&
        t > j.verdict_deadline_ns, "Job cannot expire");
      this.take("reward_reserved", amount(j.max_reward));
      this.add("reward_available", amount(j.max_reward));
      this.releaseEpochReward(j, amount(j.max_reward));
      this.state.epochs[j.epoch_id].agent_used = (
        amount(this.state.epochs[j.epoch_id].agent_used) - amount(j.agent_fee)
      ).toString();
      this.take("agent_reserved", amount(j.agent_fee));
      this.add("agent_available", amount(j.agent_fee));
      j.reward_status = j.agent_status = "released";
      j.expired = true;
      return j;
    }
    if (method === "claim_reward" || method === "claim_agent_fee") {
      const reward = method === "claim_reward";
      require(actor ===
        (reward
          ? j.request.beneficiary
          : j.agent.account_id), "Bound claimant required");
      require(j.score !== null && !j.expired, "No completed verdict");
      const key = reward ? "reward_status" : "agent_status";
      require(j[key] === "reserved", "Already claimed or unavailable");
      if (reward) {
        require(!j.challenged ||
          j.resolved_approved === true, "Unresolved/rejected challenge");
        require(j.challenged ||
          t >= (j.challenge_ends_at_ns ?? Infinity), "Challenge window open");
      }
      const bucket = reward ? "reward" : "agent",
        n = amount(reward ? j.reward_amount : j.agent_fee);
      this.take(bucket + "_reserved", n);
      this.add(bucket + "_paid", n);
      j[key] = "paid";
      return { simulated: true, receipt: "local-" + method + "-" + j.id };
    }
    throw Error("Unsupported local method");
  }
  snapshot() {
    return {
      mode: "local-demo" as const,
      config: {
        ...clone(this.state.config),
        epoch_id: Math.floor(
          (this.now() - this.state.epoch_origin_ns) /
            this.state.config.policy.epoch_duration_ns,
        ),
      },
      treasury: clone(this.state.treasury),
      proposals: clone(this.state.proposals),
      jobs: clone(this.state.jobs),
      now_ns: this.now(),
      actor: this.state.active_actor ?? "alice.testnet",
      accounts: [
        "alice.testnet",
        "bob.testnet",
        "carol.testnet",
        "judge.testnet",
        "builder.testnet",
        "observer.testnet",
      ],
    };
  }
}
