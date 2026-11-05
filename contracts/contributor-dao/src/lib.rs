//! Testnet contributor governance. Agent judgment is explicit trust, never objective-quality proof.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
    PromiseResult,
};
const SECOND: u64 = 1_000_000_000;
const MAX_PROPOSALS: u64 = 1000;
fn check(ok: bool, msg: &str) {
    if !ok {
        #[cfg(target_arch = "wasm32")]
        env::panic_str(msg);
        #[cfg(not(target_arch = "wasm32"))]
        panic!("{}", msg);
    }
}
fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).expect("Amount overflow")
}
fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).expect("Amount underflow")
}
fn testnet(a: &AccountId) -> bool {
    a.as_str().ends_with(".testnet")
}
fn hex(s: &str, len: usize) -> bool {
    s.len() == len
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn one() {
    check(
        env::attached_deposit() == NearToken::from_yoctonear(1),
        "Attach exactly one yoctoNEAR",
    );
}
fn deadline(duration: u64) -> u64 {
    env::block_timestamp()
        .checked_add(duration)
        .expect("Time overflow")
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub tokens_per_point: U128,
    pub max_score: u32,
    pub max_reward_per_contribution: U128,
    pub epoch_budget: U128,
    pub epoch_agent_budget: U128,
    pub epoch_duration_ns: u64,
    pub challenge_period_ns: u64,
    pub voting_period_ns: u64,
    pub verdict_timeout_ns: u64,
    pub verdict_fee: U128,
}
impl Policy {
    fn validate(&self) {
        check((1..=1000).contains(&self.max_score), "Invalid score limit");
        check(self.tokens_per_point.0 > 0, "Positive point value required");
        check(
            self.tokens_per_point
                .0
                .checked_mul(self.max_score as u128)
                .map(|v| v <= self.max_reward_per_contribution.0)
                .unwrap_or(false),
            "Score value exceeds reward cap",
        );
        check(
            self.epoch_budget.0 >= self.max_reward_per_contribution.0
                && self.epoch_agent_budget.0 >= self.verdict_fee.0,
            "Epoch budget below job cap",
        );
        for d in [
            self.challenge_period_ns,
            self.voting_period_ns,
            self.verdict_timeout_ns,
        ] {
            check(
                (SECOND..=30 * 86400 * SECOND).contains(&d),
                "Invalid policy duration",
            );
        }
        check(
            (SECOND..=365 * 86400 * SECOND).contains(&self.epoch_duration_ns),
            "Invalid epoch duration",
        );
    }
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct SecretProfile {
    pub profile: String,
    pub account_id: AccountId,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct OutlayerConfig {
    pub contract_id: AccountId,
    pub source_url: String,
    pub source_hash: String,
    pub max_deposit: U128,
    #[serde(default)]
    pub secrets_ref: Option<SecretProfile>,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Agent {
    pub account_id: AccountId,
    pub worker_code_hash: String,
    pub rubric_hash: String,
    #[serde(default)]
    pub outlayer: Option<OutlayerConfig>,
}
impl Agent {
    fn validate(&self) {
        check(testnet(&self.account_id), "Testnet agent required");
        check(
            hex(&self.worker_code_hash, 64) && hex(&self.rubric_hash, 64),
            "Invalid agent hashes",
        );
        if let Some(o) = &self.outlayer {
            check(
                o.contract_id.as_str() == "outlayer.testnet",
                "Only configured testnet OutLayer supported",
            );
            check(
                o.source_url.starts_with("https://")
                    && o.source_url.len() <= 512
                    && !o.source_url.contains('@'),
                "Invalid worker URL",
            );
            check(
                hex(&o.source_hash, 64) && o.source_hash == self.worker_code_hash,
                "Worker source hash mismatch",
            );
            if let Some(ref r) = o.secrets_ref {
                check(
                    testnet(&r.account_id)
                        && !r.profile.is_empty()
                        && r.profile.len() <= 64
                        && r.profile
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)),
                    "Invalid secret profile locator",
                );
            }
            check(
                o.max_deposit.0 > 0 && o.max_deposit.0 <= NearToken::from_near(1).as_yoctonear(),
                "Compute deposit outside cap",
            );
        }
    }
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct ReviewRequest {
    pub repo: String,
    pub pr_number: u64,
    pub merge_sha: String,
    pub beneficiary: AccountId,
}
impl ReviewRequest {
    fn validate(&self) {
        let p: Vec<_> = self.repo.split('/').collect();
        check(
            p.len() == 2
                && p.iter().all(|s| {
                    !s.is_empty()
                        && s.len() <= 100
                        && s.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
                }),
            "Invalid repository",
        );
        check(
            self.repo == self.repo.to_ascii_lowercase(),
            "Use lowercase repository identity",
        );
        check(
            self.pr_number > 0 && hex(&self.merge_sha, 40),
            "Invalid PR or merge SHA",
        );
        check(testnet(&self.beneficiary), "Testnet beneficiary required");
    }
    fn key(&self) -> String {
        format!("{}#{}", self.repo, self.pr_number)
    }
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Action {
    UpdatePolicy { policy: Policy },
    AppointAgent { agent: Agent },
    ReviewContribution { request: ReviewRequest },
    ResolveChallenge { job_id: u64, approve: bool },
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Vote {
    pub account_id: AccountId,
    pub approve: bool,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: AccountId,
    pub description: String,
    pub action: Action,
    pub created_at_ns: u64,
    pub voting_ends_at_ns: u64,
    pub yes: u32,
    pub no: u32,
    pub voters: Vec<Vote>,
    pub executed: bool,
    pub job_id: Option<u64>,
    pub review_policy: Option<Policy>,
    pub review_agent: Option<Agent>,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Epoch {
    pub epoch_id: u64,
    pub reward_limit: U128,
    pub agent_limit: U128,
    pub reward_committed: U128,
    pub agent_committed: U128,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct ReviewJob {
    pub id: u64,
    pub request: ReviewRequest,
    pub policy: Policy,
    pub agent: Agent,
    pub created_at_ns: u64,
    pub verdict_deadline_ns: u64,
    pub epoch_id: u64,
    pub max_reward: U128,
    pub agent_fee: U128,
    pub score: Option<u32>,
    pub rationale: Option<String>,
    pub evidence_hash: Option<String>,
    pub challenge_ends_at_ns: Option<u64>,
    pub challenged: bool,
    pub challenge_reason: Option<String>,
    pub resolved_approved: Option<bool>,
    pub expired: bool,
    pub reward_amount: U128,
    pub reward_status: String,
    pub agent_status: String,
    pub reward_nonce: Option<u64>,
    pub agent_nonce: Option<u64>,
    pub compute_nonce: Option<u64>,
    pub compute_attempted: bool,
}
#[near(serializers=[json])]
pub struct ConfigView {
    pub members: Vec<AccountId>,
    pub threshold: u32,
    pub token_id: AccountId,
    pub policy: Policy,
    pub agent: Option<Agent>,
    pub epoch_id: u64,
}
#[near(serializers=[json])]
pub struct TreasuryView {
    pub reward_available: U128,
    pub reward_reserved: U128,
    pub reward_pending: U128,
    pub reward_paid: U128,
    pub agent_available: U128,
    pub agent_reserved: U128,
    pub agent_pending: U128,
    pub agent_paid: U128,
    pub compute_available: U128,
    pub compute_pending: U128,
    pub compute_spent: U128,
}
#[near(serializers=[json])]
#[serde(deny_unknown_fields)]
pub struct Verdict {
    pub job_id: u64,
    pub score: u32,
    pub rationale: String,
    pub evidence_hash: String,
    pub merge_sha: String,
    pub worker_code_hash: String,
    pub rubric_hash: String,
}
#[near(serializers=[json])]
#[serde(deny_unknown_fields)]
pub struct OutlayerVerdict {
    pub schema_version: u32,
    pub job_id: u64,
    pub repository: String,
    pub pull_request: u64,
    pub beneficiary: AccountId,
    pub merge_sha: String,
    pub worker_code_hash: String,
    pub rubric_hash: String,
    pub score: u32,
    pub rationale: String,
    pub evidence_hash: String,
    pub eligible: bool,
    pub agent_kind: String,
    pub attestation_status: String,
}
#[near(serializers=[json])]
#[serde(deny_unknown_fields)]
pub struct Deposit {
    pub bucket: String,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ContributorDao {
    members: Vec<AccountId>,
    threshold: u32,
    token_id: AccountId,
    policy: Policy,
    agent: Option<Agent>,
    epoch_origin_ns: u64,
    epoch_duration_ns: u64,
    proposals: LookupMap<u64, Proposal>,
    proposal_count: u64,
    jobs: LookupMap<u64, ReviewJob>,
    used_prs: LookupMap<String, u64>,
    epochs: LookupMap<u64, Epoch>,
    reward_available: u128,
    reward_reserved: u128,
    reward_pending: u128,
    reward_paid: u128,
    agent_available: u128,
    agent_reserved: u128,
    agent_pending: u128,
    agent_paid: u128,
    compute_available: u128,
    compute_pending: u128,
    compute_spent: u128,
    next_nonce: u64,
}
#[near]
impl ContributorDao {
    #[init]
    pub fn new(
        members: Vec<AccountId>,
        threshold: u32,
        token_id: AccountId,
        policy: Policy,
    ) -> Self {
        check(
            testnet(&env::current_account_id()) && testnet(&token_id),
            "Testnet-only DAO",
        );
        check(
            token_id != env::current_account_id(),
            "Separate token contract required",
        );
        check(
            !members.is_empty() && members.len() <= 15 && members.iter().all(testnet),
            "Invalid council",
        );
        let mut sorted = members.clone();
        sorted.sort();
        sorted.dedup();
        check(sorted.len() == members.len(), "Duplicate council member");
        check(
            threshold as usize > members.len() / 2 && threshold as usize <= members.len(),
            "Strict majority threshold required",
        );
        policy.validate();
        Self {
            members,
            threshold,
            token_id,
            epoch_origin_ns: env::block_timestamp(),
            epoch_duration_ns: policy.epoch_duration_ns,
            policy,
            agent: None,
            proposals: LookupMap::new(b"p"),
            proposal_count: 0,
            jobs: LookupMap::new(b"j"),
            used_prs: LookupMap::new(b"u"),
            epochs: LookupMap::new(b"e"),
            reward_available: 0,
            reward_reserved: 0,
            reward_pending: 0,
            reward_paid: 0,
            agent_available: 0,
            agent_reserved: 0,
            agent_pending: 0,
            agent_paid: 0,
            compute_available: 0,
            compute_pending: 0,
            compute_spent: 0,
            next_nonce: 0,
        }
    }
    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            members: self.members.clone(),
            threshold: self.threshold,
            token_id: self.token_id.clone(),
            policy: self.policy.clone(),
            agent: self.agent.clone(),
            epoch_id: self.epoch_id(),
        }
    }
    pub fn get_treasury(&self) -> TreasuryView {
        TreasuryView {
            reward_available: U128(self.reward_available),
            reward_reserved: U128(self.reward_reserved),
            reward_pending: U128(self.reward_pending),
            reward_paid: U128(self.reward_paid),
            agent_available: U128(self.agent_available),
            agent_reserved: U128(self.agent_reserved),
            agent_pending: U128(self.agent_pending),
            agent_paid: U128(self.agent_paid),
            compute_available: U128(self.compute_available),
            compute_pending: U128(self.compute_pending),
            compute_spent: U128(self.compute_spent),
        }
    }
    pub fn get_proposal(&self, proposal_id: u64) -> Option<Proposal> {
        self.proposals.get(&proposal_id).cloned()
    }
    pub fn list_proposals(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Proposal> {
        let from = from_index.unwrap_or(0);
        let end = from
            .saturating_add(limit.unwrap_or(50).min(100))
            .min(self.proposal_count);
        (from..end)
            .filter_map(|i| self.proposals.get(&i).cloned())
            .collect()
    }
    pub fn get_job(&self, job_id: u64) -> Option<ReviewJob> {
        self.jobs.get(&job_id).cloned()
    }
    pub fn list_jobs(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<ReviewJob> {
        let from = from_index.unwrap_or(0);
        let end = from
            .saturating_add(limit.unwrap_or(50).min(100))
            .min(self.proposal_count);
        (from..end)
            .filter_map(|i| self.jobs.get(&i).cloned())
            .collect()
    }
    pub fn get_epoch(&self, epoch_id: u64) -> Option<Epoch> {
        self.epochs.get(&epoch_id).cloned()
    }
    #[payable]
    pub fn propose(&mut self, action: Action, description: String) -> u64 {
        one();
        self.member();
        check(
            self.proposal_count < MAX_PROPOSALS,
            "Proposal storage cap reached",
        );
        check(
            !description.trim().is_empty() && description.len() <= 1024,
            "Invalid description",
        );
        self.validate_action(&action);
        let review_policy = if matches!(&action, Action::ReviewContribution { .. }) {
            Some(self.policy.clone())
        } else {
            None
        };
        let review_agent = if matches!(&action, Action::ReviewContribution { .. }) {
            self.agent.clone()
        } else {
            None
        };
        let id = self.proposal_count;
        self.proposal_count += 1;
        self.proposals.insert(
            id,
            Proposal {
                id,
                proposer: env::predecessor_account_id(),
                description,
                action,
                created_at_ns: env::block_timestamp(),
                voting_ends_at_ns: deadline(self.policy.voting_period_ns),
                yes: 0,
                no: 0,
                voters: vec![],
                executed: false,
                job_id: None,
                review_policy,
                review_agent,
            },
        );
        self.event("proposal_created", id);
        id
    }
    #[payable]
    pub fn vote(&mut self, proposal_id: u64, approve: bool) -> Proposal {
        one();
        self.member();
        let who = env::predecessor_account_id();
        let mut p = self.proposal(proposal_id);
        check(
            !p.executed && env::block_timestamp() < p.voting_ends_at_ns,
            "Voting closed",
        );
        check(
            !p.voters.iter().any(|v| v.account_id == who),
            "Duplicate vote",
        );
        let conflict = match &p.action {
            Action::ReviewContribution { request } => {
                request.beneficiary == who
                    || self
                        .agent
                        .as_ref()
                        .map(|a| a.account_id == who)
                        .unwrap_or(false)
            }
            Action::ResolveChallenge { job_id, .. } => {
                let j = self.job(*job_id);
                j.request.beneficiary == who || j.agent.account_id == who
            }
            Action::AppointAgent { agent } => agent.account_id == who,
            _ => false,
        };
        check(!conflict, "Conflicted voter must recuse");
        if approve {
            p.yes += 1
        } else {
            p.no += 1
        };
        p.voters.push(Vote {
            account_id: who,
            approve,
        });
        self.proposals.insert(proposal_id, p.clone());
        self.event("vote_recorded", proposal_id);
        p
    }
    #[payable]
    pub fn execute(&mut self, proposal_id: u64) -> Proposal {
        one();
        let mut p = self.proposal(proposal_id);
        check(!p.executed, "Proposal already executed");
        check(
            env::block_timestamp() >= p.voting_ends_at_ns,
            "Voting period active",
        );
        check(p.yes >= self.threshold, "Approval threshold not met");
        self.validate_action(&p.action);
        match p.action.clone() {
            Action::UpdatePolicy { policy } => {
                check(
                    policy.epoch_duration_ns == self.epoch_duration_ns,
                    "Epoch duration immutable",
                );
                self.policy = policy;
            }
            Action::AppointAgent { agent } => self.agent = Some(agent),
            Action::ReviewContribution { request } => {
                check(
                    p.review_policy.as_ref() == Some(&self.policy) && p.review_agent == self.agent,
                    "Review policy or agent changed; propose again",
                );
                self.create_job(proposal_id, request);
                p.job_id = Some(proposal_id);
            }
            Action::ResolveChallenge { job_id, approve } => {
                let mut j = self.job(job_id);
                check(
                    j.challenged && j.resolved_approved.is_none() && !j.expired,
                    "No unresolved challenge",
                );
                check(
                    j.reward_status == "reserved"
                        || (j.reward_status == "released" && j.reward_amount.0 == 0),
                    "Reward already dispatched",
                );
                j.resolved_approved = Some(approve);
                if !approve && j.reward_status == "reserved" {
                    self.release_reward(&mut j);
                }
                self.jobs.insert(job_id, j);
            }
        }
        p.executed = true;
        self.proposals.insert(proposal_id, p.clone());
        self.event("proposal_executed", proposal_id);
        p
    }
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = sender_id;
        if env::predecessor_account_id() != self.token_id || amount.0 == 0 || msg.len() > 64 {
            return PromiseOrValue::Value(amount);
        }
        let Ok(d) = near_sdk::serde_json::from_str::<Deposit>(&msg) else {
            return PromiseOrValue::Value(amount);
        };
        match d.bucket.as_str() {
            "rewards" => self.reward_available = add(self.reward_available, amount.0),
            "agents" => self.agent_available = add(self.agent_available, amount.0),
            _ => return PromiseOrValue::Value(amount),
        };
        env::log_str(&near_sdk::serde_json::json!({"event":"budget_funded","bucket":d.bucket,"amount":amount}).to_string());
        PromiseOrValue::Value(U128(0))
    }
    #[payable]
    pub fn submit_verdict(
        &mut self,
        job_id: u64,
        score: u32,
        rationale: String,
        evidence_hash: String,
        merge_sha: String,
        worker_code_hash: String,
        rubric_hash: String,
    ) -> ReviewJob {
        one();
        let j = self.job(job_id);
        check(
            env::predecessor_account_id() == j.agent.account_id,
            "Appointed job agent only",
        );
        check(j.compute_nonce.is_none(), "OutLayer execution pending");
        self.record_verdict(Verdict {
            job_id,
            score,
            rationale,
            evidence_hash,
            merge_sha,
            worker_code_hash,
            rubric_hash,
        })
    }
    #[payable]
    pub fn challenge(&mut self, job_id: u64, reason: String) -> ReviewJob {
        one();
        let mut j = self.job(job_id);
        check(
            j.score.is_some() && !j.expired && !j.challenged,
            "Cannot challenge job",
        );
        check(
            env::block_timestamp() < j.challenge_ends_at_ns.unwrap(),
            "Challenge period ended",
        );
        check(
            !reason.trim().is_empty() && reason.len() <= 2048,
            "Invalid challenge reason",
        );
        j.challenged = true;
        j.challenge_reason = Some(reason);
        self.jobs.insert(job_id, j.clone());
        self.event("verdict_challenged", job_id);
        j
    }
    #[payable]
    pub fn expire_job(&mut self, job_id: u64) -> ReviewJob {
        one();
        let mut j = self.job(job_id);
        check(j.score.is_none() && !j.expired, "Cannot expire job");
        check(
            env::block_timestamp() >= j.verdict_deadline_ns,
            "Verdict deadline active",
        );
        if j.compute_nonce.take().is_some() {
            let amount = j
                .agent
                .outlayer
                .as_ref()
                .expect("Missing compute config")
                .max_deposit
                .0;
            self.compute_pending = sub(self.compute_pending, amount);
            self.compute_spent = add(self.compute_spent, amount);
        }
        self.release_reward(&mut j);
        self.agent_reserved = sub(self.agent_reserved, j.agent_fee.0);
        self.agent_available = add(self.agent_available, j.agent_fee.0);
        let mut e = self.epoch(j.epoch_id);
        e.agent_committed = U128(sub(e.agent_committed.0, j.agent_fee.0));
        self.epochs.insert(j.epoch_id, e);
        j.agent_status = "released".into();
        j.expired = true;
        self.jobs.insert(job_id, j.clone());
        self.event("job_expired", job_id);
        j
    }
    #[payable]
    pub fn claim_reward(&mut self, job_id: u64) -> Promise {
        one();
        let mut j = self.job(job_id);
        check(
            env::predecessor_account_id() == j.request.beneficiary,
            "Bound beneficiary only",
        );
        check(
            j.score.is_some()
                && !j.expired
                && j.reward_status == "reserved"
                && j.reward_amount.0 > 0,
            "No claimable reward",
        );
        check(
            if j.challenged {
                j.resolved_approved == Some(true)
            } else {
                env::block_timestamp() >= j.challenge_ends_at_ns.unwrap()
            },
            "Reward locked or disputed",
        );
        let n = self.nonce();
        j.reward_status = "pending".into();
        j.reward_nonce = Some(n);
        self.reward_reserved = sub(self.reward_reserved, j.reward_amount.0);
        self.reward_pending = add(self.reward_pending, j.reward_amount.0);
        let promise = self.transfer(
            job_id,
            "rewards",
            n,
            j.request.beneficiary.clone(),
            j.reward_amount,
        );
        self.jobs.insert(job_id, j);
        promise
    }
    #[payable]
    pub fn claim_agent_fee(&mut self, job_id: u64) -> Promise {
        one();
        let mut j = self.job(job_id);
        check(
            env::predecessor_account_id() == j.agent.account_id,
            "Bound agent only",
        );
        check(
            j.score.is_some() && !j.expired && j.agent_status == "reserved" && j.agent_fee.0 > 0,
            "No claimable agent fee",
        );
        let n = self.nonce();
        j.agent_status = "pending".into();
        j.agent_nonce = Some(n);
        self.agent_reserved = sub(self.agent_reserved, j.agent_fee.0);
        self.agent_pending = add(self.agent_pending, j.agent_fee.0);
        let promise = self.transfer(job_id, "agents", n, j.agent.account_id.clone(), j.agent_fee);
        self.jobs.insert(job_id, j);
        promise
    }
    #[private]
    pub fn resolve_claim(&mut self, job_id: u64, bucket: String, nonce: u64) -> bool {
        self.private();
        check(
            env::promise_results_count() == 1,
            "Expected exactly one callback result",
        );
        let result = if env::promise_results_count() == 1 {
            match env::promise_result_checked(0, 0) {
                Ok(_) | Err(PromiseError::TooLong(_)) => PromiseResult::Successful(vec![]),
                Err(_) => PromiseResult::Failed,
            }
        } else {
            PromiseResult::Failed
        };
        self.finish_claim(job_id, bucket, nonce, result)
    }
    #[payable]
    pub fn fund_compute(&mut self) -> U128 {
        check(
            env::attached_deposit().as_yoctonear() > 0,
            "Positive native compute deposit required",
        );
        self.compute_available = add(
            self.compute_available,
            env::attached_deposit().as_yoctonear(),
        );
        U128(self.compute_available)
    }
    #[payable]
    pub fn execute_outlayer(&mut self, job_id: u64) -> Promise {
        one();
        self.member();
        let mut j = self.job(job_id);
        check(
            j.score.is_none() && !j.expired && j.compute_nonce.is_none() && !j.compute_attempted,
            "Job unavailable for compute",
        );
        check(
            env::block_timestamp() < j.verdict_deadline_ns,
            "Verdict deadline ended",
        );
        let o = j.agent.outlayer.clone().expect("OutLayer not configured");
        check(
            self.compute_available >= o.max_deposit.0,
            "Insufficient native compute budget",
        );
        self.compute_available = sub(self.compute_available, o.max_deposit.0);
        self.compute_pending = add(self.compute_pending, o.max_deposit.0);
        let nonce = self.nonce();
        j.compute_nonce = Some(nonce);
        j.compute_attempted = true;
        let input = near_sdk::serde_json::json!({"schema_version":1,"job_id":job_id,"repository":j.request.repo,"pull_request":j.request.pr_number,"merge_sha":j.request.merge_sha,"beneficiary":j.request.beneficiary,"worker_code_hash":j.agent.worker_code_hash,"rubric_hash":j.agent.rubric_hash,"max_score":j.policy.max_score});
        let args = near_sdk::serde_json::json!({"source":{"WasmUrl":{"url":o.source_url,"hash":o.source_hash,"build_target":"wasm32-wasip2"}},"resource_limits":{"max_instructions":1000000000u64,"max_memory_mb":128,"max_execution_seconds":60},"input_data":input.to_string(),"secrets_ref":o.secrets_ref,"response_format":"Json","payer_account_id":null,"params":null});
        self.jobs.insert(job_id, j);
        Promise::new(o.contract_id).function_call("request_execution",near_sdk::serde_json::to_vec(&args).unwrap(),NearToken::from_yoctonear(o.max_deposit.0),Gas::from_tgas(200)).then(Promise::new(env::current_account_id()).function_call("resolve_outlayer",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"job_id":job_id,"nonce":nonce,"deposit":o.max_deposit})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(40)))
    }
    #[private]
    pub fn resolve_outlayer(&mut self, job_id: u64, nonce: u64, deposit: U128) -> bool {
        self.private();
        check(
            env::promise_results_count() == 1,
            "Expected exactly one callback result",
        );
        let result = if env::promise_results_count() == 1 {
            match env::promise_result_checked(0, 16_384) {
                Ok(bytes) => PromiseResult::Successful(bytes),
                Err(_) => PromiseResult::Failed,
            }
        } else {
            PromiseResult::Failed
        };
        self.finish_compute(job_id, nonce, deposit, result)
    }
}
impl ContributorDao {
    fn finish_claim(
        &mut self,
        job_id: u64,
        bucket: String,
        nonce: u64,
        result: PromiseResult,
    ) -> bool {
        self.private();
        let mut j = self.job(job_id);
        let ok = matches!(result, PromiseResult::Successful(_));
        match bucket.as_str() {
            "rewards" => {
                check(
                    j.reward_status == "pending" && j.reward_nonce == Some(nonce),
                    "Reward callback mismatch",
                );
                self.reward_pending = sub(self.reward_pending, j.reward_amount.0);
                if ok {
                    self.reward_paid = add(self.reward_paid, j.reward_amount.0);
                    j.reward_status = "paid".into();
                } else {
                    self.reward_reserved = add(self.reward_reserved, j.reward_amount.0);
                    j.reward_status = "reserved".into();
                }
                j.reward_nonce = None;
            }
            "agents" => {
                check(
                    j.agent_status == "pending" && j.agent_nonce == Some(nonce),
                    "Agent callback mismatch",
                );
                self.agent_pending = sub(self.agent_pending, j.agent_fee.0);
                if ok {
                    self.agent_paid = add(self.agent_paid, j.agent_fee.0);
                    j.agent_status = "paid".into();
                } else {
                    self.agent_reserved = add(self.agent_reserved, j.agent_fee.0);
                    j.agent_status = "reserved".into();
                }
                j.agent_nonce = None;
            }
            _ => check(false, "Unknown claim bucket"),
        };
        self.jobs.insert(job_id, j);
        self.event(if ok { "claim_paid" } else { "claim_retryable" }, job_id);
        ok
    }
    fn finish_compute(
        &mut self,
        job_id: u64,
        nonce: u64,
        deposit: U128,
        result: PromiseResult,
    ) -> bool {
        self.private();
        let mut j = self.job(job_id);
        if j.compute_nonce != Some(nonce)
            || j.agent.outlayer.as_ref().map(|o| o.max_deposit) != Some(deposit)
        {
            self.event("compute_stale_callback", job_id);
            return false;
        }
        self.compute_pending = sub(self.compute_pending, deposit.0);
        self.compute_spent = add(self.compute_spent, deposit.0);
        j.compute_nonce = None;
        self.jobs.insert(job_id, j.clone());
        let value = match result {
            PromiseResult::Successful(bytes) if bytes.len() <= 16_384 => {
                near_sdk::serde_json::from_slice::<Option<OutlayerVerdict>>(&bytes)
                    .ok()
                    .flatten()
            }
            _ => None,
        };
        let Some(v) = value else {
            self.event("compute_failed", job_id);
            return false;
        };
        if v.schema_version != 1
            || v.job_id != job_id
            || v.repository != j.request.repo
            || v.pull_request != j.request.pr_number
            || v.beneficiary != j.request.beneficiary
            || (!v.eligible && v.score != 0)
            || v.agent_kind != "deterministic-program-v1"
            || v.attestation_status != "external-verification-required"
        {
            self.event("compute_invalid_result", job_id);
            return false;
        }
        let verdict = Verdict {
            job_id: v.job_id,
            score: v.score,
            rationale: v.rationale,
            evidence_hash: v.evidence_hash,
            merge_sha: v.merge_sha,
            worker_code_hash: v.worker_code_hash,
            rubric_hash: v.rubric_hash,
        };
        if !Self::valid_verdict(&j, &verdict) {
            self.event("compute_invalid_result", job_id);
            return false;
        }
        self.record_verdict(verdict);
        true
    }
    fn private(&self) {
        check(
            env::predecessor_account_id() == env::current_account_id(),
            "Private callback only",
        );
    }
    fn member(&self) {
        check(
            self.members.contains(&env::predecessor_account_id()),
            "Council member only",
        );
    }
    fn epoch_id(&self) -> u64 {
        env::block_timestamp().saturating_sub(self.epoch_origin_ns) / self.epoch_duration_ns
    }
    fn epoch(&self, id: u64) -> Epoch {
        self.epochs.get(&id).cloned().expect("Unknown epoch")
    }
    fn job(&self, id: u64) -> ReviewJob {
        self.jobs.get(&id).cloned().expect("Unknown job")
    }
    fn proposal(&self, id: u64) -> Proposal {
        self.proposals.get(&id).cloned().expect("Unknown proposal")
    }
    fn nonce(&mut self) -> u64 {
        self.next_nonce = self.next_nonce.checked_add(1).expect("Nonce overflow");
        self.next_nonce
    }
    fn event(&self, name: &str, id: u64) {
        env::log_str(
            &near_sdk::serde_json::json!({"event":name,"id":id,"at_ns":env::block_timestamp()})
                .to_string(),
        );
    }
    fn validate_action(&self, a: &Action) {
        match a {
            Action::UpdatePolicy { policy } => {
                policy.validate();
                check(
                    policy.epoch_duration_ns == self.epoch_duration_ns,
                    "Epoch duration immutable",
                );
            }
            Action::AppointAgent { agent } => agent.validate(),
            Action::ReviewContribution { request } => {
                request.validate();
                let agent = self.agent.as_ref().expect("No appointed verdict agent");
                check(
                    request.beneficiary != agent.account_id,
                    "Agent cannot judge own reward",
                );
                check(
                    !self.used_prs.contains_key(&request.key()),
                    "PR already authorized",
                );
            }
            Action::ResolveChallenge { job_id, .. } => {
                let j = self.job(*job_id);
                check(
                    j.challenged && j.resolved_approved.is_none() && !j.expired,
                    "No unresolved challenge",
                );
            }
        }
    }
    fn create_job(&mut self, id: u64, request: ReviewRequest) {
        let p = self.policy.clone();
        let agent = self.agent.clone().expect("Agent missing");
        let epoch_id = self.epoch_id();
        let mut e = self.epochs.get(&epoch_id).cloned().unwrap_or(Epoch {
            epoch_id,
            reward_limit: p.epoch_budget,
            agent_limit: p.epoch_agent_budget,
            reward_committed: U128(0),
            agent_committed: U128(0),
        });
        let r = p.max_reward_per_contribution.0;
        let a = p.verdict_fee.0;
        check(
            self.reward_available >= r && self.agent_available >= a,
            "Insufficient funded token budgets",
        );
        check(
            add(e.reward_committed.0, r) <= e.reward_limit.0
                && add(e.agent_committed.0, a) <= e.agent_limit.0,
            "Epoch budget exhausted",
        );
        e.reward_committed = U128(add(e.reward_committed.0, r));
        e.agent_committed = U128(add(e.agent_committed.0, a));
        self.epochs.insert(epoch_id, e);
        self.reward_available = sub(self.reward_available, r);
        self.reward_reserved = add(self.reward_reserved, r);
        self.agent_available = sub(self.agent_available, a);
        self.agent_reserved = add(self.agent_reserved, a);
        self.used_prs.insert(request.key(), id);
        self.jobs.insert(
            id,
            ReviewJob {
                id,
                request,
                policy: p.clone(),
                agent,
                created_at_ns: env::block_timestamp(),
                verdict_deadline_ns: deadline(p.verdict_timeout_ns),
                epoch_id,
                max_reward: U128(r),
                agent_fee: U128(a),
                score: None,
                rationale: None,
                evidence_hash: None,
                challenge_ends_at_ns: None,
                challenged: false,
                challenge_reason: None,
                resolved_approved: None,
                expired: false,
                reward_amount: U128(r),
                reward_status: "reserved".into(),
                agent_status: if a == 0 {
                    "paid".into()
                } else {
                    "reserved".into()
                },
                reward_nonce: None,
                agent_nonce: None,
                compute_nonce: None,
                compute_attempted: false,
            },
        );
        self.event("review_authorized", id);
    }
    fn valid_verdict(j: &ReviewJob, v: &Verdict) -> bool {
        j.score.is_none()
            && !j.expired
            && env::block_timestamp() < j.verdict_deadline_ns
            && v.score <= j.policy.max_score
            && !v.rationale.trim().is_empty()
            && v.rationale.len() <= 4096
            && hex(&v.evidence_hash, 64)
            && v.merge_sha == j.request.merge_sha
            && v.worker_code_hash == j.agent.worker_code_hash
            && v.rubric_hash == j.agent.rubric_hash
    }
    fn record_verdict(&mut self, v: Verdict) -> ReviewJob {
        let mut j = self.job(v.job_id);
        check(
            Self::valid_verdict(&j, &v),
            "Invalid, late or duplicate verdict",
        );
        let amount = j
            .policy
            .tokens_per_point
            .0
            .checked_mul(v.score as u128)
            .expect("Reward overflow");
        check(amount <= j.max_reward.0, "Reward above reserved cap");
        let release = sub(j.max_reward.0, amount);
        self.reward_reserved = sub(self.reward_reserved, release);
        self.reward_available = add(self.reward_available, release);
        let mut e = self.epoch(j.epoch_id);
        e.reward_committed = U128(sub(e.reward_committed.0, release));
        self.epochs.insert(j.epoch_id, e);
        j.reward_amount = U128(amount);
        j.score = Some(v.score);
        j.rationale = Some(v.rationale);
        j.evidence_hash = Some(v.evidence_hash);
        j.challenge_ends_at_ns = Some(deadline(j.policy.challenge_period_ns));
        if amount == 0 {
            j.reward_status = "released".into();
        }
        self.jobs.insert(j.id, j.clone());
        self.event("verdict_submitted", j.id);
        j
    }
    fn release_reward(&mut self, j: &mut ReviewJob) {
        check(
            j.reward_status == "reserved",
            "Cannot release dispatched reward",
        );
        self.reward_reserved = sub(self.reward_reserved, j.reward_amount.0);
        self.reward_available = add(self.reward_available, j.reward_amount.0);
        let mut e = self.epoch(j.epoch_id);
        e.reward_committed = U128(sub(e.reward_committed.0, j.reward_amount.0));
        self.epochs.insert(j.epoch_id, e);
        j.reward_status = "released".into();
    }
    fn transfer(
        &self,
        id: u64,
        bucket: &str,
        nonce: u64,
        receiver: AccountId,
        amount: U128,
    ) -> Promise {
        Promise::new(self.token_id.clone()).function_call("ft_transfer",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"receiver_id":receiver,"amount":amount,"memo":format!("Rascals DAO {} job {}",bucket,id)})).unwrap(),NearToken::from_yoctonear(1),Gas::from_tgas(20)).then(Promise::new(env::current_account_id()).function_call("resolve_claim",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"job_id":id,"bucket":bucket,"nonce":nonce})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(15)))
    }
}

