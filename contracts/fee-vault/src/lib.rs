use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub const FEE_BPS: u128 = 50;
const DENOMINATOR: u128 = 10_000;
const MIN_GROSS: u128 = 1_000_000;
const MAX_GROSS: u128 = 100_000_000;
const MAX_RECEIPTS: u64 = 100_000;

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct FeeMessage {
    pub roll_id: String,
    pub payer: AccountId,
    pub gross_usdc: U128,
}
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct FeeReceipt {
    pub payer: AccountId,
    pub gross_usdc: U128,
    pub fee_usdc: U128,
    pub collected_at_ns: u64,
}
#[near(serializers = [json])]
pub struct VaultView {
    pub owner: AccountId,
    pub usdc_token: AccountId,
    pub settlement_router: AccountId,
    pub fee_bps: u16,
    pub available_usdc: U128,
    pub pending_withdrawal_usdc: U128,
    pub total_collected_usdc: U128,
    pub receipt_count: u64,
    pub paused: bool,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct FeeVault {
    owner: AccountId,
    usdc_token: AccountId,
    settlement_router: AccountId,
    receipts: LookupMap<String, FeeReceipt>,
    available: u128,
    pending: u128,
    collected: u128,
    count: u64,
    paused: bool,
}
fn require(condition: bool, message: &str) {
    if !condition {
        #[cfg(target_arch = "wasm32")]
        env::panic_str(message);
        #[cfg(not(target_arch = "wasm32"))]
        panic!("{}", message);
    }
}
#[near]
impl FeeVault {
    #[init]
    pub fn new(owner: AccountId, usdc_token: AccountId, settlement_router: AccountId) -> Self {
        require(
            env::current_account_id().as_str().ends_with(".testnet"),
            "Testnet-only vault",
        );
        require(
            owner.as_str().ends_with(".testnet")
                && usdc_token.as_str().ends_with(".testnet")
                && settlement_router.as_str().ends_with(".testnet"),
            "Testnet accounts required",
        );
        require(
            usdc_token != env::current_account_id(),
            "Token must be a separate contract",
        );
        Self {
            owner,
            usdc_token,
            settlement_router,
            receipts: LookupMap::new(b"f"),
            available: 0,
            pending: 0,
            collected: 0,
            count: 0,
            paused: false,
        }
    }
    pub fn get_vault(&self) -> VaultView {
        VaultView {
            owner: self.owner.clone(),
            usdc_token: self.usdc_token.clone(),
            settlement_router: self.settlement_router.clone(),
            fee_bps: FEE_BPS as u16,
            available_usdc: U128(self.available),
            pending_withdrawal_usdc: U128(self.pending),
            total_collected_usdc: U128(self.collected),
            receipt_count: self.count,
            paused: self.paused,
        }
    }
    pub fn get_fee(&self, roll_id: String) -> Option<FeeReceipt> {
        self.receipts.get(&roll_id).cloned()
    }
    /// NEP-141 receiver. The immutable router attests completed roll identity.
    /// This contract cannot verify a remote Solana swap by itself.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let refund = PromiseOrValue::Value(amount);
        if env::predecessor_account_id() != self.usdc_token
            || sender_id != self.settlement_router
            || self.paused
            || self.count >= MAX_RECEIPTS
            || msg.len() > 512
        {
            return refund;
        }
        let Ok(message) = near_sdk::serde_json::from_str::<FeeMessage>(&msg) else {
            return refund;
        };
        let valid_id = !message.roll_id.is_empty()
            && message.roll_id.len() <= 96
            && message
                .roll_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b));
        let gross = message.gross_usdc.0;
        if !valid_id
            || !(MIN_GROSS..=MAX_GROSS).contains(&gross)
            || amount.0 != gross * FEE_BPS / DENOMINATOR
            || self.receipts.contains_key(&message.roll_id)
        {
            return refund;
        }
        // Fixed receipt cap bounds storage. A funded deployer supplies storage stake.
        let receipt = FeeReceipt {
            payer: message.payer,
            gross_usdc: message.gross_usdc,
            fee_usdc: amount,
            collected_at_ns: env::block_timestamp(),
        };
        self.receipts.insert(message.roll_id.clone(), receipt);
        self.available = self
            .available
            .checked_add(amount.0)
            .expect("Balance overflow");
        self.collected = self
            .collected
            .checked_add(amount.0)
            .expect("Total overflow");
        self.count += 1;
        env::log_str(&near_sdk::serde_json::json!({"event":"fee_collected","roll_id":message.roll_id,"fee_usdc":amount,"fee_bps":50}).to_string());
        PromiseOrValue::Value(U128(0))
    }
    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }
    #[payable]
    pub fn withdraw(&mut self, receiver_id: AccountId, amount: U128) -> Promise {
        self.assert_owner();
        require(
            amount.0 > 0 && amount.0 <= self.available,
            "Insufficient available USDC",
        );
        require(self.pending == 0, "Withdrawal already pending");
        self.available -= amount.0;
        self.pending = amount.0;
        Promise::new(self.usdc_token.clone()).function_call("ft_transfer", near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"receiver_id":receiver_id,"amount":amount,"memo":"therascals.fun testnet fee vault"})).unwrap(), NearToken::from_yoctonear(1), Gas::from_tgas(15))
            .then(Promise::new(env::current_account_id()).function_call("resolve_withdrawal", near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"amount":amount})).unwrap(), NearToken::from_yoctonear(0), Gas::from_tgas(10)))
    }
    #[private]
    pub fn resolve_withdrawal(
        &mut self,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        require(
            env::predecessor_account_id() == env::current_account_id(),
            "Private callback",
        );
        require(
            self.pending == amount.0 && amount.0 > 0,
            "Withdrawal mismatch",
        );
        self.pending = 0;
        if result.is_err() {
            self.available = self
                .available
                .checked_add(amount.0)
                .expect("Balance overflow");
            return false;
        }
        true
    }
}
impl FeeVault {
    fn assert_owner(&self) {
        require(env::predecessor_account_id() == self.owner, "Owner only");
        require(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "Attach exactly one yoctoNEAR",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    fn account(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn context(predecessor: &str, deposit: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(account("fees.testnet"))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build());
    }
    fn vault() -> FeeVault {
        context("fees.testnet", 0);
        FeeVault::new(
            account("owner.testnet"),
            account("usdc.testnet"),
            account("router.testnet"),
        )
    }
    fn message(id: &str, gross: u128) -> String {
        near_sdk::serde_json::to_string(&FeeMessage {
            roll_id: id.into(),
            payer: account("player.testnet"),
            gross_usdc: U128(gross),
        })
        .unwrap()
    }
    fn receive(v: &mut FeeVault, amount: u128, msg: String) -> u128 {
        match v.ft_on_transfer(account("router.testnet"), U128(amount), msg) {
            PromiseOrValue::Value(n) => n.0,
            _ => panic!("unexpected promise"),
        }
    }
    #[test]
    fn exact_fee_and_duplicate_refund() {
        let mut v = vault();
        context("usdc.testnet", 0);
        assert_eq!(receive(&mut v, 25000, message("roll-1", 5000000)), 0);
        assert_eq!(receive(&mut v, 25000, message("roll-1", 5000000)), 25000);
        assert_eq!(v.get_vault().available_usdc.0, 25000);
        assert_eq!(v.count, 1);
        assert_eq!(v.get_fee("roll-1".into()).unwrap().gross_usdc.0, 5000000);
    }
    #[test]
    fn rejects_wrong_amount_asset_router_and_malformed_payload() {
        let mut v = vault();
        context("wrong.testnet", 0);
        assert_eq!(receive(&mut v, 25000, message("r", 5000000)), 25000);
        context("usdc.testnet", 0);
        assert!(matches!(
            v.ft_on_transfer(
                account("attacker.testnet"),
                U128(25000),
                message("r", 5000000)
            ),
            PromiseOrValue::Value(U128(25000))
        ));
        for (n, msg) in [
            (25001, message("r", 5000000)),
            (25000, "bad".into()),
            (0, message("r", 0)),
            (500001, message("r", 100000001)),
            (25000, message("../bad", 5000000)),
        ] {
            assert_eq!(receive(&mut v, n, msg), n);
        }
        assert_eq!(v.count, 0);
        assert_eq!(v.available, 0);
    }
    #[test]
    fn paused_and_capacity_refund() {
        let mut v = vault();
        context("owner.testnet", 1);
        v.set_paused(true);
        context("usdc.testnet", 0);
        assert_eq!(receive(&mut v, 5000, message("r", 1000000)), 5000);
        v.paused = false;
        v.count = MAX_RECEIPTS;
        assert_eq!(receive(&mut v, 5000, message("r", 1000000)), 5000);
    }
    #[test]
    fn withdrawal_failure_restores_and_success_consumes() {
        let mut v = vault();
        context("usdc.testnet", 0);
        receive(&mut v, 25000, message("r", 5000000));
        context("owner.testnet", 1);
        v.withdraw(account("owner.testnet"), U128(10000));
        assert_eq!(v.available, 15000);
        assert_eq!(v.pending, 10000);
        context("fees.testnet", 0);
        assert!(!v.resolve_withdrawal(U128(10000), Err(PromiseError::Failed)));
        assert_eq!(v.available, 25000);
        assert_eq!(v.pending, 0);
        context("owner.testnet", 1);
        v.withdraw(account("owner.testnet"), U128(25000));
        context("fees.testnet", 0);
        assert!(v.resolve_withdrawal(U128(25000), Ok(())));
        assert_eq!(v.available, 0);
        assert_eq!(v.pending, 0);
        assert_eq!(v.collected, 25000);
    }
    #[test]
    #[should_panic(expected = "Owner only")]
    fn unauthorized_withdrawal() {
        let mut v = vault();
        context("attacker.testnet", 1);
        v.withdraw(account("attacker.testnet"), U128(1));
    }
    #[test]
    #[should_panic(expected = "Withdrawal already pending")]
    fn concurrent_withdrawal_blocked() {
        let mut v = vault();
        v.available = 25000;
        context("owner.testnet", 1);
        v.withdraw(account("owner.testnet"), U128(10000));
        v.withdraw(account("owner.testnet"), U128(10000));
    }
    #[test]
    fn state_roundtrip_preserves_receipts_and_balances() {
        let mut v = vault();
        context("usdc.testnet", 0);
        receive(&mut v, 25000, message("r", 5000000));
        v.receipts.flush();
        env::state_write(&v);
        let restored: FeeVault = env::state_read().unwrap();
        assert_eq!(restored.available, 25000);
        assert!(restored.get_fee("r".into()).is_some());
    }
}
