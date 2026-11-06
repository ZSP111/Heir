# Heir: crypto inheritance across chains

A "dead man's switch" vault on NEAR. The owner keeps savings in a vault smart contract and checks in
now and then. If they go silent for the check-in period, a grace period starts; if they still don't
respond, the vault unlocks and their heirs claim their shares. Using NEAR Chain Signatures, the same
vault also controls an Ethereum address, so ETH can be inherited too.

> 🚧 Work in progress for the NEAR Hackathon (Nov 2026).

## Status

- [x] Vault contract (NEAR): create, deposit, check in, withdraw, heirs and shares, countdown and grace period, claim, cancel
- [x] Chain Signatures: vault-controlled Ethereum (Sepolia) address, release ETH to heirs
- [x] Web app: owner dashboard and heir claim page
- [x] Gasless check-ins (meta transactions + relayer)

## Contract

Live on testnet: [`heir-vault.testnet`](https://testnet.nearblocks.io/address/heir-vault.testnet)

```bash
cd contract
cargo test                              # unit tests
cargo near build non-reproducible-wasm  # builds target/near/heir_vault.wasm
```

## Web app

```bash
cd web
npm install
npm run dev   # http://localhost:3000
```

See [web/README.md](web/README.md) for the pages and settings.

### Gasless check-ins

"I'm still here" is free for the owner when their wallet can sign NEAR meta transactions
(NEP-366): the wallet signs a `check_in` call without sending it, and the app's relayer
(`web/src/app/api/relay/route.ts`) wraps it in a transaction and pays the gas. The contract
still sees the owner as the caller. The relayer only pays for one `check_in` call on the Heir
contract, with no NEAR attached, at most 30 Tgas, from an account whose vault hasn't unlocked
([relayPolicy.ts](web/src/lib/relayPolicy.ts)). Wallets without meta-transaction support fall
back to a normal transaction.

Enable it with server-side `RELAYER_ACCOUNT_ID` and `RELAYER_PRIVATE_KEY` (a funded NEAR
account's full-access key; keep it out of the repo) and `NEXT_PUBLIC_GASLESS=true`.

## Security notes

- Heirs' NEAR shares and ETH amounts, recipients and the Ethereum chain ID are fixed by the
  contract; whoever triggers a payout only chooses the gas price, within a cap.
- ETH signing requests run one at a time per owner, and the contract tracks the Ethereum
  nonce itself, so a payout can never be signed twice with different nonces.
- **Testnet only:** the contract account `heir-vault.testnet` still has a full-access key so
  it can be upgraded during the hackathon. A production deployment must remove that key
  (or hand upgrades to a DAO) so nobody, including the Heir team, can change the code.

## Other project by the same author

Per hackathon rule Q-015, I'm also submitting **Settl** (crypto invoices on NEAR):
https://github.com/ZSP111/settl. The two are independent projects.
