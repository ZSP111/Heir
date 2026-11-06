# Heir: crypto inheritance across chains

A "dead man's switch" vault on NEAR. The owner keeps savings in a vault smart contract and checks in
now and then. If they go silent for the check-in period, a grace period starts; if they still don't
respond, the vault unlocks and their heirs claim their shares. Using NEAR Chain Signatures, the same
vault also controls an Ethereum address, so ETH can be inherited too.

> 🚧 Work in progress for the NEAR Hackathon (Nov 2026).

## Status

- [x] Vault contract (NEAR): create, deposit, check in, withdraw, heirs and shares, countdown and grace period, claim, cancel
- [x] Chain Signatures: vault-controlled Ethereum (Sepolia) address, release ETH to heirs
- [ ] Web app: owner dashboard and heir claim page
- [ ] Gasless check-ins (meta transactions + relayer)

## Contract

Live on testnet: [`heir-vault.testnet`](https://testnet.nearblocks.io/address/heir-vault.testnet)

```bash
cd contract
cargo test                              # unit tests
cargo near build non-reproducible-wasm  # builds target/near/heir_vault.wasm
```

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
