use near_sdk::serde_json::{json, Value};
use near_sdk::{
    env, json_types::U64, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PublicKey,
};
use std::collections::BTreeMap;
const RAY: &str = "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb";
const TOKEN: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const COMPUTE: &str = "ComputeBudget111111111111111111111111111111";
const SESSION_LIMIT: u64 = 100_000_000;
const DEGEN_ODDS: [(u64, u32); 20] = [
    (1, 2000),
    (2, 1500),
    (3, 1200),
    (4, 1000),
    (5, 800),
    (7, 650),
    (10, 550),
    (12, 450),
    (15, 350),
    (20, 300),
    (25, 250),
    (30, 220),
    (35, 180),
    (40, 150),
    (45, 120),
    (50, 100),
    (60, 75),
    (70, 50),
    (85, 35),
    (100, 20),
];
fn degen_amount(roll: u32) -> u64 {
    assert!(roll < 10000);
    let mut boundary = 0;
    for (dollars, weight) in DEGEN_ODDS {
        boundary += weight;
        if roll < boundary {
            return dollars * 1_000_000;
        }
    }
    reject("Invalid amount distribution")
}
// Separate storage namespace preserves the existing Borsh contract layout.
fn degen_key(draw: u64) -> Vec<u8> {
    let mut key = b"jackpot:degen:v1:".to_vec();
    key.extend(draw.to_le_bytes());
    key
}
fn draw_amount(draw: u64) -> Option<u64> {
    env::storage_read(&degen_key(draw))
        .map(|bytes| u64::from_le_bytes(bytes.try_into().expect("Amount record")))
}
fn key(s: &str) -> [u8; 32] {
    bs58::decode(s)
        .into_vec()
        .expect("base58 key")
        .try_into()
        .expect("32 byte key")
}
fn hx(s: &str) -> [u8; 32] {
    hex::decode(s)
        .expect("hex")
        .try_into()
        .expect("32 byte hash")
}
fn hash(b: &[u8]) -> [u8; 32] {
    env::sha256(b).try_into().unwrap()
}
fn reject(message: &str) -> ! {
    #[cfg(target_arch = "wasm32")]
    env::panic_str(message);
    #[cfg(not(target_arch = "wasm32"))]
    panic!("{}", message)
}
pub fn check_buy(
    authorized: bool,
    used: u64,
    amount: u64,
    expired: bool,
    revoked: bool,
    pending: bool,
) -> Result<u64, &'static str> {
    if !authorized {
        return Err("Unauthorized session key");
    };
    if expired || revoked {
        return Err("New buys disabled");
    };
    if pending {
        return Err("Unresolved operation");
    };
    if !(1_000_000..=SESSION_LIMIT).contains(&amount) {
        return Err("Buy must be 1..100 demo USDC");
    };
    let next = used.checked_add(amount).ok_or("Overflow")?;
    if next > SESSION_LIMIT {
        return Err("Session authorization exhausted");
    };
    Ok(next)
}
#[near(serializers=[json])]
pub struct MarketInput {
    pub id: String,
    pub addresses: Vec<String>,
    pub buy_floor: U64,
    pub sell_floor_divisor: U64,
}
#[near(serializers=[borsh])]
#[derive(Clone)]
pub struct Market {
    id: String,
    keys: Vec<[u8; 32]>,
    buy_floor: u64,
    sell_floor_divisor: u64,
}
#[near(serializers=[borsh])]
#[derive(Clone)]
struct Session {
    id: u64,
    source: [u8; 32],
    usdc_ata: [u8; 32],
    token_atas: Vec<[u8; 32]>,
    session_key: PublicKey,
    issued: u64,
    expires_ms: u64,
    revoked: bool,
    pending: Option<u64>,
    balances: Vec<u64>,
}
#[near(serializers=[borsh])]
#[derive(Clone)]
struct Draw {
    id: u64,
    session: u64,
    source: [u8; 32],
    manifest: [u8; 32],
    market: usize,
    seed: [u8; 32],
    created_ms: u64,
}
#[near(serializers=[borsh])]
#[derive(Clone)]
struct Attempt {
    id: u64,
    session: u64,
    draw: u64,
    buy: bool,
    market: usize,
    amount: u64,
    min_out: u64,
    message: Vec<u8>,
    message_hash: [u8; 32],
    blockhash: [u8; 32],
    last_valid: u64,
    status: String,
    signature: Vec<u8>,
    input: u64,
    output: u64,
    fee: u64,
    evidence: String,
    late_callback: bool,
}
#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MpcSignature {
    scheme: String,
    signature: Vec<u8>,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Jackpot {
    owner: AccountId,
    owner_key: PublicKey,
    settler: AccountId,
    quote_key: [u8; 32],
    markets: Vec<Market>,
    mapping: [u8; 32],
    session: Option<Session>,
    draws: BTreeMap<u64, Draw>,
    attempts: BTreeMap<u64, Attempt>,
    next_session: u64,
    next_draw: u64,
    next_attempt: u64,
}
pub fn swap_message(
    source: [u8; 32],
    usdc_ata: [u8; 32],
    token_ata: [u8; 32],
    market: &Market,
    buy: bool,
    amount: u64,
    min_out: u64,
    blockhash: [u8; 32],
) -> Vec<u8> {
    let k = &market.keys;
    let keys = vec![
        source,
        usdc_ata,
        token_ata,
        k[0],
        k[1],
        k[2],
        k[3],
        k[4],
        k[5],
        k[6],
        k[7],
        key(TOKEN),
        key(RAY),
        key(COMPUTE),
    ];
    let mut b = vec![1, 0, 7, 14];
    for p in keys {
        b.extend(p)
    }
    b.extend(blockhash);
    b.push(2);
    b.extend([13, 0, 5, 2]);
    b.extend(200_000u32.to_le_bytes());
    b.extend([
        12,
        13,
        0,
        7,
        8,
        3,
        if buy { 1 } else { 2 },
        if buy { 2 } else { 1 },
        if buy { 4 } else { 5 },
        if buy { 5 } else { 4 },
        11,
        11,
        if buy { 9 } else { 10 },
        if buy { 10 } else { 9 },
        6,
        24,
    ]);
    b.extend(hex::decode("8fbe5adac41e33de").unwrap());
    b.extend(amount.to_le_bytes());
    b.extend(min_out.to_le_bytes());
    b
}
const FEE_POLICY_KEY: &[u8] = b"rascals:usdc-fee:v1";
fn fee_vault() -> Option<[u8; 32]> {
    env::storage_read(FEE_POLICY_KEY).map(|b| b.try_into().expect("Fee vault address"))
}
pub fn entry_fee(amount: u64) -> u64 {
    ((amount as u128) * 50 / 10000) as u64
}
/// Atomic fixed-fee buy message. The gross budget is consumed once: net swap + SPL transfer.
pub fn fee_swap_message(
    source: [u8; 32],
    usdc_ata: [u8; 32],
    token_ata: [u8; 32],
    market: &Market,
    buy: bool,
    amount: u64,
    min_out: u64,
    blockhash: [u8; 32],
    vault: [u8; 32],
) -> Vec<u8> {
    if !buy {
        return swap_message(
            source, usdc_ata, token_ata, market, buy, amount, min_out, blockhash,
        );
    }
    let k = &market.keys;
    let keys = vec![
        source,
        usdc_ata,
        token_ata,
        k[0],
        k[1],
        k[2],
        k[3],
        vault,
        k[4],
        k[5],
        k[6],
        k[7],
        key(TOKEN),
        key(RAY),
        key(COMPUTE),
    ];
    assert!(
        !keys.iter().enumerate().any(|(i, p)| i != 7 && *p == vault),
        "Fee destination aliases swap account"
    );
    let fee = entry_fee(amount);
    let mut b = vec![1, 0, 7, 15];
    for p in keys {
        b.extend(p);
    }
    b.extend(blockhash);
    b.push(3);
    b.extend([14, 0, 5, 2]);
    b.extend(200_000u32.to_le_bytes());
    b.extend([13, 13, 0, 8, 9, 3, 1, 2, 4, 5, 12, 12, 10, 11, 6, 24]);
    b.extend(hex::decode("8fbe5adac41e33de").unwrap());
    b.extend((amount - fee).to_le_bytes());
    b.extend(min_out.to_le_bytes());
    b.extend([12, 3, 1, 7, 0, 9, 3]);
    b.extend(fee.to_le_bytes());
    b
}
fn quote_bytes(
    sid: u64,
    aid: u64,
    draw: &Draw,
    buy: bool,
    amount: u64,
    min_out: u64,
    blockhash: [u8; 32],
    height: u64,
    slot: u64,
    expires: u64,
    mapping: [u8; 32],
) -> Vec<u8> {
    let mut b = b"JACKPOT_QUOTE_V1".to_vec();
    for n in [sid, aid, draw.id] {
        b.extend(n.to_le_bytes())
    }
    b.extend([draw.market as u8, u8::from(buy)]);
    b.extend(amount.to_le_bytes());
    b.extend(min_out.to_le_bytes());
    b.extend(blockhash);
    for n in [height, slot, expires] {
        b.extend(n.to_le_bytes())
    }
    b.extend(draw.source);
    b.extend(draw.manifest);
    b.extend(mapping);
    b
}
#[near]
impl Jackpot {
    #[init]
    pub fn new(
        owner: AccountId,
        settler: AccountId,
        quote_key: String,
        markets: Vec<MarketInput>,
    ) -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            owner,
            "Owner initialization only"
        );
        assert!(owner.as_str().ends_with(".testnet") && settler.as_str().ends_with(".testnet"));
        assert_eq!(markets.len(), 3);
        let mut list = Vec::new();
        for (i, m) in markets.into_iter().enumerate() {
            assert_eq!(m.id, format!("demo-{}", i + 1));
            assert_eq!(m.addresses.len(), 8);
            let keys: Vec<_> = m.addresses.iter().map(|s| key(s)).collect();
            assert_eq!(keys[5], key("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy"));
            assert_ne!(keys[6], keys[7]);
            assert!(m.buy_floor.0 > 0 && m.sell_floor_divisor.0 > 0);
            list.push(Market {
                id: m.id,
                keys,
                buy_floor: m.buy_floor.0,
                sell_floor_divisor: m.sell_floor_divisor.0,
            })
        }
        let mapping = hash(&near_sdk::borsh::to_vec(&list).unwrap());
        Self {
            owner,
            owner_key: env::signer_account_pk(),
            settler,
            quote_key: key(&quote_key),
            markets: list,
            mapping,
            session: None,
            draws: BTreeMap::new(),
            attempts: BTreeMap::new(),
            next_session: 1,
            next_draw: 1,
            next_attempt: 1,
        }
    }
    /// One-time opt-in on a fresh dedicated testnet deployment, before any session.
    pub fn configure_fee_vault(&mut self, vault_ata: String) -> Value {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet"),
            "Testnet only"
        );
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
        assert!(
            self.session.is_none() && self.attempts.is_empty(),
            "Configure before sessions"
        );
        assert!(fee_vault().is_none(), "Fee vault already configured");
        let address = key(&vault_ata);
        assert!(
            address != [0; 32] && !self.markets.iter().any(|m| m.keys.contains(&address)),
            "Invalid fee destination"
        );
        env::storage_write(FEE_POLICY_KEY, &address);
        self.get_fee_policy()
    }
    pub fn get_fee_policy(&self) -> Value {
        match fee_vault() {
            Some(address) => {
                json!({"version":"usdc-entry-v1","fee_bps":50,"vault_ata":bs58::encode(address).into_string()})
            }
            None => Value::Null,
        }
    }
    pub fn create_session(
        &mut self,
        expected_id: U64,
        source: String,
        usdc_ata: String,
        token_atas: Vec<String>,
        session_key: PublicKey,
    ) -> Value {
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
        assert_eq!(expected_id.0, self.next_session);
        if let Some(s) = &self.session {
            assert!(
                s.pending.is_none() && s.balances.iter().all(|x| *x == 0),
                "Resolve and exit the current session first"
            )
        };
        assert_eq!(token_atas.len(), 3);
        let id = self.next_session;
        self.next_session += 1;
        self.session = Some(Session {
            id,
            source: key(&source),
            usdc_ata: key(&usdc_ata),
            token_atas: token_atas.iter().map(|x| key(x)).collect(),
            session_key,
            issued: 0,
            expires_ms: env::block_timestamp_ms() + 1_800_000,
            revoked: false,
            pending: None,
            balances: vec![0; 3],
        });
        self.get_session()
    }
    pub fn begin_draw(
        &mut self,
        mints: Vec<String>,
        configuration_hash: String,
        created_ms: U64,
        manifest_signature: Vec<u8>,
    ) -> Value {
        let s = self.session.as_ref().expect("No session");
        assert!(self.authorized(s));
        assert!(!s.revoked && env::block_timestamp_ms() < s.expires_ms && s.pending.is_none());
        assert!((2..=32).contains(&mints.len()));
        let keys: Vec<_> = mints.iter().map(|x| key(x)).collect();
        for i in 0..keys.len() {
            assert!(!keys[..i].contains(&keys[i]), "Duplicate mint")
        }
        let now = env::block_timestamp_ms();
        assert!(
            created_ms.0 <= now && now - created_ms.0 <= 15_000,
            "Stale manifest"
        );
        let mut bytes = b"JACKPOT_MANIFEST_V1".to_vec();
        bytes.extend(s.id.to_le_bytes());
        bytes.extend(created_ms.0.to_le_bytes());
        bytes.extend(hx(&configuration_hash));
        bytes.push(keys.len() as u8);
        for k in &keys {
            bytes.extend(k)
        }
        let signature: [u8; 64] = manifest_signature
            .try_into()
            .expect("64-byte manifest signature");
        assert!(
            env::ed25519_verify(&signature, &bytes, &self.quote_key),
            "Manifest authority"
        );
        let manifest = hash(&bytes);
        let id = self.next_draw;
        self.next_draw += 1;
        let mut seed_input = b"jackpot:draw:v1".to_vec();
        seed_input.extend(env::random_seed_array());
        seed_input.extend(s.id.to_le_bytes());
        seed_input.extend(id.to_le_bytes());
        seed_input.extend(manifest);
        let mut seed = hash(&seed_input);
        let max = 1u64 << 32;
        let limit = max - max % (keys.len() as u64);
        let chosen = loop {
            let v = u32::from_be_bytes(seed[..4].try_into().unwrap()) as u64;
            if v < limit {
                break (v % (keys.len() as u64)) as usize;
            }
            seed = hash(&seed)
        };
        let source = keys[chosen];
        let h = hash(&source);
        let market = (u32::from_be_bytes(h[..4].try_into().unwrap()) % 3) as usize;
        let draw = Draw {
            id,
            session: s.id,
            source,
            manifest,
            market,
            seed,
            created_ms: now,
        };
        self.draws.insert(id, draw);
        self.get_draw(U64(id))
    }
    pub fn begin_proximity_draw(
        &mut self,
        mints: Vec<String>,
        configuration_hash: String,
        created_ms: U64,
        manifest_signature: Vec<u8>,
        selected_mint: String,
        release_hash: String,
        selection_signature: Vec<u8>,
    ) -> Value {
        let session = self.session.as_ref().expect("No session");
        let source = key(&selected_mint);
        assert!(
            mints.iter().any(|m| key(m) == source),
            "Selected token outside manifest"
        );
        let mut manifest = b"JACKPOT_MANIFEST_V1".to_vec();
        manifest.extend(session.id.to_le_bytes());
        manifest.extend(created_ms.0.to_le_bytes());
        manifest.extend(hx(&configuration_hash));
        manifest.push(mints.len() as u8);
        for mint in &mints {
            manifest.extend(key(mint));
        }
        let release = hx(&release_hash);
        let mut proof = b"JACKPOT_PROXIMITY_V1".to_vec();
        proof.extend(hash(&manifest));
        proof.extend(source);
        proof.extend(release);
        let signature: [u8; 64] = selection_signature
            .try_into()
            .expect("64-byte selection signature");
        assert!(
            env::ed25519_verify(&signature, &proof, &self.quote_key),
            "Selection authority"
        );
        self.begin_draw(mints, configuration_hash, created_ms, manifest_signature);
        let id = self.next_draw - 1;
        let draw = self.draws.get_mut(&id).expect("Draw");
        draw.source = source;
        let h = hash(&source);
        draw.market = (u32::from_be_bytes(h[..4].try_into().unwrap()) % 3) as usize;
        let mut storage = b"jackpot:proximity:v1:".to_vec();
        storage.extend(id.to_le_bytes());
        env::storage_write(&storage, &release);
        self.get_draw(U64(id))
    }
    pub fn begin_degen_draw(
        &mut self,
        mints: Vec<String>,
        configuration_hash: String,
        created_ms: U64,
        manifest_signature: Vec<u8>,
    ) -> Value {
        let s = self.session.as_ref().expect("No session");
        assert_eq!(
            s.issued, 0,
            "Full degen requires 100 unused demo USDC authorization"
        );
        self.begin_draw(mints, configuration_hash, created_ms, manifest_signature);
        let id = self.next_draw - 1;
        let mut input = b"jackpot:amount:v1".to_vec();
        input.extend(self.draws[&id].seed);
        let mut entropy = hash(&input);
        let limit = (1u64 << 32) - (1u64 << 32) % 10000;
        let roll = loop {
            let value = u32::from_be_bytes(entropy[..4].try_into().unwrap());
            if (value as u64) < limit {
                break value % 10000;
            }
            entropy = hash(&entropy);
        };
        env::storage_write(&degen_key(id), &degen_amount(roll).to_le_bytes());
        self.get_draw(U64(id))
    }
    pub fn authorize_attempt(
        &mut self,
        draw_id: U64,
        expected_attempt: U64,
        amount: U64,
        min_out: U64,
        blockhash: String,
        last_valid: U64,
        observed_slot: U64,
        quote_expires_ms: U64,
        quote_signature: Vec<u8>,
    ) -> Promise {
        self.issue(
            draw_id.0,
            expected_attempt.0,
            true,
            amount.0,
            min_out.0,
            key(&blockhash),
            last_valid.0,
            observed_slot.0,
            quote_expires_ms.0,
            quote_signature,
        )
    }
    pub fn request_exit(
        &mut self,
        draw_id: U64,
        expected_attempt: U64,
        amount: U64,
        min_out: U64,
        blockhash: String,
        last_valid: U64,
        observed_slot: U64,
        quote_expires_ms: U64,
        quote_signature: Vec<u8>,
    ) -> Promise {
        self.issue(
            draw_id.0,
            expected_attempt.0,
            false,
            amount.0,
            min_out.0,
            key(&blockhash),
            last_valid.0,
            observed_slot.0,
            quote_expires_ms.0,
            quote_signature,
        )
    }
    pub fn revoke_session(&mut self) {
        let s = self.session.as_ref().expect("No session");
        assert!(self.authorized(s));
        self.session.as_mut().unwrap().revoked = true
    }
    #[private]
    pub fn on_signature(
        &mut self,
        attempt_id: U64,
        #[callback_result] result: Result<MpcSignature, PromiseError>,
    ) -> Value {
        let a = self.attempts.get_mut(&attempt_id.0).expect("Attempt");
        if a.status != "signing" {
            a.late_callback = true;
            return self.get_attempt(attempt_id);
        };
        let valid = match result {
            Ok(r) => {
                if r.scheme == "Ed25519" && r.signature.len() == 64 {
                    let sig: [u8; 64] = r.signature.as_slice().try_into().unwrap();
                    let source = self.session.as_ref().unwrap().source;
                    if env::ed25519_verify(&sig, &a.message, &source) {
                        a.signature = r.signature;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            Err(_) => false,
        };
        a.status = if valid { "signed" } else { "signing_failed" }.into();
        if !valid {
            let s = self.session.as_mut().unwrap();
            if s.pending == Some(a.id) {
                s.pending = None
            }
        }
        self.get_attempt(attempt_id)
    }
    pub fn reconcile_attempt(
        &mut self,
        attempt_id: U64,
        outcome: String,
        message_hash: String,
        signature: String,
        input: U64,
        output: U64,
        fee: U64,
        evidence: String,
    ) -> Value {
        assert_eq!(
            env::predecessor_account_id(),
            self.settler,
            "Settlement role only"
        );
        assert!(["finalized_success", "finalized_failure", "expired"].contains(&outcome.as_str()));
        let a = self.attempts.get_mut(&attempt_id.0).expect("Attempt");
        assert_eq!(a.message_hash, hx(&message_hash));
        if a.status == outcome {
            return self.get_attempt(attempt_id);
        };
        assert!(a.status == "signed", "Already terminal or still unsigned");
        if a.signature.len() == 64 {
            assert_eq!(bs58::encode(&a.signature).into_string(), signature)
        } else {
            assert!(signature.is_empty())
        };
        if outcome == "finalized_success" {
            assert_eq!(input.0, a.amount);
            assert!(output.0 >= a.min_out);
            let s = self.session.as_mut().unwrap();
            assert_eq!(s.id, a.session);
            if a.buy {
                s.balances[a.market] = s.balances[a.market].checked_add(output.0).unwrap()
            } else {
                s.balances[a.market] = s.balances[a.market].checked_sub(input.0).unwrap()
            }
        }
        a.status = outcome;
        a.input = input.0;
        a.output = output.0;
        a.fee = fee.0;
        a.evidence = evidence;
        let s = self.session.as_mut().unwrap();
        if s.pending == Some(a.id) {
            s.pending = None
        }
        self.get_attempt(attempt_id)
    }
    pub fn get_state(&self) -> Value {
        json!({"fee_policy":self.get_fee_policy(),"owner":self.owner,"settler":self.settler,"mapping_hash":hex::encode(self.mapping),"next_session":self.next_session.to_string(),"next_attempt":self.next_attempt.to_string(),"next_draw":self.next_draw.to_string(),"session":self.get_session(),"policy_version":"full-degen-v1","selection_modes":["random-v1","proximity-v1"],"max_buy":"100000000","session_limit":"100000000"})
    }
    pub fn get_session(&self) -> Value {
        match &self.session {
            None => Value::Null,
            Some(s) => {
                json!({"id":s.id.to_string(),"path":format!("jackpot/session/{}",s.id),"source":bs58::encode(s.source).into_string(),"usdc_ata":bs58::encode(s.usdc_ata).into_string(),"token_atas":s.token_atas.iter().map(|x|bs58::encode(x).into_string()).collect::<Vec<_>>(),"issued":s.issued.to_string(),"expires_ms":s.expires_ms.to_string(),"revoked":s.revoked,"pending":s.pending.map(|x|x.to_string()),"balances":s.balances.iter().map(|x|x.to_string()).collect::<Vec<_>>()})
            }
        }
    }
    pub fn get_draw(&self, draw_id: U64) -> Value {
        let d = self.draws.get(&draw_id.0).expect("Draw");
        let amount = draw_amount(d.id);
        let mut storage = b"jackpot:proximity:v1:".to_vec();
        storage.extend(d.id.to_le_bytes());
        let release = env::storage_read(&storage);
        json!({"selection_policy":if release.is_some(){"proximity-v1"}else{"random-v1"},"release_hash":release.map(hex::encode),"id":d.id.to_string(),"session":d.session.to_string(),"source_mint":bs58::encode(d.source).into_string(),"manifest_hash":hex::encode(d.manifest),"market_index":d.market,"selection_seed":hex::encode(d.seed),"created_ms":d.created_ms.to_string(),"amount_mode":if amount.is_some(){"full_degen"}else{"fixed"},"amount":amount.map(|x|x.to_string()),"amount_odds_version":if amount.is_some(){Some("full-degen-v1")}else{None}})
    }
    pub fn get_attempt(&self, attempt_id: U64) -> Value {
        let a = self.attempts.get(&attempt_id.0).expect("Attempt");
        json!({"protocol_fee":if a.buy {fee_vault().map(|v|json!({"version":"usdc-entry-v1","fee_bps":50,"vault_ata":bs58::encode(v).into_string(),"gross_atomic":a.amount.to_string(),"principal_atomic":(a.amount-entry_fee(a.amount)).to_string(),"fee_atomic":entry_fee(a.amount).to_string(),"collected":a.status=="finalized_success","receipt_trust":"testnet-settler-attestation"}))}else{None},"id":a.id.to_string(),"session":a.session.to_string(),"draw":a.draw.to_string(),"buy":a.buy,"market_index":a.market,"amount":a.amount.to_string(),"min_out":a.min_out.to_string(),"message_hex":hex::encode(&a.message),"message_hash":hex::encode(a.message_hash),"blockhash":bs58::encode(a.blockhash).into_string(),"last_valid":a.last_valid.to_string(),"status":a.status,"signature":if a.signature.is_empty(){String::new()}else{bs58::encode(&a.signature).into_string()},"input":a.input.to_string(),"output":a.output.to_string(),"fee":a.fee.to_string(),"evidence":a.evidence,"late_callback":a.late_callback})
    }
}
impl Jackpot {
    fn authorized(&self, s: &Session) -> bool {
        env::predecessor_account_id() == self.owner
            && env::signer_account_id() == self.owner
            && (env::signer_account_pk() == s.session_key
                || env::signer_account_pk() == self.owner_key)
    }
    fn issue(
        &mut self,
        draw_id: u64,
        id: u64,
        buy: bool,
        amount: u64,
        min_out: u64,
        blockhash: [u8; 32],
        height: u64,
        slot: u64,
        expires: u64,
        quote_signature: Vec<u8>,
    ) -> Promise {
        if id != self.next_attempt {
            reject("Attempt replay")
        }
        if buy {
            assert!(self.attempts.len() < 1000, "Demo buy history bound");
        }
        let d = self.draws.get(&draw_id).expect("Draw").clone();
        let s = self.session.as_ref().expect("No session");
        assert_eq!(d.session, s.id);
        let authorized = self.authorized(s);
        if buy {
            if let Some(selected_amount) = draw_amount(draw_id) {
                assert_eq!(amount, selected_amount, "Amount differs from degen draw");
            }
            check_buy(
                authorized,
                s.issued,
                amount,
                env::block_timestamp_ms() >= s.expires_ms,
                s.revoked,
                s.pending.is_some(),
            )
            .unwrap_or_else(|error| reject(error));
            assert!(
                !self.attempts.values().any(|a| a.draw == draw_id
                    && a.buy
                    && a.status != "signing_failed"
                    && a.status != "finalized_failure"
                    && a.status != "expired"),
                "Draw already authorized"
            )
        } else {
            assert!(
                authorized && s.pending.is_none() && amount > 0 && amount <= s.balances[d.market],
                "Exit policy"
            )
        };
        let now = env::block_timestamp_ms();
        assert!(expires >= now && expires <= now + 30_000, "Quote validity");
        let m = &self.markets[d.market];
        let floor = if buy {
            (amount
                - if fee_vault().is_some() {
                    entry_fee(amount)
                } else {
                    0
                })
            .checked_mul(m.buy_floor)
            .expect("Floor overflow")
        } else {
            amount / m.sell_floor_divisor
        };
        assert!(min_out > 0 && min_out >= floor, "Owner output floor");
        let bytes = quote_bytes(
            s.id,
            id,
            &d,
            buy,
            amount,
            min_out,
            blockhash,
            height,
            slot,
            expires,
            self.mapping,
        );
        let signature: [u8; 64] = quote_signature.try_into().expect("64-byte quote signature");
        assert!(
            env::ed25519_verify(&signature, &bytes, &self.quote_key),
            "Quote authority"
        );
        let message = match fee_vault() {
            Some(vault) => fee_swap_message(
                s.source,
                s.usdc_ata,
                s.token_atas[d.market],
                m,
                buy,
                amount,
                min_out,
                blockhash,
                vault,
            ),
            None => swap_message(
                s.source,
                s.usdc_ata,
                s.token_atas[d.market],
                m,
                buy,
                amount,
                min_out,
                blockhash,
            ),
        };
        let message_hash = hash(&message);
        let sid = s.id;
        let s = self.session.as_mut().unwrap();
        if buy {
            s.issued = s.issued.checked_add(amount).unwrap()
        };
        s.pending = Some(id);
        self.next_attempt += 1;
        self.attempts.insert(
            id,
            Attempt {
                id,
                session: sid,
                draw: draw_id,
                buy,
                market: d.market,
                amount,
                min_out,
                message: message.clone(),
                message_hash,
                blockhash,
                last_valid: height,
                status: "signing".into(),
                signature: Vec::new(),
                input: 0,
                output: 0,
                fee: 0,
                evidence: String::new(),
                late_callback: false,
            },
        );
        let args = json!({"request":{"path":format!("jackpot/session/{}",sid),"payload_v2":{"Eddsa":hex::encode(message)},"domain_id":1}});
        Promise::new("v1.signer-prod.testnet".parse().unwrap())
            .function_call(
                "sign",
                near_sdk::serde_json::to_vec(&args).unwrap(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(100),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_signature",
                near_sdk::serde_json::to_vec(&json!({"attempt_id":id.to_string()})).unwrap(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(35),
            ))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn web3_legacy_bytes_match_in_both_directions() {
        let f: Value = near_sdk::serde_json::from_str(include_str!(
            "../../../tests/fixtures/policy-wire.json"
        ))
        .unwrap();
        let m = Market {
            id: "demo-1".into(),
            keys: f["addresses"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| key(v.as_str().unwrap()))
                .collect(),
            buy_floor: 800,
            sell_floor_divisor: 1250,
        };
        let fee_message = fee_swap_message(
            key(f["source"].as_str().unwrap()),
            key(f["usdcAta"].as_str().unwrap()),
            key(f["tokenAta"].as_str().unwrap()),
            &m,
            true,
            5_000_000,
            4_000_000_000,
            key(f["blockhash"].as_str().unwrap()),
            key(f["feeVaultAta"].as_str().unwrap()),
        );
        assert_eq!(hex::encode(fee_message), f["feeBuyHex"].as_str().unwrap());
        for (buy, min, name) in [
            (true, 4_000_000_000u64, "buyHex"),
            (false, 4000u64, "sellHex"),
        ] {
            let message = swap_message(
                key(f["source"].as_str().unwrap()),
                key(f["usdcAta"].as_str().unwrap()),
                key(f["tokenAta"].as_str().unwrap()),
                &m,
                buy,
                5_000_000,
                min,
                key(f["blockhash"].as_str().unwrap()),
            );
            assert_eq!(hex::encode(message), f[name].as_str().unwrap());
        }
    }
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    fn near_key(n: u8) -> PublicKey {
        format!("ed25519:{}", bs58::encode([n; 32]).into_string())
            .parse()
            .unwrap()
    }
    fn context(account: &str, pk: u8, ms: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("session.owner.testnet".parse().unwrap())
            .predecessor_account_id(account.parse().unwrap())
            .signer_account_id(account.parse().unwrap())
            .signer_account_pk(near_key(pk))
            .block_timestamp(ms * 1_000_000)
            .random_seed([5; 32]);
        testing_env!(b.build());
    }
    fn fixture() -> (Jackpot, SigningKey) {
        context("owner.testnet", 8, 1_000_000);
        let quote = SigningKey::from_bytes(&[7; 32]);
        let inputs = (0..3)
            .map(|i| MarketInput {
                id: format!("demo-{}", i + 1),
                addresses: vec![
                    [1; 32],
                    [2; 32],
                    [3; 32],
                    [4; 32],
                    [5; 32],
                    key("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy"),
                    [6; 32],
                    [7; 32],
                ]
                .iter()
                .map(|x| bs58::encode(x).into_string())
                .collect(),
                buy_floor: U64(800),
                sell_floor_divisor: U64(1250),
            })
            .collect();
        let mut c = Jackpot::new(
            "owner.testnet".parse().unwrap(),
            "settle.owner.testnet".parse().unwrap(),
            bs58::encode(quote.verifying_key().as_bytes()).into_string(),
            inputs,
        );
        let source = SigningKey::from_bytes(&[9; 32]);
        c.create_session(
            U64(1),
            bs58::encode(source.verifying_key().as_bytes()).into_string(),
            bs58::encode([11; 32]).into_string(),
            (12..15)
                .map(|i| bs58::encode([i; 32]).into_string())
                .collect(),
            near_key(10),
        );
        let mut bytes = b"JACKPOT_MANIFEST_V1".to_vec();
        bytes.extend(1u64.to_le_bytes());
        bytes.extend(1_000_000u64.to_le_bytes());
        bytes.extend([0; 32]);
        bytes.push(2);
        bytes.extend([21; 32]);
        bytes.extend([22; 32]);
        c.begin_draw(
            vec![
                bs58::encode([21; 32]).into_string(),
                bs58::encode([22; 32]).into_string(),
            ],
            hex::encode([0; 32]),
            U64(1_000_000),
            quote.sign(&bytes).to_bytes().to_vec(),
        );
        (c, quote)
    }
    #[test]
    fn fixed_fee_math_and_policy_are_persisted_without_changing_legacy_layout() {
        let (mut c, _) = fixture();
        c.session = None;
        assert_eq!(entry_fee(5_000_000), 25_000);
        assert_eq!(
            entry_fee(u64::MAX),
            ((u64::MAX as u128) * 50 / 10000) as u64
        );
        assert!(c.get_fee_policy().is_null());
        c.configure_fee_vault(bs58::encode([99; 32]).into_string());
        assert_eq!(c.get_fee_policy()["fee_bps"], 50);
        env::state_write(&c);
        let restored: Jackpot = env::state_read().unwrap();
        assert_eq!(restored.get_fee_policy(), c.get_fee_policy());
    }
    #[test]
    #[should_panic(expected = "Configure before sessions")]
    fn fee_policy_cannot_change_an_active_session() {
        let (mut c, _) = fixture();
        c.configure_fee_vault(bs58::encode([99; 32]).into_string());
    }
    #[test]
    #[should_panic(expected = "Fee vault already configured")]
    fn fee_destination_is_one_time() {
        let (mut c, _) = fixture();
        c.session = None;
        c.configure_fee_vault(bs58::encode([99; 32]).into_string());
        c.configure_fee_vault(bs58::encode([98; 32]).into_string());
    }
    fn proximity_fixture(c: &mut Jackpot, quote: &SigningKey, tamper: bool) -> Value {
        let mints: Vec<String> = (40u8..42)
            .map(|i| bs58::encode([i; 32]).into_string())
            .collect();
        let mut manifest = b"JACKPOT_MANIFEST_V1".to_vec();
        manifest.extend(1u64.to_le_bytes());
        manifest.extend(1_000_000u64.to_le_bytes());
        manifest.extend([0; 32]);
        manifest.push(2);
        manifest.extend([40; 32]);
        manifest.extend([41; 32]);
        let mut proof = b"JACKPOT_PROXIMITY_V1".to_vec();
        proof.extend(hash(&manifest));
        proof.extend([41; 32]);
        proof.extend([6; 32]);
        c.begin_proximity_draw(
            mints,
            hex::encode([0; 32]),
            U64(1_000_000),
            quote.sign(&manifest).to_bytes().to_vec(),
            bs58::encode(if tamper { [40; 32] } else { [41; 32] }).into_string(),
            hex::encode([6; 32]),
            quote.sign(&proof).to_bytes().to_vec(),
        )
    }
    #[test]
    fn proximity_selection_binds_source_and_release_without_changing_spending_or_old_draws() {
        let (mut c, quote) = fixture();
        let session = c.get_session();
        let old = c.get_draw(U64(1));
        let result = proximity_fixture(&mut c, &quote, false);
        assert_eq!(result["source_mint"], bs58::encode([41; 32]).into_string());
        assert_eq!(result["release_hash"], hex::encode([6; 32]));
        assert_eq!(result["selection_policy"], "proximity-v1");
        assert_eq!(c.get_draw(U64(1)), old);
        assert_eq!(c.get_session(), session);
        assert_eq!(old["selection_policy"], "random-v1");
    }
    #[test]
    #[should_panic(expected = "Selection authority")]
    fn proximity_cannot_substitute_a_different_selected_mint() {
        let (mut c, quote) = fixture();
        proximity_fixture(&mut c, &quote, true);
    }
    #[test]
    fn accepts_32_unique_mints_and_binds_the_full_manifest() {
        let (mut c, quote) = fixture();
        let mints: Vec<String> = (40u8..72)
            .map(|i| bs58::encode([i; 32]).into_string())
            .collect();
        let mut bytes = b"JACKPOT_MANIFEST_V1".to_vec();
        bytes.extend(1u64.to_le_bytes());
        bytes.extend(1_000_000u64.to_le_bytes());
        bytes.extend([0; 32]);
        bytes.push(32);
        for i in 40u8..72 {
            bytes.extend([i; 32]);
        }
        c.begin_draw(
            mints.clone(),
            hex::encode([0; 32]),
            U64(1_000_000),
            quote.sign(&bytes).to_bytes().to_vec(),
        );
        let draw = c.draws.get(&2).unwrap();
        assert!(mints.contains(&bs58::encode(draw.source).into_string()));
        assert_eq!(draw.manifest, hash(&bytes));
    }
    #[test]
    #[should_panic]
    fn rejects_33_mints_before_accepting_a_draw() {
        let (mut c, quote) = fixture();
        let mints = (40u8..73)
            .map(|i| bs58::encode([i; 32]).into_string())
            .collect();
        let mut bytes = b"JACKPOT_MANIFEST_V1".to_vec();
        bytes.extend(1u64.to_le_bytes());
        bytes.extend(1_000_000u64.to_le_bytes());
        bytes.extend([0; 32]);
        bytes.push(33);
        for i in 40u8..73 {
            bytes.extend([i; 32]);
        }
        c.begin_draw(
            mints,
            hex::encode([0; 32]),
            U64(1_000_000),
            quote.sign(&bytes).to_bytes().to_vec(),
        );
    }
    fn issue(c: &mut Jackpot, q: &SigningKey, buy: bool, amount: u64, min: u64) {
        let d = c.draws.get(&1).unwrap().clone();
        let bytes = quote_bytes(
            1,
            c.next_attempt,
            &d,
            buy,
            amount,
            min,
            [31; 32],
            1000,
            900,
            env::block_timestamp_ms() + 15_000,
            c.mapping,
        );
        let p = c.issue(
            1,
            c.next_attempt,
            buy,
            amount,
            min,
            [31; 32],
            1000,
            900,
            env::block_timestamp_ms() + 15_000,
            q.sign(&bytes).to_bytes().to_vec(),
        );
        drop(p);
    }
    #[test]
    fn keys_and_failed_signing_keep_consumed_authorization() {
        let (mut c, q) = fixture();
        context("owner.testnet", 23, 1_000_000);
        assert!(
            !c.authorized(c.session.as_ref().unwrap()),
            "Unregistered owner-account function key must fail"
        );
        context("owner.testnet", 10, 1_000_000);
        issue(&mut c, &q, true, 5_000_000, 4_000_000_000);
        assert_eq!(c.session.as_ref().unwrap().issued, 5_000_000);
        assert_eq!(c.session.as_ref().unwrap().pending, Some(1));
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| issue(
                &mut c,
                &q,
                true,
                5_000_000,
                4_000_000_000
            )))
            .is_err()
        );
        c.on_signature(U64(1), Err(PromiseError::Failed));
        assert_eq!(c.session.as_ref().unwrap().issued, 5_000_000);
        assert_eq!(c.session.as_ref().unwrap().pending, None);
        issue(&mut c, &q, true, 5_000_000, 4_000_000_000);
        assert_eq!(c.session.as_ref().unwrap().issued, 10_000_000);
    }
    #[test]
    fn finalized_settlement_is_idempotent_and_exit_survives_revocation_and_expiry() {
        let (mut c, q) = fixture();
        issue(&mut c, &q, true, 5_000_000, 4_000_000_000);
        let source = SigningKey::from_bytes(&[9; 32]);
        let sig = source.sign(&c.attempts[&1].message).to_bytes().to_vec();
        c.on_signature(
            U64(1),
            Ok(MpcSignature {
                scheme: "Ed25519".into(),
                signature: sig.clone(),
            }),
        );
        let h = hex::encode(c.attempts[&1].message_hash);
        let signature = bs58::encode(&sig).into_string();
        context("owner.testnet", 8, 1_000_000);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.reconcile_attempt(
                U64(1),
                "finalized_success".into(),
                h.clone(),
                signature.clone(),
                U64(5_000_000),
                U64(4_500_000_000),
                U64(5000),
                "evidence".into()
            )))
            .is_err()
        );
        context("settle.owner.testnet", 24, 1_000_000);
        for _ in 0..2 {
            c.reconcile_attempt(
                U64(1),
                "finalized_success".into(),
                h.clone(),
                signature.clone(),
                U64(5_000_000),
                U64(4_500_000_000),
                U64(5000),
                "evidence".into(),
            );
        }
        let i = c.draws[&1].market;
        assert_eq!(c.session.as_ref().unwrap().balances[i], 4_500_000_000);
        context("owner.testnet", 8, 3_000_000);
        c.revoke_session();
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| issue(
                &mut c,
                &q,
                true,
                1_000_000,
                800_000_000
            )))
            .is_err()
        );
        issue(&mut c, &q, false, 4_500_000_000, 3_600_000);
        assert_eq!(c.session.as_ref().unwrap().issued, 5_000_000);
    }
    #[test]
    fn retired_late_callback_cannot_reopen_or_replace_attempt() {
        let (mut c, q) = fixture();
        issue(&mut c, &q, true, 5_000_000, 4_000_000_000);
        let h = hex::encode(c.attempts[&1].message_hash);
        context("settle.owner.testnet", 24, 1_000_000);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.reconcile_attempt(
                U64(1),
                "expired".into(),
                h.clone(),
                String::new(),
                U64(0),
                U64(0),
                U64(0),
                "incomplete-signing".into()
            )))
            .is_err()
        );
        assert_eq!(c.session.as_ref().unwrap().pending, Some(1));
        let source = SigningKey::from_bytes(&[9; 32]);
        let sig = source.sign(&c.attempts[&1].message).to_bytes().to_vec();
        c.on_signature(
            U64(1),
            Ok(MpcSignature {
                scheme: "Ed25519".into(),
                signature: sig.clone(),
            }),
        );
        let encoded = bs58::encode(&sig).into_string();
        c.reconcile_attempt(
            U64(1),
            "expired".into(),
            h,
            encoded,
            U64(0),
            U64(0),
            U64(0),
            "two-rpc-expiry".into(),
        );
        c.on_signature(
            U64(1),
            Ok(MpcSignature {
                scheme: "Ed25519".into(),
                signature: sig.clone(),
            }),
        );
        assert_eq!(c.attempts[&1].status, "expired");
        assert_eq!(c.attempts[&1].signature, sig);
        assert!(c.attempts[&1].late_callback);
        assert_eq!(c.session.as_ref().unwrap().pending, None);
        assert_eq!(c.session.as_ref().unwrap().issued, 5_000_000);
    }
    #[test]
    fn output_floor_and_bad_quote_cannot_issue_signature() {
        let (mut c, q) = fixture();
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| issue(
                &mut c, &q, true, 5_000_000, 1
            )))
            .is_err()
        );
        assert_eq!(c.session.as_ref().unwrap().issued, 0);
        let fake = SigningKey::from_bytes(&[99; 32]);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| issue(
                &mut c,
                &fake,
                true,
                5_000_000,
                4_000_000_000
            )))
            .is_err()
        );
        assert_eq!(c.session.as_ref().unwrap().issued, 0);
    }
    #[test]
    fn history_admission_limit_cannot_disable_exit() {
        let (mut c, q) = fixture();
        issue(&mut c, &q, true, 5_000_000, 4_000_000_000);
        let original = c.attempts.get(&1).unwrap().clone();
        for id in 2..=1000 {
            c.attempts.insert(id, original.clone());
        }
        c.next_attempt = 1001;
        let market = c.draws[&1].market;
        c.session.as_mut().unwrap().pending = None;
        c.session.as_mut().unwrap().balances[market] = 4_500_000_000;
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| issue(
                &mut c,
                &q,
                true,
                1_000_000,
                800_000_000
            )))
            .is_err()
        );
        issue(&mut c, &q, false, 4_500_000_000, 3_600_000);
        assert_eq!(c.session.as_ref().unwrap().pending, Some(1001));
        assert_eq!(c.session.as_ref().unwrap().issued, 5_000_000);
    }
    #[test]
    fn buy_policy() {
        assert!(check_buy(false, 0, 1_000_000, false, false, false).is_err());
        assert!(check_buy(true, 0, 100_000_001, false, false, false).is_err());
        assert!(check_buy(true, 95_000_000, 10_000_000, false, false, false).is_err());
        assert!(check_buy(true, 0, 1_000_000, true, false, false).is_err());
        assert!(check_buy(true, 0, 1_000_000, false, true, false).is_err());
        assert!(check_buy(true, 0, 1_000_000, false, false, true).is_err());
        assert_eq!(
            check_buy(true, 90_000_000, 10_000_000, false, false, false),
            Ok(100_000_000)
        );
    }
    #[test]
    fn full_degen_odds_cover_every_basis_point() {
        let expected = [
            (1, 2000),
            (2, 1500),
            (3, 1200),
            (4, 1000),
            (5, 800),
            (7, 650),
            (10, 550),
            (12, 450),
            (15, 350),
            (20, 300),
            (25, 250),
            (30, 220),
            (35, 180),
            (40, 150),
            (45, 120),
            (50, 100),
            (60, 75),
            (70, 50),
            (85, 35),
            (100, 20),
        ];
        let mut counts = BTreeMap::new();
        for roll in 0..10000 {
            *counts.entry(degen_amount(roll)).or_insert(0) += 1;
        }
        for (dollars, weight) in expected {
            assert_eq!(counts[&(dollars * 1_000_000)], weight);
        }
        assert_eq!(
            check_buy(true, 0, 100_000_000, false, false, false),
            Ok(100_000_000)
        );
    }
    #[test]
    fn full_degen_amount_cannot_be_substituted_even_by_quote_authority() {
        let (mut c, q) = fixture();
        env::storage_write(&degen_key(1), &7_000_000u64.to_le_bytes());
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| issue(
                &mut c,
                &q,
                true,
                5_000_000,
                4_000_000_000
            )))
            .is_err()
        );
        issue(&mut c, &q, true, 7_000_000, 5_600_000_000);
        assert_eq!(c.session.as_ref().unwrap().issued, 7_000_000);
    }
    #[test]
    fn degen_draw_reports_bound_amount_and_preserves_old_draws() {
        let (mut c, q) = fixture();
        let mut bytes = b"JACKPOT_MANIFEST_V1".to_vec();
        bytes.extend(1u64.to_le_bytes());
        bytes.extend(1_000_000u64.to_le_bytes());
        bytes.extend([0; 32]);
        bytes.push(2);
        let mints: Vec<String> = (40u8..42)
            .map(|i| {
                bytes.extend([i; 32]);
                bs58::encode([i; 32]).into_string()
            })
            .collect();
        let result = c.begin_degen_draw(
            mints.clone(),
            hex::encode([0; 32]),
            U64(1_000_000),
            q.sign(&bytes).to_bytes().to_vec(),
        );
        let selected = result["amount"].as_str().unwrap().parse::<u64>().unwrap();
        assert_eq!(result["amount_mode"], "full_degen");
        assert_eq!(result["amount_odds_version"], "full-degen-v1");
        assert!(DEGEN_ODDS.iter().any(|(d, _)| *d * 1_000_000 == selected));
        assert_eq!(draw_amount(2), Some(selected));
        assert_eq!(c.get_draw(U64(1))["amount_mode"], "fixed");
        c.session.as_mut().unwrap().issued = 1_000_000;
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.begin_degen_draw(
                mints,
                hex::encode([0; 32]),
                U64(1_000_000),
                q.sign(&bytes).to_bytes().to_vec()
            )))
            .is_err()
        );
    }
}
