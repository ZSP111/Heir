# Heir web app

Next.js (App Router) + TypeScript + Tailwind. Everything runs in the browser: it reads
NEAR and Ethereum Sepolia through public RPC nodes and signs with the user's NEAR wallet
(NEAR Connect). There is no backend and no database.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

Settings are optional `NEXT_PUBLIC_*` variables (see `.env.example`); the defaults use
`heir-vault.testnet` and Ethereum Sepolia.

| Page | What it does |
|------|--------------|
| `/` | What Heir is |
| `/vault` | Owner dashboard: create a vault, check in, deposit/withdraw NEAR, the vault's ETH address and balance, edit heirs and periods, close the vault |
| `/claim` | Heir page: vaults that name you (or `?owner=alice.testnet`), claim NEAR, release and broadcast ETH payouts |
