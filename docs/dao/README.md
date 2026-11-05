# Rascals contributor DAO prototype

The workbench is available through the local Rascals DAO navigation at http://127.0.0.1:5177/#dao. It now loads real NEAR testnet state automatically; there is no Local Demo entry. The deployed contract is `v2.rascals-dao-1104.testnet`. See [testnet deployment](testnet-deployment-2026-11-04.md) for exact funding, governance and execution limits. No protocol token or mainnet economics are launched.

The local simulator instructions below are historical development/testing notes, not the current product entry.

## Run the real-testnet interface

```sh
pnpm install --frozen-lockfile
pnpm dao:release
pnpm dao:serve
```

Open http://127.0.0.1:4321/dao/. Reads use the deployed testnet contract; no simulator server is required. The release server only serves static UI and health, with a fresh CSP nonce for the NEAR wallet connector. It has no signing key or simulated mutation API. The separate output is `dist/dao`, guarded against simulator and localhost markers. `pnpm dao:dev` serves source development at port 5190.

The source-level local model remains a regression-test tool; it is not a product entry or part of either release bundle.

## Participate

Anyone with the interface URL can inspect the deployed program and its actual receipts. Repository access is required to submit a PR while `nvq2309/therascals` is private. A council member must propose review of the exact merged commit and beneficiary testnet wallet; quorum approves authorization. The appointed trusted agent submits the bound assessment. The beneficiary can claim only after the challenge window or a valid council resolution. Wallet connection does not grant membership, and merging a PR does not cause an automatic payout. TEST-USDC has no monetary value.

The recorded job #1 is already paid; never replay its authorization or claims. [Acceptance receipts](reward-test-2026-11-04.md).

## Actual testnet mode

The separate interface accepts a named `.testnet` DAO and opens a NEAR testnet wallet connector. All mutations require an explicit wallet action. The prototype UI checks `ft_metadata` and supports reward tokens with **6 decimals only**; other precision is refused rather than silently misdisplayed. The Rust contract itself accounts in generic atomic U128 units.

The contract must be deployed/initialized separately by the owner's authorized testnet wallet. Before any funded test, replace example council/agent/beneficiary accounts with accounts their intended operators actually control. Fixed council membership/strict-majority threshold and token ID are initialization decisions. Do not leave example accounts controlling a funded deployment. The contract rejects mainnet identifiers.

Build artifacts:

```sh
pnpm dao:contract:build
pnpm dao:worker:build
```

DAO WASM: `target/wasm32-unknown-unknown/release/rascals_contributor_dao.wasm`.
Worker artifact/hash manifest: `workers/contributor-verdict/artifacts/build.json` (ignored generated output). `build.sh` requires installed WASI Preview2 support; see worker README.

Deployment sequence (no commands here are auto-executed):

1. Owner creates a funded testnet DAO account with sufficient storage reserve, then deploys WASM and calls `new` with controlled council accounts, strict-majority threshold, token ID and policy. Exact JSON ABI: [contract-api.md](contract-api.md).
2. Register the DAO, beneficiary and agent with the NEP141 token as required by that token's storage policy. Fund token budgets via `ft_transfer_call` with `msg:{"bucket":"rewards"}` or `{"bucket":"agents"}`; native NEAR sent with `fund_compute` is a separate compute allocation.
3. Publish the actual hash-named worker WASM using the provider's trusted setup. For the private GitHub repo, configure encrypted read-only `GITHUB_TOKEN` injection through a named secret profile; never paste its value into proposals, job inputs, docs or browser state.
4. DAO votes on the exact worker/rubric/source hashes, optional OutLayer contract/source and nonsecret profile locator, plus capped per-job deposit. It then authorizes a real merged-PR review job.
5. A council wallet can call `execute_outlayer`; the contract sends one bounded request and validates its private callback. Alternatively the appointed agent may submit a bound manual result, explicitly trusted. Callback provenance is not hardware proof.
6. Independently verify a real provider execution with `outlayer-verify` before treating any result as TEE proven. [outlayer.md](outlayer.md) describes exact provider ABI, proof boundary and the fail-closed hosted-response gate. No real proof or deployed end-to-end execution has been verified in this change.

## Scope and trust boundaries

- Governance approves policy, judge appointment and funded jobs. The program judges importance using a disclosed heuristic; this is not objective quality certification. A future model-backed judge needs a new pinned code/rubric appointment.
- A job binds the approved beneficiary; this prototype does not cryptographically prove GitHub-account-to-wallet ownership. Council authorization remains a trust boundary.
- No live fee conversion or bridge is implemented. Only actual token deposits fund spendable on-chain token balances. The historical 50bps fee policy is not activated by this work.
- Agent service payment and native compute costs are separate. Native compute allocation is conservatively treated as spent on completion/failure/expiry; actual provider refunds are not automatically credited as new budget. There is no arbitrary treasury withdrawal.
- Challenges can uphold/reject the existing award, including recording an appeal of a zero award. They cannot increase/re-score an award in this prototype. A future re-judgment workflow must reserve and govern any additional spending.
- Council/token/epoch duration are fixed; 1,000 proposals/jobs and bounded text/list sizes cap storage. Storage staking, upgrade-key removal/governance, membership rotation, anti-spam challenge economics and third-party audit remain production work.
- Local model code/output remains outside release bundles. Development output is `.local-dev/dao-dist`; the separately reviewed real-testnet candidate builds to `dist/dao`. The main arcade retains its development-only DAO navigation until a public testnet entry is explicitly approved.

## Verification

Run `pnpm exec vitest run --maxWorkers=4`, `pnpm build`, `pnpm dao:build`, `cargo test --workspace --locked`, the worker's Rust/Python tests and both WASM builds. Browser evidence and local receipts are private under `.local-dev/dao-evidence` / `.local-dev/dao-qa`, not bundled as fictitious public activity. See [verification.md](verification.md) for the consumed final results.
