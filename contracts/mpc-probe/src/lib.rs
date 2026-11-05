use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise};
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Probe {
    owner: AccountId,
    source: [u8; 32],
    recipient: [u8; 32],
    path: String,
}
fn decode(s: &str) -> [u8; 32] {
    bs58::decode(s)
        .into_vec()
        .expect("Invalid base58")
        .try_into()
        .expect("Expected 32 bytes")
}
pub fn validate_transfer(caller: &str, owner: &str, amount: u64) -> Result<(), &'static str> {
    if caller != owner {
        return Err("Owner only");
    };
    if amount == 0 || amount > 10_000 {
        return Err("Transfer must be 1..10000 lamports");
    };
    Ok(())
}
pub fn transfer_message(
    source: [u8; 32],
    recipient: [u8; 32],
    blockhash: [u8; 32],
    amount: u64,
) -> Vec<u8> {
    let mut m = vec![1, 0, 1, 3];
    m.extend(source);
    m.extend(recipient);
    m.extend([0u8; 32]);
    m.extend(blockhash);
    m.extend([1, 2, 2, 0, 1, 12]);
    m.extend(2u32.to_le_bytes());
    m.extend(amount.to_le_bytes());
    m
}
#[near]
impl Probe {
    #[init]
    pub fn new(owner: AccountId, source: String, recipient: String, path: String) -> Self {
        assert!(path.starts_with("jackpot/probe/"));
        Self {
            owner,
            source: decode(&source),
            recipient: decode(&recipient),
            path,
        }
    }
    pub fn sign_transfer(&self, blockhash: String, amount: u64) -> Promise {
        validate_transfer(
            env::predecessor_account_id().as_str(),
            self.owner.as_str(),
            amount,
        )
        .expect("Transfer policy rejected");
        let message = transfer_message(self.source, self.recipient, decode(&blockhash), amount);
        let args = near_sdk::serde_json::json!({"request":{"path":self.path,"payload_v2":{"Eddsa":hex::encode(message)},"domain_id":1}});
        Promise::new("v1.signer-prod.testnet".parse().unwrap()).function_call(
            "sign",
            near_sdk::serde_json::to_vec(&args).unwrap(),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(100),
        )
    }
    pub fn config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"owner":self.owner,"source":bs58::encode(self.source).into_string(),"recipient":bs58::encode(self.recipient).into_string(),"path":self.path})
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transfer_policy() {
        assert!(validate_transfer("attacker.testnet", "owner.testnet", 1000).is_err());
        assert!(validate_transfer("owner.testnet", "owner.testnet", 10001).is_err());
        assert!(validate_transfer("owner.testnet", "owner.testnet", 10000).is_ok());
    }
    #[test]
    fn canonical_transfer() {
        let m = transfer_message([1; 32], [2; 32], [3; 32], 10000);
        assert_eq!(m.len(), 150);
        assert_eq!(&m[..4], &[1, 0, 1, 3]);
        assert_eq!(&m[36..68], &[2; 32]);
        assert_eq!(&m[138..142], &2u32.to_le_bytes());
        assert_eq!(&m[142..], &10000u64.to_le_bytes());
    }
    #[test]
    fn recipient_is_fixed() {
        let p = Probe {
            owner: "owner.testnet".parse().unwrap(),
            source: [1; 32],
            recipient: [2; 32],
            path: "jackpot/probe/v1".into(),
        };
        let m = transfer_message(p.source, p.recipient, [3; 32], 1);
        assert_ne!(&m[36..68], &[4; 32]);
        assert_eq!(&m[36..68], &p.recipient);
    }
}
