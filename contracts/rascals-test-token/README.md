# Rascals Test Token (`RASCALS-TEST`)

Dedicated NEP-141 testnet token crate for **`rewards.rascals-council2-1104.testnet`**, prepared as a storage-compatible metadata rename of [`contracts/demo-usdc`](../demo-usdc).

- **Token metadata**: `name = "RASCALS-TEST"`, `symbol = "RASCALS-TEST"`, `decimals = 6`
- **Economic status**: Testnet-only accounting token with **no monetary value**
- **Deployment status**: Redeployed and verified on NEAR testnet November 11, 2026. [Deployment transaction](https://testnet.nearblocks.io/txns/3PqBzD4AgQxiBc55wYH3YVnTW3QeZpz8qdQRVCP2XQ4y). Code hash: `5FbhxMhypS1kNBvM7M4iB8cTsbX4XP58uih8otKgrJU1`. Every token storage record, supply, balances and DAO references were preserved.

## Target Account & Untouched Fee Asset

- **Target account for this crate**: `rewards.rascals-council2-1104.testnet` (used by the contributor DAO reward and agent budgets on NEAR Testnet).
- **Fee token remains untouched**: `usdc.rascals-fees-80f33cf4.testnet` continues to use [`contracts/demo-usdc`](../demo-usdc) (`symbol = "TEST-USDC"`, `name = "Rascals TEST USDC (no value)"`) and is not modified by this crate.

## State-Preserving Deployment (No `new()` Call)

`rewards.rascals-council2-1104.testnet` already holds live NEP-141 contract state (`STATE`) initialized with:

- Single contract field `token: FungibleToken` using storage prefix `b"t"`
- Initial total supply of `1_000_000_000_000` atomic units (`1,000,000.000000` tokens at 6 decimals)
- Existing account storage registrations and token balances (including the DAO treasury and contributor accounts)

Because `RascalsTestToken` preserves the exact Borsh `STATE` layout (`token: FungibleToken`) and storage prefix (`b"t"`), upgrading `rewards.rascals-council2-1104.testnet` must be performed as a **code-only deployment (`DeployContract` action without an initialization function call)**:

1. Build the WASM binary from `contracts/rascals-test-token`.
2. Deploy the WASM binary to `rewards.rascals-council2-1104.testnet` **without calling `new()`**.
3. Verify `ft_metadata`, `ft_total_supply`, `ft_balance_of`, and `storage_balance_of` on `rewards.rascals-council2-1104.testnet`.

`new(owner_id)` remains `#[init]`-only for first-time initialization on an uninitialized `.testnet` account and panics if `STATE` already exists (`env::state_exists()`). No admin, mint, burn, or custom migration methods are added.

## Access Keys & Governance Posture

`rewards.rascals-council2-1104.testnet` retains full-access keys on NEAR Testnet, which is what permits an in-place WASM code replacement. **Do not claim contract immutability** for `rewards.rascals-council2-1104.testnet` while full-access keys remain on the account.
