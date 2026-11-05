# Contributor verdict worker

This stateless Rust/WASI program is an OutLayer execution target. It reads one JSON request from stdin, retrieves a merged PR from the fixed `api.github.com/repos/nvq2309/therascals` endpoint, checks the exact merge SHA and evaluates a published deterministic demo rubric. It writes one bound verdict JSON to stdout. This is a program's judgment, not objective proof of importance.

Input (all fields required, unknown fields refused):

```json
{"schema_version":1,"job_id":1,"repository":"nvq2309/therascals","pull_request":1,"merge_sha":"40-lowercase-hex","beneficiary":"alice.testnet","worker_code_hash":"64-lowercase-hex","rubric_hash":"64-lowercase-hex","max_score":100}
```

Output includes the same request identifiers, `score` (0..max_score, maximum 1000), `rationale`, `evidence_hash`, `rubric_hash`, `worker_code_hash`, `eligible`, `agent_kind:"deterministic-program-v1"`, and `attestation_status:"external-verification-required"`. A worker cannot certify its own TEE. Its returned code hash is the requested binding; the caller must independently compare the actual execution's WASM digest. Never accept that field alone as attestation.

The contract remains authoritative for who may request a review, reserve payment, submit a verdict and claim tokens. A local run must be marked unattested. API keys (if needed for this private repository) come only from a secret environment variable `GITHUB_TOKEN`, never stdin or browser state.

No remote execution or token payment is performed by building or testing this worker.

## Build and run

```sh
rustup target add wasm32-wasip2
sh workers/contributor-verdict/build.sh
cargo test --manifest-path workers/contributor-verdict/Cargo.toml --locked
python3 -m unittest discover -s workers/contributor-verdict/tests -p 'test_*.py'
cargo run --manifest-path workers/contributor-verdict/Cargo.toml -- --rubric-hash
```

For a real approved review, create an input with the on-chain job's exact snapshot fields and actual build hashes; then pipe it to the native binary. No historical/demo contribution is bundled as a payable production input. `cargo run --manifest-path ... < job.json` performs read-only GitHub requests. The private Rascals repository needs a read-only GitHub credential in `GITHUB_TOKEN`; missing access produces an error, never fabricated evidence. No credential value is placed in the job or output. Use a trusted secret-setup flow, not a token pasted into command history.

`tools/make_request.py job.json --wasm-url <published-hash-named-URL> --secret-account <owner.testnet> --secret-profile github-readonly` prints the exact `request_execution` arguments. It does not deploy/upload, send a transaction or spend money. A code hash change or rubric hash change requires a new DAO-approved agent configuration.

## What the program judges

The disclosed demo rubric starts at 20%, adds bounded signals for sensitive runtime paths, runtime implementation, tests, successful CI configuration, and documentation-only work, then scales to the approved `max_score` (1..1000). It does not count lines or reward PR splitting. Bots, empty contributions and observed failed checks receive zero; pending CI and incomplete evidence fail closed. A merge does not prove correctness. A pinned program can consistently apply this heuristic but cannot make it objective; the DAO's review/challenge controls remain necessary.

The worker checks exact repository/PR/merge SHA and hashes the fetched metadata, files and check runs. It does not prove GitHub-to-wallet ownership; the governance-authorized job binds the beneficiary. It rejects more than 100 changed files/check runs instead of silently scoring truncated evidence. Raise limits only through a reviewed worker build.

## Attestation boundary

Local execution is **unattested**. `attestation_status` is never `verified`: an app cannot attest itself. NEAR promise callbacks from the configured OutLayer contract establish callback provenance, not a standalone proof that the deployed provider has no upgrade/admin trust.

For HTTPS runs, preserve exact request and response bytes. `tools/verify_execution.py` refuses failed/missing-attestation/mismatched outputs, invokes the separately installed `outlayer-verify` CLI, requires its proven exit status, and checks the expected WASM hash in structured proof. It fails closed if the verifier is absent, proof schema is unsupported or verification cannot complete. This adapter has unit coverage, but a real funded OutLayer execution and real Intel proof are **not** claimed. Confirm the installed verifier version's JSON schema before enabling it operationally; an incompatible schema remains unproven.
