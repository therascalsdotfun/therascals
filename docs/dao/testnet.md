# NEAR testnet

Open the deployed program at [therascals.fun/#dao](https://therascals.fun/#dao). The UI displays live contract state; balances and job counts should be read from the contract rather than treated as fixed values.

| Component | Account |
| --- | --- |
| Contributor DAO | [`v2.rascals-dao-1104.testnet`](https://testnet.nearblocks.io/address/v2.rascals-dao-1104.testnet) |
| Reward token | [`rewards.rascals-council2-1104.testnet`](https://testnet.nearblocks.io/address/rewards.rascals-council2-1104.testnet) |
| Appointed verdict agent | [`rascals-judge-1104.testnet`](https://testnet.nearblocks.io/address/rascals-judge-1104.testnet) |

The program uses a 2-of-3 testnet council, one test token per score point, a maximum of 100 per PR, a one-token agent fee, a one-hour challenge period and a five-minute voting period. The token has six decimals. Current policy and available budgets are shown in the UI.

## Public transaction examples

A completed testnet review paid 40 TEST-USDC to the contributor test account and a one-token agent fee:

- [Contributor payment](https://testnet.nearblocks.io/txns/Ehqq3ayM3BX7TfVqE6kV3JrtijiXqQPM6Aq9imnDs6KX)
- [Agent service payment](https://testnet.nearblocks.io/txns/8sxQC27A1RU5BPJ5ReSErgUmqArNABc95ETYTgtrfo7Z)

These are test-token transfers, not production compensation. The recorded verdict came from a trusted deterministic worker; it does not establish hosted OutLayer execution or TEE attestation.

The published source repository is separate from the deployed program's pinned contribution repository. This documentation does not change existing contract jobs, worker configuration or repository bindings. A public-source PR is not automatically eligible for a deployed program reward.

Testnet accounts and tokens are distinct from mainnet. No mainnet DAO reward program or protocol-token entitlement is offered.
