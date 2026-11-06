//! Heir: a "dead man's switch" inheritance vault on NEAR.
//!
//! One contract holds many vaults, one per owner account.
//!
//! Lifecycle of a vault:
//!   Active   -> the owner checked in recently.
//!   Grace    -> the check-in period ran out; warnings go out, the owner can still act.
//!   Unlocked -> the grace period ran out too; owner controls stop and heirs can claim.
//!
//! Any owner action (check in, deposit, withdraw, edit heirs, edit periods) counts as a
//! check-in and resets the countdown.
//!
//! Each owner also has an Ethereum address controlled by this contract through NEAR
//! Chain Signatures (derivation path `eth-<owner>`). Only this contract can ask the MPC
//! network to sign for it, so ETH sent there follows the same rules as the NEAR vault.

mod eth;

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

/// Shares are in basis points: 10_000 = 100%, 2_500 = 25%.
pub const BPS_TOTAL: u16 = 10_000;
pub const MAX_HEIRS: usize = 10;
/// Shortest allowed check-in or grace period (1 minute, handy for demos).
pub const MIN_PERIOD_MS: u64 = 60 * 1000;
/// Fixed deposit taken at vault creation to pay for the vault's on-chain storage.
/// It is refunded on cancel, or shared among the heirs once the vault unlocks.
pub const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(50); // 0.05 NEAR

/// The NEAR Chain Signatures (MPC) signer contract on testnet.
pub const MPC_CONTRACT: &str = "v1.signer-prod.testnet";
/// Gas for the MPC `sign` call (it needs >= 15 Tgas) and for our callback.
const MPC_SIGN_GAS: Gas = Gas::from_tgas(50);
const ON_SIGNED_GAS: Gas = Gas::from_tgas(15);
/// Limits on the gas price a caller can pick, so nobody can burn the vault's ETH on fees.
pub const MAX_FEE_PER_GAS: u128 = 200_000_000_000; // 200 gwei
pub const MAX_PRIORITY_FEE_PER_GAS: u128 = 10_000_000_000; // 10 gwei

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Heir {
    pub account_id: AccountId,
    pub share_bps: u16,
}

/// An heir paid in ETH on Ethereum: a fixed amount to a fixed address.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct EthHeir {
    /// Lowercase "0x..." address.
    pub address: String,
    pub amount_wei: U128,
    /// The Ethereum nonce assigned to this heir's payout once it has been signed.
    pub nonce: Option<u64>,
    /// The signed raw transaction ("0x..."), ready to broadcast to Ethereum.
    pub signed_tx: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub enum VaultStatus {
    Active,
    Grace,
    Unlocked,
}

#[near(serializers = [borsh])]
pub struct Vault {
    pub heirs: Vec<Heir>,
    /// NEAR held for the heirs (excludes the storage deposit).
    pub balance: NearToken,
    pub storage_deposit: NearToken,
    pub check_in_period_ms: u64,
    pub grace_period_ms: u64,
    pub last_check_in_ms: u64,
    /// Fixed when the first heir claims, so every share is computed from the same total.
    pub payout_total: Option<NearToken>,
    pub paid_out: NearToken,
    pub claimed: Vec<AccountId>,
    pub eth_heirs: Vec<EthHeir>,
}

impl Vault {
    fn grace_starts_ms(&self) -> u64 {
        self.last_check_in_ms + self.check_in_period_ms
    }

    fn unlocks_ms(&self) -> u64 {
        self.grace_starts_ms() + self.grace_period_ms
    }

    fn status(&self, now_ms: u64) -> VaultStatus {
        if now_ms >= self.unlocks_ms() {
            VaultStatus::Unlocked
        } else if now_ms >= self.grace_starts_ms() {
            VaultStatus::Grace
        } else {
            VaultStatus::Active
        }
    }

    /// Everything the heirs share: the savings plus the storage deposit, which is freed
    /// when the vault record is deleted after the last claim.
    fn distributable(&self) -> NearToken {
        self.payout_total
            .unwrap_or(self.balance.saturating_add(self.storage_deposit))
    }

    fn share_of(&self, heir: &Heir) -> NearToken {
        let total = self.distributable().as_yoctonear();
        NearToken::from_yoctonear(total * heir.share_bps as u128 / BPS_TOTAL as u128)
    }
}

