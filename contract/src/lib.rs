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

use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

/// Shares are in basis points: 10_000 = 100%, 2_500 = 25%.
pub const BPS_TOTAL: u16 = 10_000;
pub const MAX_HEIRS: usize = 10;
/// Shortest allowed check-in or grace period (1 minute, handy for demos).
pub const MIN_PERIOD_MS: u64 = 60 * 1000;
/// Fixed deposit taken at vault creation to pay for the vault's on-chain storage.
/// It is refunded on cancel, or shared among the heirs once the vault unlocks.
pub const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(50); // 0.05 NEAR

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Heir {
    pub account_id: AccountId,
    pub share_bps: u16,
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

/// What view calls return: the vault plus computed status and deadlines.
#[near(serializers = [json])]
pub struct VaultView {
    pub owner: AccountId,
    pub heirs: Vec<Heir>,
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

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Vaults,
    VaultsByHeir,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    vaults: LookupMap<AccountId, Vault>,
    /// heir account -> owners of the vaults that name them, for the heir claim page.
    vaults_by_heir: LookupMap<AccountId, Vec<AccountId>>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            vaults: LookupMap::new(StorageKey::Vaults),
            vaults_by_heir: LookupMap::new(StorageKey::VaultsByHeir),
        }
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

    /// Replace the list of heirs. Shares must add up to 100% (10_000 bps).
    pub fn set_heirs(&mut self, heirs: Vec<Heir>) {
        let owner = env::predecessor_account_id();
        validate_heirs(&owner, &heirs);
        let old_heirs = self.owner_vault_mut().heirs.clone();
        self.unindex_heirs(&owner, &old_heirs);
        self.index_heirs(&owner, &heirs);
        self.owner_vault_mut().heirs = heirs;
    }

    /// Change how long the owner can stay silent, and how long the grace period lasts.
    pub fn set_periods(&mut self, check_in_period_ms: u64, grace_period_ms: u64) {
        validate_periods(check_in_period_ms, grace_period_ms);
        let vault = self.owner_vault_mut();
        vault.check_in_period_ms = check_in_period_ms;
        vault.grace_period_ms = grace_period_ms;
    }

    /// Close the vault and send everything (balance + storage deposit) back to the owner.
    pub fn cancel(&mut self) -> Promise {
        let owner = env::predecessor_account_id();
        self.owner_vault_mut(); // checks the vault exists and is not unlocked
        let vault = self.vaults.remove(&owner).unwrap();
        self.unindex_heirs(&owner, &vault.heirs);
        env::log_str(&format!("vault_cancelled owner={owner}"));
        Promise::new(owner).transfer(vault.balance.saturating_add(vault.storage_deposit))
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

        if is_last {
            let vault = self.vaults.remove(&owner).unwrap();
            self.unindex_heirs(&owner, &vault.heirs);
            env::log_str(&format!("vault_settled owner={owner}"));
        }
        env::log_str(&format!("claim owner={owner} heir={heir_id} amount={amount}"));
        Promise::new(heir_id).transfer(amount)
    }

    // ---------------------------------------------------------------- views

    pub fn get_vault(&self, owner: AccountId) -> Option<VaultView> {
        let now = env::block_timestamp_ms();
        self.vaults.get(&owner).map(|v| VaultView {
            owner: owner.clone(),
            heirs: v.heirs.clone(),
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
