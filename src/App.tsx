import { useState, useCallback } from 'react'
import { useReadContract, useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle } from 'lucide-react'
import { Header } from './components/Header'
import { CreateJobForm } from './components/CreateJobForm'
import { JobList } from './components/JobList'
import { ESCROW_ADDRESS, ESCROW_ABI, ARC_MAINNET_CHAIN_ID } from './escrow-contract'
import { useWalletEvents } from './hooks/useWalletEvents'
import { useRequestAllAccounts } from './hooks/useRequestAllAccounts'

export default function App() {
  // Subscribe to accountsChanged / chainChanged on window.ethereum so that
  // switching accounts in MetaMask re-renders the entire app immediately.
  useWalletEvents()
  // After connecting, request permission for all accounts so the switcher works.
  useRequestAllAccounts()

  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const [refreshKey, setRefreshKey] = useState(0)
  const wrongChain = address !== undefined && chainId !== ARC_MAINNET_CHAIN_ID

  const { data: jobCount, refetch: refetchCount } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'jobCount',
    chainId: ARC_MAINNET_CHAIN_ID,
  })

  const handleRefresh = useCallback(() => {
    void refetchCount()
    setRefreshKey(k => k + 1)
  }, [refetchCount])

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <Header />

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {/* Wrong chain banner */}
        {wrongChain && (
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: 'rgba(232,109,122,0.1)', border: '1px solid rgba(232,109,122,0.3)' }}
          >
            <AlertTriangle className="size-4 shrink-0" style={{ color: 'var(--danger)' }} />
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              This app runs on <strong>Arc Mainnet</strong> (chain ID 5042).
            </p>
            <button
              onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
              className="ml-auto shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{ background: 'var(--danger)', color: '#fff' }}
            >
              Switch
            </button>
          </div>
        )}

        {/* Not connected */}
        {!address && (
          <div
            className="flex flex-col items-center gap-4 rounded-2xl py-14"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--subtle)' }}>
              Connect your wallet to use AgentEscrow on Arc Mainnet.
            </p>
            <ConnectKitButton />
          </div>
        )}

        {/* Main content */}
        {address && (
          <>
            <CreateJobForm onJobCreated={handleRefresh} />
            <JobList
              jobCount={jobCount ?? 0n}
              onRefresh={handleRefresh}
              refreshKey={refreshKey}
            />
          </>
        )}
      </main>
    </div>
  )
}
