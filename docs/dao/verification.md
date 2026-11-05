# Contributor DAO verification — November 4, 2026

Checkout: `/Users/cherry/Desktop/01_Work_Projects/therascals`, branch `feat/contributor-dao`.

## Automated verification

- **Application & DAO test suite:** `pnpm exec vitest run --maxWorkers=4` — **138 test files, 619 tests passed**, including:
  - `tests/dao-local.test.ts` (5 tests: governance quorum, upfront reward + agent-fee reservations, challenge window and dispute resolution, job expiry recovery, loopback/origin/nonce HTTP boundary).
  - `tests/dao-wallet.test.ts` (5 tests: mainnet contract refusal, 1-yocto explicit testnet signing, signer account-change guard, failed/unknown receipt rejection, separate token vs native compute funding, 6-decimal NEP-141 metadata check, sparse job pagination).
  - Repaired fixture-free `tests/devnet-portfolio.test.ts` and `tests/route-preview.test.ts`.
- **Public release build & boundary:** `pnpm build` — passed (`tsc --noEmit`, `vite build`, `tsx scripts/check-release-ui.ts` across all 5 client assets; zero demo/test/DAO markers in `dist/web`).
- **Isolated DAO workbench build:** `pnpm dao:build` — passed (`tsc --noEmit` + Vite build into ignored `.local-dev/dao-dist`).
- **NEAR Rust workspace tests:** `cargo test --workspace --locked` — **52 Rust tests passed**, including **20 tests** in `contracts/contributor-dao` covering bucket-separated NEP-141 deposits, recusal, quorum/timing/duplicate-vote/replay checks, policy/agent drift refusal, reservation return on unused/rejected/expired jobs, retryable failed FT transfer callbacks, finalized transfer replay refusal, OutLayer pinned compute dispatch/callbacks, oversized/malformed/late callback handling, and zero-score appeals.
- **DAO contract WASM build:** `pnpm dao:contract:build` — `target/wasm32-unknown-unknown/release/rascals_contributor_dao.wasm` (643 KB, SHA-256 `5cacddda29e2e1d95f26b6298da941b4ef9779fc5a15f1e5c47ca51735d8a28a`).
- **OutLayer WASI worker tests & build:**
  - `cargo test --manifest-path workers/contributor-verdict/Cargo.toml --locked` — **12 integration tests passed** (pinned repository `nvq2309/therascals`, exact merge SHA and rubric hash binding, unknown field refusal, bot/failed/pending CI handling, incomplete evidence fail-closed, deterministic capped scoring).
  - `python3 -m unittest discover -s workers/contributor-verdict/tests -p 'test_*.py'` — **5 attestation-gate tests passed** (fail-closed hosted-response gate and `outlayer-verify` integration check).
  - `pnpm dao:worker:build` — `workers/contributor-verdict/artifacts/ef612d068757a478bb536667e8de3c2dc6091a8e3f382640aa03fe15de1a6380.wasm` (`wasm32-wasip2`, 441 KB, rubric SHA-256 `8795a2e80a870e3549bd55bbe72642d009b1e6bb7a359d8e6d7f0be6dc61b356`).

## Desktop browser walkthrough (`gstack browse`)

Exercised against `pnpm dao:local` (`127.0.0.1:4390`) and `pnpm dao:dev` (`127.0.0.1:5190`) at `1440x900` desktop priority:

1. Disconnected landing view shows explicit choice between **Start local demo** and **Connect testnet wallet** (disabled until a `.testnet` contract ID is entered).
2. Reset local sandbox to zero balances; funded simulated `rewards` (`1,000`) and `agents` (`10`) buckets in Treasury.
3. Proposed, 2-of-3 council voted (`alice.testnet`, `bob.testnet`), advanced sandbox clock (`+1h`), and executed `appoint_agent` (`judge.testnet`, worker hash `ef612d06…1a6380`).
4. Submitted a labelled local fictional PR review request (`nvq2309/therascals#42`), voted as 2 council members, advanced clock, and executed job reservation (`100` max reward + `1` agent fee reserved upfront).
5. Ran the local manual/program verdict (`impact: 5, security: 4, verification: 5, maintenance: 4` → score `93/100`, `93` reserved, `7` returned to `reward_available`).
6. Switched to `observer.testnet`, verified non-member proposal buttons are disabled, challenged the verdict, switched back to council, proposed/voted/executed `resolve_challenge` (`approve: true`).
7. Claimed `93` contributor reward as `builder.testnet` and `1` agent service fee as `judge.testnet`; verified reconciled Treasury (`907` reward available / `93` paid; `9` agent available / `1` paid; `0` reserved/pending).
8. Proposed, voted, advanced clock, and executed an `update_policy` governance proposal.
9. Checked layout overflow (`scrollWidth - innerWidth = 0`) at `1280px`, `1440px`, `1920px`, and `390px`, with **0 browser console errors**. Private screenshots stored under ignored `.local-dev/dao-evidence/`.

## Unverified / out-of-scope boundaries

- No NEAR testnet or mainnet contract deployment, token minting, OutLayer provider upload, or live wallet transaction was executed.
- Local demo verdicts are simulated program assessments on loopback state, not GitHub-verified merges or hardware-attested TEE proofs.
- Live fee collection/conversion into DAO token budgets and GitHub-to-wallet identity cryptography remain future protocol work.


## November 4 — local main-navigation integration

Owner requested DAO as a tab in the original product, with the existing theme and mascots. The local main app at `http://127.0.0.1:5177/#dao` now keeps the arcade header/navigation and renders the isolated DAO workbench inline. Its duplicate header is hidden in embedded mode. It reuses the original `RascalMark`, mascot artwork, fonts, paper/grid palette and outlined controls. Trading-only help and mainnet footer text do not appear on the DAO tab.

This navigation entry is development-only while DAO contains the explicitly local simulator. Public release assets remain free of simulator code; no website deployment occurred. Both local UI servers and the existing loopback DAO API are required. Existing local walkthrough state was preserved.

Verification: 619 application tests across 138 files pass; DAO build and public production build/release-boundary check pass. gstack desktop Chromium at 1440 px verifies the active DAO tab and embedded interface with no horizontal overflow or console errors. Starting the local sandbox and navigating to Proposals work. Screenshot: ignored `.local-dev/dao-qa/integrated-navigation.png`.


## November 4 — deployed testnet program

The DAO tab no longer offers a local simulator. It autoloads `v2.rascals-dao-1104.testnet`, with Programs selected initially. The reward and agent buckets hold 1,000 and 10 real six-decimal TEST-USDC testnet tokens. Two governance votes and finalized execution appointed `rascals-judge-1104.testnet`; Programs displays **Funded · accepting reviews**. No merged PRs exist in the repository; jobs and paid awards remain zero.

Independent FastNEAR testnet reads matched the deployed code hash to the built WASM and verified config/treasury/proposal. Browser checks: no Local Demo/reset/advance buttons, real NEAR TESTNET state, funded program, no horizontal overflow at 1440 px and no console errors. 619 app tests, 20 contract tests, both builds and public release boundary pass. No mainnet spend or website deployment. Live OutLayer remains unconfigured and unverified. See deployment report and sanitized receipts.
