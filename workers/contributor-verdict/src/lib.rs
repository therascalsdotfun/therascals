use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const REPOSITORY: &str = "nvq2309/therascals";
pub const RUBRIC_JSON: &str = include_str!("../rubric.json");
pub const MAX_RESPONSE_BYTES: usize = 2_000_000;
pub const MAX_FILES: usize = 100;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version: u8,
    pub job_id: u64,
    pub repository: String,
    pub pull_request: u64,
    pub merge_sha: String,
    pub beneficiary: String,
    pub worker_code_hash: String,
    pub rubric_hash: String,
    pub max_score: u32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Repo {
    pub full_name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Branch {
    pub repo: Option<Repo>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct User {
    pub login: String,
    #[serde(rename = "type")]
    pub kind: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PullRequest {
    pub number: u64,
    pub merged: bool,
    pub merge_commit_sha: Option<String>,
    pub merged_at: Option<String>,
    pub state: String,
    pub title: String,
    pub user: User,
    pub base: Branch,
    pub changed_files: usize,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChangedFile {
    pub filename: String,
    pub status: String,
    pub sha: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CheckRun {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub head_sha: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CheckRuns {
    pub total_count: usize,
    pub check_runs: Vec<CheckRun>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Evidence {
    pub pr: PullRequest,
    pub files: Vec<ChangedFile>,
    pub checks: CheckRuns,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Verdict {
    pub schema_version: u8,
    pub job_id: u64,
    pub repository: String,
    pub pull_request: u64,
    pub merge_sha: String,
    pub beneficiary: String,
    pub worker_code_hash: String,
    pub rubric_hash: String,
    pub score: u32,
    pub rationale: String,
    pub evidence_hash: String,
    pub eligible: bool,
    pub agent_kind: String,
    pub attestation_status: String,
}
fn hash(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}
pub fn rubric_hash() -> String {
    hash(RUBRIC_JSON.as_bytes())
}
fn lower_hex(s: &str, n: usize) -> bool {
    s.len() == n
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
pub fn validate_request(r: &Request) -> Result<(), String> {
    if r.schema_version != 1 {
        return Err("unsupported request schema".into());
    }
    if r.pull_request == 0 || r.pull_request > 10_000_000 {
        return Err("invalid request identifiers".into());
    }
    if r.repository != REPOSITORY {
        return Err("repository is not allowed by this worker build".into());
    }
    if !lower_hex(&r.merge_sha, 40) || !lower_hex(&r.worker_code_hash, 64) {
        return Err("invalid pinned hash".into());
    }
    if r.rubric_hash != rubric_hash() {
        return Err("rubric does not match this worker build".into());
    }
    if r.max_score == 0 || r.max_score > 1000 {
        return Err("max_score must be 1..1000".into());
    }
    if r.beneficiary.len() < 10
        || r.beneficiary.len() > 64
        || !r.beneficiary.ends_with(".testnet")
        || !r
            .beneficiary
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
    {
        return Err("testnet beneficiary required".into());
    }
    Ok(())
}
pub fn github_paths(r: &Request) -> Result<[String; 3], String> {
    validate_request(r)?;
    let prefix = format!("https://api.github.com/repos/{REPOSITORY}");
    Ok([
        format!("{prefix}/pulls/{}", r.pull_request),
        format!(
            "{prefix}/pulls/{}/files?per_page=100&page=1",
            r.pull_request
        ),
        format!(
            "{prefix}/commits/{}/check-runs?per_page=100&page=1",
            r.merge_sha
        ),
    ])
}
pub fn evaluate(r: &Request, e: &Evidence) -> Result<Verdict, String> {
    validate_request(r)?;
    let pr = &e.pr;
    if pr.number != r.pull_request
        || pr.base.repo.as_ref().map(|x| x.full_name.as_str()) != Some(REPOSITORY)
    {
        return Err("GitHub PR identity mismatch".into());
    }
    if !pr.merged
        || pr.state != "closed"
        || pr.merged_at.as_deref().unwrap_or("").is_empty()
        || pr.merge_commit_sha.as_deref() != Some(r.merge_sha.as_str())
    {
        return Err("PR is not merged at the pinned commit".into());
    }
    if e.files.len() != pr.changed_files
        || e.files.len() > MAX_FILES
        || e.files.iter().any(|f| {
            f.filename.len() > 512
                || f.filename.starts_with('/')
                || f.filename.split('/').any(|x| x == "..")
        })
    {
        return Err("incomplete or oversized changed-file evidence".into());
    }
    if e.checks.total_count != e.checks.check_runs.len()
        || e.checks.total_count > 100
        || e.checks
            .check_runs
            .iter()
            .any(|c| c.head_sha != r.merge_sha)
    {
        return Err("incomplete or wrong-commit CI evidence".into());
    }
    let checks_ok = !e.checks.check_runs.is_empty()
        && e.checks.check_runs.iter().all(|c| {
            c.status == "completed"
                && matches!(
                    c.conclusion.as_deref(),
                    Some("success" | "neutral" | "skipped")
                )
        });
    if e.checks.check_runs.iter().any(|c| c.status != "completed") {
        return Err("CI evidence is not settled".into());
    }
    let failed_checks = e.checks.check_runs.iter().any(|c| {
        c.status == "completed"
            && matches!(
                c.conclusion.as_deref(),
                Some("failure" | "cancelled" | "timed_out" | "action_required" | "stale")
            )
    });
    let has = |f: fn(&str) -> bool| e.files.iter().any(|x| f(&x.filename));
    let sensitive = has(|p| {
        p.starts_with("contracts/")
            || p.starts_with("apps/server/src/execution/")
            || p.starts_with("apps/server/src/mainnet/")
            || p.contains("/wallets/")
    });
    let runtime =
        has(|p| (p.starts_with("apps/") || p.starts_with("packages/")) && !p.ends_with(".md"));
    let tests = has(|p| p.starts_with("tests/") || p.contains(".test.") || p.ends_with("_test.rs"));
    let ci = has(|p| p.starts_with(".github/workflows/"));
    let docs_only = !e.files.is_empty()
        && e.files
            .iter()
            .all(|f| f.filename.starts_with("docs/") || f.filename.ends_with(".md"));
    let eligible = pr.user.kind != "Bot" && !e.files.is_empty() && !failed_checks;
    let mut percent = 20;
    if sensitive {
        percent += 30;
    }
    if runtime {
        percent += 15;
    }
    if tests {
        percent += 20;
    }
    if ci && checks_ok {
        percent += 10;
    }
    if docs_only {
        percent += 5;
    }
    percent = percent.min(100);
    let score = if eligible {
        ((u64::from(r.max_score) * percent + 99) / 100) as u32
    } else {
        0
    };
    let evidence_bytes = serde_json::to_vec(e).map_err(|_| "could not encode evidence")?;
    let rationale=format!("Demo program rubric v1: base 20%; sensitive-runtime signal={sensitive}; runtime signal={runtime}; tests signal={tests}; CI configuration with observed passing checks={}; documentation-only={docs_only}; observed checks={}. This heuristic is not an objective quality or impact audit. {}",ci&&checks_ok,if checks_ok{"passing"}else if failed_checks{"failed"}else{"unknown/pending"},if eligible{"Merged contribution eligible for the computed score; DAO challenge rules still apply."}else{"No reward: bot, empty change or failed CI evidence."});
    Ok(Verdict {
        schema_version: 1,
        job_id: r.job_id,
        repository: r.repository.clone(),
        pull_request: r.pull_request,
        merge_sha: r.merge_sha.clone(),
        beneficiary: r.beneficiary.clone(),
        worker_code_hash: r.worker_code_hash.clone(),
        rubric_hash: r.rubric_hash.clone(),
        score,
        rationale,
        evidence_hash: hash(&evidence_bytes),
        eligible,
        agent_kind: "deterministic-program-v1".into(),
        attestation_status: "external-verification-required".into(),
    })
}
