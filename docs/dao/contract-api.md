# Contributor DAO contract API (prototype, testnet only)

Crate `rascals-contributor-dao`, NEAR SDK 5.29.1. Amounts are JSON decimal strings (`U128`), timestamps/durations are integer nanoseconds (`u64`). Every write below except `new`, `ft_on_transfer`, `fund_compute`, and private callbacks requires exactly 1 yoctoNEAR. Mainnet contract/token/member/agent/beneficiary accounts are refused. Deployed November 4 to `v2.rascals-dao-1104.testnet`; see testnet-deployment-2026-11-04.md.

## Initialization

`new({ members: string[], threshold: number, token_id: string, policy: Policy })`

Members are fixed for this prototype (1–15 distinct testnet accounts). Threshold must be a strict majority, not exceed member count. Fund contract storage separately. Testnet token contract must be separate from DAO.

Policy:

```json
{
  "tokens_per_point": "1000000",
  "max_score": 100,
  "max_reward_per_contribution": "100000000",
  "epoch_budget": "1000000000",
  "epoch_agent_budget": "10000000",
  "epoch_duration_ns": 86400000000000,
  "challenge_period_ns": 3600000000000,
  "voting_period_ns": 3600000000000,
  "verdict_timeout_ns": 86400000000000,
  "verdict_fee": "1000000"
}
```

Agent:

```json
{
  "account_id": "judge.testnet",
  "worker_code_hash": "<64 lowercase hex>",
  "rubric_hash": "<64 lowercase hex>"
}
```

ReviewRequest:

```json
{
  "repo": "nvq2309/therascals",
  "pr_number": 1,
  "merge_sha": "<40 lowercase hex>",
  "beneficiary": "builder.testnet"
}
```

## Governance

`propose({ action, description }) -> number` (member only)
`vote({ proposal_id, approve: boolean }) -> Proposal` (member, one vote; no beneficiary self-vote for review/dispute, no appointee self-vote for agent appointment)
`execute({ proposal_id }) -> Proposal` (any caller, only after voting deadline and approved threshold)

Actions use tagged JSON:

- `{"kind":"update_policy","value":{"policy":Policy}}`
- `{"kind":"appoint_agent","value":{"agent":Agent}}`
- `{"kind":"review_contribution","value":{"request":ReviewRequest}}`
- `{"kind":"resolve_challenge","value":{"job_id":0,"approve":true}}`

All validation is also repeated on execution. A review proposal creates its job ID equal to the proposal ID; execution result's `job_id` identifies it. Agent and policy snapshots bind each job. One repo/PR may be authorized only once. Reward max + agent fee are reserved before work and counted against fixed contract epoch ceilings. Current policy changes do not change prior jobs. Epoch ceilings are immutable once first funded work is authorized in that epoch.

## Agent, dispute and claims

`submit_verdict({ job_id, score, rationale, evidence_hash, merge_sha, worker_code_hash, rubric_hash }) -> ReviewJob` — appointed job agent only; all request hashes must match snapshots, one result, deadline enforced. Agent is an explicitly trusted signer in this prototype; this is not a raw TEE-attestation verification endpoint.

`challenge({ job_id, reason }) -> ReviewJob` — public, before challenge deadline, reason required, once per job. Challenged jobs require a governance resolution before reward claims. Challengers do not automatically change score/payment.

`expire_job({ job_id }) -> ReviewJob` — any caller after verdict deadline, only jobs without verdict. Returns both reservations to respective budgets; duplicate expirations refused. PR remains consumed to prevent retry farming; a new policy alone does not erase identity.

`claim_reward({ job_id }) -> Promise` — bound beneficiary, only after unchallenged challenge period / approved dispute. Transfer is reserved pending callback; failure restores claimability, success permanently marks claimed. A rejected dispute returns reward reservation to available; agent may still claim earned service fee for a valid completed verdict.

`claim_agent_fee({ job_id }) -> Promise` — snapshotted agent, only after a valid verdict, one service payment per authorized job. Failure restores claimability. No agent fee for expired/no-result jobs.

Private `resolve_claim({ job_id, bucket, nonce }, callback result)` is only callable by DAO itself; matches pending nonce and exact state. There is no withdraw/mint/arbitrary-call method.

## Funding

NEP-141 `ft_transfer_call` from `token_id` with `msg` equal to `{"bucket":"rewards"}` or `{"bucket":"agents"}` deposits into distinct budgets. Invalid messages/unexpected token/zero deposits are refunded in full. These are confirmed token deposits, not an automatic claim that protocol fees were converted/bridged.

## Views

- `get_config({}) -> {members,threshold,token_id,policy,agent,epoch_id}`
- `get_treasury({}) -> {reward_available,reward_reserved,reward_pending,reward_paid,agent_available,agent_reserved,agent_pending,agent_paid}`
- `get_proposal({proposal_id}) -> Proposal|null`
- `list_proposals({from_index?:0,limit?:50}) -> Proposal[]` (max100)
- `get_job({job_id}) -> ReviewJob|null`
- `list_jobs({from_index?:0,limit?:50}) -> ReviewJob[]` (job IDs are proposal IDs; paginate scans by proposal ID)
- `get_epoch({epoch_id}) -> Epoch|null`

