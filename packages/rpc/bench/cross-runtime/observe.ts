import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { CrossRuntimeBench } from '../text.mjs'
/** Failure tuples preserve the source graph while fixture secrets remain redacted. */
type IFailure = {
  source: unknown
  code: unknown
  name: unknown
  reason: unknown
  message: string
  stack: string | null
  cause: IFailure | null
  errors: IFailure[]
  cycle?: boolean
}
/** Runtime failures may be native Errors, serialized errors, or plain thrown values. */
type IErrorFields = {
  source?: unknown
  code?: unknown
  name?: unknown
  reason?: unknown
  message?: unknown
  stack?: unknown
  cause?: unknown
  errors?: unknown
}
/** Loaded records identify the selected source bytes, not simulated JS or engine bytecode. */
type ISourceRow = {
  path: string
  actualSourcePath?: string
  originalSHA256?: string
  targetSHA256?: string
  effectiveSHA256?: string
  loadedSHA256?: string
  diagnosticOverlay?: boolean
}
/** Each native lease owner has separate active and cumulative observations. */
type ILeaseRow = { owner: number; active: number; peak: number; acquired: number; released: number }
/** The canonical existing readCapacity result contains independently bounded global/peer numbers. */
type ICapacity = { occupancy: number; limit: number; peerOccupancy: number; peerLimit: number }
/** Replay identities stay hashed, while actual accepted/released counts remain exact. */
type ILedgerRow = {
  owner: number
  globalPeak: number
  peerPeak: number
  accepted: number
  limit: number
  peerLimit: number
  active: number
  completed: number
  peers: Record<string, { peak: number; occupancy: number; accepted: number }>
  phases: Record<string, number>
}
/** All diagnostic storage is bounded by this finite arm and its actual owner/peer count. */
type IState = {
  counts: Record<string, number>
  loaded: (ISourceRow & {
    actualSourcePath: string
    actualLoadedSourceSHA256: string
    proof: string
  })[]
  provider: { calls: number; active: number; peak: number }
  leases: ILeaseRow[]
  ledgers: ILedgerRow[]
  failures: IFailure[]
  reports: IFailure[]
  rejections: unknown[]
  phase: string
  promiseStatus: string
  promiseOwnershipMethod: string
  calibration: { before: number; after: number; events: number } | null
  promiseOwners: Record<string, number>
  foreignIdentities: unknown[]
  timingAdmission?: unknown
}
declare global {
  /** These hooks are installed only by the observer before selected source modules load. */
  var __XRT_COUNT: (key: string) => void
  var __XRT_LOADED: (row: ISourceRow) => void
  var __XRT_LEASE: (owner: object, size: number) => void
  var __XRT_LEDGER: (
    owner: object,
    peerKey: string,
    capacity: ICapacity,
    active: number,
    completed: number,
    accepted: number
  ) => void
}

/** Diagnostic state is isolate-local and uses only scalar counters and source provenance. */
export const state: IState = {
  counts: {},
  loaded: [],
  provider: { calls: 0, active: 0, peak: 0 },
  leases: [],
  ledgers: [],
  phase: 'unphased-no-cold-claim',
  failures: [],
  reports: [],
  rejections: [],
  promiseStatus: 'UNAVAILABLE_NOT_ATTEMPTED',
  promiseOwnershipMethod: 'first non-observer file URL frame; packages/rpc only',
  calibration: null,
  promiseOwners: {},
  foreignIdentities: []
}
/** Runtime metadata distinguishes native engines from compatibility APIs. */
export const runtime = 'Deno' in globalThis ? 'deno' : process.versions.bun ? 'bun' : 'node'
/** Every exact entry delta belongs to a separate counter run. */
globalThis.__XRT_COUNT = (key) => {
  state.counts[key] = (state.counts[key] ?? 0) + 1
}
/** Evaluation records prove source modules executed in the actual TS runtime. */
globalThis.__XRT_LOADED = (row) => {
  const path =
    row.actualSourcePath ??
    (row.path.startsWith('serialize/')
      ? fileURLToPath(
          new URL('../../serialize/dist/' + row.path.slice(10), process.env.XRT_SOURCE_ROOT)
        )
      : fileURLToPath(new URL(row.path, process.env.XRT_SOURCE_ROOT)))
  state.loaded.push({
    ...row,
    actualSourcePath: path,
    actualLoadedSourceSHA256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    proof: 'actual module evaluation plus exact disk TS/source bytes; no engine bytecode claim'
  })
}
/** Genuine admission occupancy is observed only where canonical leases change. */
const owners = new WeakMap<object, ILeaseRow>()
globalThis.__XRT_LEASE = (owner, size) => {
  let row = owners.get(owner)
  if (!row) {
    row = { owner: state.leases.length, active: 0, peak: 0, acquired: 0, released: 0 }
    owners.set(owner, row)
    state.leases.push(row)
  }
  if (size > row.active) row.acquired += size - row.active
  else row.released += row.active - size
  row.active = size
  row.peak = Math.max(row.peak, size)
}
/** The existing capacity read is observed after the canonical admission decision. */
const ledgers = new WeakMap<object, ILedgerRow>()
globalThis.__XRT_LEDGER = (owner, peerKey, capacity, active, completed, accepted) => {
  /** No peer identities, request ids or payloads escape this numeric record. */
  const key = createHash('sha256').update(peerKey).digest('hex')
  /** A canonical ledger, not client in-flight state, owns these retained entries. */
  let row = ledgers.get(owner)
  if (!row) {
    row = {
      owner: state.ledgers.length,
      globalPeak: 0,
      peerPeak: 0,
      accepted: 0,
      limit: capacity.limit,
      peerLimit: capacity.peerLimit,
      active: 0,
      completed: 0,
      peers: {},
      phases: {}
    }
    ledgers.set(owner, row)
    state.ledgers.push(row)
  }
  /** Each recorded peer occupancy comes from the original lease registry. */
  const peer = (row.peers[key] ??= { peak: 0, occupancy: 0, accepted: 0 })
  row.globalPeak = Math.max(row.globalPeak, capacity.occupancy)
  row.peerPeak = Math.max(row.peerPeak, capacity.peerOccupancy)
  row.active = active
  row.completed = completed
  peer.peak = Math.max(peer.peak, capacity.peerOccupancy)
  peer.occupancy = capacity.peerOccupancy
  if (accepted) {
    row.accepted += accepted
    peer.accepted += accepted
    row.phases[state.phase] = (row.phases[state.phase] ?? 0) + accepted
  }
}
/** Redaction is shared by all failure-chain fields, including native stacks. */
const redact = (value: unknown): string =>
  String(value)
    .replace(/x{16,}/g, '[REDACTED_PAYLOAD]')
    .replaceAll(CrossRuntimeBench.token, '[REDACTED_AUTH]')
