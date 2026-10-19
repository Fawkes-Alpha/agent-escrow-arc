import { useCallback, useEffect } from 'react'
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain,
} from 'wagmi'
import { ExternalLink, Loader2, CheckCircle2 } from 'lucide-react'
import {
  ESCROW_ADDRESS, ESCROW_ABI, ARC_MAINNET_CHAIN_ID, EXPLORER_BASE,
  formatUsdc, shortAddr, blocksToMinutes, parseRevertError, Status, Job,
} from '../escrow-contract'

const STATUS_LABEL: Record<Status, string> = {
  [Status.Funded]: 'Funded',
  [Status.Submitted]: 'Submitted',
  [Status.Approved]: 'Approved',
  [Status.Refunded]: 'Refunded',
}

const STATUS_COLOR: Record<Status, { bg: string; text: string }> = {
  [Status.Funded]: { bg: 'rgba(172,198,233,0.15)', text: 'var(--accent)' },
  [Status.Submitted]: { bg: 'rgba(245,201,122,0.15)', text: 'var(--warning)' },
  [Status.Approved]: { bg: 'rgba(141,216,159,0.15)', text: 'var(--success)' },
  [Status.Refunded]: { bg: 'rgba(148,163,184,0.12)', text: 'var(--subtle)' },
}

interface Props {
  job: Job
  onAction: () => void
  blockNumber: bigint
}

function ActionButton({
  label, onClick, disabled, disabledReason, isPending, isConfirming, isSuccess, txHash,
  error,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  disabledReason?: string
  isPending?: boolean
  isConfirming?: boolean
  isSuccess?: boolean
  txHash?: `0x${string}`
  error?: string | null
}) {
  return (
    <div className="space-y-1.5">
      <button
        disabled={disabled || isPending || isConfirming || isSuccess}
        onClick={onClick}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: disabled && !isPending && !isConfirming
            ? 'var(--surface-muted)'
            : 'var(--accent)',
          color: disabled && !isPending && !isConfirming ? 'var(--subtle)' : '#0d1b2f',
        }}
      >
        {isPending
          ? <><Loader2 className="size-4 animate-spin" /> Confirm in wallet...</>
          : isConfirming
            ? <><Loader2 className="size-4 animate-spin" /> Confirming...</>
            : isSuccess
              ? <><CheckCircle2 className="size-4" /> Done</>
              : label}
      </button>
      {disabled && disabledReason && !isPending && !isConfirming && (
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>{disabledReason}</p>
      )}
      {txHash && (
        <a
          href={`${EXPLORER_BASE}/tx/${txHash}`}
          target="_blank" rel="noreferrer"
          className="flex items-center gap-1 text-xs"
          style={{ color: 'var(--accent)' }}
        >
          <ExternalLink className="size-3" />
          <span className="mono">{txHash.slice(0, 12)}…</span>
        </a>
      )}
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

