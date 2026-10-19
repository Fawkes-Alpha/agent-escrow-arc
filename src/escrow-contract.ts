/**
 * AgentEscrow contract — Arc mainnet
 * Address: 0xd7589da91061f2f27ac118b22fcc3822f569359c
 * ABI derived from contracts/AgentEscrow.sol
 */

export const ESCROW_ADDRESS = '0xd7589da91061f2f27ac118b22fcc3822f569359c' as const
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const ARC_MAINNET_CHAIN_ID = 5042
export const EXPLORER_BASE = 'https://explorer.arc.io'
export const REVIEW_BLOCKS = 5000n
/** Arc block time ~0.506 s */
export const ARC_BLOCK_MS = 506

export const ESCROW_ABI = [
  // errors
  { type: 'error', name: 'NotProvider', inputs: [] },
  { type: 'error', name: 'NotClient', inputs: [] },
  { type: 'error', name: 'InvalidStatus', inputs: [] },
  { type: 'error', name: 'DeadlineNotReached', inputs: [] },
  { type: 'error', name: 'DeadlinePassed', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'DeadlineInPast', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },
  // events
  {
    type: 'event', name: 'JobCreated', inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'WorkSubmitted', inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'JobApproved', inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'JobRefunded', inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  // views
  {
    type: 'function', name: 'jobCount', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'REVIEW_BLOCKS', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function', name: 'getJob', stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'client', type: 'address' },
        { name: 'provider', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'deadline', type: 'uint64' },
        { name: 'reviewDeadline', type: 'uint64' },
        { name: 'status', type: 'uint8' },
      ],
    }],
  },
  // writes
  {
    type: 'function', name: 'createJob', stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint64' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'submitWork', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'refund', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'claimTimeout', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
] as const

export enum Status {
  Funded = 0,
  Submitted = 1,
  Approved = 2,
  Refunded = 3,
}

export interface Job {
  id: bigint
  client: string
  provider: string
  amount: bigint
  deadline: bigint
  reviewDeadline: bigint
  status: Status
}

export function parseRevertError(error: unknown): string {
  const msg = (error as Error)?.message ?? String(error)
  const lower = msg.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('user denied')) return 'Transaction cancelled.'
  // named custom errors
  const customErrors: Record<string, string> = {
    NotProvider: 'Only the provider can call this.',
    NotClient: 'Only the client can call this.',
    InvalidStatus: 'Job is not in the required status for this action.',
    DeadlineNotReached: 'The deadline or review window has not been reached yet.',
    DeadlinePassed: 'The job deadline has already passed.',
    ZeroAddress: 'Provider address cannot be zero.',
    ZeroAmount: 'Amount must be greater than zero.',
    DeadlineInPast: 'Deadline must be in the future.',
    TransferFailed: 'USDC transfer failed.',
  }
  for (const [name, label] of Object.entries(customErrors)) {
    if (msg.includes(name)) return label
  }
  if (lower.includes('insufficient')) return 'Insufficient USDC balance or allowance.'
  if (lower.includes('reverted')) return 'Transaction reverted — check the contract state.'
  return 'Transaction failed. Please try again.'
}

export function formatUsdc(raw: bigint): string {
  const n = Number(raw) / 1_000_000
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

export function blocksToMinutes(blocks: bigint | number, blockMs = ARC_BLOCK_MS): string {
  const ms = Number(blocks) * blockMs
  const mins = ms / 60_000
  if (mins < 1) return `<1 min`
  if (mins < 60) return `~${Math.round(mins)} min`
  const hrs = mins / 60
  return `~${hrs.toFixed(1)} hr`
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
