import { useState, useCallback, useEffect } from 'react'
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain, usePublicClient,
} from 'wagmi'
import { erc20Abi, parseUnits, isAddress } from 'viem'
import { Loader2, CheckCircle2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import {
  ESCROW_ADDRESS, USDC_ADDRESS, ESCROW_ABI, ARC_MAINNET_CHAIN_ID,
  EXPLORER_BASE, blocksToMinutes, parseRevertError,
} from '../escrow-contract'

interface Props {
  onJobCreated: () => void
}

const BLOCK_OFFSET_DEFAULT = 10000

export function CreateJobForm({ onJobCreated }: Props) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = chainId !== ARC_MAINNET_CHAIN_ID
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID })

  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState('')
  const [amountStr, setAmountStr] = useState('')
  const [blockOffset, setBlockOffset] = useState(String(BLOCK_OFFSET_DEFAULT))
  // Absolute block number shown as preview (updated when the user types)
  const [previewDeadlineBlock, setPreviewDeadlineBlock] = useState<bigint | null>(null)

  // Derived
  const amountRaw = amountStr ? parseUnits(amountStr, 6) : 0n
  const blockOffsetNum = parseInt(blockOffset, 10)
  const isValidBlockOffset = blockOffsetNum > 0 && !Number.isNaN(blockOffsetNum)

  // Step 1: read current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, ESCROW_ADDRESS] : undefined,
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  const needsApproval = amountRaw > 0n && (allowance ?? 0n) < amountRaw

  // Step 1: approve
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: approveWalletPending,
    error: approveWriteError,
    reset: resetApprove,
  } = useWriteContract()
  const {
    isLoading: approveConfirming,
    isSuccess: approveSuccess,
  } = useWaitForTransactionReceipt({
    hash: approveTxHash,
    chainId: ARC_MAINNET_CHAIN_ID,
    // Poll at 1 s intervals; give up after 2 minutes.
    pollingInterval: 1_000,
    timeout: 120_000,
  })

  // Step 2: createJob
  const {
    writeContract: writeCreate,
    data: createTxHash,
    isPending: createWalletPending,
    error: createWriteError,
    reset: resetCreate,
  } = useWriteContract()
  const {
    isLoading: createConfirming,
    isSuccess: createSuccess,
  } = useWaitForTransactionReceipt({
    hash: createTxHash,
    chainId: ARC_MAINNET_CHAIN_ID,
    // Poll at 1 s intervals; give up after 2 minutes.
    pollingInterval: 1_000,
    timeout: 120_000,
  })

  // When approve confirms, re-fetch allowance
  const handleApprove = useCallback(() => {
    if (wrongChain) { switchChain({ chainId: ARC_MAINNET_CHAIN_ID }); return }
    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ESCROW_ADDRESS, amountRaw],
      chainId: ARC_MAINNET_CHAIN_ID,
    })
  }, [wrongChain, switchChain, writeApprove, amountRaw])

  // Update the deadline preview on blur (fresh block number from the chain)
  const handleBlockOffsetBlur = useCallback(() => {
    if (!publicClient || !isValidBlockOffset) { setPreviewDeadlineBlock(null); return }
    void publicClient.getBlockNumber().then(bn => {
      setPreviewDeadlineBlock(bn + BigInt(blockOffsetNum))
    }).catch(() => { setPreviewDeadlineBlock(null) })
  }, [publicClient, blockOffsetNum, isValidBlockOffset])

  // Fetch a fresh block number at click time so the deadline is always absolute
  const handleCreateJob = useCallback(() => {
    if (wrongChain) { switchChain({ chainId: ARC_MAINNET_CHAIN_ID }); return }
    if (!publicClient) return
    void refetchAllowance()
    // getBlockNumber() is a fresh RPC call — no stale cache
    void publicClient.getBlockNumber().then(currentBlock => {
      const absoluteDeadline = currentBlock + BigInt(blockOffsetNum)
      setPreviewDeadlineBlock(absoluteDeadline)
      writeCreate({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: 'createJob',
        args: [provider as `0x${string}`, amountRaw, absoluteDeadline],
        chainId: ARC_MAINNET_CHAIN_ID,
      })
    })
  }, [wrongChain, switchChain, refetchAllowance, publicClient, provider, amountRaw, blockOffsetNum, writeCreate])

  const isValidProvider = isAddress(provider)
  const isValidAmount = amountRaw > 0n
  const canProceed = isValidProvider && isValidAmount && isValidBlockOffset && !!address

  // Notify parent exactly once when the create tx confirms.
  // A render-body call would fire on every re-render while createSuccess is true,
  // causing an infinite refetch loop that freezes the tab.
  useEffect(() => {
    if (createSuccess) onJobCreated()
  }, [createSuccess, onJobCreated])

  const step1Done = approveSuccess || !needsApproval
  const approveError = approveWriteError ? parseRevertError(approveWriteError) : null
  const createError = createWriteError ? parseRevertError(createWriteError) : null

  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="display text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          Create job
        </span>
        {open
          ? <ChevronUp className="size-4" style={{ color: 'var(--subtle)' }} />
          : <ChevronDown className="size-4" style={{ color: 'var(--subtle)' }} />
        }
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          {/* Provider */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              Provider address
            </label>
            <input
              value={provider}
              onChange={e => setProvider(e.target.value.trim())}
              placeholder="0x..."
              className="mono w-full rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:opacity-40"
              style={{
                background: 'var(--surface-strong)',
                border: `1px solid ${isValidProvider || !provider ? 'var(--border)' : 'var(--danger)'}`,
                color: 'var(--ink)',
              }}
            />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              Amount (USDC)
            </label>
            <input
              inputMode="decimal"
              value={amountStr}
              onChange={e => {
                const v = e.target.value.replace(/[^0-9.]/g, '')
                if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) setAmountStr(v)
              }}
              placeholder="0.00"
              className="display w-full rounded-xl px-3.5 py-2.5 text-2xl font-bold tabular-nums outline-none placeholder:opacity-30"
              style={{
                background: 'var(--surface-strong)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
            />
          </div>

          {/* Deadline */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              Deadline (blocks from now)
            </label>
            <input
              inputMode="numeric"
              value={blockOffset}
              onChange={e => {
                setBlockOffset(e.target.value.replace(/[^0-9]/g, ''))
                setPreviewDeadlineBlock(null) // invalidate preview until blur
              }}
              onBlur={handleBlockOffsetBlur}
              placeholder="10000"
              className="mono w-full rounded-xl px-3.5 py-2.5 text-sm tabular-nums outline-none"
              style={{
                background: 'var(--surface-strong)',
                border: `1px solid ${isValidBlockOffset || !blockOffset ? 'var(--border)' : 'var(--danger)'}`,
                color: 'var(--ink)',
              }}
            />
            {!isValidBlockOffset && blockOffset !== '' && (
              <p className="text-xs" style={{ color: 'var(--danger)' }}>
                Enter a number greater than 0.
              </p>
            )}
            {isValidBlockOffset && (
              <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                {previewDeadlineBlock != null
                  ? <>Deadline: block <span className="mono" style={{ color: 'var(--muted)' }}>{previewDeadlineBlock.toLocaleString()}</span> · {blocksToMinutes(blockOffsetNum)} from now</>
                  : <>{blocksToMinutes(blockOffsetNum)} from now · click the field and tab away to see the absolute block</>
                }
              </p>
            )}
          </div>

          {/* Two-step actions */}
          {canProceed && (
            <div className="space-y-2.5 pt-1">
              {/* Step indicator */}
              <div className="flex gap-2 text-xs" style={{ color: 'var(--subtle)' }}>
                <div className={`flex items-center gap-1 font-semibold ${step1Done ? '' : ''}`} style={{ color: step1Done ? 'var(--success)' : 'var(--muted)' }}>
                  {step1Done
                    ? <CheckCircle2 className="size-3.5" />
                    : <span className="inline-flex size-3.5 items-center justify-center rounded-full border text-[10px]" style={{ borderColor: 'var(--muted)' }}>1</span>
                  }
                  Approve USDC spending
                </div>
                <span style={{ color: 'var(--border-strong)' }}>›</span>
                <div className="flex items-center gap-1 font-semibold" style={{ color: createSuccess ? 'var(--success)' : 'var(--subtle)' }}>
                  {createSuccess
                    ? <CheckCircle2 className="size-3.5" />
                    : <span className="inline-flex size-3.5 items-center justify-center rounded-full border text-[10px]" style={{ borderColor: 'var(--subtle)' }}>2</span>
                  }
                  Create job
                </div>
              </div>

              {/* Step 1: Approve */}
              {needsApproval && !approveSuccess && (
                <div className="space-y-1.5">
                  <button
                    disabled={approveWalletPending || approveConfirming || wrongChain}
                    onClick={handleApprove}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: 'var(--surface-strong)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}
                  >
                    {approveWalletPending
                      ? <><Loader2 className="size-4 animate-spin" /> Confirm in wallet...</>
                      : approveConfirming
                        ? <><Loader2 className="size-4 animate-spin" /> Confirming...</>
                        : wrongChain
                          ? 'Switch to Arc'
                          : 'Step 1: Approve USDC spending'
                    }
                  </button>
                  {approveTxHash && (
                    <a
                      href={`${EXPLORER_BASE}/tx/${approveTxHash}`}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-xs"
                      style={{ color: 'var(--accent)' }}
                    >
                      <ExternalLink className="size-3" /> View approval tx
                    </a>
                  )}
                  {approveError && (
                    <p className="text-xs" style={{ color: 'var(--danger)' }}>{approveError}</p>
                  )}
                </div>
              )}

              {/* Step 2: Create */}
              <div className="space-y-1.5">
                <button
                  disabled={
                    needsApproval && !approveSuccess ||
                    createWalletPending || createConfirming || createSuccess || wrongChain
                  }
                  onClick={handleCreateJob}
                  className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: '#0d1b2f' }}
                >
                  {createWalletPending
                    ? <><Loader2 className="size-4 animate-spin" /> Confirm in wallet...</>
                    : createConfirming
                      ? <><Loader2 className="size-4 animate-spin" /> Confirming...</>
                      : createSuccess
                        ? <><CheckCircle2 className="size-4" /> Job created!</>
                        : wrongChain
                          ? 'Switch to Arc'
                          : 'Step 2: Create job'
                  }
                </button>
                {createTxHash && (
                  <a
                    href={`${EXPLORER_BASE}/tx/${createTxHash}`}
                    target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs"
                    style={{ color: 'var(--accent)' }}
                  >
                    <ExternalLink className="size-3" /> View tx
                  </a>
                )}
                {createError && (
                  <p className="text-xs" style={{ color: 'var(--danger)' }}>{createError}</p>
                )}
              </div>

              {/* Reset after success */}
              {createSuccess && (
                <button
                  onClick={() => {
                    setProvider(''); setAmountStr(''); setBlockOffset(String(BLOCK_OFFSET_DEFAULT))
                    resetApprove(); resetCreate(); setOpen(false)
                  }}
                  className="w-full rounded-xl py-2.5 text-sm font-semibold"
                  style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                >
                  Create another job
                </button>
              )}
            </div>
          )}

          {!address && (
            <p className="text-center text-sm" style={{ color: 'var(--subtle)' }}>
              Connect your wallet to create a job.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
