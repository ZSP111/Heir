//! Unit tests: a simulated blockchain where we pick the caller, the attached NEAR
//! and the clock for every call.

use super::*;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::mock::MockAction;
use near_sdk::testing_env;

const MIN: u64 = 60 * 1000; // one minute in ms
const START: u64 = 1_000_000_000; // arbitrary start time in ms

fn contract_id() -> AccountId {
    "heir-vault.testnet".parse().unwrap()
}
fn owner() -> AccountId {
    "alice.testnet".parse().unwrap()
}
fn bob() -> AccountId {
    "bob.testnet".parse().unwrap()
}
fn carol() -> AccountId {
    "carol.testnet".parse().unwrap()
}
fn stranger() -> AccountId {
    "mallory.testnet".parse().unwrap()
}
fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

/// Set who is calling, how much NEAR they attach, and what time it is.
fn call(who: AccountId, deposit: NearToken, now_ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(who)
        .attached_deposit(deposit)
        .block_timestamp(now_ms * 1_000_000)
        .build());
}

fn heirs_60_40() -> Vec<Heir> {
    vec![
        Heir { account_id: bob(), share_bps: 6_000 },
        Heir { account_id: carol(), share_bps: 4_000 },
    ]
}

/// A contract where alice has a vault: 10 NEAR, 10 min check-in, 5 min grace, bob 60% / carol 40%.
fn setup() -> Contract {
    call(owner(), NearToken::from_yoctonear(0), START);
    let mut c = Contract::new();
    call(owner(), near(10).saturating_add(STORAGE_DEPOSIT), START);
    c.create_vault(heirs_60_40(), 10 * MIN, 5 * MIN);
    c
}

fn vault(c: &Contract) -> VaultView {
    c.get_vault(owner()).expect("vault should exist")
}

/// The (receiver, amount) of the single NEAR transfer the last call created.
fn last_transfer() -> (AccountId, NearToken) {
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1, "expected exactly one transfer");
    let r = &receipts[0];
    let amount = r
        .actions
        .iter()
        .find_map(|a| match a {
            MockAction::Transfer { deposit, .. } => Some(*deposit),
            _ => None,
        })
        .expect("expected a transfer action");
    (r.receiver_id.clone(), amount)
}

// ------------------------------------------------------------------ create_vault

#[test]
fn create_vault_stores_balance_without_storage_deposit() {
    let c = setup();
    let v = vault(&c);
    assert_eq!(v.balance, near(10));
    assert_eq!(v.storage_deposit, STORAGE_DEPOSIT);
    assert_eq!(v.heirs, heirs_60_40());
    assert_eq!(v.status, VaultStatus::Active);
    assert_eq!(v.grace_starts_ms, START + 10 * MIN);
    assert_eq!(v.unlocks_ms, START + 15 * MIN);
}

#[test]
#[should_panic(expected = "Attach at least 0.05 NEAR for storage")]
fn create_vault_requires_storage_deposit() {
    call(owner(), NearToken::from_millinear(1), START);
    let mut c = Contract::new();
    c.create_vault(heirs_60_40(), 10 * MIN, 5 * MIN);
}

#[test]
#[should_panic(expected = "You already have a vault")]
fn create_vault_only_once() {
    let mut c = setup();
    call(owner(), STORAGE_DEPOSIT, START);
    c.create_vault(heirs_60_40(), 10 * MIN, 5 * MIN);
}

#[test]
#[should_panic(expected = "Shares must add up to 100%")]
fn heirs_must_add_up_to_100() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_heirs(vec![Heir { account_id: bob(), share_bps: 5_000 }]);
}

#[test]
#[should_panic(expected = "Add at least one heir")]
fn heirs_cannot_be_empty() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_heirs(vec![]);
}

#[test]
#[should_panic(expected = "Each heir can only be listed once")]
fn heirs_cannot_repeat() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_heirs(vec![
        Heir { account_id: bob(), share_bps: 5_000 },
        Heir { account_id: bob(), share_bps: 5_000 },
    ]);
}

#[test]
#[should_panic(expected = "You can't be your own heir")]
fn owner_cannot_be_heir() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_heirs(vec![Heir { account_id: owner(), share_bps: 10_000 }]);
}