export function JobCard({ job, onAction, blockNumber }: Props) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = chainId !== ARC_MAINNET_CHAIN_ID

  const isClient = address?.toLowerCase() === job.client.toLowerCase()
  const isProvider = address?.toLowerCase() === job.provider.toLowerCase()
  const block = blockNumber

  // Per-job write hooks
  const {
    writeContract, data: txHash, isPending: walletPending, error: writeError,
  } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: ARC_MAINNET_CHAIN_ID,
    // Poll at 1 s intervals; give up after 2 minutes.
    pollingInterval: 1_000,
    timeout: 120_000,
  })

  // Notify parent exactly once when the tx confirms — not on every render.
  useEffect(() => {
    if (isSuccess) onAction()
  }, [isSuccess, onAction])

  const call = useCallback((functionName: 'submitWork' | 'approve' | 'refund' | 'claimTimeout') => {
    if (wrongChain) { switchChain({ chainId: ARC_MAINNET_CHAIN_ID }); return }
    writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName,
      args: [job.id],
      chainId: ARC_MAINNET_CHAIN_ID,
    })
  }, [wrongChain, switchChain, writeContract, job.id])

  const statusColors = STATUS_COLOR[job.status]
  const errMsg = writeError ? parseRevertError(writeError) : null

  // Determine which action(s) are available and why others are blocked
  type Action = {
    label: string
    key: 'submitWork' | 'approve' | 'refund' | 'claimTimeout'
    enabled: boolean
    reason?: string
  }

  const actions: Action[] = []

  // provider + Funded + before deadline -> Submit work
  if (isProvider) {
    const enabled = job.status === Status.Funded && block <= job.deadline
    const reason = !enabled
      ? job.status !== Status.Funded
        ? `Job status is ${STATUS_LABEL[job.status]}.`
        : `Deadline passed at block #${job.deadline.toLocaleString()}.`
      : undefined
    actions.push({ label: 'Submit work', key: 'submitWork', enabled, reason })
  }

  // client + Submitted -> Approve work & pay
  if (isClient) {
    const enabled = job.status === Status.Submitted
    const reason = !enabled
      ? `Job must be Submitted (currently ${STATUS_LABEL[job.status]}).`
      : undefined
    actions.push({ label: 'Approve work & pay', key: 'approve', enabled, reason })
  }

  // client + Funded + after deadline -> Refund
  if (isClient) {
    const enabled = job.status === Status.Funded && block >= job.deadline
    const reason = !enabled
      ? job.status !== Status.Funded
        ? `Job status is ${STATUS_LABEL[job.status]}.`
        : `Deadline not reached yet (${blocksToMinutes(job.deadline - block)} remaining).`
      : undefined
    actions.push({ label: 'Refund', key: 'refund', enabled, reason })
  }

  // provider + Submitted + after reviewDeadline -> Claim timeout
  if (isProvider) {
    const enabled = job.status === Status.Submitted && block >= job.reviewDeadline
    const reason = !enabled
      ? job.status !== Status.Submitted
        ? `Job must be Submitted (currently ${STATUS_LABEL[job.status]}).`
        : `Review window open for ${blocksToMinutes(job.reviewDeadline - block)} more.`
      : undefined
    actions.push({ label: 'Claim timeout', key: 'claimTimeout', enabled, reason })
  }

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="mono text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
            #{job.id.toString()}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: statusColors.bg, color: statusColors.text }}
          >
            {STATUS_LABEL[job.status]}
          </span>
        </div>
        <span className="display text-base font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
          {formatUsdc(job.amount)} <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
        </span>
      </div>

      {/* Addresses */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl px-3 py-2 space-y-0.5" style={{ background: 'var(--surface-muted)' }}>
          <div className="font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--subtle)' }}>Client</div>
          <div className="mono tabular-nums" style={{ color: isClient ? 'var(--accent)' : 'var(--ink-2)' }}>
            {shortAddr(job.client)} {isClient && <span style={{ color: 'var(--accent)' }}>(you)</span>}
          </div>
        </div>
        <div className="rounded-xl px-3 py-2 space-y-0.5" style={{ background: 'var(--surface-muted)' }}>
          <div className="font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--subtle)' }}>Provider</div>
          <div className="mono tabular-nums" style={{ color: isProvider ? 'var(--accent)' : 'var(--ink-2)' }}>
            {shortAddr(job.provider)} {isProvider && <span style={{ color: 'var(--accent)' }}>(you)</span>}
          </div>
        </div>
      </div>

      {/* Block info */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl px-3 py-2 space-y-0.5" style={{ background: 'var(--surface-muted)' }}>
          <div className="font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--subtle)' }}>Deadline</div>
          <div className="mono tabular-nums" style={{ color: 'var(--ink-2)' }}>#{job.deadline.toLocaleString()}</div>
          <div className="text-[10px]" style={{ color: 'var(--subtle)' }}>
            {block > 0n
              ? block >= job.deadline
                ? 'Passed'
                : `${blocksToMinutes(job.deadline - block)} left`
              : '…'
            }
          </div>
        </div>
        {job.reviewDeadline > 0n && (
          <div className="rounded-xl px-3 py-2 space-y-0.5" style={{ background: 'var(--surface-muted)' }}>
            <div className="font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--subtle)' }}>Review deadline</div>
            <div className="mono tabular-nums" style={{ color: 'var(--ink-2)' }}>#{job.reviewDeadline.toLocaleString()}</div>
            <div className="text-[10px]" style={{ color: 'var(--subtle)' }}>
              {block > 0n
                ? block >= job.reviewDeadline
                  ? 'Passed'
                  : `${blocksToMinutes(job.reviewDeadline - block)} left`
                : '…'
              }
            </div>
          </div>
        )}
      </div>

      {/* Role label */}
      {address && (
        <div
          className="rounded-xl px-3 py-1.5 text-xs font-medium"
          style={{
            background: isClient || isProvider ? 'rgba(172,198,233,0.08)' : 'transparent',
            border: `1px solid ${isClient || isProvider ? 'rgba(172,198,233,0.18)' : 'transparent'}`,
            color: isClient || isProvider ? 'var(--accent)' : 'var(--subtle)',
          }}
        >
          {isClient && isProvider
            ? 'You are both client and provider of this job.'
            : isClient
              ? `You are the client of job #${job.id.toString()}.`
              : isProvider
                ? `You are the provider of job #${job.id.toString()}.`
                : 'Not a party to this job.'}
        </div>
      )}

      {/* Actions */}
      {actions.length > 0 && (
        <div className="space-y-2 pt-1">
          {actions.map(action => (
            <ActionButton
              key={action.key}
              label={action.label}
              onClick={() => call(action.key)}
              disabled={!action.enabled}
              disabledReason={action.reason}
              isPending={walletPending}
              isConfirming={confirming}
              isSuccess={isSuccess}
              txHash={txHash}
              error={errMsg}
            />
          ))}
        </div>
      )}

      {!address && (
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>Connect wallet to act on this job.</p>
      )}
    </div>
  )
}