/// Per-owner state for their Ethereum address. Kept even after a vault is deleted, so
/// the nonce stays correct if the owner makes a new vault (same address).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EthAccount {
    /// The next Ethereum nonce to use. Only this contract can sign for the address, so it
    /// knows exactly how many transactions have been signed.
    pub next_nonce: u64,
    /// True while a signature request is in flight. Requests run one at a time so two
    /// payouts can never be signed with the same nonce.
    pub pending: bool,
    /// The most recent signed transaction, for broadcasting or re-broadcasting.
    pub last_signed_tx: Option<String>,
}

/// What view calls return: the vault plus computed status and deadlines.
#[near(serializers = [json])]
pub struct VaultView {
    pub owner: AccountId,
    pub heirs: Vec<Heir>,
    pub eth_heirs: Vec<EthHeir>,
    pub balance: NearToken,
    pub storage_deposit: NearToken,
    pub check_in_period_ms: u64,
    pub grace_period_ms: u64,
    pub last_check_in_ms: u64,
    pub grace_starts_ms: u64,
    pub unlocks_ms: u64,
    pub now_ms: u64,
    pub status: VaultStatus,
    pub claimed: Vec<AccountId>,
    pub paid_out: NearToken,
}

/// What the owner passes in to set an ETH heir.
#[near(serializers = [json])]
pub struct EthHeirInput {
    pub address: String,
    pub amount_wei: U128,
}

/// The ETH transfer we asked the MPC network to sign, passed to the callback.
#[near(serializers = [json])]
pub struct PendingEthTx {
    pub nonce: u64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub to: String,
    pub value: U128,
    /// Set when this is an heir payout (None for an owner withdrawal).
    pub heir_address: Option<String>,
}

// ---------------------------------------------------------------- MPC signer interface

#[near(serializers = [json])]
pub enum MpcPayload {
    Ecdsa(String),
}

#[near(serializers = [json])]
pub struct MpcSignRequest {
    pub path: String,
    pub payload_v2: MpcPayload,
    pub domain_id: u64,
}

#[near(serializers = [json])]
pub struct MpcAffinePoint {
    pub affine_point: String,
}

#[near(serializers = [json])]
pub struct MpcScalar {
    pub scalar: String,
}

/// The signature the MPC network returns for an ECDSA (secp256k1) request.
#[near(serializers = [json])]
pub struct MpcSignature {
    pub big_r: MpcAffinePoint,
    pub s: MpcScalar,
    pub recovery_id: u8,
}

