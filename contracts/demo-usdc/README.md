# Faucet-only TEST-USDC

This crate remains the separate fee-test asset at `usdc.rascals-fees-80f33cf4.testnet`. The DAO reward token at `rewards.rascals-council2-1104.testnet` was renamed to **RASCALS-TEST** on November 11, 2026 using the storage-compatible [`rascals-test-token`](../rascals-test-token) crate. Do not deploy this legacy metadata over that reward account or relabel the fee-test asset as the reward token.

Six-decimal NEP-141 demo token for the fee-vault transfer tests. Not Circle USDC; no value; no public mint method. One fixed supply is assigned to the dedicated faucet owner at testnet initialization. Uses near-contract-standards 5.29.1 transfer, resolver and storage implementations.