#[test]
#[should_panic(expected = "Every heir needs a share above 0")]
fn heir_share_cannot_be_zero() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_heirs(vec![
        Heir { account_id: bob(), share_bps: 10_000 },
        Heir { account_id: carol(), share_bps: 0 },
    ]);
}

#[test]
#[should_panic(expected = "At most 10 heirs")]
fn at_most_ten_heirs() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    let heirs = (0..11)
        .map(|i| Heir { account_id: format!("heir{i}.testnet").parse().unwrap(), share_bps: 1 })
        .collect();
    c.set_heirs(heirs);
}

#[test]
#[should_panic(expected = "Check-in period must be at least 1 minute")]
fn check_in_period_has_minimum() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_periods(MIN - 1, 5 * MIN);
}

#[test]
#[should_panic(expected = "Grace period must be at least 1 minute")]
fn grace_period_has_minimum() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_periods(10 * MIN, 0);
}

#[test]
fn ten_heirs_fit_in_the_storage_deposit() {
    let mut c = setup();
    let before = env::storage_usage();
    call(owner(), NearToken::from_yoctonear(0), START);
    let heirs = (0..10)
        .map(|i| Heir {
            // 64 characters: the longest possible NEAR account name.
            account_id: format!("{i}{}", "a".repeat(63)).parse().unwrap(),
            share_bps: 1_000,
        })
        .collect();
    c.set_heirs(heirs);
    // The whole vault, worst case, must cost less than the storage deposit.
    let used = env::storage_usage() - before + 1_000; // + generous allowance for the vault record
    let cost = env::storage_byte_cost().saturating_mul(used as u128);
    assert!(cost < STORAGE_DEPOSIT, "worst case storage {used} bytes costs {cost}");
}

// ------------------------------------------------------------------ countdown

#[test]
fn status_goes_active_then_grace_then_unlocked() {
    let c = setup();
    call(stranger(), NearToken::from_yoctonear(0), START + 10 * MIN - 1);
    assert_eq!(vault(&c).status, VaultStatus::Active);
    call(stranger(), NearToken::from_yoctonear(0), START + 10 * MIN);
    assert_eq!(vault(&c).status, VaultStatus::Grace);
    call(stranger(), NearToken::from_yoctonear(0), START + 15 * MIN);
    assert_eq!(vault(&c).status, VaultStatus::Unlocked);
}

#[test]
fn check_in_resets_the_countdown() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + 8 * MIN);
    c.check_in();
    let v = vault(&c);
    assert_eq!(v.last_check_in_ms, START + 8 * MIN);
    assert_eq!(v.unlocks_ms, START + 23 * MIN);
}

#[test]
fn check_in_during_grace_returns_to_active() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + 12 * MIN);
    assert_eq!(vault(&c).status, VaultStatus::Grace);
    c.check_in();
    assert_eq!(vault(&c).status, VaultStatus::Active);
}

#[test]
#[should_panic(expected = "You don't have a vault")]
fn check_in_needs_a_vault() {
    let mut c = setup();
    call(stranger(), NearToken::from_yoctonear(0), START);
    c.check_in();
}

#[test]
#[should_panic(expected = "Vault has unlocked")]
fn check_in_too_late_fails() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + 15 * MIN);
    c.check_in();
}

// ------------------------------------------------------------------ deposit / withdraw

#[test]
fn deposit_adds_to_balance_and_checks_in() {
    let mut c = setup();
    call(owner(), near(5), START + 3 * MIN);
    c.deposit();
    let v = vault(&c);
    assert_eq!(v.balance, near(15));
    assert_eq!(v.last_check_in_ms, START + 3 * MIN);
}

#[test]
#[should_panic(expected = "Attach some NEAR to deposit")]
fn deposit_needs_nonzero_amount() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.deposit();
}

#[test]
fn withdraw_sends_near_to_owner() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + 2 * MIN);
    let _ = c.withdraw(near(4));
    assert_eq!(last_transfer(), (owner(), near(4)));
    let v = vault(&c);
    assert_eq!(v.balance, near(6));
    assert_eq!(v.last_check_in_ms, START + 2 * MIN);
}

