//! Faucet-only six-decimal RASCALS-TEST token (no monetary value). Testnet only.
//! Storage-compatible metadata rename of `contracts/demo-usdc` for in-place
//! code replacement on `rewards.rascals-council2-1104.testnet` without calling `new()`.
use near_contract_standards::fungible_token::{
    core::FungibleTokenCore,
    metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC},
    resolver::FungibleTokenResolver,
    FungibleToken,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RascalsTestToken {
    token: FungibleToken,
}

#[near]
impl RascalsTestToken {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet"),
            "Testnet only"
        );
        assert!(
            !env::state_exists(),
            "The contract has already been initialized"
        );
        let mut token = FungibleToken::new(b"t");
        token.internal_register_account(&owner_id);
        token.internal_deposit(&owner_id, 1_000_000_000_000);
        Self { token }
    }
}

#[near]
impl FungibleTokenCore for RascalsTestToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for RascalsTestToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, _burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used_amount.into()
    }
}

#[near]
impl StorageManagement for RascalsTestToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for RascalsTestToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.into(),
            name: "RASCALS-TEST".into(),
            symbol: "RASCALS-TEST".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};

    /// Exact legacy state layout deployed from `contracts/demo-usdc`.
    #[near(serializers = [borsh])]
    struct LegacyDemoUsdcState {
        token: FungibleToken,
    }

    fn account(id: &str) -> AccountId {
        id.parse().unwrap()
    }

    fn set_context(current: &str, predecessor: &str, deposit_yocto: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(account(current))
            .predecessor_account_id(account(predecessor))
            .signer_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit_yocto))
            .build());
    }

    #[test]
    fn storage_compatible_with_legacy_demo_usdc_state_and_transfers_with_one_yocto() {
        let token_account = "rewards.rascals-council2-1104.testnet";
        let owner = account("rascals-council2-1104.testnet");
        let dao = account("dao.rascals-council2-1104.testnet");
        let contributor = account("alice.testnet");
        let unregistered = account("unregistered.testnet");

        set_context(token_account, owner.as_str(), 0);

        // Construct legacy DemoUsdc state with prefix b"t", 1,000,000 tokens (6 decimals),
        // existing registered accounts, and existing balances.
        let mut legacy_ft = FungibleToken::new(b"t");
        legacy_ft.internal_register_account(&owner);
        legacy_ft.internal_deposit(&owner, 1_000_000_000_000);
        legacy_ft.internal_register_account(&dao);
        legacy_ft.internal_register_account(&contributor);
        legacy_ft.internal_transfer(&owner, &dao, 250_000_000_000, Some("DAO budget".into()));
        legacy_ft.internal_transfer(
            &dao,
            &contributor,
            12_500_000,
            Some("Prior payout".into()),
        );

        let legacy_state = LegacyDemoUsdcState { token: legacy_ft };
        env::state_write(&legacy_state);
        assert!(env::state_exists());

        // Deserialize the stored STATE as the renamed RascalsTestToken contract
        // without calling `new()`.
        let mut upgraded: RascalsTestToken =
            env::state_read().expect("Legacy STATE must deserialize as RascalsTestToken");

        assert_eq!(upgraded.ft_total_supply(), U128(1_000_000_000_000));
        assert_eq!(upgraded.ft_balance_of(owner.clone()), U128(750_000_000_000));
        assert_eq!(upgraded.ft_balance_of(dao.clone()), U128(249_987_500_000));
        assert_eq!(
            upgraded.ft_balance_of(contributor.clone()),
            U128(12_500_000)
        );
        assert_eq!(upgraded.ft_balance_of(unregistered.clone()), U128(0));

        assert!(upgraded.storage_balance_of(owner.clone()).is_some());
        assert!(upgraded.storage_balance_of(dao.clone()).is_some());
        assert!(upgraded.storage_balance_of(contributor.clone()).is_some());
        assert!(upgraded.storage_balance_of(unregistered).is_none());

        // Execute an NEP-141 transfer with 1 yoctoNEAR attached on the upgraded contract.
        set_context(token_account, dao.as_str(), 1);
        upgraded.ft_transfer(
            contributor.clone(),
            U128(7_500_000),
            Some("Post-upgrade reward".into()),
        );
        env::state_write(&upgraded);

        let reloaded: RascalsTestToken = env::state_read().unwrap();
        assert_eq!(reloaded.ft_total_supply(), U128(1_000_000_000_000));
        assert_eq!(reloaded.ft_balance_of(dao), U128(249_980_000_000));
        assert_eq!(reloaded.ft_balance_of(contributor), U128(20_000_000));
    }

    #[test]
    fn metadata_returns_rascals_test_and_does_not_mutate_state() {
        let token_account = "rewards.rascals-council2-1104.testnet";
        let owner = account("rascals-council2-1104.testnet");
        set_context(token_account, owner.as_str(), 0);

        let contract = RascalsTestToken::new(owner.clone());
        env::state_write(&contract);

        let state_before = env::storage_read(b"STATE").expect("STATE must exist");
        let supply_before = contract.ft_total_supply();
        let owner_balance_before = contract.ft_balance_of(owner.clone());

        let meta = contract.ft_metadata();
        assert_eq!(meta.spec, FT_METADATA_SPEC);
        assert_eq!(meta.name, "RASCALS-TEST");
        assert_eq!(meta.symbol, "RASCALS-TEST");
        assert_eq!(meta.decimals, 6);
        assert!(meta.icon.is_none());
        assert!(meta.reference.is_none());
        assert!(meta.reference_hash.is_none());

        let state_after = env::storage_read(b"STATE").expect("STATE must still exist");
        assert_eq!(state_before, state_after);
        assert_eq!(contract.ft_total_supply(), supply_before);
        assert_eq!(contract.ft_balance_of(owner), owner_balance_before);
    }

    #[test]
    fn existing_state_rejects_reinitialization_and_preserves_state() {
        let token_account = "rewards.rascals-council2-1104.testnet";
        let owner = account("rascals-council2-1104.testnet");
        let attacker = account("attacker.testnet");
        set_context(token_account, owner.as_str(), 0);

        let initial = RascalsTestToken::new(owner.clone());
        env::state_write(&initial);

        // On wasm32, the `#[near]` macro's generated `#[init]` wrapper for `new` checks
        // `near_sdk::env::state_exists()` before calling `RascalsTestToken::new` and panics
        // with "The contract has already been initialized". `RascalsTestToken::new` also
        // enforces `!env::state_exists()` directly so unit tests verify the same invariant.
        assert!(env::state_exists());
        let saved_state_bytes = env::storage_read(b"STATE").unwrap();

        let reinit_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            RascalsTestToken::new(attacker.clone())
        }));
        assert!(reinit_result.is_err());

        // Existing STATE and balances remain intact.
        assert_eq!(env::storage_read(b"STATE").unwrap(), saved_state_bytes);
        let preserved: RascalsTestToken = env::state_read().unwrap();
        assert_eq!(preserved.ft_total_supply(), U128(1_000_000_000_000));
        assert_eq!(preserved.ft_balance_of(owner), U128(1_000_000_000_000));
        assert_eq!(preserved.ft_balance_of(attacker), U128(0));
    }

    #[test]
    fn first_deployment_initializes_one_million_tokens_with_six_decimals() {
        let token_account = "rewards.rascals-council2-1104.testnet";
        let owner = account("rascals-council2-1104.testnet");
        set_context(token_account, owner.as_str(), 0);
        assert!(!env::state_exists());

        let contract = RascalsTestToken::new(owner.clone());
        env::state_write(&contract);

        assert!(env::state_exists());
        assert_eq!(contract.ft_total_supply(), U128(1_000_000_000_000));
        assert_eq!(contract.ft_balance_of(owner.clone()), U128(1_000_000_000_000));
        assert!(contract.storage_balance_of(owner).is_some());
        assert_eq!(contract.ft_metadata().decimals, 6);
    }

    #[test]
    #[should_panic(expected = "Testnet only")]
    fn refuses_non_testnet_account_initialization() {
        set_context("rewards.rascals.near", "owner.near", 0);
        let _ = RascalsTestToken::new(account("owner.near"));
    }
}
