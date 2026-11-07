# Heir: crypto inheritance across chains

**In plain English:** Heir is like a will for your crypto, one that carries itself out.

If something happens to you, your crypto is usually lost forever: only your private key can move
it, and if you share that key with your family today, they can take everything today. With Heir:

1. You put your savings in a vault and choose who gets what.
2. Every so often you tap **"I'm still here"**. It takes a second and it's free.
3. If you stop checking in, Heir waits a little longer, just in case. If you still don't respond,
   the vault opens and your family collects what you left them.

No company ever holds the money, not even us: the rules live in a smart contract on NEAR, and
while you're alive only you can change them. (During the hackathon the testnet contract can
still be upgraded by its developer; see [Security](#security-model-and-limitations).) One vault covers both NEAR and Ethereum: using NEAR
Chain Signatures, the vault on NEAR pays your Ethereum heirs directly on Ethereum, with no bridge
and no middleman.

**Technically:** a "dead man's switch" vault. The owner deposits into a NEAR smart contract, names
heirs, and checks in. After a check-in period with no activity a grace period starts; after that the
vault unlocks and heirs claim. Through NEAR Chain Signatures the same contract controls an Ethereum
address for each vault and signs ETH payouts to heirs.

- **Live demo:** https://web-fpdj.vercel.app (NEAR testnet + Ethereum Sepolia)
- **Contract:** [`heir-vault.testnet`](https://testnet.nearblocks.io/address/heir-vault.testnet)
- **Demo video:** see the X post (link added at submission)
- **Built at NEAR HACKATHON** (Nov 2026) by Peter Obisi. Tracks: `open`, `realworld`.

## The problem

Crypto held in a personal wallet is lost when its owner dies or becomes incapacitated: only the
private key can move it, and handing that key to family in advance means trusting them (or a
custodian) with everything today. Heir lets the owner keep full control while alive and still
pass the funds on, under rules enforced by a contract rather than a company.

## Try it (for judges)

### 1. See a finished cross-chain inheritance (no wallet, 1 minute)

1. Open https://web-fpdj.vercel.app/claim?owner=heir-demo-alice.testnet
2. See: vault status **Unlocked**; NEAR heir `heir-demo-bob.testnet`; ETH heir `0x104c…7cae`
   for 0.005 ETH marked **Paid**.
3. Click the payout link to Sepolia Etherscan
   ([0xf019…9fae](https://sepolia.etherscan.io/tx/0xf0194b93681da64925d09c0c30bd819a9662cc19256c3348223630cb56b59fae)).
   See: **From** is `0x6cd1254647565676558d6c6dc0267706e77128ce`, the vault's Ethereum address.
   No private key exists for that address; the Heir contract had the NEAR MPC network sign the
   transaction ([NEAR tx](https://testnet.nearblocks.io/txns/3UXaugtBTPwFRRoi3Lr2953Cd49zAXKPGJ5sidUx6bvp)).
4. Check that the address belongs to the vault: it is derived from the contract account
   `heir-vault.testnet` and the path `eth-heir-demo-alice.testnet`:
   ```bash
   near contract call-function as-read-only v1.signer-prod.testnet derived_public_key \
     json-args '{"path":"eth-heir-demo-alice.testnet","predecessor":"heir-vault.testnet","domain_id":0}' \
     network-config testnet now
   ```
   The keccak256 of that public key (last 20 bytes) is `0x6cd1…28ce`. The web app does this
   derivation in [`web/src/lib/eth.ts`](web/src/lib/eth.ts) and shows the address on the owner page.

### 2. Run the whole lifecycle yourself (two testnet wallets, about 5 minutes)

You need two NEAR testnet accounts (an owner and an heir) in a wallet such as Meteor or HOT.
Testnet NEAR is free from https://near-faucet.io.

1. Open https://web-fpdj.vercel.app/vault and **Connect wallet** with the owner account.
2. Create a vault: NEAR heir = your second account at 100%, check-in period **1 minute**,
   grace period **1 minute**, deposit 1 NEAR. See: a live countdown with status **Active**.
3. Click **I'm still here**. See: the countdown restarts. If the wallet supports meta transactions
   the check-in is gas-free (the relayer pays); otherwise it is a normal transaction.
4. Wait 1 minute. See: status **Grace period**. You can still check in, withdraw or edit heirs.
5. Wait 1 more minute. See: status **Unlocked**; owner actions are now refused by the contract.
6. Sign in with the heir account, open **Claim**. See: the vault listed with
   **Claim 1.05 NEAR** (deposit + 0.05 NEAR storage). Click it; the NEAR arrives in the heir's wallet.

ETH heirs work the same way, but the vault's Ethereum address (shown on the owner page) must first
be funded with Sepolia ETH. After unlock, anyone with a NEAR wallet can press **Release ETH** on the
claim page; the app then broadcasts the signed transaction to Sepolia.

### 3. Run the tests

```bash
cd contract && cargo test   # 64 unit tests: lifecycle, shares, claims, ETH signing, nonces, fee caps
cd web && npm install && npm run build
```

## How it works

```
 owner wallet ──create / check_in / deposit / withdraw / set heirs──►  heir-vault.testnet (NEAR)
      │                                                                    │  holds NEAR, runs the timers,
      │  (gasless) signed check_in ──► /api/relay ──pays gas──────────────►│  pays NEAR heirs on claim
      │                                                                    │
 NEAR heir ──claim──────────────────────────────────────────────────────►  │
 anyone ──release_eth──────────────────────────────────────────────────►   │──sign(payload, path "eth-<owner>")──► v1.signer-prod.testnet (MPC)
                                                                           │◄───────────── signature ──────────────┘
                                                                           └─ returns signed Ethereum tx ──► broadcast to Sepolia ──► ETH heir
```

**Vault lifecycle.** `Active` until `last_check_in + check_in_period`; then `Grace` until
`+ grace_period`; then `Unlocked`. Every owner action counts as a check-in. Owner actions fail once
the vault is unlocked; claims fail before.

**NEAR payouts.** Heirs have shares in basis points that must sum to 100%. The total is frozen at
the first claim, the last heir also receives rounding dust, and the vault record is deleted when the
last NEAR heir has claimed (unless it also has ETH heirs, in which case it is kept as the record).

**ETH payouts (Chain Signatures).** Each owner's Ethereum address is derived from
(`heir-vault.testnet`, path `eth-<owner>`). After unlock, `release_eth` builds an EIP-1559 transfer
inside the contract ([`contract/src/eth.rs`](contract/src/eth.rs): RLP encoding, keccak256),
calls `sign` on the MPC contract, and in the callback assembles the signed raw transaction, stores it
in the vault and returns it. The recipient, amount, chain ID (Sepolia, 11155111) and gas limit are
fixed by the contract; the caller only picks the gas price, capped at 200 gwei / 10 gwei tip. The
contract tracks the address's nonce itself, runs one signing request at a time per owner, and re-signs
an heir's payout with the same nonce, so a payout can be fee-bumped but never paid twice.

ETH heirs get **fixed amounts**, not percentages: a NEAR contract cannot read an Ethereum balance,
and letting the caller report it would let them skew the split.

**Gasless check-ins (meta transactions).** The wallet signs a NEP-366 delegate action for
`check_in` without sending it. [`/api/relay`](web/src/app/api/relay/route.ts) wraps it in a
transaction signed by the relayer account, which pays the gas; the contract still sees the owner
as the caller. The relayer only pays for a single `check_in` on the Heir contract, with no deposit,
at most 30 Tgas, from an owner whose vault exists and hasn't unlocked
([`relayPolicy.ts`](web/src/lib/relayPolicy.ts)).

### Contract interface

| Method | Who | What |
| --- | --- | --- |
| `create_vault(heirs, check_in_period_ms, grace_period_ms)` | owner, attach ≥ 0.05 NEAR | Create the caller's vault; deposit minus 0.05 NEAR storage is the balance |
| `check_in()`, `deposit()`, `withdraw(amount)` | owner | Prove liveness, add NEAR, take NEAR out |
| `set_heirs(heirs)`, `set_eth_heirs(eth_heirs)`, `set_periods(...)` | owner | Edit heirs (NEAR %, ETH fixed amounts) and timers |
| `withdraw_eth(to, amount_wei, fees)` | owner | Sign an ETH transfer out of the vault's Ethereum address |
| `cancel()` | owner | Close the vault, refund all NEAR |
| `claim(owner)` | NEAR heir, after unlock | Receive this heir's share |
| `release_eth(owner, address, fees)` | anyone, after unlock | Sign an ETH heir's payout via Chain Signatures |
| `get_vault`, `get_vaults_for_heir`, `get_claimable`, `get_eth_path`, `get_eth_account` | view | Read state |

## NEAR tech used

| Technology | Where | What it does in Heir |
| --- | --- | --- |
| Smart contract (Rust, `near-sdk` 5.30) | [`contract/`](contract/) | Holds NEAR, runs timers, enforces who can do what |
| **Chain Signatures** (MPC signer `v1.signer-prod.testnet`, domain 0 / secp256k1) | [`contract/src/lib.rs`](contract/src/lib.rs), [`web/src/lib/eth.ts`](web/src/lib/eth.ts) | The contract controls an Ethereum address per vault and signs ETH payouts to heirs |
| **Meta transactions** (NEP-366) + relayer | [`web/src/app/api/relay/route.ts`](web/src/app/api/relay/route.ts) | Gas-free check-ins for the owner |
| NEAR Connect (`@hot-labs/near-connect`) | [`web/src/components/WalletProvider.tsx`](web/src/components/WalletProvider.tsx) | Wallet login and signing |
| `near-api-js` 7.4 | relayer route | Decodes signed delegates and submits them |
| Named accounts | throughout | Heirs are listed as readable accounts such as `bob.testnet` |

## Deployments and proof

| What | Link |
| --- | --- |
| Contract | [`heir-vault.testnet`](https://testnet.nearblocks.io/address/heir-vault.testnet) |
| Web app | https://web-fpdj.vercel.app |
| ETH inheritance paid on Sepolia | [0xf019…9fae](https://sepolia.etherscan.io/tx/0xf0194b93681da64925d09c0c30bd819a9662cc19256c3348223630cb56b59fae) (from vault address `0x6cd1…28ce`) |
| `release_eth` on NEAR (MPC signature) | [3UXaug…6bvp](https://testnet.nearblocks.io/txns/3UXaugtBTPwFRRoi3Lr2953Cd49zAXKPGJ5sidUx6bvp) |
| Gasless check-in paid by relayer `heir-relayer.testnet` | [HZwq5x…ZeCW](https://testnet.nearblocks.io/txns/HZwq5xNnMZbx3uLpE5wtL7dS4FUdhvG7uZRez7qeZUCW) |

## Security model and limitations

- **Non-custodial:** funds sit in the contract and only the owner's account can manage a vault. The
  website has no database and never sees user keys: it reads the chain and asks the user's wallet to
  sign. Its only server-side key is the relayer's, which pays gas and can only get `check_in` calls
  through the relay policy; it has no power over any vault.
- **Not audited.** Testnet only; do not use with real funds.
- **Upgradeable during the hackathon:** `heir-vault.testnet` still has a full-access key so bugs can be
  fixed. A production deployment must remove it (or hand upgrades to a DAO). This key was used once:
  the first Sepolia payout used a 21,000 gas limit, but sending ETH to a brand-new address on Sepolia
  now costs about 207,000 gas, so it failed and used up nonce 0. The contract was fixed to use a
  500,000 gas limit (only gas actually used is charged), and a one-off migration cleared that single
  heir's signed record so the payout could be signed again with nonce 1. The migration code was
  removed right after and is not in this repository.
- **Only native NEAR and Sepolia ETH are supported.** Tokens (e.g. USDC) or ETH on other EVM chains
  sent to a vault's Ethereum address cannot be moved by the contract yet. Same mechanism, future work:
  ERC-20 transfers, other EVM chains (one derivation path per chain), Bitcoin.
- ETH payouts need the vault's Ethereum address to hold the promised amounts plus gas; the owner page
  warns when it holds less.
- The relayer can be spent down by vault owners checking in repeatedly; a production relayer needs
  rate limits.
- Demo periods are minutes; real vaults would use weeks or months.

## Repository layout

```
contract/            Rust smart contract (near-sdk) and unit tests
  src/lib.rs         vault logic, Chain Signatures calls
  src/eth.rs         EIP-1559 transaction building (RLP, keccak256, low-s)
  src/tests.rs       64 unit tests
web/                 Next.js 16 + TypeScript + Tailwind app (see web/README.md)
  src/app/           pages: / , /vault (owner), /claim (heirs), /api/relay (gasless)
  src/lib/           NEAR + Ethereum helpers, contract bindings
```

### Run locally

```bash
# contract
cd contract
cargo test
cargo near build non-reproducible-wasm   # -> target/near/heir_vault.wasm

# web app
cd web
npm install
npm run dev                              # http://localhost:3000
```

The web app works with no configuration (defaults: `heir-vault.testnet`, NEAR testnet RPC,
publicnode Sepolia RPC). For gasless check-ins set `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY`
(server-side only) and `NEXT_PUBLIC_GASLESS=true`; see [`web/.env.example`](web/.env.example).

## Hackathon disclosures

- **Built in the hackathon window.** All code in this repository was written during NEAR HACKATHON
  (Nov 2026). No pre-existing project or code.
- **Libraries and templates (Q-005):** `near-sdk`, `hex` (contract); Next.js (`create-next-app`
  template), React, Tailwind CSS, `@hot-labs/near-connect`, `near-api-js`, `borsh`, `@noble/hashes`,
  `bs58`, Inter and Fraunces fonts via Fontsource (web); `ethers` was used only in local scripts to
  generate test vectors. Development was assisted by an AI coding agent (Claude Code).
- **Testnet (Q-010):** Heir runs on NEAR testnet and Ethereum Sepolia.
- **Other project by the same author (Q-015):** I'm also submitting **Settl** (crypto invoices on
  NEAR): https://github.com/ZSP111/settl. The two are independent projects.

## License

[MIT](LICENSE)
