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

it('[U33] W3 rejects concurrent throughput loss beyond measured noise while B0 stays tracking', async () => {
  /** One complete controlled receipt isolates throughput regression from CPU and clock noise. */
  const unit = {
    id: 'sdk-concurrency-fixture',
    codec: 'identity',
    carrier: 'worker',
    payloadBytes: 64
  }
  /** Only throughput changes; all historical B0 tracking and baseline observation fields stay valid. */
  const receipt = (throughput: number) => ({
    unit,
    samples: 1000,
    latenciesNs: Array.from({ length: 1000 }, () => 10),
    p50Ns: 10,
    p95Ns: 10,
    p99Ns: 10,
    elapsedNs: (1000 * 1e9) / throughput,
    throughputPerSecond: throughput,
    cpuNsPerRequest: 1,
    rssAbsolutePeakSumBytes: 20,
    cpuByPid: [{ pid: 1, cpuNs: 1000 }],
    rssPeaksByPid: [{ pid: 1, rssBytes: 20 }],
    parentPid: 1,
    peerPid: 1,
    encodedBytes: 66,
    concurrency: 16,
    runtime: 'v24.16.0'
  })
  const rounds = [0, 1, 2].map((index) => ({
    order: index % 2 ? ['rpc', 'bare'] : ['bare', 'rpc'],
    bare: receipt(1000),
    rpc: receipt(600)
  }))
  const bench = await import(/* @vite-ignore */ driverUrl)
  /** A 25% drop from final SDK 0.8 exceeds 2% A/A; the historical 0.552 floor still passes. */
  const baseline = { scope: 'paired', metrics: { throughputPerSecond: 0.8 } }
  const noise = { throughputPerSecond: 0.02 }
  const old = bench.judgeDa1Pairs(rounds, 'concurrency', 0.552)
  assert.equal(old.status, 'pass')
  const judged = bench.judgeSdkRegression ? bench.judgeSdkRegression(rounds, baseline, noise) : old
  assert.equal(
    judged.status,
    'fail',
    '[U33] final SDK throughput guard must reject the injected loss'
  )
  assert.equal(
    bench.judgeDa1Pairs(rounds, 'concurrency', 0.552, { sdk: { baseline, noise } }).status,
    'fail',
    '[U33] the existing DA1/W3 verdict must retain the SDK throughput failure'
  )
  assert.equal(
    bench.judgeSdkRegression(rounds, { ...baseline, metrics: { throughputPerSecond: 0.61 } }, noise)
      .status,
    'pass',
    '[U33] a decrease within the same measured noise band remains accepted'
  )
})

it('[A37] Deno SDK guard retains all four relative metrics and rejects p99 regression', async () => {
  const bench = await import(/* @vite-ignore */ driverUrl)
  /** Complete paired observations isolate the p99 direction without historical Deno values. */
  const side = (tail: number) => ({
    samples: 1000,
    latenciesNs: Array.from({ length: 1000 }, (_, index) => (index < 980 ? 10 : tail)),
    throughputPerSecond: 1000
  })
  const rounds = [0, 1, 2].map(() => ({ bare: side(20), rpc: side(40) }))
  const baseline = {
    scope: 'paired',
    metrics: { p50Ns: 1, p95Ns: 1, p99Ns: 1, throughputPerSecond: 1 }
  }
  const noise = { p50Ns: 0.05, p95Ns: 0.05, p99Ns: 0.05, throughputPerSecond: 0.05 }
  const judged = bench.judgeSdkRegression(rounds, baseline, noise)
  assert.equal(judged.status, 'fail')
  assert.deepEqual(judged.failedMetrics, ['p99Ns'])
  assert.deepEqual(Object.keys(judged.metrics), Object.keys(baseline.metrics))
})

it('[U45] final public Peer freeze rejects p50 loss hidden by the historical primitive value', async () => {
  /** The existing oracle and cold reference selection execute independently of native timing. */
  const bench = await import(/* @vite-ignore */ driverUrl)
  /** Complete retained samples isolate baseline selection from every absolute DA1 budget. */
  const side = (latency: number) => ({
    unit: { carrier: 'stdio-framed' },
    samples: 1000,
    latenciesNs: Array.from({ length: 1000 }, () => latency)
  })
  const rounds = [0, 1, 2].map(() => ({ bare: side(100), rpc: side(525) }))
  /** The older primitive value is a positive control that would hide this public-source regression. */
  const historical = { p50Ratio: 10, sourceCommit: 'historical-primitive' }
  /** Each final-source cell supplies its own frozen p50 while keeping history untouched. */
  const baseline = {
    sourceCommit: 'final-public-source',
    cells: { 'public-fixture': { p50Ratio: 5 } }
  }
  /** Calibration has the final reference identity; historical noise is independently rejected. */
  const noise = {
    sourceCommit: baseline.sourceCommit,
    representatives: [1, 2, 3, 4],
    p50RatioNoiseBand: 0.02
  }
  /** Before U45 wiring the CLI uses the historical primitive cell regardless of public data. */
  const guard = bench.resolveW3Guard?.('public-fixture', baseline, noise) ?? {
    baseline: historical,
    noiseBand: noise.p50RatioNoiseBand
  }
  assert.equal(bench.judgeW3Regression(rounds, historical, noise.p50RatioNoiseBand).status, 'pass')
  assert.equal(
    bench.judgeW3Regression(rounds, guard.baseline, guard.noiseBand).status,
    'fail',
    '[U45] the new public baseline must detect 5% loss beyond its own 2% noise'
  )
  assert.equal(guard.baseline.sourceCommit, baseline.sourceCommit)
  assert.throws(
    () =>
      bench.resolveW3Guard('public-fixture', baseline, {
        ...noise,
        sourceCommit: historical.sourceCommit
      }),
    '[U45] primitive calibration cannot stand in for public-source A/A'
  )
})