#[allow(dead_code)]
#[ext_contract(ext_mpc)]
trait MpcSigner {
    fn sign(&mut self, request: MpcSignRequest);
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Vaults,
    VaultsByHeir,
    EthAccounts,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    vaults: LookupMap<AccountId, Vault>,
    /// heir account -> owners of the vaults that name them, for the heir claim page.
    vaults_by_heir: LookupMap<AccountId, Vec<AccountId>>,
    eth_accounts: LookupMap<AccountId, EthAccount>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            vaults: LookupMap::new(StorageKey::Vaults),
            vaults_by_heir: LookupMap::new(StorageKey::VaultsByHeir),
            eth_accounts: LookupMap::new(StorageKey::EthAccounts),
        }
    }

    /// One-off upgrade from the first (NEAR-only) version, which had no vaults left.
    /// Only the contract account itself can call it.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        Self::new()
    }

    // ---------------------------------------------------------------- owner actions

    /// Create the caller's vault. Attach at least 0.05 NEAR (storage); anything above
    /// that becomes the vault's starting balance.
    #[payable]
    pub fn create_vault(&mut self, heirs: Vec<Heir>, check_in_period_ms: u64, grace_period_ms: u64) {
        let owner = env::predecessor_account_id();
        require!(!self.vaults.contains_key(&owner), "You already have a vault");
        let attached = env::attached_deposit();
        require!(attached >= STORAGE_DEPOSIT, "Attach at least 0.05 NEAR for storage");
        validate_heirs(&owner, &heirs);
        validate_periods(check_in_period_ms, grace_period_ms);

        self.index_heirs(&owner, &heirs);
        self.vaults.insert(
            owner.clone(),
            Vault {
                heirs,
                balance: attached.saturating_sub(STORAGE_DEPOSIT),
                storage_deposit: STORAGE_DEPOSIT,
                check_in_period_ms,
                grace_period_ms,
                last_check_in_ms: env::block_timestamp_ms(),
                payout_total: None,
                paid_out: NearToken::from_yoctonear(0),
                claimed: vec![],
                eth_heirs: vec![],
            },
        );
        env::log_str(&format!("vault_created owner={owner}"));
    }

    /// "I'm still here." Resets the countdown.
    pub fn check_in(&mut self) {
        self.owner_vault_mut();
        env::log_str(&format!("check_in owner={}", env::predecessor_account_id()));
    }

    /// Add NEAR to the vault.
    #[payable]
    pub fn deposit(&mut self) {
        let attached = env::attached_deposit();
        require!(attached.as_yoctonear() > 0, "Attach some NEAR to deposit");
        let vault = self.owner_vault_mut();
        vault.balance = vault.balance.saturating_add(attached);
    }

    /// Take NEAR out of the vault back to the owner's wallet.
    pub fn withdraw(&mut self, amount: NearToken) -> Promise {
        require!(amount.as_yoctonear() > 0, "Amount must be more than 0");
        let vault = self.owner_vault_mut();
        require!(amount <= vault.balance, "Amount is more than the vault balance");
        vault.balance = vault.balance.saturating_sub(amount);
        // The receiver is the caller, an account that exists, so the transfer can't fail.
        Promise::new(env::predecessor_account_id()).transfer(amount)
    }

    /// Replace the list of NEAR heirs. Shares must add up to 100% (10_000 bps).
    pub fn set_heirs(&mut self, heirs: Vec<Heir>) {
        let owner = env::predecessor_account_id();
        validate_heirs(&owner, &heirs);
        let old_heirs = self.owner_vault_mut().heirs.clone();
        self.unindex_heirs(&owner, &old_heirs);
        self.index_heirs(&owner, &heirs);
        self.owner_vault_mut().heirs = heirs;
    }

    /// Replace the list of ETH heirs: each gets a fixed amount of ETH (in wei) sent to
    /// their Ethereum address once the vault unlocks. Pass [] to remove them all.
    pub fn set_eth_heirs(&mut self, eth_heirs: Vec<EthHeirInput>) {
        require!(eth_heirs.len() <= MAX_HEIRS, "At most 10 ETH heirs");
        let mut parsed: Vec<EthHeir> = Vec::new();
        for input in eth_heirs {
            let address = normalize_address(&input.address);
            require!(input.amount_wei.0 > 0, "Every ETH heir needs an amount above 0");
            require!(
                !parsed.iter().any(|h| h.address == address),
                "Each ETH address can only be listed once"
            );
            parsed.push(EthHeir { address, amount_wei: input.amount_wei, nonce: None, signed_tx: None });
        }
        self.owner_vault_mut().eth_heirs = parsed;
    }

    /// Change how long the owner can stay silent, and how long the grace period lasts.
    pub fn set_periods(&mut self, check_in_period_ms: u64, grace_period_ms: u64) {
        validate_periods(check_in_period_ms, grace_period_ms);
        let vault = self.owner_vault_mut();
        vault.check_in_period_ms = check_in_period_ms;
        vault.grace_period_ms = grace_period_ms;
    }

    /// Close the vault and send all its NEAR (balance + storage deposit) back to the
    /// owner. ETH stays at the owner's Ethereum address; use `withdraw_eth` for it.
    pub fn cancel(&mut self) -> Promise {
        let owner = env::predecessor_account_id();
        self.owner_vault_mut(); // checks the vault exists and is not unlocked
        let vault = self.vaults.remove(&owner).unwrap();
        self.unindex_heirs(&owner, &vault.heirs);
        env::log_str(&format!("vault_cancelled owner={owner}"));
        Promise::new(owner).transfer(vault.balance.saturating_add(vault.storage_deposit))
    }

    /// Owner: sign a transfer of ETH from the owner's vault address to `to`. Works while
    /// the vault is not unlocked, or when the owner has no vault. Returns the signed
    /// transaction, which the website then broadcasts to Ethereum.
    pub fn withdraw_eth(
        &mut self,
        to: String,
        amount_wei: U128,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
    ) -> Promise {
        let owner = env::predecessor_account_id();
        if self.vaults.contains_key(&owner) {
            self.owner_vault_mut(); // must not be unlocked; also counts as a check-in
        }
        require!(amount_wei.0 > 0, "Amount must be more than 0");
        let to = normalize_address(&to);
        let nonce = self.eth_accounts.get(&owner).map(|a| a.next_nonce).unwrap_or(0);
        self.request_eth_signature(
            owner,
            PendingEthTx { nonce, max_fee_per_gas, max_priority_fee_per_gas, to, value: amount_wei, heir_address: None },
        )
    }

    // ---------------------------------------------------------------- heir actions

    /// Claim the caller's share of an unlocked vault.
    pub fn claim(&mut self, owner: AccountId) -> Promise {
        let heir_id = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let vault = self.vaults.get_mut(&owner).unwrap_or_else(|| env::panic_str("Vault not found"));
        require!(vault.status(now) == VaultStatus::Unlocked, "Vault is not unlocked yet");
        let heir = vault
            .heirs
            .iter()
            .find(|h| h.account_id == heir_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("You are not an heir of this vault"));
        require!(!vault.claimed.contains(&heir_id), "You already claimed");

        // First claim: freeze the total so every share is computed from the same number.
        if vault.payout_total.is_none() {
            vault.payout_total = Some(vault.distributable());
        }
        vault.claimed.push(heir_id.clone());
        let is_last = vault.claimed.len() == vault.heirs.len();
        // The last heir also gets any rounding dust, so the vault ends at exactly zero.
        let amount = if is_last {
            vault.distributable().saturating_sub(vault.paid_out)
        } else {
            vault.share_of(&heir)
        };
        vault.paid_out = vault.paid_out.saturating_add(amount);
        // A vault with ETH heirs is kept as the record of their payouts.
        let delete = is_last && vault.eth_heirs.is_empty();

        if delete {
            let vault = self.vaults.remove(&owner).unwrap();
            self.unindex_heirs(&owner, &vault.heirs);
            env::log_str(&format!("vault_settled owner={owner}"));
        }
        env::log_str(&format!("claim owner={owner} heir={heir_id} amount={amount}"));
        Promise::new(heir_id).transfer(amount)
    }

    /// Anyone (the heir, a relayer, a friend) can trigger an ETH heir's payout once the
    /// vault has unlocked. The contract fixes the recipient, amount and chain; the caller
    /// only picks the gas price (within limits). Calling again re-signs the same payout
    /// with the same nonce, e.g. with a higher gas price, so it can only ever be paid once.
    /// Attach 150 Tgas. The contract pays the MPC network's 1 yoctoNEAR fee itself.
    pub fn release_eth(
        &mut self,
        owner: AccountId,
        address: String,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
    ) -> Promise {
        let address = normalize_address(&address);
        let now = env::block_timestamp_ms();
        let vault = self.vaults.get(&owner).unwrap_or_else(|| env::panic_str("Vault not found"));
        require!(vault.status(now) == VaultStatus::Unlocked, "Vault is not unlocked yet");
        let heir = vault
            .eth_heirs
            .iter()
            .find(|h| h.address == address)
            .unwrap_or_else(|| env::panic_str("That address is not an ETH heir of this vault"));
        let next_nonce = self.eth_accounts.get(&owner).map(|a| a.next_nonce).unwrap_or(0);
        let nonce = heir.nonce.unwrap_or(next_nonce);
        let value = heir.amount_wei;
        self.request_eth_signature(
            owner,
            PendingEthTx {
                nonce,
                max_fee_per_gas,
                max_priority_fee_per_gas,
                to: address.clone(),
                value,
                heir_address: Some(address),
            },
        )
    }

    // ---------------------------------------------------------------- callbacks

    /// Runs when the MPC network answers. Builds the signed Ethereum transaction and
    /// records it. Returns it as "0x..." hex.
    #[private]
    pub fn on_eth_signed(
        &mut self,
        owner: AccountId,
        tx: PendingEthTx,
        #[callback_result] signature: Result<MpcSignature, PromiseError>,
    ) -> Option<String> {
        let mut account = self.eth_accounts.get(&owner).cloned().unwrap_or_default();
        account.pending = false;

        let Ok(signature) = signature else {
            env::log_str("eth_sign_failed: the MPC network did not return a signature");
            self.eth_accounts.insert(owner, account);
            return None;
        };

        let signed_tx = format!("0x{}", hex::encode(build_signed_tx(&tx, &signature)));

        // A fresh nonce was used: move the counter forward.
        if tx.nonce == account.next_nonce {
            account.next_nonce += 1;
        }
        account.last_signed_tx = Some(signed_tx.clone());
        self.eth_accounts.insert(owner.clone(), account);

        if let Some(heir_address) = &tx.heir_address {
            if let Some(vault) = self.vaults.get_mut(&owner) {
                if let Some(heir) = vault.eth_heirs.iter_mut().find(|h| &h.address == heir_address) {
                    heir.nonce = Some(tx.nonce);
                    heir.signed_tx = Some(signed_tx.clone());
                }
            }
        }
        env::log_str(&format!(
            "eth_signed owner={owner} to={} value={} nonce={} tx={signed_tx}",
            tx.to, tx.value.0, tx.nonce
        ));
        Some(signed_tx)
    }

    // ---------------------------------------------------------------- views

    pub fn get_vault(&self, owner: AccountId) -> Option<VaultView> {
        let now = env::block_timestamp_ms();
        self.vaults.get(&owner).map(|v| VaultView {
            owner: owner.clone(),
            heirs: v.heirs.clone(),
            eth_heirs: v.eth_heirs.clone(),
            balance: v.balance,
            storage_deposit: v.storage_deposit,
            check_in_period_ms: v.check_in_period_ms,
            grace_period_ms: v.grace_period_ms,
            last_check_in_ms: v.last_check_in_ms,
            grace_starts_ms: v.grace_starts_ms(),
            unlocks_ms: v.unlocks_ms(),
            now_ms: now,
            status: v.status(now),
            claimed: v.claimed.clone(),
            paid_out: v.paid_out,
        })
    }

    /// Owners of the vaults that name `heir` as an heir.
    pub fn get_vaults_for_heir(&self, heir: AccountId) -> Vec<AccountId> {
        self.vaults_by_heir.get(&heir).cloned().unwrap_or_default()
    }

    /// How much `heir` would receive from `owner`'s vault if it unlocked now.
    pub fn get_claimable(&self, owner: AccountId, heir: AccountId) -> NearToken {
        let zero = NearToken::from_yoctonear(0);
        let Some(vault) = self.vaults.get(&owner) else { return zero };
        if vault.claimed.contains(&heir) {
            return zero;
        }
        match vault.heirs.iter().find(|h| h.account_id == heir) {
            Some(h) => vault.share_of(h),
            None => zero,
        }
    }

    /// The Chain Signatures derivation path of `owner`'s Ethereum address. The address
    /// itself is derived off-chain from (this contract's account, this path).
    pub fn get_eth_path(&self, owner: AccountId) -> String {
        eth_path(&owner)
    }

    pub fn get_eth_account(&self, owner: AccountId) -> EthAccount {
        self.eth_accounts.get(&owner).cloned().unwrap_or_default()
    }

    // ---------------------------------------------------------------- internal

    /// The caller's vault, for an owner action. Panics if it doesn't exist or has
    /// unlocked. Records a check-in, because any owner action proves they're alive.
    fn owner_vault_mut(&mut self) -> &mut Vault {
        let owner = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let vault = self
            .vaults
            .get_mut(&owner)
            .unwrap_or_else(|| env::panic_str("You don't have a vault"));
        require!(
            vault.status(now) != VaultStatus::Unlocked,
            "Vault has unlocked; it now belongs to the heirs"
        );
        vault.last_check_in_ms = now;
        vault
    }

    /// Ask the MPC network to sign `tx` with `owner`'s Ethereum key, then `on_eth_signed`.
    fn request_eth_signature(&mut self, owner: AccountId, tx: PendingEthTx) -> Promise {
        require!(tx.max_fee_per_gas.0 <= MAX_FEE_PER_GAS, "max_fee_per_gas is above 200 gwei");
        require!(
            tx.max_priority_fee_per_gas.0 <= MAX_PRIORITY_FEE_PER_GAS,
            "max_priority_fee_per_gas is above 10 gwei"
        );
        require!(
            tx.max_priority_fee_per_gas.0 <= tx.max_fee_per_gas.0,
            "max_priority_fee_per_gas can't be above max_fee_per_gas"
        );
        require!(
            env::prepaid_gas().saturating_sub(env::used_gas()) >= Gas::from_tgas(100),
            "Attach at least 150 Tgas"
        );

        let account = self.eth_accounts.entry(owner.clone()).or_default();
        require!(!account.pending, "Another ETH signature is in progress; try again shortly");
        account.pending = true;

        let hash = transfer_from(&tx).signing_hash();
        ext_mpc::ext(MPC_CONTRACT.parse().unwrap())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(MPC_SIGN_GAS)
            .sign(MpcSignRequest {
                path: eth_path(&owner),
                payload_v2: MpcPayload::Ecdsa(hex::encode(hash)),
                domain_id: 0,
            })
            .then(Self::ext(env::current_account_id()).with_static_gas(ON_SIGNED_GAS).on_eth_signed(owner, tx))
    }

    fn index_heirs(&mut self, owner: &AccountId, heirs: &[Heir]) {
        for heir in heirs {
            let owners = self.vaults_by_heir.entry(heir.account_id.clone()).or_default();
            if !owners.contains(owner) {
                owners.push(owner.clone());
            }
        }
    }

    fn unindex_heirs(&mut self, owner: &AccountId, heirs: &[Heir]) {
        for heir in heirs {
            if let Some(owners) = self.vaults_by_heir.get_mut(&heir.account_id) {
                owners.retain(|o| o != owner);
                if owners.is_empty() {
                    self.vaults_by_heir.remove(&heir.account_id);
                }
            }
        }
    }
}

