import assert from 'node:assert/strict'
import { it } from 'vitest'

/** The bench remains outside the production TypeScript export graph. */
const driverUrl = new URL('../../bench/ipc.mjs', import.meta.url).href

it('[A27-FIX2] DA1 rejects frozen-W3 p50 regression even when absolute budgets pass', async () => {
  /** Complete identical units satisfy the existing paired-measurement contract. */
  const unit = { id: 'guard-fixture', codec: 'json', carrier: 'stdio-framed', payloadBytes: 64 }
  /** A deterministic receipt isolates the missing baseline verdict from host timing noise. */
  const receipt = (factor: number) => ({
    unit,
    samples: 1000,
    latenciesNs: Array.from({ length: 1000 }, () => 10 * factor),
    p50Ns: 10 * factor,
    p95Ns: 10 * factor,
    p99Ns: 10 * factor,
    elapsedNs: 1000 * factor,
    throughputPerSecond: 1000 / factor,
    cpuNsPerRequest: factor,
    rssAbsolutePeakSumBytes: 20 * factor,
    cpuByPid: [
      { pid: 1, cpuNs: 500 * factor },
      { pid: 2, cpuNs: 500 * factor }
    ],
    rssPeaksByPid: [
      { pid: 1, rssBytes: 10 * factor },
      { pid: 2, rssBytes: 10 * factor }
    ],
    parentPid: 1,
    peerPid: 2,
    encodedBytes: 66,
    concurrency: 1,
    runtime: 'v24.16.0'
  })
  /** No pair can be discarded; the same old absolute verdict is the positive control. */
  const rounds = [0, 1, 2].map((index) => ({
    order: index % 2 ? ['rpc', 'bare'] : ['bare', 'rpc'],
    bare: receipt(1),
    rpc: receipt(2)
  }))
  /** Previous W3-normalized performance and independently supplied A/A noise remain fixed. */
  const guard = { baseline: { p50Ratio: 1, sourceCommit: 'frozen-fixture' }, noiseBand: 0.01 }
  /** The old function accepts extra arguments but ignores this missing regression requirement. */
  const { judgeDa1Pairs } = await import(/* @vite-ignore */ driverUrl)
  assert.equal(judgeDa1Pairs(rounds, 'small').status, 'pass')
  assert.equal(
    judgeDa1Pairs(rounds, 'small', undefined, guard).status,
    'fail',
    '[A27-FIX2] frozen-baseline regression is a failure independent of the absolute budgets'
  )
})