#[test]
#[should_panic(expected = "Amount is more than the vault balance")]
fn withdraw_cannot_exceed_balance() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    let _ = c.withdraw(near(11));
}

#[test]
#[should_panic(expected = "Amount must be more than 0")]
fn withdraw_needs_nonzero_amount() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    let _ = c.withdraw(NearToken::from_yoctonear(0));
}

#[test]
#[should_panic(expected = "You don't have a vault")]
fn stranger_cannot_withdraw() {
    let mut c = setup();
    call(stranger(), NearToken::from_yoctonear(0), START);
    let _ = c.withdraw(near(1));
}

#[test]
#[should_panic(expected = "Vault has unlocked")]
fn owner_cannot_withdraw_after_unlock() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + 15 * MIN);
    let _ = c.withdraw(near(1));
}

// ------------------------------------------------------------------ set_heirs / set_periods

#[test]
fn set_heirs_replaces_heirs_and_updates_index() {
    let mut c = setup();
    assert_eq!(c.get_vaults_for_heir(bob()), vec![owner()]);
    call(owner(), NearToken::from_yoctonear(0), START + MIN);
    c.set_heirs(vec![Heir { account_id: carol(), share_bps: 10_000 }]);
    assert_eq!(vault(&c).heirs, vec![Heir { account_id: carol(), share_bps: 10_000 }]);
    assert_eq!(vault(&c).last_check_in_ms, START + MIN);
    assert!(c.get_vaults_for_heir(bob()).is_empty());
    assert_eq!(c.get_vaults_for_heir(carol()), vec![owner()]);
}

#[test]
fn set_periods_changes_deadlines() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + MIN);
    c.set_periods(2 * MIN, 3 * MIN);
    let v = vault(&c);
    assert_eq!(v.grace_starts_ms, START + 3 * MIN);
    assert_eq!(v.unlocks_ms, START + 6 * MIN);
}

#[test]
#[should_panic(expected = "Vault has unlocked")]
fn owner_cannot_change_heirs_after_unlock() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + 15 * MIN);
    c.set_heirs(vec![Heir { account_id: carol(), share_bps: 10_000 }]);
}

// ------------------------------------------------------------------ cancel

#[test]
fn cancel_refunds_everything_and_deletes_vault() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + MIN);
    let _ = c.cancel();
    assert_eq!(last_transfer(), (owner(), near(10).saturating_add(STORAGE_DEPOSIT)));
    assert!(c.get_vault(owner()).is_none());
    assert!(c.get_vaults_for_heir(bob()).is_empty());
}

#[test]
fn owner_can_create_a_new_vault_after_cancel() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    let _ = c.cancel();
    call(owner(), STORAGE_DEPOSIT, START);
    c.create_vault(heirs_60_40(), 10 * MIN, 5 * MIN);
    assert_eq!(vault(&c).balance, NearToken::from_yoctonear(0));
}

#[test]
#[should_panic(expected = "Vault has unlocked")]
fn owner_cannot_cancel_after_unlock() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + 15 * MIN);
    let _ = c.cancel();
}

// ------------------------------------------------------------------ claim

#[test]
#[should_panic(expected = "Vault is not unlocked yet")]
fn heir_cannot_claim_during_grace() {
    let mut c = setup();
    call(bob(), NearToken::from_yoctonear(0), START + 14 * MIN);
    let _ = c.claim(owner());
}

#[test]
#[should_panic(expected = "You are not an heir of this vault")]
fn stranger_cannot_claim() {
    let mut c = setup();
    call(stranger(), NearToken::from_yoctonear(0), START + 15 * MIN);
    let _ = c.claim(owner());
}

#[test]
#[should_panic(expected = "Vault not found")]
fn claim_needs_existing_vault() {
    let mut c = setup();
    call(bob(), NearToken::from_yoctonear(0), START + 15 * MIN);
    let _ = c.claim(stranger());
}