fn eth_path(owner: &AccountId) -> String {
    format!("eth-{owner}")
}

/// Validate an Ethereum address and return it in lowercase.
fn normalize_address(address: &str) -> String {
    let bytes = eth::parse_address(address).unwrap_or_else(|e| env::panic_str(e));
    format!("0x{}", hex::encode(bytes))
}

fn transfer_from(tx: &PendingEthTx) -> eth::EthTransfer {
    eth::EthTransfer {
        chain_id: eth::SEPOLIA_CHAIN_ID,
        nonce: tx.nonce,
        max_priority_fee_per_gas: tx.max_priority_fee_per_gas.0,
        max_fee_per_gas: tx.max_fee_per_gas.0,
        to: eth::parse_address(&tx.to).unwrap(),
        value: tx.value.0,
    }
}

/// Combine the transaction with the MPC signature into raw signed transaction bytes.
fn build_signed_tx(tx: &PendingEthTx, sig: &MpcSignature) -> Vec<u8> {
    // big_r is a compressed point: 1 prefix byte + the 32-byte x coordinate, which is `r`.
    let big_r = hex::decode(&sig.big_r.affine_point).unwrap_or_else(|_| env::panic_str("Bad big_r"));
    require!(big_r.len() == 33, "big_r must be 33 bytes");
    let r: [u8; 32] = big_r[1..].try_into().unwrap();
    let s: [u8; 32] = hex::decode(&sig.s.scalar)
        .ok()
        .and_then(|b| b.try_into().ok())
        .unwrap_or_else(|| env::panic_str("Bad s"));
    let (s, y_parity) = eth::normalize_s(s, sig.recovery_id);
    transfer_from(tx).signed(y_parity, &r, &s)
}

fn validate_heirs(owner: &AccountId, heirs: &[Heir]) {
    require!(!heirs.is_empty(), "Add at least one heir");
    require!(heirs.len() <= MAX_HEIRS, "At most 10 heirs");
    let mut total: u32 = 0;
    for (i, heir) in heirs.iter().enumerate() {
        require!(heir.share_bps > 0, "Every heir needs a share above 0");
        require!(&heir.account_id != owner, "You can't be your own heir");
        require!(
            !heirs[..i].iter().any(|h| h.account_id == heir.account_id),
            "Each heir can only be listed once"
        );
        total += heir.share_bps as u32;
    }
    require!(total == BPS_TOTAL as u32, "Shares must add up to 100% (10000 bps)");
}

fn validate_periods(check_in_period_ms: u64, grace_period_ms: u64) {
    require!(check_in_period_ms >= MIN_PERIOD_MS, "Check-in period must be at least 1 minute");
    require!(grace_period_ms >= MIN_PERIOD_MS, "Grace period must be at least 1 minute");
}

#[cfg(test)]
mod tests;