#[cfg(test)]
#[allow(unused_must_use)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{get_created_receipts, VMContextBuilder},
        testing_env,
    };
    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, seconds: u64, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("dao.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .block_timestamp(seconds * SECOND)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(100));
        testing_env!(b.build());
    }
    fn policy() -> Policy {
        Policy {
            tokens_per_point: U128(1),
            max_score: 100,
            max_reward_per_contribution: U128(100),
            epoch_budget: U128(1000),
            epoch_agent_budget: U128(100),
            epoch_duration_ns: 100 * SECOND,
            challenge_period_ns: 2 * SECOND,
            voting_period_ns: SECOND,
            verdict_timeout_ns: 10 * SECOND,
            verdict_fee: U128(10),
        }
    }
    fn agent() -> Agent {
        Agent {
            account_id: a("judge.testnet"),
            worker_code_hash: "a".repeat(64),
            rubric_hash: "b".repeat(64),
            outlayer: None,
        }
    }
    fn request(pr: u64) -> ReviewRequest {
        ReviewRequest {
            repo: "nvq2309/therascals".into(),
            pr_number: pr,
            merge_sha: "c".repeat(40),
            beneficiary: a("builder.testnet"),
        }
    }
    fn base() -> ContributorDao {
        ctx("alice.testnet", 0, 0);
        ContributorDao::new(
            vec![a("alice.testnet"), a("bob.testnet"), a("carol.testnet")],
            2,
            a("token.testnet"),
            policy(),
        )
    }
    fn pass(d: &mut ContributorDao, action: Action, time: u64) -> u64 {
        ctx("alice.testnet", time, 1);
        let id = d.propose(action, "Evidence and scope".into());
        d.vote(id, true);
        ctx("bob.testnet", time, 1);
        d.vote(id, true);
        ctx("anyone.testnet", time + 1, 1);
        d.execute(id);
        id
    }
    fn ready() -> ContributorDao {
        let mut d = base();
        pass(&mut d, Action::AppointAgent { agent: agent() }, 0);
        ctx("token.testnet", 1, 0);
        assert!(matches!(
            d.ft_on_transfer(
                a("funder.testnet"),
                U128(1000),
                "{\"bucket\":\"rewards\"}".into()
            ),
            PromiseOrValue::Value(U128(0))
        ));
        d.ft_on_transfer(
            a("funder.testnet"),
            U128(100),
            "{\"bucket\":\"agents\"}".into(),
        );
        d
    }
    fn job(d: &mut ContributorDao) -> u64 {
        pass(
            d,
            Action::ReviewContribution {
                request: request(1),
            },
            2,
        )
    }
    fn verdict(d: &mut ContributorDao, id: u64, score: u32) {
        ctx("judge.testnet", 4, 1);
        d.submit_verdict(
            id,
            score,
            "Useful fix; tests demonstrate bounded outcome".into(),
            "d".repeat(64),
            "c".repeat(40),
            "a".repeat(64),
            "b".repeat(64),
        );
    }
    fn panics(f: impl FnOnce()) {
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err());
    }
    #[test]
    fn refuses_mainnet_and_bad_quorum() {
        ctx("alice.testnet", 0, 0);
        panics(|| {
            ContributorDao::new(vec![a("alice.testnet")], 1, a("token.near"), policy());
        });
        panics(|| {
            ContributorDao::new(
                vec![a("alice.testnet"), a("bob.testnet"), a("carol.testnet")],
                1,
                a("token.testnet"),
                policy(),
            );
        });
    }
    #[test]
    fn funding_is_token_bound_and_bucket_separated() {
        let mut d = base();
        ctx("fake.testnet", 0, 0);
        assert!(matches!(
            d.ft_on_transfer(
                a("funder.testnet"),
                U128(100),
                "{\"bucket\":\"rewards\"}".into()
            ),
            PromiseOrValue::Value(U128(100))
        ));
        ctx("token.testnet", 0, 0);
        assert!(matches!(
            d.ft_on_transfer(
                a("funder.testnet"),
                U128(100),
                "{\"bucket\":\"bad\"}".into()
            ),
            PromiseOrValue::Value(U128(100))
        ));
        assert_eq!(d.get_treasury().reward_available.0, 0);
    }
    #[test]
    fn quorum_timing_duplicate_vote_and_replay_enforced() {
        let mut d = base();
        ctx("outsider.testnet", 0, 1);
        panics(|| {
            d.propose(Action::AppointAgent { agent: agent() }, "appoint".into());
        });
        ctx("alice.testnet", 0, 1);
        let id = d.propose(Action::AppointAgent { agent: agent() }, "appoint".into());
        d.vote(id, true);
        panics(|| {
            d.vote(id, true);
        });
        panics(|| {
            d.execute(id);
        });
        ctx("alice.testnet", 1, 1);
        panics(|| {
            d.vote(id, true);
        });
        panics(|| {
            d.execute(id);
        });
        ctx("bob.testnet", 0, 1);
        d.vote(id, true);
        ctx("alice.testnet", 1, 1);
        d.execute(id);
        panics(|| {
            d.execute(id);
        });
    }
    #[test]
    fn reserves_before_work_binds_agent_and_returns_unused_reward() {
        let mut d = ready();
        let id = job(&mut d);
        assert_eq!(d.reward_available, 900);
        assert_eq!(d.reward_reserved, 100);
        assert_eq!(d.agent_available, 90);
        ctx("wrong.testnet", 4, 1);
        panics(|| {
            d.submit_verdict(
                id,
                40,
                "rationale".into(),
                "d".repeat(64),
                "c".repeat(40),
                "a".repeat(64),
                "b".repeat(64),
            );
        });
        ctx("judge.testnet", 4, 1);
        panics(|| {
            d.submit_verdict(
                id,
                40,
                "rationale".into(),
                "d".repeat(64),
                "f".repeat(40),
                "a".repeat(64),
                "b".repeat(64),
            );
        });
        verdict(&mut d, id, 40);
        assert_eq!(d.reward_available, 960);
        assert_eq!(d.reward_reserved, 40);
        panics(|| {
            verdict(&mut d, id, 40);
        });
        ctx("alice.testnet", 4, 1);
        panics(|| {
            d.propose(
                Action::ReviewContribution {
                    request: request(1),
                },
                "duplicate".into(),
            );
        });
    }
    #[test]
    fn unfunded_review_cannot_become_payable() {
        let mut d = base();
        pass(&mut d, Action::AppointAgent { agent: agent() }, 0);
        ctx("alice.testnet", 2, 1);
        let id = d.propose(
            Action::ReviewContribution {
                request: request(1),
            },
            "work".into(),
        );
        d.vote(id, true);
        ctx("bob.testnet", 2, 1);
        d.vote(id, true);
        ctx("alice.testnet", 3, 1);
        panics(|| {
            d.execute(id);
        });
        assert!(d.get_job(id).is_none());
        assert!(!d.get_proposal(id).unwrap().executed);
    }
    #[test]
    fn challenge_locks_reward_and_governance_rejection_releases_only_reward() {
        let mut d = ready();
        let id = job(&mut d);
        verdict(&mut d, id, 40);
        ctx("builder.testnet", 4, 1);
        panics(|| {
            d.claim_reward(id);
        });
        ctx("challenger.testnet", 5, 1);
        d.challenge(id, "Regression evidence".into());
        ctx("builder.testnet", 9, 1);
        panics(|| {
            d.claim_reward(id);
        });
        pass(
            &mut d,
            Action::ResolveChallenge {
                job_id: id,
                approve: false,
            },
            9,
        );
        assert_eq!(d.reward_available, 1000);
        assert_eq!(d.reward_reserved, 0);
        assert_eq!(d.agent_reserved, 10);
        ctx("judge.testnet", 11, 1);
        d.claim_agent_fee(id);
        assert_eq!(d.agent_pending, 10);
    }
    #[test]
    fn payout_callback_failure_is_retryable_success_and_replay_are_final() {
        let mut d = ready();
        let id = job(&mut d);
        verdict(&mut d, id, 40);
        ctx("builder.testnet", 6, 1);
        d.claim_reward(id);
        let nonce = d.get_job(id).unwrap().reward_nonce.unwrap();
        assert_eq!(d.reward_pending, 40);
        panics(|| {
            d.claim_reward(id);
        });
        ctx("fake.testnet", 6, 0);
        panics(|| {
            d.finish_claim(
                id,
                "rewards".into(),
                nonce,
                PromiseResult::Successful(vec![]),
            );
        });
        ctx("dao.testnet", 6, 0);
        assert!(!d.finish_claim(id, "rewards".into(), nonce, PromiseResult::Failed));
        assert_eq!(d.reward_reserved, 40);
        assert_eq!(d.reward_pending, 0);
        ctx("builder.testnet", 7, 1);
        d.claim_reward(id);
        let nonce2 = d.get_job(id).unwrap().reward_nonce.unwrap();
        ctx("dao.testnet", 7, 0);
        panics(|| {
            d.finish_claim(
                id,
                "rewards".into(),
                nonce,
                PromiseResult::Successful(vec![]),
            );
        });
        assert!(d.finish_claim(
            id,
            "rewards".into(),
            nonce2,
            PromiseResult::Successful(vec![])
        ));
        assert_eq!(d.reward_paid, 40);
        assert_eq!(d.reward_reserved, 0);
        ctx("builder.testnet", 7, 1);
        panics(|| {
            d.claim_reward(id);
        });
    }
    #[test]
    fn expired_job_frees_reservations_once_and_no_agent_payment() {
        let mut d = ready();
        let id = job(&mut d);
        ctx("anyone.testnet", 13, 1);
        d.expire_job(id);
        assert_eq!(d.reward_available, 1000);
        assert_eq!(d.agent_available, 100);
        panics(|| {
            d.expire_job(id);
        });
        ctx("judge.testnet", 14, 1);
        panics(|| {
            d.claim_agent_fee(id);
        });
        panics(|| {
            verdict(&mut d, id, 40);
        });
    }
    #[test]
    fn epoch_limit_is_not_reset_by_policy_change() {
        let mut d = ready();
        d.policy.epoch_budget = U128(100);
        let id = job(&mut d);
        verdict(&mut d, id, 100);
        let mut p = policy();
        p.epoch_budget = U128(1000);
        pass(&mut d, Action::UpdatePolicy { policy: p }, 7);
        ctx("alice.testnet", 9, 1);
        let second = d.propose(
            Action::ReviewContribution {
                request: request(2),
            },
            "more".into(),
        );
        d.vote(second, true);
        ctx("bob.testnet", 9, 1);
        d.vote(second, true);
        ctx("alice.testnet", 10, 1);
        panics(|| {
            d.execute(second);
        });
        assert_eq!(d.epoch(0).reward_limit.0, 100);
    }
    #[test]
    fn beneficiary_recuses_and_agent_cannot_judge_own_reward() {
        let mut d = ready();
        let mut r = request(2);
        r.beneficiary = a("judge.testnet");
        ctx("alice.testnet", 2, 1);
        panics(|| {
            d.propose(Action::ReviewContribution { request: r }, "self".into());
        });
        let mut r = request(3);
        r.beneficiary = a("alice.testnet");
        let id = d.propose(
            Action::ReviewContribution { request: r },
            "member work".into(),
        );
        panics(|| {
            d.vote(id, true);
        });
    }
    #[test]
    fn compute_dispatch_is_funded_pinned_once_and_callback_bound() {
        let mut d = ready();
        let mut ag = agent();
        ag.outlayer = Some(OutlayerConfig {
            contract_id: a("outlayer.testnet"),
            source_url: "https://example.org/worker.wasm".into(),
            source_hash: "a".repeat(64),
            max_deposit: U128(100),
            secrets_ref: None,
        });
        pass(&mut d, Action::AppointAgent { agent: ag }, 2);
        let id = pass(
            &mut d,
            Action::ReviewContribution {
                request: request(1),
            },
            4,
        );
        ctx("alice.testnet", 6, 1);
        panics(|| {
            d.execute_outlayer(id);
        });
        ctx("funder.testnet", 6, 100);
        d.fund_compute();
        ctx("alice.testnet", 6, 1);
        d.execute_outlayer(id);
        assert_eq!(d.compute_pending, 100);
        let nonce = d.job(id).compute_nonce.unwrap();
        let receipts = get_created_receipts();
        assert!(!receipts.is_empty());
        ctx("judge.testnet", 6, 1);
        panics(|| {
            d.submit_verdict(
                id,
                40,
                "r".into(),
                "d".repeat(64),
                "c".repeat(40),
                "a".repeat(64),
                "b".repeat(64),
            );
        });
        ctx("fake.testnet", 6, 0);
        panics(|| {
            d.finish_compute(
                id,
                nonce,
                U128(100),
                PromiseResult::Successful(b"null".to_vec()),
            );
        });
        ctx("dao.testnet", 6, 0);
        assert!(!d.finish_compute(
            id,
            nonce,
            U128(100),
            PromiseResult::Successful(b"null".to_vec())
        ));
        assert_eq!(d.compute_spent, 100);
        assert_eq!(d.compute_available, 0);
        ctx("alice.testnet", 7, 1);
        panics(|| {
            d.execute_outlayer(id);
        });
        verdict(&mut d, id, 40);
        assert_eq!(d.job(id).score, Some(40));
    }
    fn compute_ready() -> (ContributorDao, u64, u64) {
        let mut d = ready();
        let mut ag = agent();
        ag.outlayer = Some(OutlayerConfig {
            contract_id: a("outlayer.testnet"),
            source_url: "https://example.org/worker.wasm".into(),
            source_hash: "a".repeat(64),
            max_deposit: U128(100),
            secrets_ref: None,
        });
        pass(&mut d, Action::AppointAgent { agent: ag }, 2);
        let id = pass(
            &mut d,
            Action::ReviewContribution {
                request: request(1),
            },
            4,
        );
        ctx("funder.testnet", 6, 100);
        d.fund_compute();
        ctx("alice.testnet", 6, 1);
        d.execute_outlayer(id);
        let n = d.job(id).compute_nonce.unwrap();
        (d, id, n)
    }
    fn worker_bytes(id: u64, hash: &str) -> Vec<u8> {
        near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"schema_version":1,"job_id":id,"repository":"nvq2309/therascals","pull_request":1,"beneficiary":"builder.testnet","merge_sha":"c".repeat(40),"worker_code_hash":hash,"rubric_hash":"b".repeat(64),"score":40,"rationale":"Reviewed authenticated merge and tests","evidence_hash":"d".repeat(64),"eligible":true,"agent_kind":"deterministic-program-v1","attestation_status":"external-verification-required"})).unwrap()
    }
    #[test]
    fn malformed_compute_json_clears_pending_and_keeps_manual_fallback() {
        let (mut d, id, n) = compute_ready();
        ctx("dao.testnet", 7, 0);
        assert!(!d.finish_compute(
            id,
            n,
            U128(100),
            PromiseResult::Successful(b"not json".to_vec())
        ));
        assert_eq!(d.compute_pending, 0);
        assert_eq!(d.compute_spent, 100);
        assert!(d.job(id).compute_nonce.is_none());
        ctx("judge.testnet", 7, 1);
        d.submit_verdict(
            id,
            40,
            "Manual fallback".into(),
            "d".repeat(64),
            "c".repeat(40),
            "a".repeat(64),
            "b".repeat(64),
        );
        assert_eq!(d.job(id).score, Some(40));
    }
    #[test]
    fn wrong_worker_hash_cannot_write_score() {
        let (mut d, id, n) = compute_ready();
        ctx("dao.testnet", 7, 0);
        assert!(!d.finish_compute(
            id,
            n,
            U128(100),
            PromiseResult::Successful(worker_bytes(id, &"f".repeat(64)))
        ));
        assert!(d.job(id).score.is_none());
        assert_eq!(d.compute_pending, 0);
        assert_eq!(d.compute_spent, 100);
    }
    #[test]
    fn successful_compute_is_bound_and_duplicate_callback_has_no_effect() {
        let (mut d, id, n) = compute_ready();
        ctx("dao.testnet", 7, 0);
        assert!(d.finish_compute(
            id,
            n,
            U128(100),
            PromiseResult::Successful(worker_bytes(id, &"a".repeat(64)))
        ));
        assert_eq!(d.job(id).score, Some(40));
        assert_eq!(d.reward_reserved, 40);
        assert!(!d.finish_compute(
            id,
            n,
            U128(100),
            PromiseResult::Successful(worker_bytes(id, &"a".repeat(64)))
        ));
        assert_eq!(d.compute_spent, 100);
        assert_eq!(d.reward_reserved, 40);
    }
    #[test]
    fn missing_or_late_compute_cannot_lock_token_budgets() {
        let (mut d, id, n) = compute_ready();
        ctx("anyone.testnet", 15, 1);
        d.expire_job(id);
        assert_eq!(d.reward_available, 1000);
        assert_eq!(d.agent_available, 100);
        assert_eq!(d.compute_pending, 0);
        assert_eq!(d.compute_spent, 100);
        ctx("dao.testnet", 16, 0);
        assert!(!d.finish_compute(
            id,
            n,
            U128(100),
            PromiseResult::Successful(worker_bytes(id, &"a".repeat(64)))
        ));
        assert!(d.job(id).score.is_none());
        assert_eq!(d.reward_available, 1000);
    }
    #[test]
    fn late_compute_result_is_rejected_before_expiry() {
        let (mut d, id, n) = compute_ready();
        ctx("dao.testnet", 16, 0);
        assert!(!d.finish_compute(
            id,
            n,
            U128(100),
            PromiseResult::Successful(worker_bytes(id, &"a".repeat(64)))
        ));
        assert_eq!(d.compute_pending, 0);
        ctx("anyone.testnet", 16, 1);
        d.expire_job(id);
        assert_eq!(d.reward_available, 1000);
    }
    #[test]
    fn zero_score_can_be_appealed_without_minting_new_reward() {
        let mut d = ready();
        let id = job(&mut d);
        verdict(&mut d, id, 0);
        ctx("builder.testnet", 5, 1);
        d.challenge(id, "Importance appeal".into());
        pass(
            &mut d,
            Action::ResolveChallenge {
                job_id: id,
                approve: true,
            },
            6,
        );
        assert_eq!(d.job(id).resolved_approved, Some(true));
        assert_eq!(d.reward_available, 1000);
        assert_eq!(d.reward_reserved, 0);
        ctx("builder.testnet", 8, 1);
        panics(|| {
            d.claim_reward(id);
        });
    }
    #[test]
    fn approved_review_cannot_execute_under_changed_agent_or_policy() {
        let mut d = ready();
        ctx("alice.testnet", 2, 1);
        let id = d.propose(
            Action::ReviewContribution {
                request: request(1),
            },
            "work".into(),
        );
        d.vote(id, true);
        ctx("bob.testnet", 2, 1);
        d.vote(id, true);
        let mut p = policy();
        p.tokens_per_point = U128(2);
        p.max_reward_per_contribution = U128(200);
        pass(&mut d, Action::UpdatePolicy { policy: p }, 3);
        ctx("alice.testnet", 5, 1);
        panics(|| {
            d.execute(id);
        });
        assert!(d.get_job(id).is_none());
        assert_eq!(d.reward_available, 1000);
    }
    #[allow(deprecated)]
    fn callback_context(seconds: u64, result: PromiseResult) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("dao.testnet"))
            .predecessor_account_id(a("dao.testnet"))
            .signer_account_id(a("dao.testnet"))
            .block_timestamp(seconds * SECOND);
        near_sdk::test_utils::testing_env_with_promise_results(b.build(), result);
    }
    #[test]
    fn raw_compute_callback_rejects_oversized_bytes_without_locking() {
        let (mut d, id, n) = compute_ready();
        callback_context(7, PromiseResult::Successful(vec![b'x'; 20_000]));
        assert!(!d.resolve_outlayer(id, n, U128(100)));
        assert!(d.job(id).compute_nonce.is_none());
        assert_eq!(d.compute_pending, 0);
        assert_eq!(d.compute_spent, 100);
    }
    #[test]
    fn successful_token_transfer_never_retries_because_of_return_bytes() {
        let mut d = ready();
        let id = job(&mut d);
        verdict(&mut d, id, 40);
        ctx("builder.testnet", 6, 1);
        d.claim_reward(id);
        let n = d.job(id).reward_nonce.unwrap();
        callback_context(7, PromiseResult::Successful(vec![b'x'; 20_000]));
        assert!(d.resolve_claim(id, "rewards".into(), n));
        assert_eq!(d.reward_paid, 40);
        assert_eq!(d.job(id).reward_status, "paid");
    }
}
