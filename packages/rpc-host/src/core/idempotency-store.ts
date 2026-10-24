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
      /** False selects a failed application outcome retained for replay. */
      ok: false
      /** Stable application failure code retained with this original outcome. */
      code: string
      /** Application failure message retained for replay. */
      message: string
      /** Optional portable application result or failure detail. */
      data?: IRpcPortableValue
      /** Optional serialized failure chain retained for the original result. */
      error?: IRpcSerializedError
    }
>

/** A claim either owns execution, waits, replays, or rejects capacity admission. */
export type IRpcIdempotencyClaim =
  | Readonly<{
      /**
       * Claimed owns execution; pending waits for the original owner; done replays retention; full
       * refuses admission.
       */
      status: 'claimed'
      /** Settle this exact claim once with its outcome and settlement-relative monotonic time. */
      settle: (outcome: IRpcIdempotencyOutcome, now: number) => void
      /** Release an unsettled claim and resolve its waiting observers with undefined. */
      release: () => void
    }>
  | Readonly<{
      /**
       * Claimed owns execution; pending waits for the original owner; done replays retention; full
       * refuses admission.
       */
      status: 'pending'
      /**
       * Original completed outcome or pending observation; unavailable means the body was not
       * retained.
       */
      outcome: Promise<IRpcIdempotencyOutcome | 'unavailable' | undefined>
    }>
  | Readonly<{ status: 'done'; outcome: IRpcIdempotencyOutcome | 'unavailable' }>
  | Readonly<{ status: 'full' }>