/** Original cause/errors remain visible; cyclic thrown objects are represented without recursion. */
export function classify(error: unknown, seen = new Set<object>()): IFailure {
  /** Reading fields does not infer a rejection reason from an overloaded semantic code. */
  const fields = error && typeof error === 'object' ? (error as IErrorFields) : {}
  /** Every native field is kept even when the original event lacks it. */
  const result: IFailure = {
    source: fields.source ?? null,
    code: fields.code ?? null,
    name: fields.name ?? typeof error,
    reason: fields.reason ?? null,
    message: redact(fields.message ?? error),
    stack: fields.stack === undefined ? null : redact(fields.stack),
    cause: null,
    errors: []
  }
  if (error && typeof error === 'object') {
    if (seen.has(error)) return { ...result, cycle: true }
    seen.add(error)
  }
  if (fields.cause !== undefined) result.cause = classify(fields.cause, seen)
  if (Array.isArray(fields.errors))
    result.errors = fields.errors.map((value) => classify(value, seen))
  return result
}
/** Existing report and rejection callbacks expose their original failure/reason channels. */
export const report = (error: unknown): void => {
  state.reports.push(classify(error))
}
/** Name is absent on the actual rejection event; its reason is never synthesized. */
export const onRejected = (event: Record<string, unknown>): void => {
  state.rejections.push({
    ...event,
    verifiedPeerKey: '[REDACTED]',
    source: '@migaia/rpc/core',
    code: 'OVERLOADED',
    name: null,
    message: 'provider rejection event',
    classificationSource: 'existing onRejected; name not supplied'
  })
}
/** Synchronous portable echo records actual TS provider entry independently of client concurrency. */
export function echo<T>(value: T): T {
  state.provider.calls++
  state.provider.active++
  state.provider.peak = Math.max(state.provider.peak, state.provider.active)
  try {
    return value
  } finally {
    state.provider.active--
  }
}
/** Only actual native delivery can qualify Promise creations. */
if (process.env.XRT_CAPTURE === 'count') {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout
  globalThis.setTimeout = (...args) => {
    globalThis.__XRT_COUNT('native:setTimeout')
    return originalSet(...args)
  }
  globalThis.clearTimeout = (...args) => {
    globalThis.__XRT_COUNT('native:clearTimeout')
    return originalClear(...args)
  }
  for (const name of ['parse', 'stringify']) {
    const original = JSON[name]
    JSON[name] = (...args) => {
      globalThis.__XRT_COUNT('native:JSON.' + name)
      return original(...args)
    }
  }
  try {
    const { createHook } = await import('node:async_hooks')
    createHook({
      init(_id, type) {
        if (type !== 'PROMISE') return
        globalThis.__XRT_COUNT('native:PROMISE')
        const first = String(new Error().stack)
          .split('\n')
          .slice(2)
          .find((frame) => frame.includes('file:') && !frame.includes('/observe.ts'))
        if (first?.includes('/packages/rpc/src/')) {
          globalThis.__XRT_COUNT('native:PROMISE:rpc-owned')
          state.promiseOwners[first.trim()] = (state.promiseOwners[first.trim()] ?? 0) + 1
        }
      }
    }).enable()
    const before = state.counts['native:PROMISE'] ?? 0
    await new Promise((resolve) => resolve())
    const after = state.counts['native:PROMISE'] ?? 0
    state.calibration = { before, after, events: after - before }
    state.promiseStatus =
      after > before
        ? runtime === 'node'
          ? 'EXACT_NODE_ASYNC_HOOKS_INIT'
          : 'NATIVE_INIT_EVENTS_CALIBRATED_' + runtime.toUpperCase()
        : 'UNAVAILABLE_ENGINE_CHANNEL_NO_EVENTS'
  } catch (error) {
    state.promiseStatus = 'UNAVAILABLE_ENGINE_CHANNEL: ' + String(error.message)
  }
}
/** Out-of-band snapshots occur outside measured RPC exchanges. */
export function snapshot() {
  return {
    runtime,
    pid: process.pid,
    ...structuredClone(state),
    sourceForm: 'TypeScript public-entry source; no RPC dist/build'
  }
}
