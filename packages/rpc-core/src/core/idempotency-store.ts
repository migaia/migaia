import { createRpcConfigurationError, createRpcContractError } from './errors.js'
import { utf8ByteLength, isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { rpcBinaryBackingLength, rpcBinaryView } from '@migaia/rpc-contract/binary/inspect'
import type { IRpcPortableValue, IRpcSerializedError } from '@migaia/rpc-contract'

import { RpcCoreErrorText } from './error-text.js'
import { RpcRuntimeOutcomeState } from '@migaia/rpc-contract/framing/v1'
import { RpcRuntimeStoreKind, RpcRuntimeStoreContinuity } from '@migaia/rpc-contract/framing/v1'
import type { IRpcRuntimeStore } from '@migaia/rpc-contract/runtime'
import { defaultRpcId } from './internal/id.js'

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
  claim: (scope: string, key: string, now: number, fingerprint?: string) => IRpcIdempotencyClaim
  /**
   * Optional outcome-lookup extension; a legacy store without lookup cannot advertise outcome
   * semantics.
   */
  lookup?: (scope: string, key: string, now: number) => IRpcIdempotencyLookup
  /** Opt-in store facts describe this actual owner; ordinary claims never create or read an epoch. */
  readRuntimeFacts?: () => IRpcRuntimeStore
}>

/** A lookup reports only retained store facts and never allocates execution or waiter ownership. */
export type IRpcIdempotencyLookup = Readonly<
  | { state: 'pending' | 'unknown' }
  | { state: 'done'; outcome: IRpcIdempotencyOutcome | 'unavailable' }
>

/** One entry is retained until release or a post-settlement expiry. */
type IEntry = {
  readonly scope: string
  readonly key: string
  /**
   * Only new-profile claims carry an admitted fingerprint; old method/key claims retain their
   * domain.
   */
  readonly fingerprint?: string
  readonly waiters: Array<(value: IRpcIdempotencyOutcome | 'unavailable' | undefined) => void>
  status: 'pending' | 'done'
  outcome?: IRpcIdempotencyOutcome | 'unavailable'
  settledAt?: number
  bytes: number
  sequence: number
}

/**
 * Count portable result data exactly unless the caller's trusted admission budget is exceeded. An
 * over-budget result is only a rejection witness; replay callers omit the budget for exact bytes.
 * Record entry snapshots preserve existing property evaluation order before recursive traversal.
 */
export function portableBytes(
  value: IRpcPortableValue | IRpcSerializedError | undefined,
  budget = Infinity
): number {
  if (value === undefined) return 0
  // Every UTF-16 code unit requires at least one UTF-8 byte, so rejection needs no full scan here.
  if (typeof value === 'string') return value.length > budget ? value.length : utf8ByteLength(value)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return 8
  if (Array.isArray(value)) {
    /** Match reduce's sparse-index semantics while stopping the recursive walk after rejection. */
    let bytes = 0
    /** Native reduce captures the initial length before visiting any element. */
    const length = value.length
    for (let index = 0; index < length; index++) {
      if (!(index in value)) continue
      bytes += portableBytes(value[index], budget - bytes)
      if (bytes > budget) return bytes
    }
    return bytes
  }
  /** Native results charge their accessible full backing; they cannot masquerade as empty records. */
  if (isArrayBuffer(value)) return rpcBinaryBackingLength(value)
  if (isUint8Array(value)) return rpcBinaryBackingLength(rpcBinaryView(value).backing)
  if (
    '$rpc' in value &&
    value.$rpc === 'bytes' &&
    'base64url' in value &&
    typeof value.base64url === 'string'
  ) {
    const length = value.base64url.length
    return Math.floor((length * 3) / 4)
  }
  /** Keep one canonical traversal for admission and exact replay accounting. */
  let bytes = 0
  for (const [key, item] of Object.entries(value)) {
    bytes += portableBytes(key, budget - bytes)
    if (bytes > budget) return bytes
    bytes += portableBytes(item, budget - bytes)
    if (bytes > budget) return bytes
  }
  return bytes
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
    throw createRpcConfigurationError(RpcCoreErrorText.idempotencyConfigInvalid)
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
  /** Lazily minted only when outcome lookup queries this exact in-memory store incarnation. */
  let epoch: string | undefined

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
    /** Read one original entry without purge, waiters, retention refresh or quota mutation. */
    readRuntimeFacts(): IRpcRuntimeStore {
      return Object.freeze({
        kind: RpcRuntimeStoreKind.memory,
        epoch: (epoch ??= defaultRpcId()),
        continuity: RpcRuntimeStoreContinuity.retained
      })
    },
    lookup(scope: string, key: string, now: number): IRpcIdempotencyLookup {
      /**
       * Missing/expired/body-evicted keys are unknown; continuity belongs to the actual store
       * owner.
       */
      const entry = scopes.get(scope)?.get(key)
      if (
        !entry ||
        (entry.status === 'done' && now - entry.settledAt! >= retentionMs) ||
        entry.outcome === 'unavailable'
      )
        return Object.freeze({ state: RpcRuntimeOutcomeState.unknown })
      return entry.status === 'pending'
        ? Object.freeze({ state: RpcRuntimeOutcomeState.pending })
        : Object.freeze({ state: RpcRuntimeOutcomeState.done, outcome: entry.outcome! })
    },
    /** Existing atomic claim retains one optional new-domain fingerprint until its result expires. */
    claim(scope: string, key: string, now: number, fingerprint?: string): IRpcIdempotencyClaim {
      purge(now)
      const existing = scopes.get(scope)?.get(key)
      if (fingerprint !== undefined && existing && existing.fingerprint !== fingerprint)
        throw createRpcContractError(RpcCoreErrorText.runtimeIdempotencyConflict)
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
        ...(fingerprint === undefined ? {} : { fingerprint }),
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
