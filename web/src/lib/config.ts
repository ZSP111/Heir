/**
 * App settings, read from NEXT_PUBLIC_* environment variables (see .env.example).
 * The defaults point at NEAR testnet and Ethereum Sepolia.
 */
export const config = {
  network: (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet",
  nearRpcUrl: process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
  /** The Heir vault contract. */
  heirContract: process.env.NEXT_PUBLIC_HEIR_CONTRACT_ID ?? "heir-vault.testnet",
  /** NEAR's Chain Signatures (MPC) signer. */
  mpcContract: process.env.NEXT_PUBLIC_MPC_CONTRACT_ID ?? "v1.signer-prod.testnet",
  sepoliaRpcUrl:
    process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
  nearExplorer: "https://testnet.nearblocks.io",
  ethExplorer: "https://sepolia.etherscan.io",
};
