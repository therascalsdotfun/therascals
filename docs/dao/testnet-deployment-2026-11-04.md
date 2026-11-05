# Contributor DAO — NEAR testnet deployment

Owner requested removing the Local Demo entry, deploying to testnet, and displaying running programs. The local main app's DAO tab now automatically reads the deployed contract at `v2.rascals-dao-1104.testnet`; wallet connection is separate and every mutation requires a testnet signature. Programs displays the real policy, treasury, appointed judge, authorized review and paid-award counts. No fictional PR or payout is inserted.

## Program

Merged PR rewards targets `nvq2309/therascals`: 1 six-decimal test token per score point, 100 maximum per PR, 1,000 epoch reward budget, 10 epoch agent budget, 1 token service fee, one-hour challenge window and five-minute voting period. Separate funded buckets contain 1,000 reward tokens and 10 agent tokens. Token contract: `rewards.rascals-council2-1104.testnet` (`TEST-USDC`, a faucet-only test asset, not Circle USDC or an issued protocol token). The repository has no merged PRs as checked via GitHub; zero reviews and payouts is expected.

Council uses three existing/dedicated assistant-controlled testnet accounts and a strict 2-of-3 quorum. This is a testing configuration, not decentralized production governance. The appointed agent is the dedicated `rascals-judge-1104.testnet`, with the built deterministic worker and rubric pinned by hash. Private credential files are ignored, never part of frontend assets.

## Execution boundaries

A merged PR does not trigger a payout automatically. Council must authorize its exact merge SHA and beneficiary; an appointed trusted agent submits the bound verdict, then claims follow the challenge/dispute rules. There is no GitHub merge watcher running. No real merged-PR payout has been exercised because the repository has no merged PRs. Live OutLayer worker hosting, encrypted GitHub secret profile, compute dispatch and independently verified attestation remain unconfigured/unverified; compute balance is zero. Unit tests are not proof of hosted OutLayer execution.

## First deployment and recovery

The initial `rascals-dao-1104.testnet` deployed and received test tokens but inherited a one-second unit-test voting period. A vote failed after the window expired. This account and receipts were preserved; no storage or tokens were represented as recovered. A fresh child account `v2.rascals-dao-1104.testnet` was funded using dedicated faucet-only keys and deployed with the five-minute policy. The token account was reused and new deposits funded the active replacement. No mainnet keys/funds or historical trade sessions were used.

The deprecated `rpc.testnet.near.org` returned 429/CORS errors. The UI uses verified testnet RPC `rpc.testnet.fastnear.com`; deployed code was independently matched against the local WASM using `test.rpc.fastnear.com`.

## Evidence and checks

Sanitized chain receipts and final state are in `testnet-deployment-2026-11-04.json`; private working receipts/keys remain ignored under `.local-dev/dao-deploy`. Application suite: 619 tests / 138 files pass. DAO contract: 20 tests pass. DAO build and main production build/release boundary pass. Browser checks verify testnet-only read state, program funding and no demo controls; the original Rascals navigation and mascot remain.
