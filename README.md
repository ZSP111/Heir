# Heir: crypto inheritance across chains

A "dead man's switch" vault on NEAR. The owner keeps savings in a vault smart contract and checks in
now and then. If they go silent for the check-in period, a grace period starts; if they still don't
respond, the vault unlocks and their heirs claim their shares. Using NEAR Chain Signatures, the same
vault also controls an Ethereum address, so ETH can be inherited too.

> 🚧 Work in progress for the NEAR Hackathon (Nov 2026).

## Status

- [x] Vault contract (NEAR): create, deposit, check in, withdraw, heirs and shares, countdown and grace period, claim, cancel
- [ ] Chain Signatures: vault-controlled Ethereum (Sepolia) address, release ETH to heirs
- [ ] Web app: owner dashboard and heir claim page
- [ ] Gasless check-ins (meta transactions + relayer)

## Contract

Live on testnet: [`heir-vault.testnet`](https://testnet.nearblocks.io/address/heir-vault.testnet)

```bash
cd contract
cargo test                              # unit tests
cargo near build non-reproducible-wasm  # builds target/near/heir_vault.wasm
```

## Other project by the same author

Per hackathon rule Q-015, I'm also submitting **Settl** (crypto invoices on NEAR):
https://github.com/ZSP111/settl. The two are independent projects.