/** Injectable store boundary; the session owner chooses scopes only after identity admission. */
export type IRpcIdempotencyStore = Readonly<{
  /**
   * Atomically claim a scoped logical key, observe its existing owner/result, or refuse capacity.
   * Fingerprint mismatch rejects the contract.
   */
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

/** Capacity inputs are validated before the store retains any scoped execution state. */
type IRpcIdempotencyStoreOptions = {
  /**
   * Completed-entry retention, defaulting to 300000 ms; pending executions are not expired by this
   * budget.
   */
  readonly retentionMs?: number
  /** Global claim/tombstone capacity; defaults to 1024. */
  readonly maxEntries?: number
  /** Per-authenticated-scope claim/tombstone capacity; defaults to 256. */
  readonly maxEntriesPerScope?: number
  /** Total retained outcome-body budget; defaults to 8 MiB. */
  readonly maxBytes?: number
  /** Per-outcome body budget; defaults to 1 MiB. */
  readonly maxOutcomeBytes?: number
}

/** One claimed handle lends only settlement and release rights for its exact original entry. */
class RpcIdempotencyClaim {
  /** The original store retains scope membership and all budget mutation authority. */
  readonly #store: RpcIdempotencyStore
  /** Entry identity prevents stale handles from settling a replacement with the same key. */
  readonly #entry: IEntry
  /** A claim handle never changes state; its store determines whether its rights remain live. */
  readonly status = 'claimed' as const

  /** Retain the actual entry, not a copied key that could later identify a replacement. */
  constructor(store: RpcIdempotencyStore, entry: IEntry) {
    this.#store = store
    this.#entry = entry
  }

  /** Receiver-independent settlement preserves the original claim method's callable contract. */
  readonly settle = (outcome: IRpcIdempotencyOutcome, now: number): void => {
    this.#store.settleClaim(this.#entry, outcome, now)
  }

  /** Receiver-independent release affects only this still-pending entry and its own waiters. */
  readonly release = (): void => {
    this.#store.releaseClaim(this.#entry)
  }
}

/** One store owns all scopes, pending claims, retained bodies and the optional continuity epoch. */
class RpcIdempotencyStore implements IRpcIdempotencyStore {
  /** Retention begins when a terminal provider outcome is known, not when execution starts. */
  readonly #retentionMs: number
  /** Global pending/tombstone limit is fixed when this store is created. */
  readonly #maxEntries: number
  /** An authenticated scope cannot consume another scope's reserved claim capacity. */
  readonly #maxEntriesPerScope: number
  /** Body pressure evicts outcomes without reviving their execution keys. */
  readonly #maxBytes: number
  /** Oversized outcomes retain an unavailable tombstone rather than an unbounded body. */
  readonly #maxOutcomeBytes: number
  /** Scope maps separate identical method/key tuples on different admitted connections. */
  readonly #scopes = new Map<string, Map<string, IEntry>>()
  /** Settlement insertion order is already the original sequence order used for body eviction. */
  readonly #completed = new Map<IEntry, true>()
  /** Every pending or completed tombstone consumes exactly one global claim slot. */
  #entries = 0
  /** Sum of currently retained completed-body sizes, excluding unavailable tombstones. */
  #bytes = 0
  /** Lazily minted only when outcome lookup queries this exact in-memory store incarnation. */
  #epoch: string | undefined

  /** Validate all numeric policy before allocating an application's first claim. */
  constructor(options: IRpcIdempotencyStoreOptions) {
    this.#retentionMs = capacity(options.retentionMs, 300_000)
    this.#maxEntries = capacity(options.maxEntries, 1024)
    this.#maxEntriesPerScope = capacity(options.maxEntriesPerScope, 256)
    this.#maxBytes = capacity(options.maxBytes, 8 * 1024 * 1024)
    this.#maxOutcomeBytes = capacity(options.maxOutcomeBytes, 1024 * 1024)
  }

  /** Remove an entry only if the same owner still holds that key. */
  #remove(entry: IEntry): void {
    const scope = this.#scopes.get(entry.scope)
    if (scope?.get(entry.key) !== entry) return
    scope.delete(entry.key)
    if (scope.size === 0) this.#scopes.delete(entry.scope)
    this.#completed.delete(entry)
    this.#entries -= 1
    this.#bytes -= entry.bytes
  }

  /** Purge completed outcomes whose settlement-relative retention has elapsed. */
  #purge(now: number): void {
    for (const scope of this.#scopes.values())
      for (const entry of scope.values())
        if (
          entry.status === 'done' &&
          entry.settledAt !== undefined &&
          now - entry.settledAt >= this.#retentionMs
        )
          this.#remove(entry)
  }

  /** Drop oldest completed bodies while keeping tombstones and their execution history. */
  #enforceByteBudget(): void {
    for (const entry of this.#completed.keys()) {
      if (this.#bytes <= this.#maxBytes) break
      this.#completed.delete(entry)
      this.#bytes -= entry.bytes
      entry.bytes = 0
      entry.outcome = 'unavailable'
    }
  }

  /** Read one original entry without purge, waiters, retention refresh or quota mutation. */
  readonly readRuntimeFacts = (): IRpcRuntimeStore => {
    return Object.freeze({
      kind: RpcRuntimeStoreKind.memory,
      epoch: (this.#epoch ??= defaultRpcId()),
      continuity: RpcRuntimeStoreContinuity.retained
    })
  }
  /** Lookup observes retention without allocating waiters or modifying a claim's lifetime. */
  readonly lookup = (scope: string, key: string, now: number): IRpcIdempotencyLookup => {
    /** Missing/expired/body-evicted keys are unknown; continuity belongs to the actual store owner. */
    const entry = this.#scopes.get(scope)?.get(key)
    if (
      !entry ||
      (entry.status === 'done' && now - entry.settledAt! >= this.#retentionMs) ||
      entry.outcome === 'unavailable'
    )
      return Object.freeze({ state: RpcRuntimeOutcomeState.unknown })
    return entry.status === 'pending'
      ? Object.freeze({ state: RpcRuntimeOutcomeState.pending })
      : Object.freeze({ state: RpcRuntimeOutcomeState.done, outcome: entry.outcome! })
  }
  /** Existing atomic claim retains one optional new-domain fingerprint until its result expires. */
  readonly claim = (
    scope: string,
    key: string,
    now: number,
    fingerprint?: string
  ): IRpcIdempotencyClaim => {
    this.#purge(now)
    const existing = this.#scopes.get(scope)?.get(key)
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
    const scoped = this.#scopes.get(scope) ?? new Map<string, IEntry>()
    if (this.#entries >= this.#maxEntries || scoped.size >= this.#maxEntriesPerScope)
      return Object.freeze({ status: 'full' })
    if (!this.#scopes.has(scope)) this.#scopes.set(scope, scoped)
    const entry: IEntry = {
      scope,
      key,
      ...(fingerprint === undefined ? {} : { fingerprint }),
      waiters: [],
      status: 'pending',
      bytes: 0
    }
    scoped.set(key, entry)
    this.#entries += 1
    return Object.freeze(new RpcIdempotencyClaim(this, entry))
  }

  /** Commit one exact pending claim, then release its waiters after ordered body eviction. */
  settleClaim(entry: IEntry, outcome: IRpcIdempotencyOutcome, settledAt: number): void {
    if (entry.status !== 'pending' || this.#scopes.get(entry.scope)?.get(entry.key) !== entry)
      return
    /** Byte measurement preserves the original provider-value access and failure point. */
    const size = outcomeBytes(outcome)
    entry.status = 'done'
    entry.settledAt = settledAt
    entry.outcome = size > this.#maxOutcomeBytes ? 'unavailable' : outcome
    entry.bytes = size > this.#maxOutcomeBytes ? 0 : size
    this.#bytes += entry.bytes
    if (entry.outcome !== 'unavailable') this.#completed.set(entry, true)
    this.#enforceByteBudget()
    for (const waiter of entry.waiters.splice(0)) waiter(entry.outcome!)
  }

  /** Release a pending exact claim without affecting any replacement or already-settled body. */
  releaseClaim(entry: IEntry): void {
    if (entry.status !== 'pending' || this.#scopes.get(entry.scope)?.get(entry.key) !== entry)
      return
    this.#remove(entry)
    for (const waiter of entry.waiters.splice(0)) waiter(undefined)
  }
}

/** Provide one bounded store; pending claims expire only by settlement or explicit release. */
export function createRpcIdempotencyStore(
  options: IRpcIdempotencyStoreOptions = {}
): IRpcIdempotencyStore {
  return Object.freeze(new RpcIdempotencyStore(options))
}
