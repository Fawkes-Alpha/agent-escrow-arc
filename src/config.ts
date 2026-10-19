/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'viem/chains'
import { type Chain } from 'viem'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

export const arcMainnet = {
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://explorer.arc.io' } },
} as const satisfies Chain

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcMainnet, mainnet], // mainnet also needed for ENS resolution
  // shimDisconnect: false — treat an account switch as a reconnect, not a disconnect.
  // This lets wagmi pick up the new account from accountsChanged without a full
  // connect flow, which is what makes switching roles in MetaMask work.
  connectors: [injected({ shimDisconnect: false })],
  // Disable multi-provider discovery so the injected connector is stable and its
  // internal event listeners are not torn down between renders.
  multiInjectedProviderDiscovery: false,
  transports: {
    [arcMainnet.id]: http('https://rpc.mainnet.arc.io'),
    [mainnet.id]: http(),
  },
})
