/**
 * useRequestAllAccounts
 *
 * Called once after the wallet connects. Sends `wallet_requestPermissions` with
 * `eth_accounts` so MetaMask presents its full account selector and the user can
 * grant access to more than just the first account.
 *
 * This is the only standards-compliant way to ask for multi-account access from
 * an injected provider without forking ConnectKit's connect modal.
 */
import { useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { useAvailableAccounts } from './useWalletEvents'

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export function useRequestAllAccounts() {
  const { isConnected } = useAccount()
  const availableAccounts = useAvailableAccounts()
  const didRequest = useRef(false)

  useEffect(() => {
    // Only run once per session after the wallet first connects.
    // Skip if we already have more than one account (permission already granted).
    if (!isConnected || didRequest.current || availableAccounts.length > 1) return
    didRequest.current = true

    const raw: unknown = window.ethereum
    if (!raw || typeof raw !== 'object') return
    const provider = raw as EthereumProvider

    void provider
      .request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      })
      .catch(() => {
        // User dismissed the picker — not an error, just means they didn't
        // want to share more accounts. Reset so they can try again next connect.
        didRequest.current = false
      })
  }, [isConnected, availableAccounts.length])
}
