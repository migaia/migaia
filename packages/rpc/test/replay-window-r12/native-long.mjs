import assert from 'node:assert/strict'
import {
  openSync,
  closeSync,
  writeSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  readdirSync
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { nativeSession } from './native-harness.mjs'
import { nativeSample, classifyFailure, classifyProviderRejection } from './native-telemetry.mjs'
import { loadedModules } from './native-loaded.mjs'
import { assertClosureFresh } from '../../../../scripts/dist-stamp.mjs'
import { RpcCoreErrorCode } from '../../dist/core/error-code.js'
import { RpcProviderRejectionReason } from '../../dist/core/semantic-constants.js'

/** Each command owns one sustained cell; shorter duration is solely fixture preparation. */
const [mode, rateText, durationText, destination] = process.argv.slice(2)
const rate = Number(rateText)
const durationMs = Number(durationText) * 1000
assert.ok(['process', 'worker'].includes(mode))
assert.ok([50, 500, 5000].includes(rate))
assert.ok(durationMs > 0)
assertClosureFresh(resolve('packages/rpc'))
/** Raw files are exclusively created; an earlier attempt is never replaced. */
const directory = resolve(destination)
mkdirSync(directory, { recursive: true })
const latencyFile = openSync(join(directory, 'latency.jsonl'), 'wx')
const parentFile = openSync(join(directory, 'parent.jsonl'), 'wx')
const peerFile = join(directory, 'peer.jsonl')
writeFileSync(peerFile, '', { flag: 'wx' })
/** Bounded rows avoid a retained cons-string rope while preserving the original JSONL bytes. */
const latencyBuffer = []
/** The original 512-outcome cadence bounds fixture output without retaining the sample history. */
let latencyBuffered = 0
/** One bounded pacing burst covers at most 20ms of demand, matching the existing H6 fixture. */
const maxBurst = Math.max(1, Math.ceil(rate / 50))
const bursts = new Uint32Array(maxBurst + 1)
let offered = 0,
  submitted = 0,
  missed = 0,
  success = 0,
  rejected = 0,
  pending = 0
let peakPending = 0,
  peakBurst = 0,
  maximumLoad = 0
/** Counts are not substitute classifications; every event is also saved in the raw JSONL. */
const errorCounts = new Map()
/** Existing callbacks carry precise reasons; no diagnostic execution counters run here. */
const writeParent = (value) => writeSync(parentFile, JSON.stringify(value) + '\n')
const classify = (kind, value) => {
  writeParent({ kind, UTC: new Date().toISOString(), ...value })
  const key = JSON.stringify([
    kind,
    value.source,
    value.code,
    value.name,
    value.reason,
    value.message
  ])
  errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1)
}
/** Declare shared codes and applicability before the measurement window starts. */
const contract = {
  mode,
  rate,
  durationMs,
  command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
  UTC: new Date().toISOString(),
  cwd: process.cwd(),
  node: process.version,
  diagnosticCounters: 'NOT_ENABLED',
  GC: 'NOT_COLLECTED',
  observableCoreCodes: RpcCoreErrorCode,
  rejectionReasons: RpcProviderRejectionReason,
  sharedOverloadedBranches: [
    'replayLedgerFull',
    'concurrency',
    'bindingExpired',
    'outboundReplayFull',
    'queue admission'
  ],
  applicability: {
    idempotencyStore: 'not entered: no idempotency key',
    bindingExpired: 'not assembled: executor retainBinding absent',
    concurrency:
      'callback active/peak is actual business provider concurrency; admission samples are separate'
  },
  limits: {
    replayGlobal: 4096,
    replayPeer: 1024,
    providerGlobal: 256,
    providerPeer: 64,
    dataQueue: 256,
    controlQueue: 8,
    ttlMs: 310000
  },
  memory: 'separate isolate heaps; Worker RSS/process CPU have shared PID and are counted once',
  rawLatency:
    'one row per completed attempt, order is completion order; monotonic send and receive timestamps',
  rawBuffer:
    'at most 512 latency rows, then synchronous append; fixture I/O is included in observed timing'
}
/** Fingerprint all owned fixture sources before launch, independently of actual dist loader proof. */
const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url))
contract.fixtures = Object.fromEntries(
  readdirSync(fixtureDirectory)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(join(fixtureDirectory, name)))
        .digest('hex')
    ])
)
writeFileSync(join(directory, 'contract.json'), JSON.stringify(contract, null, 2), { flag: 'wx' })
process.stdout.write(JSON.stringify({ kind: 'classification-contract', ...contract }) + '\n')
const session = await nativeSession(mode, {
  telemetry: peerFile,
  collectDiagnostics: false,
  providerLimits: {
    onRejected: (value) => classify('rejection', classifyProviderRejection(value))
  },
  onFailure: (event) => classify('failure', classifyFailure(event.error, event.detail?.reason))
})
assert.equal(
  session.receipt.qualified,
  true,
  '[A1] real canonical endpoint qualifies before timing'
)
/** Persist the actual startup loader's returned bytes on both endpoints. */
const loaded = { parent: loadedModules(), peer: session.peerReady.loaded }
for (const side of Object.values(loaded)) {
  assert.ok(side.modules.length > 0, '[E3] actual startup modules are observed')
  assert.ok(
    side.modules.every((entry) => entry.matches),
    '[E3] each loaded module matches its built disk file'
  )
}
writeFileSync(join(directory, 'loaded.json'), JSON.stringify(loaded, null, 2), { flag: 'wx' })
/** Initial/final CPU boundaries supplement periodic raw sampling of both isolates. */
const initial = nativeSample(session)
assert.deepEqual(
  initial.outboundReplay,
  { active: 0, completed: 0 },
  '[A1] actual outbound owner is sampled before timing'
)
assert.deepEqual(
  initial.inboundReplay,
  { active: 0, completed: 0 },
  '[A1] actual inbound owner is sampled before timing'
)
const started = performance.now()
const sample = () => {
  const value = nativeSample(session)
  maximumLoad = Math.max(maximumLoad, value.load[0])
  writeParent({
    kind: 'sample',
    relativeMs: performance.now() - started,
    submitted,
    success,
    rejected,
    pending,
    ...value
  })
}
sample()
const timer = setInterval(sample, 1000)
/** Flushes bounded raw latency rows without exposing or retaining the business payload. */
const recordLatency = (value) => {
  latencyBuffer.push(JSON.stringify(value) + '\n')
  if (++latencyBuffered >= 512) {
    writeSync(latencyFile, latencyBuffer.join(''))
    latencyBuffer.length = 0
    latencyBuffered = 0
  }
}
let result
try {
  while (performance.now() - started < durationMs) {
    const due = Math.floor((Math.min(durationMs, performance.now() - started) * rate) / 1000)
    const debt = due - offered
    if (debt > 0) {
      const count = Math.min(debt, maxBurst)
      missed += debt - count
      offered = due
      bursts[count]++
      peakBurst = Math.max(peakBurst, count)
      for (let index = 0; index < count; index++) {
        const sequence = submitted++
        const sentMs = performance.now()
        pending++
        peakPending = Math.max(peakPending, pending)
        void session.endpoint
          .send('peer', 'echo', sequence, { timeoutMs: 10000 })
          .then((reply) => {
            assert.equal(reply, sequence, '[A1] native business reply is unchanged')
            success++
            recordLatency({ sequence, sentMs, receivedMs: performance.now(), ok: true })
          })
          .catch((error) => {
            rejected++
            const classification = classifyFailure(error)
            classify('call-rejection', classification)
            recordLatency({
              sequence,
              sentMs,
              receivedMs: performance.now(),
              ok: false,
              classification
            })
          })
          .finally(() => {
            pending--
          })
      }
    }
    await delay(Math.min(10, 1000 / rate))
  }
  missed += Math.max(0, Math.floor((durationMs * rate) / 1000) - offered)
  offered = Math.floor((durationMs * rate) / 1000)
  const offeredMs = performance.now() - started
  const drainUntil = performance.now() + 15000
  while (pending && performance.now() < drainUntil) await delay(5)
  const stats = await session.endpoint.send('peer', 'stats', null, { timeoutMs: 10000 })
  sample()
  const final = nativeSample(session)
  /** Verify actual loaded files remain identical throughout the same formal execution. */
  const drift = Object.values(loaded).flatMap((side) =>
    side.modules.filter(
      (entry) =>
        createHash('sha256').update(readFileSync(entry.path)).digest('hex') !== entry.actualSHA256
    )
  )
  result = {
    mode,
    rate,
    durationMs,
    offeredMs,
    offered,
    submitted,
    missed,
    success,
    rejected,
    pending,
    peakPending,
    maxBurst,
    peakBurst,
    bursts: [...bursts],
    initial,
    final,
    stats,
    maximumLoad,
    actualSubmittedRps: (submitted * 1000) / offeredMs,
    actualSuccessRps: (success * 1000) / offeredMs,
    classificationCounts: Object.fromEntries(errorCounts),
    drift,
    status: maximumLoad > 5 ? 'ENVIRONMENT_ERROR' : 'OBSERVED',
    GC: 'NOT_COLLECTED'
  }
  writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  process.stdout.write(JSON.stringify({ kind: 'result', ...result }) + '\n')
  assert.equal(drift.length, 0, '[E3] actual loaded artifacts stayed unchanged')
  assert.equal(pending, 0, '[A1] all submitted attempts reached a terminal result')
  assert.equal(success + rejected, submitted)
  assert.equal(
    stats.calls,
    success + 1,
    '[A1] business provider count excludes diagnostics and includes one startup echo'
  )
} finally {
  clearInterval(timer)
  if (latencyBuffer.length) writeSync(latencyFile, latencyBuffer.join(''))
  await session.close()
  const retired = nativeSample(session)
  writeParent({ kind: 'retired', ...retired })
  closeSync(latencyFile)
  closeSync(parentFile)
  assert.deepEqual(
    retired.outboundReplay,
    { active: 0, completed: 0 },
    '[A1] actual outbound retirement clears both namespaces'
  )
  assert.deepEqual(
    retired.inboundReplay,
    { active: 0, completed: 0 },
    '[A1] actual inbound retirement clears both namespaces'
  )
}
