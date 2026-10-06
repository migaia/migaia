import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'vitest'

/** The actual bench module is imported dynamically without executing its CLI. */
const driverUrl = new URL('../../bench/ipc.mjs', import.meta.url).href

it('[A24][U33] reports a missed B0 concurrency target without making it a gate', async () => {
  /** Existing complete raw receipts isolate verdict semantics from new timing measurements. */
  const original = JSON.parse(
    await readFile(new URL('./fixtures/da1-budget-raw.json', import.meta.url), 'utf8')
  )
  /** Matching concurrency labels exercise the same existing paired oracle. */
  const rounds = structuredClone(original.rounds)
  for (const round of rounds) {
    round.bare.concurrency = 16
    round.rpc.concurrency = 16
  }
  const { judgeDa1Pairs } = await import(driverUrl)
  const result = judgeDa1Pairs(rounds, 'concurrency', 0.552)
  assert.ok(result.ratios.throughput < 0.552)
  assert.equal(result.status, 'pass', '[U33] B0 target cannot block the complete implementation')
  assert.equal(result.tracking.throughput.status, '未达跟踪目标')
  assert.equal(result.tracking.throughput.target, 0.552)
  assert.equal(result.failedMetrics.includes('throughput'), false)
})

it('[A24] rejects an overbudget endpoint CPU hidden by an acceptable total', async () => {
  /** Historical full raw supplies complete samples and two independently attributed PIDs. */
  const original = JSON.parse(
    await readFile(new URL('./fixtures/da1-budget-raw.json', import.meta.url), 'utf8')
  )
  /** Controlled oracle metrics are deliberately separate from any measured performance claim. */
  const rounds = structuredClone(original.rounds)
  for (const round of rounds) {
    /** Every nontarget metric has an identity-ratio control before one endpoint is perturbed. */
    const bare = round.bare
    /** Candidate identity retains its independently launched PID attribution. */
    const rpc = round.rpc
    for (const key of [
      'latenciesNs',
      'p50Ns',
      'p99Ns',
      'elapsedNs',
      'throughputPerSecond',
      'cpuNsPerRequest',
      'rssAbsolutePeakSumBytes'
    ])
      rpc[key] = structuredClone(bare[key])
    rpc.cpuByPid = bare.cpuByPid.map((row: { pid: number; cpuNs: number }) => ({
      pid: row.pid === bare.parentPid ? rpc.parentPid : rpc.peerPid,
      cpuNs: row.cpuNs
    }))
    rpc.rssPeaksByPid = bare.rssPeaksByPid.map((row: { pid: number; rssBytes: number }) => ({
      pid: row.pid === bare.parentPid ? rpc.parentPid : rpc.peerPid,
      rssBytes: row.rssBytes
    }))
    /** Perturb the lesser CPU role so the aggregate remains below the obsolete total-CPU gate. */
    const target = rpc.cpuByPid.reduce((left: { cpuNs: number }, right: { cpuNs: number }) =>
      left.cpuNs < right.cpuNs ? left : right
    )
    target.cpuNs *= 5.001
    rpc.cpuNsPerRequest =
      rpc.cpuByPid.reduce((sum: number, row: { cpuNs: number }) => sum + row.cpuNs, 0) / rpc.samples
  }
  /** The legacy fallback makes missing DA1 implementation a real assertion failure, not import red. */
  const bench = await import(driverUrl)
  const result = bench.judgeDa1Pairs
    ? bench.judgeDa1Pairs(rounds, 'small')
    : bench.judgePairs(rounds)
  assert.equal(result.status, 'fail', '[A24] each endpoint CPU has its own five-times budget')
})
