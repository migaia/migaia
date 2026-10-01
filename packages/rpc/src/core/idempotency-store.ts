import { utf8ByteLength } from '@migaia/utils/bytes'
import type { IRpcPortableValue, IRpcSerializedError } from '../contract/index.js'
import { RpcConfigurationError } from './errors.js'
import { RpcCoreErrorText } from './error-text.js'

/** A portable provider outcome that can be replayed with a new request identifier. */
export type IRpcIdempotencyOutcome = Readonly<
  | { ok: true; data?: IRpcPortableValue }
  | {
      ok: false
      code: string
      message: string
      data?: IRpcPortableValue
      error?: IRpcSerializedError
    }
>

/** A claim either owns execution, waits, replays, or rejects capacity admission. */
export type IRpcIdempotencyClaim =
  | Readonly<{
      status: 'claimed'
      settle: (outcome: IRpcIdempotencyOutcome, now: number) => void
      release: () => void
    }>
  | Readonly<{
      status: 'pending'
      outcome: Promise<IRpcIdempotencyOutcome | 'unavailable' | undefined>
    }>
  | Readonly<{ status: 'done'; outcome: IRpcIdempotencyOutcome | 'unavailable' }>
  | Readonly<{ status: 'full' }>

/** Injectable store boundary; the session owner chooses scopes only after identity admission. */
export type IRpcIdempotencyStore = Readonly<{
  claim: (scope: string, key: string, now: number) => IRpcIdempotencyClaim
}>

/** One entry is retained until release or a post-settlement expiry. */
type IEntry = {
  readonly scope: string
  readonly key: string
  readonly waiters: Array<(value: IRpcIdempotencyOutcome | 'unavailable' | undefined) => void>
  status: 'pending' | 'done'
  outcome?: IRpcIdempotencyOutcome | 'unavailable'
  settledAt?: number
  bytes: number
  sequence: number
}

/** Count only portable result data, using decoded byte length for the bytes marker. */
export function portableBytes(value: IRpcPortableValue | IRpcSerializedError | undefined): number {
  if (value === undefined) return 0
  if (typeof value === 'string') return utf8ByteLength(value)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return 8
  if (Array.isArray(value))
    return value.reduce((total: number, item) => total + portableBytes(item), 0)
  if (
    '$rpc' in value &&
    value.$rpc === 'bytes' &&
    'base64url' in value &&
    typeof value.base64url === 'string'
  ) {
    const length = value.base64url.length
    return Math.floor((length * 3) / 4)
  }
  return Object.entries(value).reduce(
    (total, [key, item]) => total + utf8ByteLength(key) + portableBytes(item),
    0
  )
}

/** Charge successful payloads or the public failure detail retained for replay. */
function outcomeBytes(outcome: IRpcIdempotencyOutcome): number {
  if (outcome.ok) return portableBytes(outcome.data)
  return (
    portableBytes(outcome.code) +
    portableBytes(outcome.message) +
    portableBytes(outcome.data) +
    portableBytes(outcome.error)
  )
}

/** Validate one positive capacity with the package-owned configuration error. */
function capacity(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RpcConfigurationError(RpcCoreErrorText.idempotencyConfigInvalid)
  return value
}

/** Provide bounded, settlement-relative deduplication without owning endpoint timers. */
export function createRpcIdempotencyStore(
  options: {
    readonly retentionMs?: number
    readonly maxEntries?: number
    readonly maxEntriesPerScope?: number
    readonly maxBytes?: number
    readonly maxOutcomeBytes?: number
  } = {}
): IRpcIdempotencyStore {
  /** Retention begins when a terminal provider outcome is known, not when execution starts. */
  const retentionMs = capacity(options.retentionMs, 300_000)
  const maxEntries = capacity(options.maxEntries, 1024)
  const maxEntriesPerScope = capacity(options.maxEntriesPerScope, 256)
  const maxBytes = capacity(options.maxBytes, 8 * 1024 * 1024)
  const maxOutcomeBytes = capacity(options.maxOutcomeBytes, 1024 * 1024)
  /** Scope maps separate identical method/key tuples on different admitted connections. */
  const scopes = new Map<string, Map<string, IEntry>>()
  let entries = 0
  let bytes = 0
  let sequence = 0

  /** Remove an entry only if the same owner still holds that key. */
  function remove(entry: IEntry): void {
    const scope = scopes.get(entry.scope)
    if (scope?.get(entry.key) !== entry) return
    scope.delete(entry.key)
    if (scope.size === 0) scopes.delete(entry.scope)
    entries -= 1
    bytes -= entry.bytes
  }

  /** Purge completed outcomes whose settlement-relative retention has elapsed. */
  function purge(now: number): void {
    for (const scope of scopes.values())
      for (const entry of scope.values())
        if (
          entry.status === 'done' &&
          entry.settledAt !== undefined &&
          now - entry.settledAt >= retentionMs
        )
          remove(entry)
  }

  /** Drop oldest completed bodies while keeping tombstones and their execution history. */
  function enforceByteBudget(): void {
    if (bytes <= maxBytes) return
    const completed = [...scopes.values()]
      .flatMap((scope) => [...scope.values()])
      .filter((entry) => entry.status === 'done' && entry.outcome !== 'unavailable')
      .sort((a, b) => a.sequence - b.sequence)
    for (const entry of completed) {
      if (bytes <= maxBytes) break
      bytes -= entry.bytes
      entry.bytes = 0
      entry.outcome = 'unavailable'
    }
  }

  return Object.freeze({
    claim(scope: string, key: string, now: number): IRpcIdempotencyClaim {
      purge(now)
      const existing = scopes.get(scope)?.get(key)
      if (existing?.status === 'done')
        return Object.freeze({ status: 'done', outcome: existing.outcome! })
      if (existing?.status === 'pending')
        return Object.freeze({
          status: 'pending',
          outcome: new Promise<IRpcIdempotencyOutcome | 'unavailable' | undefined>((resolve) => {
            existing.waiters.push(resolve)
          })
        })
      const scoped = scopes.get(scope) ?? new Map<string, IEntry>()
      if (entries >= maxEntries || scoped.size >= maxEntriesPerScope)
        return Object.freeze({ status: 'full' })
      if (!scopes.has(scope)) scopes.set(scope, scoped)
      const entry: IEntry = {
        scope,
        key,
        waiters: [],
        status: 'pending',
        bytes: 0,
        sequence: 0
      }
      scoped.set(key, entry)
      entries += 1
      return Object.freeze({
        status: 'claimed',
        settle(outcome: IRpcIdempotencyOutcome, settledAt: number): void {
          if (entry.status !== 'pending' || scoped.get(key) !== entry) return
          const size = outcomeBytes(outcome)
          entry.status = 'done'
          entry.settledAt = settledAt
          entry.sequence = ++sequence
          entry.outcome = size > maxOutcomeBytes ? 'unavailable' : outcome
          entry.bytes = size > maxOutcomeBytes ? 0 : size
          bytes += entry.bytes
          enforceByteBudget()
          for (const waiter of entry.waiters.splice(0)) waiter(entry.outcome!)
        },
        release(): void {
          if (entry.status !== 'pending' || scoped.get(key) !== entry) return
          remove(entry)
          for (const waiter of entry.waiters.splice(0)) waiter(undefined)
        }
      })
    }
  })
}
