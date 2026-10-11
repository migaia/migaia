import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { median, nearestRank, interval95, resetSeed } from './statistics.mjs'
import { CrossRuntimeErrorText } from '../error-text.mjs'

/** Recompute only actual complete directed rows; partial campaign coverage remains explicit. */
const root = process.argv[2]
/** A terminal row's SHA binds every original window/latency/native-PID observation. */
const entries = JSON.parse(readFileSync(join(root, 'results.json'), 'utf8'))
/** Metrics match independent endpoint roles, never numeric PIDs from another launch. */
function metrics(arm) {
  const values = {
    wall: (arm.business.elapsedMs * 1e6) / arm.samples,
    p50: nearestRank(arm.business.latenciesNs, 0.5),
    p99: nearestRank(arm.business.latenciesNs, 0.99)
  }
  for (const role of ['parent', 'peer'])
    values['cpu.' + role] =
      arm.cpuByPid.find((row) => row.pid === arm[role + 'Pid']).cpuNs / arm.samples
  if (Object.values(values).some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error(CrossRuntimeErrorText.metric)
  return values
}
/** Whole six-block cross-runtime ABBA/AA scope preserves the original directed protocol. */
const rows = []
for (const entry of entries) {
  if (entry.status !== 'PASS') continue
  const bytes = readFileSync(entry.raw)
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(CrossRuntimeErrorText.rawSHA)
  const raw = JSON.parse(bytes)
  if (
    raw.status !== 'PASS' ||
    raw.samples.length !== 6 ||
    raw.AA.length !== 12 ||
    !raw.timingAdmission.qualified
  )
    throw new Error(CrossRuntimeErrorText.timingScope)
  const blocks = []
  for (const block of raw.samples) {
    if (block.order.join(',') !== 'rpc,bare,bare,rpc' || block.windows.length !== 4)
      throw new Error(CrossRuntimeErrorText.order)
    for (const arm of block.windows)
      if (arm.samples !== 800 || arm.warm.calls !== 200 || arm.business.latenciesNs.length !== 800)
        throw new Error(CrossRuntimeErrorText.parameters)
    const values = block.windows.map(metrics),
      ratios = {},
      rpc = {},
      bare = {}
    for (const key of Object.keys(values[0])) {
      rpc[key] = Math.sqrt(values[0][key] * values[3][key])
      bare[key] = Math.sqrt(values[1][key] * values[2][key])
      ratios[key] = rpc[key] / bare[key]
    }
    blocks.push({ block: block.block, rpc, bare, ratios })
  }
  resetSeed()
  const values = {}
  for (const key of Object.keys(blocks[0].ratios)) {
    const drift = []
    for (let block = 0; block < 6; block++) {
      const rpc = raw.AA.find((row) => row.block === block && row.side === 'rpc'),
        bare = raw.AA.find((row) => row.block === block && row.side === 'bare')
      drift.push(
        metrics(rpc.second)[key] /
          metrics(rpc.first)[key] /
          (metrics(bare.second)[key] / metrics(bare.first)[key])
      )
    }
    const confidence = interval95(blocks.map((row) => row.ratios[key])),
      AA = interval95(drift)
    const noise = Math.max(Math.abs(AA.lower - 1), Math.abs(AA.upper - 1)),
      limit = key === 'wall' ? 4 : key === 'p99' || key.startsWith('cpu.') ? 5 : null
    values[key] = {
      ratio: confidence,
      ownAA: AA,
      noise,
      limit,
      verdict: limit === null ? 'TRACKING' : confidence.center <= limit ? 'PASS' : 'GAP',
      rpc: median(blocks.map((row) => row.rpc[key])),
      bare: median(blocks.map((row) => row.bare[key]))
    }
  }
  rows.push({
    cell: entry.key,
    head: raw.head,
    raw: entry.raw,
    rawSHA256: entry.sha256,
    capacity: raw.productLimits,
    admission: raw.timingAdmission,
    blocks,
    values,
    memory: 'UNAVAILABLE_FOR_RELATIVE_ACCEPTANCE: shared parent graphs; boundary snapshots only',
    cpuScope: raw.samples[0].windows[0].cpuScope
  })
}
writeFileSync(
  join(root, 'derived.json'),
  JSON.stringify(
    {
      completeRows: rows.length,
      requiredRows: 54,
      qualification:
        'optionA start only; end report; each metric actual AA tolerance, no10percent gate',
      boundary:
        'current C3 + disposable BC14 reverse baseline, not final optimized production acceptance',
      rows
    },
    null,
    2
  ) + '\n'
)
console.log(JSON.stringify({ completeRows: rows.length, requiredRows: 54 }))
