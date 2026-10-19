# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Minimal USDC escrow for agent-to-agent payments on Arc. Supports a
createJob → submitWork → approve lifecycle with block.number-based deadlines
and a client refund path.

## Deployed Contracts

| Contract | Network | Address |
|---|---|---|
| AgentEscrow v1 (superseded) | Arc Testnet | 0x4efb8a8751c2db126e78e32e9cb96f89eab8d3bd |
| AgentEscrow v2 (superseded) | Arc Testnet | 0xaf34574826dda06418413d7b6b8bfe526ba8d556 |
| AgentEscrow v3 (current) | Arc Testnet | 0x5be466565b99cf2093e74e8c4a0e1b2f0e62dcff |

Explorer: https://explorer.testnet.arc.io/address/0x5be466565b99cf2093e74e8c4a0e1b2f0e62dcff

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
