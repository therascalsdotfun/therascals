# Real repository PR reward acceptance — NEAR testnet

Completed: 2026-11-04T11:05:56.710Z.

Example: [PR #1](https://github.com/nvq2309/therascals/pull/1) merged into the dedicated `test-reward` branch at `996c2761265359ed9b1acce256c045d9307199aa`. The PR fixes private-fixture dependencies in two regression tests. `main` remains at `4fe98c648e1d9c2e48f768435863388e7352fbc3`.

## Verified result

- DAO: `v2.rascals-dao-1104.testnet`; review job `1`.
- Program score: **40/100**.
- Contributor: `rascals-builder-1104.testnet`; **40 TEST-USDC test tokens received**, confirmed by finalized FT balance delta.
- Verdict agent: `rascals-judge-1104.testnet`; **1 test token service fee received**.
- DAO token custody: 969 tokens, matching available reward 960 plus available agent-service 9; all pending/reserved balances zero.
- On-chain job marks both contributor and agent claims paid.

## Real evidence, explicit trust boundary

The native deterministic worker fetched the actual private GitHub PR, changed files and passing CI check runs using existing account access. The exact merge SHA, repository, PR, job, beneficiary, worker/rubric hashes and evidence digest were bound to the on-chain result. This was a trusted-agent submission after a native run; it was **not hosted OutLayer execution or independently verified TEE attestation**. The score is the disclosed heuristic, not an objective importance audit.

Only faucet-funded testnet accounts and tokens were used. The PR author is the repository owner, while the beneficiary is a dedicated assistant-controlled test account for this acceptance run. This is not a real contributor compensation award or production token entitlement.

## Governance and negative tests

Two council votes authorized the PR review; the five-minute voting window was honored. Before-verdict and early claims were rejected. An explicit acceptance-test challenge was filed; claims remained locked until two council votes upheld the verdict and the second five-minute window ended. The legitimate beneficiary then claimed. No challenge timer was disabled or production policy changed.

- [nonmember-proposal-refused](https://testnet.nearblocks.io/txns/GJkWbzTdymjDqCgNWEoT8nRxS5HM4h6PZvAm5mzAUv8o): rejected as expected.
- [claim-before-verdict-refused](https://testnet.nearblocks.io/txns/D2XSgWRPnxLs5SmvmnC5Cy8uWYZakucENUmA2iqYkbiz): rejected as expected.
- [early-claim-refused](https://testnet.nearblocks.io/txns/4DLV32K3NHa3PbnJ1VmmrTyLiWKLfjv5JbtSJu9y1aeS): rejected as expected.
- [disputed-claim-refused](https://testnet.nearblocks.io/txns/DP6ZFgZVJQEmM7uAi9aiqLDFFTtXXAJyq7HP4RUPwQ2c): rejected as expected.
- [wrong-beneficiary-refused](https://testnet.nearblocks.io/txns/5ZiiNtvCcNNA96DHkP3z6XzRvCxZtuna83w62fS5wAFE): rejected as expected.
- [duplicate-contributor-claim-refused](https://testnet.nearblocks.io/txns/3AqGnMDMLS3nmeR8mcHcmnDj9XhRCX2xiyjxiB3cw1Zg): rejected as expected.
- [duplicate-agent-claim-refused](https://testnet.nearblocks.io/txns/6KQNvCdvtLYUBFNnh45V3CP2JoihBwhWky1sJKR4h4C6): rejected as expected.

## Payout receipts

- [Contributor payout](https://testnet.nearblocks.io/txns/Ehqq3ayM3BX7TfVqE6kV3JrtijiXqQPM6Aq9imnDs6KX)
- [Agent service fee](https://testnet.nearblocks.io/txns/8sxQC27A1RU5BPJ5ReSErgUmqArNABc95ETYTgtrfo7Z)

## Verification

The PR passed 609 tests across 136 files and the production build locally. GitHub app and contract checks passed for both the PR and its merged commit. Fresh finalized reads through a second FastNEAR endpoint verified SHA binding, paid statuses, both balance deltas, zero pending/reserved balances and DAO custody matching its ledger. All seven negative tests were observed as failed chain transactions; they are successes of the rejection checks, not successful calls.

[Full sanitized chain receipts and finalized verification](reward-test-2026-11-04.json). The local Rascals DAO Reviews tab shows PR #1 as PAID. No credentials, test-wallet secrets or provider tokens are committed.

Do not replay this PR authorization or claims: this PR identity is consumed and both claims are final. Repeat an acceptance run with a new real PR and a separately authorized job.