#[test]
#[should_panic(expected = "You already claimed")]
fn heir_cannot_claim_twice() {
    let mut c = setup();
    call(bob(), NearToken::from_yoctonear(0), START + 15 * MIN);
    let _ = c.claim(owner());
    let _ = c.claim(owner());
}

#[test]
fn heirs_claim_their_shares_and_vault_settles() {
    let mut c = setup();
    // Everything in the vault is shared: 10 NEAR + 0.05 NEAR storage = 10.05 NEAR.
    let total = near(10).saturating_add(STORAGE_DEPOSIT).as_yoctonear();

    call(bob(), NearToken::from_yoctonear(0), START + 15 * MIN);
    assert_eq!(c.get_claimable(owner(), bob()).as_yoctonear(), total * 60 / 100);
    let _ = c.claim(owner());
    assert_eq!(last_transfer(), (bob(), NearToken::from_yoctonear(total * 60 / 100)));
    assert_eq!(c.get_claimable(owner(), bob()), NearToken::from_yoctonear(0));
    assert_eq!(vault(&c).claimed, vec![bob()]);

    call(carol(), NearToken::from_yoctonear(0), START + 20 * MIN);
    let _ = c.claim(owner());
    assert_eq!(last_transfer(), (carol(), NearToken::from_yoctonear(total * 40 / 100)));

    // Fully paid out: vault and heir index are cleaned up.
    assert!(c.get_vault(owner()).is_none());
    assert!(c.get_vaults_for_heir(bob()).is_empty());
    assert!(c.get_vaults_for_heir(carol()).is_empty());
}

#[test]
fn last_heir_gets_rounding_dust() {
    call(owner(), NearToken::from_yoctonear(0), START);
    let mut c = Contract::new();
    // 3 heirs at 33.33% / 33.33% / 33.34% of an amount that doesn't divide evenly.
    let odd = STORAGE_DEPOSIT.saturating_add(NearToken::from_yoctonear(7));
    call(owner(), odd, START);
    c.create_vault(
        vec![
            Heir { account_id: bob(), share_bps: 3_333 },
            Heir { account_id: carol(), share_bps: 3_333 },
            Heir { account_id: stranger(), share_bps: 3_334 },
        ],
        MIN,
        MIN,
    );
    let total = odd.as_yoctonear();
    let mut paid = 0;
    for heir in [bob(), carol(), stranger()] {
        call(heir, NearToken::from_yoctonear(0), START + 2 * MIN);
        let _ = c.claim(owner());
        paid += last_transfer().1.as_yoctonear();
    }
    assert_eq!(paid, total, "every yoctoNEAR is paid out");
}

// ------------------------------------------------------------------ views

#[test]
fn views_for_unknown_accounts_are_empty() {
    let c = setup();
    assert!(c.get_vault(stranger()).is_none());
    assert!(c.get_vaults_for_heir(stranger()).is_empty());
    assert_eq!(c.get_claimable(owner(), stranger()), NearToken::from_yoctonear(0));
}

#[test]
fn heir_index_lists_every_vault_naming_the_heir() {
    let mut c = setup();
    let dave: AccountId = "dave.testnet".parse().unwrap();
    call(dave.clone(), STORAGE_DEPOSIT, START);
    c.create_vault(vec![Heir { account_id: bob(), share_bps: 10_000 }], MIN, MIN);
    assert_eq!(c.get_vaults_for_heir(bob()), vec![owner(), dave]);
}

// ------------------------------------------------------------------ ETH (Chain Signatures)

const GWEI: u128 = 1_000_000_000;
const ETH_BOB: &str = "0x9f81815252301475c6f15ea6165e854061cd0346";
const ETH_CAROL: &str = "0x00000000000000000000000000000000000000c0";

fn eth_heir(address: &str, amount_wei: u128) -> EthHeirInput {
    EthHeirInput { address: address.to_string(), amount_wei: U128(amount_wei) }
}

/// The standard vault, plus ETH heirs: bob 0.01 ETH, carol 0.02 ETH.
fn setup_eth() -> Contract {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_eth_heirs(vec![eth_heir(ETH_BOB, 10_000_000_000_000_000), eth_heir(ETH_CAROL, 20_000_000_000_000_000)]);
    c
}

