# Contributor DAO

The [DAO tab](https://therascals.fun/#dao) provides a NEAR testnet program for reviewing merged pull requests and distributing governed contributor rewards. Read [public deployment details](testnet.md) and the [contract API](contract-api.md).

## Review and claim flow

1. A council member proposes a review bound to an exact repository, PR, merge SHA and beneficiary account.
2. Council votes authorize the review and reserve its maximum contributor reward and agent fee.
3. The appointed agent submits a score, rationale and evidence digest matching the authorized job.
4. The public challenge period allows objections. Challenged rewards require a council resolution.
5. The bound contributor and agent claim their respective payments. Failed transfers remain retryable; successful claims cannot be repeated.

Connecting a wallet does not grant council membership. A merge does not automatically trigger a payout. The deterministic scoring rubric is a disclosed heuristic; it is not an objective measure of contribution quality.

## Run the interface

```sh
pnpm install --frozen-lockfile
pnpm dao:release
pnpm dao:serve
```

Open http://127.0.0.1:4321/dao/. The interface reads the deployed NEAR testnet contract and uses explicit wallet approval for mutations. `pnpm dao:dev` runs the development frontend at port 5190.

The release server serves static assets and health, with per-document CSP nonces for the wallet connector. It contains no signing key. The UI supports reward tokens with six decimals; the contract uses atomic U128 units.

## Build and test

```sh
pnpm dao:contract:build
pnpm dao:worker:build
cargo test --workspace --locked
cargo test --manifest-path workers/contributor-verdict/Cargo.toml --locked
python3 -m unittest discover -s workers/contributor-verdict/tests -p 'test_*.py'
```

Contract WASM: `target/wasm32-unknown-unknown/release/rascals_contributor_dao.wasm`. The worker targets `wasm32-wasip2`; its build produces a hash-named artifact and manifest under `workers/contributor-verdict/artifacts/`.

## Trust and funding

Contributor rewards and agent service fees have separate NEP-141-funded budgets. Native NEAR compute allocation is accounted separately. Token deposits do not imply fee conversion, bridging or inference credits.

Council membership, threshold, token contract and epoch duration are fixed for this prototype. Jobs snapshot agent, rubric, policy and code identities. Challenges approve or reject an existing award; they do not rescore it. Governance authorizes the GitHub contribution-to-wallet binding.

The current program uses a trusted appointed agent. Hosted OutLayer execution and independently verified hardware attestation are not active. See [OutLayer integration](outlayer.md) and the [worker interface](../../workers/contributor-verdict/README.md).

This is a governed testnet prototype. TEST-USDC has no monetary value. Automatic merge watching, mainnet contributor economics and a protocol-token reward entitlement are not active.
