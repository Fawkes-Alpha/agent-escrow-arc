import { useCallback } from 'react'
import { useReadContracts, useBlockNumber } from 'wagmi'
import { Loader2, RefreshCw, Inbox } from 'lucide-react'
import { ESCROW_ADDRESS, ESCROW_ABI, ARC_MAINNET_CHAIN_ID, Job } from '../escrow-contract'
import { JobCard } from './JobCard'

interface Props {
  jobCount: bigint
  onRefresh: () => void
  refreshKey: number
}

export function JobList({ jobCount, onRefresh, refreshKey: _refreshKey }: Props) {
  // One shared block-number watcher for the whole list.
  // Previously each JobCard ran its own `useBlockNumber({ watch: true })`,
  // which meant N+1 concurrent pollers hammering the RPC simultaneously — the
  // primary cause of the tab freeze while a transaction was confirming.
  const { data: blockNumber } = useBlockNumber({
    chainId: ARC_MAINNET_CHAIN_ID,
    watch: true,
    // Arc blocks are ~0.506 s. Poll at 1 s to stay current without flooding the RPC.
    query: { refetchInterval: 1_000 },
  })
  const block = blockNumber ?? 0n

  // Build read calls for all jobs
  const ids = Array.from({ length: Number(jobCount) }, (_, i) => BigInt(i + 1))

  const { data: jobResults, isLoading, refetch } = useReadContracts({
    contracts: ids.map(id => ({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'getJob' as const,
      args: [id] as [bigint],
      chainId: ARC_MAINNET_CHAIN_ID,
    })),
    query: { enabled: jobCount > 0n },
  })

  const handleRefresh = useCallback(() => {
    void refetch()
    onRefresh()
  }, [refetch, onRefresh])

  const jobs: Job[] = (jobResults ?? []).flatMap((r, i) => {
    if (r.status !== 'success' || !r.result) return []
    const raw = r.result as {
      client: string; provider: string; amount: bigint
      deadline: bigint; reviewDeadline: bigint; status: number
    }
    return [{
      id: ids[i],
      client: raw.client,
      provider: raw.provider,
      amount: raw.amount,
      deadline: raw.deadline,
      reviewDeadline: raw.reviewDeadline,
      status: raw.status,
    }]
  })

  return (
    <section className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="display text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          Jobs
          {jobCount > 0n && (
            <span
              className="ml-2 rounded-full px-2 py-0.5 text-xs"
              style={{ background: 'var(--surface-strong)', color: 'var(--subtle)' }}
            >
              {jobCount.toString()}
            </span>
          )}
        </h2>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-[1.02]"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          <RefreshCw className="size-3" /> Refresh
        </button>
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-12" style={{ color: 'var(--subtle)' }}>
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Loading jobs…</span>
        </div>
      )}

      {!isLoading && jobCount === 0n && (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-2xl py-14"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <Inbox className="size-8" style={{ color: 'var(--subtle)' }} />
          <p className="text-sm" style={{ color: 'var(--subtle)' }}>No jobs yet. Create one above.</p>
        </div>
      )}

      {!isLoading && jobs.length > 0 && (
        <div className="space-y-3">
          {[...jobs].reverse().map(job => (
            <JobCard
              key={job.id.toString()}
              job={job}
              blockNumber={block}
              onAction={handleRefresh}
            />
          ))}
        </div>
      )}
    </section>
  )
}