fn release(c: &mut Contract, address: &str, who: AccountId, now: u64) {
    call(who, NearToken::from_yoctonear(0), now);
    let _ = c.release_eth(owner(), address.to_string(), U128(30 * GWEI), U128(2 * GWEI));
}

/// A signature in the MPC network's JSON format. r and s are from an ethers.js vector.
fn mpc_signature() -> Vec<u8> {
    br#"{"scheme":"Secp256k1","big_r":{"affine_point":"02fb6921cfd1b9e1d45fe1764a3371e63a05a663713acb9c1100a70591c326fec0"},"s":{"scalar":"2f75761e6af64af706f7b172b939c92b0ef9a3eb211040f704908e4c98e06a67"},"recovery_id":1}"#.to_vec()
}

/// Run the callback as the contract itself, with the MPC result `result`.
fn mpc_answers(c: &mut Contract, tx: PendingEthTx, result: near_sdk::PromiseResult) -> Option<String> {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(contract_id())
            .predecessor_account_id(contract_id())
            .block_timestamp(START * 1_000_000)
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    c.on_eth_signed(owner(), tx, Ok(serde_json::from_slice(&mpc_signature()).unwrap()))
}

fn pending_for(address: &str, amount_wei: u128, nonce: u64) -> PendingEthTx {
    PendingEthTx {
        nonce,
        max_fee_per_gas: U128(30 * GWEI),
        max_priority_fee_per_gas: U128(2 * GWEI),
        to: address.to_string(),
        value: U128(amount_wei),
        heir_address: Some(address.to_string()),
    }
}

#[test]
fn set_eth_heirs_stores_lowercase_addresses() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START + MIN);
    c.set_eth_heirs(vec![eth_heir("0x9F81815252301475C6F15EA6165E854061CD0346", 5)]);
    let v = vault(&c);
    assert_eq!(v.eth_heirs[0].address, ETH_BOB);
    assert_eq!(v.eth_heirs[0].amount_wei, U128(5));
    assert_eq!(v.last_check_in_ms, START + MIN);
}

#[test]
#[should_panic(expected = "Ethereum address must start with 0x")]
fn set_eth_heirs_rejects_bad_address() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_eth_heirs(vec![eth_heir("9f81815252301475c6f15ea6165e854061cd0346", 5)]);
}

#[test]
#[should_panic(expected = "Each ETH address can only be listed once")]
fn set_eth_heirs_rejects_duplicates() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_eth_heirs(vec![eth_heir(ETH_BOB, 5), eth_heir(&ETH_BOB.to_uppercase().replace("0X", "0x"), 6)]);
}

#[test]
#[should_panic(expected = "Every ETH heir needs an amount above 0")]
fn set_eth_heirs_rejects_zero_amount() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    c.set_eth_heirs(vec![eth_heir(ETH_BOB, 0)]);
}

#[test]
#[should_panic(expected = "Vault is not unlocked yet")]
fn release_eth_waits_for_unlock() {
    let mut c = setup_eth();
    release(&mut c, ETH_BOB, stranger(), START + 14 * MIN);
}

#[test]
#[should_panic(expected = "That address is not an ETH heir of this vault")]
fn release_eth_only_to_listed_heirs() {
    let mut c = setup_eth();
    release(&mut c, "0x1111111111111111111111111111111111111111", stranger(), START + 15 * MIN);
}

#[test]
#[should_panic(expected = "max_fee_per_gas is above 200 gwei")]
fn release_eth_caps_the_gas_price() {
    let mut c = setup_eth();
    call(stranger(), NearToken::from_yoctonear(0), START + 15 * MIN);
    let _ = c.release_eth(owner(), ETH_BOB.to_string(), U128(201 * GWEI), U128(GWEI));
}

#[test]
#[should_panic(expected = "max_priority_fee_per_gas is above 10 gwei")]
fn release_eth_caps_the_priority_fee() {
    let mut c = setup_eth();
    call(stranger(), NearToken::from_yoctonear(0), START + 15 * MIN);
    let _ = c.release_eth(owner(), ETH_BOB.to_string(), U128(30 * GWEI), U128(11 * GWEI));
}

