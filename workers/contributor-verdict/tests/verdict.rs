use rascals_contributor_verdict::*;
fn request() -> Request {
    Request {
        schema_version: 1,
        job_id: 1,
        repository: REPOSITORY.into(),
        pull_request: 9,
        merge_sha: "a".repeat(40),
        beneficiary: "builder.testnet".into(),
        worker_code_hash: "b".repeat(64),
        rubric_hash: rubric_hash(),
        max_score: 100,
    }
}
fn evidence() -> Evidence {
    Evidence {
        pr: PullRequest {
            number: 9,
            merged: true,
            merge_commit_sha: Some("a".repeat(40)),
            merged_at: Some("2026-11-04T00:00:00Z".into()),
            state: "closed".into(),
            title: "fixture contribution".into(),
            user: User {
                login: "builder".into(),
                kind: "User".into(),
            },
            base: Branch {
                repo: Some(Repo {
                    full_name: REPOSITORY.into(),
                }),
            },
            changed_files: 2,
        },
        files: vec![
            ChangedFile {
                filename: "apps/server/src/execution/policy.ts".into(),
                status: "modified".into(),
                sha: "c".repeat(40),
            },
            ChangedFile {
                filename: "tests/policy.test.ts".into(),
                status: "added".into(),
                sha: "d".repeat(40),
            },
        ],
        checks: CheckRuns {
            total_count: 1,
            check_runs: vec![CheckRun {
                name: "tests".into(),
                status: "completed".into(),
                conclusion: Some("success".into()),
                head_sha: "a".repeat(40),
            }],
        },
    }
}
#[test]
fn merged_bound_request_produces_capped_deterministic_verdict() {
    let r = request();
    let e = evidence();
    let v = evaluate(&r, &e).unwrap();
    assert!(v.eligible);
    assert_eq!(v.score, 85);
    assert_eq!(v.job_id, r.job_id);
    assert_eq!(v.beneficiary, r.beneficiary);
    assert_eq!(v.attestation_status, "external-verification-required");
    assert_eq!(v.evidence_hash, evaluate(&r, &e).unwrap().evidence_hash);
    assert_eq!(v.evidence_hash.len(), 64);
}
#[test]
fn score_scales_to_policy_without_exceeding_cap() {
    let mut r = request();
    r.max_score = 7;
    let v = evaluate(&r, &evidence()).unwrap();
    assert_eq!(v.score, 6);
    r.max_score = 1000;
    assert_eq!(evaluate(&r, &evidence()).unwrap().score, 850);
    r.max_score = 1001;
    assert!(evaluate(&r, &evidence()).is_err());
}
#[test]
fn caller_cannot_supply_arbitrary_repository_or_url() {
    for repo in [
        "other/repo",
        "https://evil.example",
        "nvq2309/therascals/../other",
    ] {
        let mut r = request();
        r.repository = repo.into();
        assert!(github_paths(&r).is_err());
    }
    let urls = github_paths(&request()).unwrap();
    assert!(urls
        .iter()
        .all(|s| s.starts_with("https://api.github.com/repos/nvq2309/therascals/")));
}
#[test]
fn pinned_sha_and_rubric_must_match() {
    let mut r = request();
    r.rubric_hash = "0".repeat(64);
    assert!(evaluate(&r, &evidence()).is_err());
    let mut e = evidence();
    e.pr.merge_commit_sha = Some("f".repeat(40));
    assert!(evaluate(&request(), &e).is_err());
}
#[test]
fn malformed_hashes_and_mainnet_beneficiary_rejected() {
    let mut r = request();
    r.merge_sha = "A".repeat(40);
    assert!(validate_request(&r).is_err());
    r = request();
    r.worker_code_hash = "https://example.com".into();
    assert!(validate_request(&r).is_err());
    r = request();
    r.beneficiary = "builder.near".into();
    assert!(validate_request(&r).is_err());
}
#[test]
fn unmerged_wrong_repository_or_wrong_pr_rejected() {
    let mut e = evidence();
    e.pr.merged = false;
    assert!(evaluate(&request(), &e).is_err());
    e = evidence();
    e.pr.base.repo.as_mut().unwrap().full_name = "different/repo".into();
    assert!(evaluate(&request(), &e).is_err());
    e = evidence();
    e.pr.number = 10;
    assert!(evaluate(&request(), &e).is_err());
}
#[test]
fn incomplete_file_or_ci_evidence_fails_closed() {
    let mut e = evidence();
    e.pr.changed_files = 3;
    assert!(evaluate(&request(), &e).is_err());
    e = evidence();
    e.checks.total_count = 2;
    assert!(evaluate(&request(), &e).is_err());
    e = evidence();
    e.checks.check_runs[0].head_sha = "f".repeat(40);
    assert!(evaluate(&request(), &e).is_err());
}
#[test]
fn pending_ci_does_not_create_a_payable_verdict() {
    let mut e = evidence();
    e.checks.check_runs[0].status = "in_progress".into();
    assert!(evaluate(&request(), &e).is_err());
}
#[test]
fn bot_and_failed_checks_return_explicit_zero_score() {
    let mut e = evidence();
    e.pr.user.kind = "Bot".into();
    let v = evaluate(&request(), &e).unwrap();
    assert!(!v.eligible);
    assert_eq!(v.score, 0);
    e = evidence();
    e.checks.check_runs[0].conclusion = Some("failure".into());
    assert_eq!(evaluate(&request(), &e).unwrap().score, 0);
}
#[test]
fn no_checks_discloses_unknown_instead_of_claiming_success() {
    let mut e = evidence();
    e.checks = CheckRuns {
        total_count: 0,
        check_runs: vec![],
    };
    let v = evaluate(&request(), &e).unwrap();
    assert!(v.rationale.contains("unknown/pending"));
}
#[test]
fn changed_evidence_changes_digest() {
    let mut e = evidence();
    let a = evaluate(&request(), &e).unwrap();
    e.files[0].sha = "e".repeat(40);
    let b = evaluate(&request(), &e).unwrap();
    assert_ne!(a.evidence_hash, b.evidence_hash);
}
#[test]
fn unknown_input_fields_are_refused() {
    let mut x = serde_json::to_value(request()).unwrap();
    x["github_token"] = "not-accepted".into();
    assert!(serde_json::from_value::<Request>(x).is_err());
}
