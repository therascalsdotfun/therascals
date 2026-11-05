//! Testnet receipt registry. Trusted recorder verifies source-chain finality;
//! entries are attestations, never bridged USDC or trustless cross-chain proofs.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, PanicOnDefault};
#[near(serializers=[json,borsh])]
#[derive(Clone, PartialEq, Debug)]
pub struct ChainVault {
    pub vault: String,
    pub mint: String,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, PartialEq, Debug)]
pub struct Receipt {
    pub chain: String,
    pub transaction: String,
    pub event_index: u32,
    pub vault: String,
    pub mint: String,
    pub payer: String,
    pub gross_atomic: U128,
    pub fee_atomic: U128,
    pub slot: u64,
    pub evidence_hash: String,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct FeeReceipts {
    recorder: AccountId,
    vaults: LookupMap<String, ChainVault>,
    receipts: LookupMap<Vec<u8>, Receipt>,
    count: u64,
}
fn require(ok: bool, msg: &str) {
    if !ok {
        #[cfg(target_arch = "wasm32")]
        env::panic_str(msg);
        #[cfg(not(target_arch = "wasm32"))]
        panic!("{}", msg);
    }
}
#[near]
impl FeeReceipts {
    #[init]
    pub fn new(recorder: AccountId) -> Self {
        require(
            env::current_account_id().as_str().ends_with(".testnet")
                && recorder.as_str().ends_with(".testnet"),
            "Testnet only",
        );
        Self {
            recorder,
            vaults: LookupMap::new(b"v"),
            receipts: LookupMap::new(b"r"),
            count: 0,
        }
    }
    pub fn register_vault(&mut self, chain: String, vault: String, mint: String) {
        self.authorize();
        require(
            [
                "solana-devnet",
                "base-sepolia",
                "bnb-testnet",
                "near-testnet",
            ]
            .contains(&chain.as_str()),
            "Unsupported test chain",
        );
        require(
            !vault.is_empty() && vault.len() <= 128 && !mint.is_empty() && mint.len() <= 128,
            "Invalid asset identity",
        );
        require(!self.vaults.contains_key(&chain), "Chain vault immutable");
        self.vaults.insert(chain, ChainVault { vault, mint });
    }
    pub fn get_vault(&self, chain: String) -> Option<ChainVault> {
        self.vaults.get(&chain).cloned()
    }
    pub fn record_fee(&mut self, receipt: Receipt) -> bool {
        self.authorize();
        let config = self.vaults.get(&receipt.chain).expect("Unregistered chain");
        require(
            config.vault == receipt.vault && config.mint == receipt.mint,
            "Wrong vault or asset",
        );
        require(
            receipt.gross_atomic.0 >= 1_000_000 && receipt.gross_atomic.0 <= 100_000_000,
            "Demo input 1..100 TEST-USDC",
        );
        require(
            receipt.fee_atomic.0 == receipt.gross_atomic.0 * 50 / 10000,
            "Incorrect fee",
        );
        require(
            receipt.transaction.len() >= 32
                && receipt.transaction.len() <= 128
                && receipt
                    .transaction
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric()),
            "Invalid transaction",
        );
        require(
            !receipt.payer.is_empty() && receipt.payer.len() <= 128 && receipt.slot > 0,
            "Missing payer or finalized slot",
        );
        require(
            receipt.evidence_hash.len() == 64
                && receipt.evidence_hash.bytes().all(|b| b.is_ascii_hexdigit()),
            "Evidence hash required",
        );
        let key = Self::receipt_key(&receipt.chain, &receipt.transaction, receipt.event_index);
        if let Some(prior) = self.receipts.get(&key) {
            require(prior == &receipt, "Receipt conflict");
            return false;
        }
        require(self.count < 100_000, "Receipt capacity");
        self.receipts.insert(key, receipt.clone());
        self.count += 1;
        env::log_str(&near_sdk::serde_json::json!({"event":"source_fee_attested","chain":receipt.chain,"transaction":receipt.transaction,"fee_atomic":receipt.fee_atomic,"trust":"recorder-attestation"}).to_string());
        true
    }
    pub fn get_receipt(
        &self,
        chain: String,
        transaction: String,
        event_index: u32,
    ) -> Option<Receipt> {
        self.receipts
            .get(&Self::receipt_key(&chain, &transaction, event_index))
            .cloned()
    }
    pub fn get_count(&self) -> u64 {
        self.count
    }
}
impl FeeReceipts {
    fn authorize(&self) {
        require(
            env::predecessor_account_id() == self.recorder,
            "Recorder only",
        );
    }
    fn receipt_key(chain: &str, tx: &str, index: u32) -> Vec<u8> {
        env::sha256(&near_sdk::serde_json::to_vec(&(chain, tx, index)).unwrap())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    fn setup() -> FeeReceipts {
        testing_env!(VMContextBuilder::new()
            .current_account_id("receipts.testnet".parse().unwrap())
            .predecessor_account_id("recorder.testnet".parse().unwrap())
            .build());
        let mut c = FeeReceipts::new("recorder.testnet".parse().unwrap());
        c.register_vault("solana-devnet".into(), "vault".into(), "usdc".into());
        c
    }
    fn receipt() -> Receipt {
        Receipt {
            chain: "solana-devnet".into(),
            transaction: "a".repeat(88),
            event_index: 2,
            vault: "vault".into(),
            mint: "usdc".into(),
            payer: "payer".into(),
            gross_atomic: U128(5_000_000),
            fee_atomic: U128(25_000),
            slot: 123,
            evidence_hash: "f".repeat(64),
        }
    }
    #[test]
    fn idempotent_and_persistent() {
        let mut c = setup();
        let r = receipt();
        assert!(c.record_fee(r.clone()));
        assert!(!c.record_fee(r.clone()));
        assert_eq!(c.get_count(), 1);
        c.receipts.flush();
        c.vaults.flush();
        env::state_write(&c);
        let d: FeeReceipts = env::state_read().unwrap();
        assert_eq!(
            d.get_receipt(r.chain.clone(), r.transaction.clone(), 2),
            Some(r)
        );
    }
    #[test]
    #[should_panic(expected = "Incorrect fee")]
    fn rejects_wrong_fee() {
        let mut c = setup();
        let mut r = receipt();
        r.fee_atomic = U128(25001);
        c.record_fee(r);
    }
    #[test]
    #[should_panic(expected = "Receipt conflict")]
    fn rejects_conflicting_retry() {
        let mut c = setup();
        let r = receipt();
        c.record_fee(r.clone());
        let mut changed = r;
        changed.payer = "other".into();
        c.record_fee(changed);
    }
    #[test]
    #[should_panic(expected = "Recorder only")]
    fn rejects_untrusted() {
        let mut c = setup();
        testing_env!(VMContextBuilder::new()
            .current_account_id("receipts.testnet".parse().unwrap())
            .predecessor_account_id("attacker.testnet".parse().unwrap())
            .build());
        c.record_fee(receipt());
    }
    #[test]
    #[should_panic(expected = "Chain vault immutable")]
    fn no_destination_replacement() {
        let mut c = setup();
        c.register_vault("solana-devnet".into(), "other".into(), "usdc".into());
    }
}
