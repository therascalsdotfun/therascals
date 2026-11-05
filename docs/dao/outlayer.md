# OutLayer contributor-verdict integration

Status: local worker implemented and compiled to WASI Preview 2. No upload, remote execution, NEAR deployment, API payment, Intel proof verification or funded reward has occurred.

## Researched interface (2026-11-04)

Current official docs redirect from `outlayer.fastnear.com` to `app.outlayer.ai`. The source repository redirects from `fastnear/near-outlayer` to `out-layer/outlayer`.

A stateless Rust command reads JSON stdin and writes JSON stdout. This worker uses `wasi-http-client 0.2.1`, whose actual runtime imports require `wasm32-wasip2`. OutLayer supports this target. The optional `outlayer 0.2` SDK is unnecessary because this worker has no persistent storage; its SDK docs also require WASI Preview 2.

NEAR testnet contract: `outlayer.testnet`, method `request_execution`. JSON arguments:

```json
{
  "source": {
    "WasmUrl": {
      "url": "<published HTTPS URL ending in actual-sha256.wasm>",
      "hash": "<actual 64 lowercase hex>",
      "build_target": "wasm32-wasip2"
    }
  },
  "resource_limits": {
    "max_instructions": 10000000000,
    "max_memory_mb": 128,
    "max_execution_seconds": 60
  },
  "input_data": "<exact compact JSON job string>",
  "secrets_ref": {
    "profile": "github-readonly",
    "account_id": "<authorized owner.testnet>"
  },
  "response_format": "Json",
  "payer_account_id": null,
  "params": null
}
```

`secrets_ref` is a non-secret profile reference. The secret itself must be provisioned through the OutLayer trusted encrypted-secret workflow. It injects `GITHUB_TOKEN` into worker environment. `null` works for public data only; the current Rascals repo is private, so a null profile cannot be represented as a functioning private-repository integration. Configure a least-privilege read-only repository credential. The worker's host is fixed to `api.github.com` and repository fixed to `nvq2309/therascals`; redirects/non-200 responses and oversized/truncated evidence fail closed.

The request attaches a separately budgeted NEAR deposit for compute. Unused compute funds are provider-refunded. The DAO's token-denominated agent service fee is a **different** payment: it is reserved by the DAO and earned by the approved agent after a valid result. A protocol-token deposit is not automatically a NEAR compute deposit or USD API credit. No fee conversion or bridge is silently assumed.

For a NEAR promise integration the DAO must call the pinned hash, attach bounded compute funds, and receive `#[callback_result] Result<Option<WorkerVerdict>,PromiseError>` in a private callback. Validate job id, repo, PR, merge SHA, beneficiary, snapshotted worker/rubric hashes and score bound before committing a verdict. A raw caller cannot forge this callback. Timeout, failed callback and unknown-result recovery must not create a second compute payment or duplicate token claim.

## HTTPS alternative and proof gate

Testnet endpoint: `https://testnet-api.outlayer.ai/call/{project_owner}/{project_name}`. Headers include `X-Payment-Key`, `X-Compute-Limit` (micro-USD cap), optional `X-Attached-Deposit` (author payment); body includes `input`, `version_key` pinned to actual WASM hash, resource limits and secret profile reference. These headers belong in the backend/TEE, never browser assets. A POST may already have executed/charged after timeout: preserve call id and reconcile rather than retry blindly.

Completed responses identify `call_id`, `output` and `/attestations/by-call/{call_id}`. A link is not proof. The current trust guide documents `outlayer-verify call <call-id> --input '<exact JSON>' --output '<exact output>'`, or `outlayer-verify tx <hash>` for on-chain work. Exit 0 is proven, 1 failed, 2 unproven; structured `--json` and `--bundle` output support a verifiable archive. Check actual WASM hash against the DAO snapshot as well as code/input/output bindings. The local `verify_execution.py` gate requires the independent executable and fails closed on missing/incompatible proof. It has not verified a live execution here.

The overview/dev guide still contains an older “attestation coming soon” line, while the current trust/attestation pages describe live proof verification. We do not infer proof availability for our undeployed worker from documentation marketing. Verify a real execution before enabling production payouts.

## Artifacts and deployment sequence

1. Run worker tests and `workers/contributor-verdict/build.sh`. Its ignored `artifacts/build.json` reports actual WASM/rubric hashes.
2. Publish the hash-named WASM through the provider upload workflow only after owner authorization. Never use an active mutable project version without a pinned hash.
3. Configure the private GitHub secret profile and its access policy through trusted provider setup.
4. DAO governance approves exact worker hash, rubric hash, trusted agent/callback configuration and bounded budgets.
5. Create a review job bound to a real merged PR/beneficiary. Execute only that authorized job once. Reconcile failed/unknown calls.
6. Verify execution proof and the independent score/evidence/challenge flow before considering any mainnet launch.

## Primary references

- https://docs.near.org/primitives/off-chain-compute/outlayer
- https://app.outlayer.ai/docs/dev-guide — `request_execution`/promise callback shape and hash-named WASM
- https://app.outlayer.ai/docs/sdk — WASI Preview 2, env-secret injection, stateless programs
- https://app.outlayer.ai/docs/https-api — testnet API, payment keys, response/attestation links and retry semantics
- https://app.outlayer.ai/docs/trust-verification — independent proof verifier and trust boundaries
- https://github.com/out-layer/weather-example — `wasi-http-client 0.2` transport reference (no source code copied)
