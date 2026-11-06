//! Building Ethereum transactions inside the NEAR contract.
//!
//! An Ethereum transaction is a list of fields encoded with RLP (Ethereum's simple
//! binary format). We build an EIP-1559 ("type 2") ETH transfer, hash it with keccak256,
//! have the MPC network sign that hash, then attach the signature to get the raw
//! transaction that anyone can broadcast to Ethereum.

use near_sdk::env;

/// Ethereum Sepolia testnet.
pub const SEPOLIA_CHAIN_ID: u64 = 11_155_111;
/// A plain ETH transfer to a normal wallet always costs exactly 21,000 gas.
pub const TRANSFER_GAS: u64 = 21_000;

pub struct EthTransfer {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub to: [u8; 20],
    pub value: u128,
}

impl EthTransfer {
    fn fields(&self) -> Vec<Vec<u8>> {
        vec![
            rlp_uint(self.chain_id as u128),
            rlp_uint(self.nonce as u128),
            rlp_uint(self.max_priority_fee_per_gas),
            rlp_uint(self.max_fee_per_gas),
            rlp_uint(TRANSFER_GAS as u128),
            rlp_bytes(&self.to),
            rlp_uint(self.value),
            rlp_bytes(&[]), // data: none
            rlp_list(&[]),  // access list: empty
        ]
    }

    /// The unsigned transaction bytes: 0x02 || rlp([fields]).
    pub fn unsigned(&self) -> Vec<u8> {
        [vec![0x02], rlp_list(&self.fields())].concat()
    }

    /// The 32-byte hash the MPC network signs.
    pub fn signing_hash(&self) -> [u8; 32] {
        env::keccak256_array(self.unsigned())
    }

    /// The signed transaction bytes: 0x02 || rlp([fields, y_parity, r, s]).
    pub fn signed(&self, y_parity: u8, r: &[u8; 32], s: &[u8; 32]) -> Vec<u8> {
        let mut fields = self.fields();
        fields.push(rlp_uint(y_parity as u128));
        fields.push(rlp_bytes(strip_zeros(r)));
        fields.push(rlp_bytes(strip_zeros(s)));
        [vec![0x02], rlp_list(&fields)].concat()
    }
}

/// Parse "0x" + 40 hex characters into a 20-byte address.
pub fn parse_address(s: &str) -> Result<[u8; 20], &'static str> {
    let hex_part = s.strip_prefix("0x").ok_or("Ethereum address must start with 0x")?;
    let bytes = hex::decode(hex_part).map_err(|_| "Ethereum address is not valid hex")?;
    bytes.try_into().map_err(|_| "Ethereum address must be 20 bytes (40 hex characters)")
}

/// The order `n` of the secp256k1 curve, and n / 2.
const SECP256K1_N: [u8; 32] =
    hex_literal(b"fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const SECP256K1_HALF_N: [u8; 32] =
    hex_literal(b"7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

/// Ethereum only accepts signatures with a "low" s (s <= n/2). Both (s, v) and
/// (n - s, flipped v) are valid signatures of the same message, so if the MPC network
/// hands us a high s, we swap to the low one.
pub fn normalize_s(s: [u8; 32], y_parity: u8) -> ([u8; 32], u8) {
    if s > SECP256K1_HALF_N {
        (sub_256(&SECP256K1_N, &s), y_parity ^ 1)
    } else {
        (s, y_parity)
    }
}

/// a - b for 256-bit big-endian numbers (a >= b).
fn sub_256(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let mut d = a[i] as i16 - b[i] as i16 - borrow;
        borrow = if d < 0 { 1 } else { 0 };
        if d < 0 {
            d += 256;
        }
        out[i] = d as u8;
    }
    out
}

const fn hex_literal(s: &[u8; 64]) -> [u8; 32] {
    const fn nibble(c: u8) -> u8 {
        match c {
            b'0'..=b'9' => c - b'0',
            _ => c - b'a' + 10,
        }
    }
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = nibble(s[2 * i]) << 4 | nibble(s[2 * i + 1]);
        i += 1;
    }
    out
}

// ---------------------------------------------------------------- RLP encoding

fn strip_zeros(b: &[u8]) -> &[u8] {
    let first = b.iter().position(|&x| x != 0).unwrap_or(b.len());
    &b[first..]
}

