import { useState, useRef, useEffect } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useReadContract, useBlockNumber, useConfig } from 'wagmi'
import { erc20Abi } from 'viem'
import { TokenUSDC } from '@web3icons/react'
import { Wifi, ChevronDown, Check } from 'lucide-react'
import { USDC_ADDRESS, ARC_MAINNET_CHAIN_ID, formatUsdc, shortAddr } from '../escrow-contract'
import { useAvailableAccounts } from '../hooks/useWalletEvents'

export function Header() {
  const { address, chainId } = useAccount()
  const config = useConfig()
  const wrongChain = address !== undefined && chainId !== ARC_MAINNET_CHAIN_ID
  const availableAccounts = useAvailableAccounts()
  const canSwitch = availableAccounts.length > 1

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const { data: balance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  const { data: blockNumber } = useBlockNumber({
    chainId: ARC_MAINNET_CHAIN_ID,
    watch: true,
    // 1 s interval — Arc blocks are ~0.506 s, no need to poll faster.
    query: { refetchInterval: 1_000 },
  })

  /** Switch the active account by calling the connector's onAccountsChanged. */
  const switchToAccount = (next: `0x${string}`) => {
    setDropdownOpen(false)
    if (next === address) return
    // Reorder the list so `next` comes first — that makes it the active account.
    const reordered = [next, ...availableAccounts.filter(a => a !== next)]
    const connector = config.state.connections.values().next().value?.connector
    if (connector && typeof connector.onAccountsChanged === 'function') {
      connector.onAccountsChanged(reordered)
    }
  }

  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between gap-4 px-5 py-3 backdrop-blur-md"
      style={{ background: 'rgba(13,27,47,0.85)', borderBottom: '1px solid var(--border)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--surface-strong)' }}
        >
          <TokenUSDC variant="branded" size={20} />
        </div>
        <span className="display text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>
          AgentEscrow
        </span>
        <span
          className="hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest sm:inline-block"
          style={{ background: 'rgba(172,198,233,0.15)', color: 'var(--accent)' }}
        >
          Arc Mainnet
        </span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Block number */}
        {blockNumber !== undefined && (
          <div className="hidden items-center gap-1.5 sm:flex">
            <Wifi className="size-3" style={{ color: 'var(--success)' }} />
            <span className="mono text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
              #{blockNumber.toLocaleString()}
            </span>
          </div>
        )}

        {/* USDC balance */}
        {address && balance !== undefined && (
          <div
            className="hidden items-center gap-1.5 rounded-xl px-3 py-1.5 sm:flex"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <TokenUSDC variant="branded" size={14} />
            <span className="mono text-xs font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>
              {formatUsdc(balance)}
            </span>
          </div>
        )}

        {/* Wrong chain badge */}
        {wrongChain && (
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'rgba(232,109,122,0.18)', color: 'var(--danger)' }}>
            Wrong network
          </span>
        )}

        {/* Account switcher — only shown when wallet exposed > 1 account */}
        {address && canSwitch && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(o => !o)}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-colors hover:opacity-80"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', color: 'var(--ink-2)' }}
              title="Switch account"
            >
              <span className="mono">{shortAddr(address)}</span>
              <ChevronDown className="size-3" style={{ color: 'var(--subtle)' }} />
            </button>

            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 min-w-48 rounded-xl overflow-hidden z-30 py-1"
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border-strong)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                }}
              >
                <div
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--subtle)' }}
                >
                  Switch account
                </div>
                {availableAccounts.map(acct => (
                  <button
                    key={acct}
                    onClick={() => switchToAccount(acct)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:opacity-80"
                    style={{ color: acct === address ? 'var(--accent)' : 'var(--ink-2)' }}
                  >
                    <span className="mono">{shortAddr(acct)}</span>
                    {acct === address && <Check className="size-3 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* When only one account, show address pill without switcher */}
        {address && !canSwitch && (
          <div
            className="hidden items-center rounded-xl px-2.5 py-1.5 sm:flex"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
          >
            <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>{shortAddr(address)}</span>
          </div>
        )}

        <ConnectKitButton />
      </div>
    </header>
  )
}
