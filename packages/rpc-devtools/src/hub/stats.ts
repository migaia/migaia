import type { IRpcDevtoolsStats } from '../contract/service.js'

/** Rows remain owned by their source target unless more than one source contributes to them. */
type IHubMethodStats = IRpcDevtoolsStats['methods'][number]

/** Summed rows are a service-boundary representation, with mutable bucket counters during merge. */
type IHubMethodAggregate = {
  endpointId: string
  method: string
  calls: number
  failed: number
  rejected: number
  timedOut: number
  aborted: number
  latencyBucketsMs: readonly number[]
  latencyCounts: number[]
  /** Extent is known only when every contributing target supplied its observed maximum. */
  latencyMaxMs?: number
  /** The common terminal bucket's lower boundary is open above this measured range. */
  latencyOverflowFromMs?: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

/** The nested identity index distinguishes endpoint/method pairs without delimiter collisions. */
type IHubStatsEntry = {
  index: number
  aggregate?: IHubMethodAggregate
}

/**
 * Build an aggregate only when another source contributes to the same endpoint/method pair. SC9(b):
 * bucket arithmetic requires a new summed service representation; boundaries retain refs.
 */
function createMethodAggregate(row: IHubMethodStats): IHubMethodAggregate {
  /** Counts become the new sum, rather than a defensive copy of a query result. */
  const counts: number[] = []
  for (let index = 0; index < row.latencyCounts.length; index++)
    counts[index] = row.latencyCounts[index]!
  return {
    endpointId: row.endpointId,
    method: row.method,
    calls: row.calls,
    failed: row.failed,
    rejected: row.rejected,
    timedOut: row.timedOut,
    aborted: row.aborted,
    latencyBucketsMs: row.latencyBucketsMs,
    latencyCounts: counts,
    latencyMaxMs: row.latencyMaxMs,
    latencyOverflowFromMs: row.latencyOverflowFromMs,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0
  }
}

/** Add the complete source histogram and outcome counters without averaging source percentiles. */
function addMethodStats(aggregate: IHubMethodAggregate, row: IHubMethodStats): void {
  aggregate.calls += row.calls
  aggregate.failed += row.failed
  aggregate.rejected += row.rejected
  aggregate.timedOut += row.timedOut
  aggregate.aborted += row.aborted
  aggregate.latencyMaxMs =
    aggregate.latencyMaxMs !== undefined && row.latencyMaxMs !== undefined
      ? Math.max(aggregate.latencyMaxMs, row.latencyMaxMs)
      : undefined
  aggregate.latencyOverflowFromMs ??= row.latencyOverflowFromMs
  for (let index = 0; index < aggregate.latencyCounts.length; index++) {
    aggregate.latencyCounts[index]! += row.latencyCounts[index]!
  }
}

/** Interpolate the requested quantile within its fixed contract bucket's lower and upper bounds. */
function histogramPercentile(row: IHubMethodAggregate, total: number, percentile: number): number {
  if (total === 0) return 0
  /** The rank uses histogram samples; calls without measured latency do not invent a duration. */
  const rank = total * percentile
  /** Only measured samples advance the rank through the histogram. */
  let previous = 0
  for (let index = 0; index < row.latencyCounts.length; index++) {
    /** The contract's fixed 24 buckets share boundaries across every target. */
    const count = row.latencyCounts[index]!
    if (count > 0 && rank <= previous + count) {
      /** The first bucket begins at zero; later buckets begin at their preceding boundary. */
      const lower = index === 0 ? 0 : row.latencyBucketsMs[index - 1]!
      /** The current boundary caps interpolation within the bucket's documented width. */
      const upper =
        index === row.latencyCounts.length - 1 && row.latencyMaxMs !== undefined
          ? Math.max(lower, row.latencyMaxMs)
          : row.latencyBucketsMs[index]!
      return Math.min(
        row.latencyMaxMs ?? Infinity,
        lower + ((upper - lower) * (rank - previous)) / count
      )
    }
    previous += count
  }
  return row.latencyBucketsMs[row.latencyBucketsMs.length - 1]!
}

/**
 * Merge target stats by endpoint/method identity and sum their fixed histograms bucket by bucket.
 * Unique source rows remain references. Empty input has no start time, represented by since=0.
 */
export function mergeStats(input: readonly IRpcDevtoolsStats[]): IRpcDevtoolsStats {
  if (input.length === 0) return { since: 0, methods: [] }
  if (input.length === 1) return input[0]!
  /** The earliest target start bounds the period represented by the merged counters. */
  let since = input[0]!.since
  /** SC9 permits a result array containing unique source rows and necessary aggregate rows. */
  const methods: IHubMethodStats[] = []
  /** Endpoint and method occupy separate Map keys, preserving their complete string identities. */
  const groups = new Map<string, Map<string, IHubStatsEntry>>()
  /** Only summed rows require percentile recalculation after all target counts are added. */
  const aggregates: IHubMethodAggregate[] = []
  for (const stats of input) {
    since = Math.min(since, stats.since)
    for (const row of stats.methods) {
      /** Each endpoint owns one method index shared by its contributing targets. */
      let endpoint = groups.get(row.endpointId)
      if (endpoint === undefined) {
        endpoint = new Map<string, IHubStatsEntry>()
        groups.set(row.endpointId, endpoint)
      }
      /** The first row retains identity until a second source makes arithmetic necessary. */
      const entry = endpoint.get(row.method)
      if (entry === undefined) {
        endpoint.set(row.method, { index: methods.length })
        methods.push(row)
        continue
      }
      /** One mutable aggregate is reused for every subsequent contribution to this identity. */
      let aggregate = entry.aggregate
      if (aggregate === undefined) {
        aggregate = createMethodAggregate(methods[entry.index]!)
        entry.aggregate = aggregate
        methods[entry.index] = aggregate
        aggregates.push(aggregate)
      }
      addMethodStats(aggregate, row)
    }
  }
  for (const aggregate of aggregates) {
    /** Histogram counts supply the shared sample total for all three requested percentiles. */
    let total = 0
    for (const count of aggregate.latencyCounts) total += count
    aggregate.p50Ms = histogramPercentile(aggregate, total, 0.5)
    aggregate.p95Ms = histogramPercentile(aggregate, total, 0.95)
    aggregate.p99Ms = histogramPercentile(aggregate, total, 0.99)
  }
  return { since, methods }
}