#[test]
fn release_eth_asks_the_mpc_network_to_sign() {
    let mut c = setup_eth();
    release(&mut c, ETH_BOB, stranger(), START + 15 * MIN);
    let receipts = get_created_receipts();
    let sign_call = receipts.iter().find(|r| r.receiver_id.as_str() == MPC_CONTRACT).expect("call to MPC");
    let MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } = &sign_call.actions[0] else {
        panic!("expected a function call");
    };
    assert_eq!(String::from_utf8(method_name.clone()).unwrap(), "sign");
    assert_eq!(*attached_deposit, NearToken::from_yoctonear(1));
    let args: serde_json::Value = serde_json::from_slice(args).unwrap();
    assert_eq!(args["request"]["path"], "eth-alice.testnet");
    assert_eq!(args["request"]["domain_id"], 0);
    // The payload is the hash of the exact transaction: nonce 0, to bob, 0.01 ETH.
    let expected = transfer_from(&pending_for(ETH_BOB, 10_000_000_000_000_000, 0)).signing_hash();
    assert_eq!(args["request"]["payload_v2"]["Ecdsa"], hex::encode(expected));
    assert!(c.get_eth_account(owner()).pending);
}

#[test]
#[should_panic(expected = "Another ETH signature is in progress")]
fn only_one_eth_signature_at_a_time() {
    let mut c = setup_eth();
    release(&mut c, ETH_BOB, stranger(), START + 15 * MIN);
    release(&mut c, ETH_CAROL, stranger(), START + 15 * MIN);
}

#[test]
fn mpc_signature_becomes_a_signed_ethereum_tx() {
    let mut c = setup_eth();
    // Same fields as the ethers.js vector (nonce 7, 0.0123456789 ETH to ETH_BOB, 500k gas).
    let tx = pending_for(ETH_BOB, 12_345_678_900_000_000, 7);
    let signed = mpc_answers(&mut c, tx, near_sdk::PromiseResult::Successful(mpc_signature()));
    assert_eq!(
        signed.as_deref(),
        Some("0x02f87683aa36a70784773594008506fc23ac008307a120949f81815252301475c6f15ea6165e854061cd0346872bdc545d58750080c001a0fb6921cfd1b9e1d45fe1764a3371e63a05a663713acb9c1100a70591c326fec0a02f75761e6af64af706f7b172b939c92b0ef9a3eb211040f704908e4c98e06a67")
    );
    let heir = &vault(&c).eth_heirs[0];
    assert_eq!(heir.nonce, Some(7));
    assert_eq!(heir.signed_tx, signed);
}

#[test]
fn signing_uses_the_next_nonce_then_moves_it_forward() {
    let mut c = setup_eth();
    release(&mut c, ETH_BOB, stranger(), START + 15 * MIN);
    mpc_answers(&mut c, pending_for(ETH_BOB, 10_000_000_000_000_000, 0), near_sdk::PromiseResult::Successful(mpc_signature()));
    let account = c.get_eth_account(owner());
    assert_eq!(account.next_nonce, 1);
    assert!(!account.pending);
    assert!(account.last_signed_tx.is_some());
    assert_eq!(vault(&c).eth_heirs[0].nonce, Some(0));

    // Carol's payout gets the next nonce.
    release(&mut c, ETH_CAROL, stranger(), START + 15 * MIN);
    let args = mpc_args();
    let expected = transfer_from(&pending_for(ETH_CAROL, 20_000_000_000_000_000, 1)).signing_hash();
    assert_eq!(args["request"]["payload_v2"]["Ecdsa"], hex::encode(expected));
}

