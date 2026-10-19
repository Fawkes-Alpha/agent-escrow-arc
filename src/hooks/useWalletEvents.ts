/**
 * useWalletEvents
 *
 * Subscribes directly to the raw EIP-1193 provider's `accountsChanged` and
 * `chainChanged` events. When either fires we:
 *
 *  1. Update our own `availableAccounts` atom (stored in a module-level signal so
 *     any component can read it without prop-drilling).
 *  2. Push the new active address into wagmi by calling the connector's internal
 *     `onAccountsChanged` handler — that's the same path MetaMask's own wagmi
 *     integration uses, and it's more reliable than `reconnect()` which only
 *     re-establishes the *existing* state without switching the account.
 *
 * chainChanged calls reconnect() because wagmi needs to rebuild its chain state.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { useConfig, useReconnect } from 'wagmi'

// ---------------------------------------------------------------------------
// Module-level store — available accounts from the wallet
// ---------------------------------------------------------------------------
type Listener = () => void
let _accounts: readonly `0x${string}`[] = []
const _listeners = new Set<Listener>()

function setAccounts(next: readonly `0x${string}`[]) {
  // deduplicate: only notify if something actually changed
  if (next.length === _accounts.length && next.every((a, i) => a === _accounts[i])) return
  _accounts = next
  _listeners.forEach(l => l())
}

function subscribeAccounts(listener: Listener) {
  _listeners.add(listener)
  return () => { _listeners.delete(listener) }
}

function getAccountsSnapshot() { return _accounts }

/** Read the full list of wallet accounts available in the current session. */
export function useAvailableAccounts(): readonly `0x${string}`[] {
  return useSyncExternalStore(subscribeAccounts, getAccountsSnapshot)
}

// ---------------------------------------------------------------------------
// EIP-1193 provider interface (narrow — only what we need)
// ---------------------------------------------------------------------------
interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on(event: string, handler: (...args: unknown[]) => void): void
  removeListener(event: string, handler: (...args: unknown[]) => void): void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useWalletEvents() {
  const config = useConfig()
  const { reconnect } = useReconnect()

  useEffect(() => {
    const raw: unknown = window.ethereum
    if (!raw || typeof raw !== 'object') return
    const provider = raw as EthereumProvider

    // Seed the available-accounts store immediately (no event needed).
    void provider
      .request({ method: 'eth_accounts' })
      .then(res => {
        if (Array.isArray(res)) setAccounts(res as `0x${string}`[])
      })
      .catch(() => { /* wallet not connected yet — ignore */ })

    const handleAccountsChanged = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? (accounts as `0x${string}`[]) : []
      setAccounts(list)
      if (list.length === 0) return   // wallet locked — leave wagmi state alone

      // Push the new active account into wagmi by calling the connector's own
      // onAccountsChanged handler. This is the internal hook wagmi itself
      // registers on connect; calling it here is the reliable way to make
      // useAccount().address switch without a full reconnect modal.
      const connector = config.state.connections.values().next().value?.connector
      if (connector && typeof connector.onAccountsChanged === 'function') {
        connector.onAccountsChanged(list)
      } else {
        // Fallback: no active connector yet — trigger a reconnect so wagmi
        // picks up the new account on the next connect flow.
        reconnect()
      }
    }

    const handleChainChanged = () => {
      // wagmi must rebuild its chain / transport state on a chain switch.
      reconnect()
    }

    provider.on('accountsChanged', handleAccountsChanged)
    provider.on('chainChanged', handleChainChanged)

    return () => {
      provider.removeListener('accountsChanged', handleAccountsChanged)
      provider.removeListener('chainChanged', handleChainChanged)
    }
  }, [config, reconnect])
}