Proposal includes `id,proposer,description,action,created_at_ns,voting_ends_at_ns,yes,no,voters,executed,job_id`. ReviewJob includes request/policy/agent snapshots, `created_at_ns,verdict_deadline_ns,epoch_id,max_reward,agent_fee,score,rationale,evidence_hash,challenge_ends_at_ns,challenged,challenge_reason,resolved_approved,expired,reward_amount,reward_status,agent_status`. Status is `reserved|pending|paid|released`. Hashes and reason lengths are bounded. Global cap: 1,000 proposals, description/rationale/challenge text bounded separately; no unbounded user-generated storage.

## Implemented OutLayer compute dispatch

`Agent` additionally accepts optional `outlayer`:

```json
{
  "contract_id": "outlayer.testnet",
  "source_url": "https://your-host/worker.wasm",
  "source_hash": "<same 64hex as worker_code_hash>",
  "max_deposit": "10000000000000000000000",
  "secrets_ref": {
    "profile": "github-readonly",
    "account_id": "profile-owner.testnet"
  }
}
```

`secrets_ref` is optional and contains only a nonsecret encrypted-profile locator; raw credentials are never allowed in this schema. The private repository requires the owner to register a GitHub read-only secret profile with OutLayer separately. This prototype does not provision or publish that secret.

- `fund_compute({})` accepts a positive native NEAR attached deposit into a separate compute allocation ledger.
- `execute_outlayer({job_id})` is a council write with one yoctoNEAR and up to 300Tgas. It dispatches **once per job**, using the snapshotted source URL/hash, WASI Preview2 target and secret-profile locator. It reserves `max_deposit` from funded native compute allocation before the call to `outlayer.testnet.request_execution`.
- Request input: `{schema_version:1,job_id,repository,pull_request,merge_sha,beneficiary,worker_code_hash,rubric_hash,max_score}`. Resource limits: 1 billion instructions, 128MB, 60 seconds. Source uses `{WasmUrl:{url,hash,build_target:"wasm32-wasip2"}}`, `response_format:"Json"`, `payer_account_id:null`, `params:null`.
- Private callback reads bounded raw receipt bytes (16KiB), clears pending compute state before parsing, validates every identity/hash/score field and records only a valid result. Malformed, missing, oversized, stale or late output cannot write a verdict. A pending compute job can expire at its verdict deadline even if no callback arrives; a late callback is ignored.
- Compute allocations are conservatively counted as spent on dispatch completion/failure/expiry; automatic refunds are **not assumed**. Any actual provider refund is unallocated account surplus pending a future reviewed reconciliation mechanism. No automatic retry or second native charge is exposed. After a failed result, the appointed manual agent may submit a valid verdict before deadline.
- Treasury view adds `compute_available`, `compute_pending`, `compute_spent` in yoctoNEAR. Token amounts and native compute allocations are never added together.

OutLayer callback JSON must contain exactly `{schema_version,job_id,repository,pull_request,beneficiary,merge_sha,worker_code_hash,rubric_hash,score,rationale,evidence_hash,eligible,agent_kind,attestation_status}`. This worker uses `agent_kind:"deterministic-program-v1"`, `attestation_status:"external-verification-required"`. Ineligible results must score zero. This is authenticated response provenance from the configured OutLayer contract, **not independently verified TEE attestation or proof of objective contribution quality**.

The reward/agent job snapshot is immutable. A review proposal records the policy and agent at proposal creation; if either changes before execution, that review proposal must be created and voted again. `epoch_duration_ns` is immutable; existing epoch ceilings remain fixed even if policy changes. Council membership/threshold and token contract are fixed for this prototype.

Zero-score verdicts can be challenged and receive a recorded governance outcome. This prototype's dispute action approves/rejects the existing award; it does not increase/re-score a zero award or create new budget. Re-scoring needs a later, separately reviewed mechanism. All reward beneficiaries and the appointed agent must recuse from decisions awarding/resolving that contribution; the fixed quorum is not reduced for recusals.

Claim callbacks inspect receipt **success status**, not JSON output. A successful NEP141 transfer is permanently paid even if the token returns unexpected/large bytes; failed receipts restore the reserved claim for retry. This prevents interpreting a completed transfer as unpaid and sending it twice. Beneficiary/agent must be registered with the FT contract or the transfer fails safely and remains retryable.

Bounds: 1,000 lifetime proposals/jobs, 15 distinct members, descriptions ≤1,024 bytes, verdict rationales ≤4,096 bytes, one challenge reason ≤2,048 bytes/job, result bytes ≤16KiB, list scan limit100. Proposal storage is finite but funded by deployer storage stake; this is not a production storage-fee market. There is no generic treasury withdrawal, arbitrary signing, native surplus withdrawal or public mint.