/// Numbers are encoded as big-endian bytes with no leading zeros (0 = empty).
fn rlp_uint(n: u128) -> Vec<u8> {
    rlp_bytes(strip_zeros(&n.to_be_bytes()))
}

fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        b.to_vec()
    } else {
        [rlp_length(b.len(), 0x80), b.to_vec()].concat()
    }
}

fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let payload = items.concat();
    [rlp_length(payload.len(), 0xc0), payload].concat()
}

fn rlp_length(len: usize, offset: u8) -> Vec<u8> {
    if len <= 55 {
        vec![offset + len as u8]
    } else {
        let len_bytes = strip_zeros(&(len as u64).to_be_bytes()).to_vec();
        [vec![offset + 55 + len_bytes.len() as u8], len_bytes].concat()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reference values produced by ethers.js v6 for the same transaction.
    fn sample() -> EthTransfer {
        EthTransfer {
            chain_id: SEPOLIA_CHAIN_ID,
            nonce: 7,
            max_priority_fee_per_gas: 2_000_000_000,
            max_fee_per_gas: 30_000_000_000,
            to: parse_address("0x9f81815252301475c6f15ea6165e854061cd0346").unwrap(),
            value: 12_345_678_900_000_000,
        }
    }

    #[test]
    fn unsigned_tx_matches_ethers() {
        assert_eq!(
            hex::encode(sample().unsigned()),
            "02f283aa36a70784773594008506fc23ac00825208949f81815252301475c6f15ea6165e854061cd0346872bdc545d58750080c0"
        );
    }

    #[test]
    fn signing_hash_matches_ethers() {
        assert_eq!(
            hex::encode(sample().signing_hash()),
            "86c9efb5b74b306c4bcb894229fed36a8a8e76cc68181df0499b18f0c7bb4529"
        );
    }

    #[test]
    fn signed_tx_matches_ethers() {
        let r: [u8; 32] = hex::decode("fb6921cfd1b9e1d45fe1764a3371e63a05a663713acb9c1100a70591c326fec0")
            .unwrap()
            .try_into()
            .unwrap();
        let s: [u8; 32] = hex::decode("2f75761e6af64af706f7b172b939c92b0ef9a3eb211040f704908e4c98e06a67")
            .unwrap()
            .try_into()
            .unwrap();
        assert_eq!(
            hex::encode(sample().signed(1, &r, &s)),
            "02f87583aa36a70784773594008506fc23ac00825208949f81815252301475c6f15ea6165e854061cd0346872bdc545d58750080c001a0fb6921cfd1b9e1d45fe1764a3371e63a05a663713acb9c1100a70591c326fec0a02f75761e6af64af706f7b172b939c92b0ef9a3eb211040f704908e4c98e06a67"
        );
    }

    #[test]
    fn rlp_handles_edge_cases() {
        assert_eq!(rlp_uint(0), vec![0x80]);
        assert_eq!(rlp_uint(0x7f), vec![0x7f]);
        assert_eq!(rlp_uint(0x80), vec![0x81, 0x80]);
        // A 56-byte string needs the long-length form.
        let long = vec![0xaa; 56];
        assert_eq!(&rlp_bytes(&long)[..2], &[0xb8, 56]);
    }

    #[test]
    fn high_s_is_flipped_to_low_s() {
        let low = [0x01; 32];
        assert_eq!(normalize_s(low, 0), (low, 0));
        let high = sub_256(&SECP256K1_N, &low); // n - low is "high"
        assert_eq!(normalize_s(high, 0), (low, 1));
        assert_eq!(normalize_s(high, 1), (low, 0));
        assert_eq!(normalize_s(SECP256K1_HALF_N, 1), (SECP256K1_HALF_N, 1));
    }

    #[test]
    fn parse_address_rejects_bad_input() {
        assert!(parse_address("9f81815252301475c6f15ea6165e854061cd0346").is_err());
        assert!(parse_address("0x9f81").is_err());
        assert!(parse_address("0xzz81815252301475c6f15ea6165e854061cd0346").is_err());
        assert!(parse_address("0x9F81815252301475C6F15EA6165E854061CD0346").is_ok());
    }
}