#[test]
fn re_releasing_an_heir_reuses_their_nonce() {
    let mut c = setup_eth();
    release(&mut c, ETH_BOB, stranger(), START + 15 * MIN);
    mpc_answers(&mut c, pending_for(ETH_BOB, 10_000_000_000_000_000, 0), near_sdk::PromiseResult::Successful(mpc_signature()));
    // Signing bob again (e.g. with a higher gas price) keeps nonce 0, so only one can land.
    release(&mut c, ETH_BOB, bob(), START + 16 * MIN);
    let args = mpc_args();
    let expected = transfer_from(&pending_for(ETH_BOB, 10_000_000_000_000_000, 0)).signing_hash();
    assert_eq!(args["request"]["payload_v2"]["Ecdsa"], hex::encode(expected));
    mpc_answers(&mut c, pending_for(ETH_BOB, 10_000_000_000_000_000, 0), near_sdk::PromiseResult::Successful(mpc_signature()));
    assert_eq!(c.get_eth_account(owner()).next_nonce, 1);
}

#[test]
fn failed_mpc_signature_unlocks_and_keeps_nonce() {
    let mut c = setup_eth();
    release(&mut c, ETH_BOB, stranger(), START + 15 * MIN);
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(contract_id())
            .predecessor_account_id(contract_id())
            .block_timestamp(START * 1_000_000)
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Failed],
    );
    let out = c.on_eth_signed(owner(), pending_for(ETH_BOB, 10_000_000_000_000_000, 0), Err(near_sdk::PromiseError::Failed));
    assert_eq!(out, None);
    let account = c.get_eth_account(owner());
    assert!(!account.pending);
    assert_eq!(account.next_nonce, 0);
    assert_eq!(vault(&c).eth_heirs[0].nonce, None);
}

#[test]
fn owner_can_withdraw_eth_before_unlock() {
    let mut c = setup_eth();
    call(owner(), NearToken::from_yoctonear(0), START + 2 * MIN);
    let _ = c.withdraw_eth(ETH_CAROL.to_string(), U128(123), U128(30 * GWEI), U128(2 * GWEI));
    let mut tx = pending_for(ETH_CAROL, 123, 0);
    tx.heir_address = None;
    assert_eq!(mpc_args()["request"]["payload_v2"]["Ecdsa"], hex::encode(transfer_from(&tx).signing_hash()));
    assert_eq!(vault(&c).last_check_in_ms, START + 2 * MIN);
}

#[test]
fn owner_without_a_vault_can_still_withdraw_eth() {
    let mut c = setup();
    call(owner(), NearToken::from_yoctonear(0), START);
    let _ = c.cancel();
    let _ = c.withdraw_eth(ETH_CAROL.to_string(), U128(123), U128(30 * GWEI), U128(2 * GWEI));
    assert!(c.get_eth_account(owner()).pending);
}

#[test]
#[should_panic(expected = "Vault has unlocked")]
fn owner_cannot_withdraw_eth_after_unlock() {
    let mut c = setup_eth();
    call(owner(), NearToken::from_yoctonear(0), START + 15 * MIN);
    let _ = c.withdraw_eth(ETH_CAROL.to_string(), U128(1), U128(30 * GWEI), U128(2 * GWEI));
}

#[test]
fn vault_with_eth_heirs_is_kept_after_last_near_claim() {
    let mut c = setup_eth();
    for heir in [bob(), carol()] {
        call(heir, NearToken::from_yoctonear(0), START + 15 * MIN);
        let _ = c.claim(owner());
    }
    let v = vault(&c);
    assert_eq!(v.claimed, vec![bob(), carol()]);
    assert_eq!(v.eth_heirs.len(), 2);
}

#[test]
fn eth_path_is_per_owner() {
    let c = setup();
    assert_eq!(c.get_eth_path(owner()), "eth-alice.testnet");
}

/// The JSON args of the MPC `sign` call the last contract call created.
fn mpc_args() -> serde_json::Value {
    let receipts = get_created_receipts();
    let sign_call = receipts.iter().find(|r| r.receiver_id.as_str() == MPC_CONTRACT).expect("call to MPC");
    let MockAction::FunctionCallWeight { args, .. } = &sign_call.actions[0] else { panic!("expected a function call") };
    serde_json::from_slice(args).unwrap()
}

#[test]
fn eth_payouts_use_a_generous_gas_limit() {
    // Sending to a brand-new address on Sepolia costs ~207k gas; 21k ran out of gas.
    assert_eq!(transfer_from(&pending_for(ETH_BOB, 1, 0)).gas_limit, 500_000);
}
