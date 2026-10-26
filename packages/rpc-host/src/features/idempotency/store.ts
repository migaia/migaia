/**
 * Owns scoped execution claims, exact settlement handles, retained outcomes and capacity/expiry
 * policy. Read-only lookup exposes only this store's facts; callers supply admitted scopes,
 * fingerprints and time, while provider execution and Session lifetimes remain outside the store.
 */
import { portableBytes } from '../../sdk/wire/portable-size.js'
import { createRpcConfigurationError, createRpcContractError } from '../../host/error-owner.js'
import type {
  IRpcPortableValue,
  IRpcWireError,
  IRpcOutcomeStore
} from '@migaia/rpc-contract/protocol'

import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import {
  RpcIdempotencyState as State,
  RpcIdempotencyStoreFact as Fact,
  RpcIdempotencyDefaults as Defaults
} from './constants.js'
import { defaultRpcId } from '../../host/identity.js'
import { deferred } from '@migaia/utils/promise'

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
      error?: IRpcWireError
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
      /** The built-in store withdraws its waiter; custom stores retain their own resource policy. */
      release?: () => void
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
  readRuntimeFacts?: () => IRpcOutcomeStore
  /** Optional synchronous retirement releases entries owned by one disconnected carrier scope. */
  releaseScope?: (scope: string) => void
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
  readonly waiters: Set<(value: IRpcIdempotencyOutcome | 'unavailable' | undefined) => void>
  status: 'pending' | 'done'
  outcome?: IRpcIdempotencyOutcome | 'unavailable'
  settledAt?: number
  bytes: number
}

/** Charge successful payloads or the public failure detail retained for replay. */
function outcomeBytes(outcome: IRpcIdempotencyOutcome): number {
  if (outcome.ok) return portableBytes(outcome.data)
  return (
    portableBytes(outcome.code) +
    portableBytes(outcome.message) +
    portableBytes(outcome.data) +
    portableBytes(outcome.error as unknown as IRpcPortableValue)
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
export type IRpcIdempotencyStoreOptions = {
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
  readonly status = State.claimed

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

/** A pending observer owns only its removable callback, never the original execution claim. */
class RpcIdempotencyWaiter {
  /** Keep the callback in the entry that registered it, independently from later key reuse. */
  readonly #entry: IEntry
  /** Reuse the completion owner so withdrawing an observer also settles its waiting Promise. */
  readonly #completion = deferred<IRpcIdempotencyOutcome | 'unavailable' | undefined>()
  /** Pending receipts expose observation without granting provider execution. */
  readonly status = State.pending
  /** Owner completion and observer withdrawal settle the same Promise at most once. */
  readonly outcome = this.#completion.promise

  /** Register one callback while the original execution is still pending. */
  constructor(entry: IEntry) {
    this.#entry = entry
    entry.waiters.add(this.#completion.resolve)
  }

  /** Removing this callback is idempotent and cannot cancel another observer or the owner. */
  readonly release = (): void => {
    this.#entry.waiters.delete(this.#completion.resolve)
    this.#completion.resolve(undefined)
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
  readonly #bodies = new Map<IEntry, true>()
  /** Settlement insertion order is monotonic, including body-evicted and oversized tombstones. */
  readonly #expiry = new Map<IEntry, true>()
  /** Every pending or completed tombstone consumes exactly one global claim slot. */
  #entries = 0
  /** Sum of currently retained completed-body sizes, excluding unavailable tombstones. */
  #bytes = 0
  /** Lazily minted only when outcome lookup queries this exact in-memory store incarnation. */
  #epoch: string | undefined

  /** Validate all numeric policy before allocating an application's first claim. */
  constructor(options: IRpcIdempotencyStoreOptions) {
    this.#retentionMs = capacity(options.retentionMs, Defaults.retentionMs)
    this.#maxEntries = capacity(options.maxEntries, Defaults.maxEntries)
    this.#maxEntriesPerScope = capacity(options.maxEntriesPerScope, Defaults.maxEntriesPerScope)
    this.#maxBytes = capacity(options.maxBytes, Defaults.maxBytes)
    this.#maxOutcomeBytes = capacity(options.maxOutcomeBytes, Defaults.maxOutcomeBytes)
  }

  /** Remove an entry only if the same owner still holds that key. */
  #remove(entry: IEntry): void {
    /** Only the exact still-resident scope can release this original entry identity. */
    const scope = this.#scopes.get(entry.scope)
    if (scope?.get(entry.key) !== entry) return
    scope.delete(entry.key)
    if (scope.size === 0) this.#scopes.delete(entry.scope)
    this.#bodies.delete(entry)
    this.#expiry.delete(entry)
    this.#entries -= 1
    this.#bytes -= entry.bytes
  }

  /** Purge completed outcomes whose settlement-relative retention has elapsed. */
  #purge(now: number): void {
    for (const entry of this.#expiry.keys()) {
      if (now - entry.settledAt! < this.#retentionMs) break
      this.#remove(entry)
    }
  }

  /** Drop oldest completed bodies while keeping tombstones and their execution history. */
  #enforceByteBudget(): void {
    for (const entry of this.#bodies.keys()) {
      if (this.#bytes <= this.#maxBytes) break
      this.#bodies.delete(entry)
      this.#bytes -= entry.bytes
      entry.bytes = 0
      entry.outcome = State.unavailable
    }
  }

  /** Read one original entry without purge, waiters, retention refresh or quota mutation. */
  readonly readRuntimeFacts = (): IRpcOutcomeStore => {
    return Object.freeze({
      kind: Fact.memory,
      epoch: (this.#epoch ??= defaultRpcId()),
      continuity: Fact.retained
    })
  }
  /** Retire only this scope's entries; late settlement cannot revive their removed identities. */
  readonly releaseScope = (scope: string): void => {
    /** Scope membership partitions retirement work without scanning other connections' entries. */
    const entries = this.#scopes.get(scope)
    if (!entries) return
    for (const entry of entries.values()) {
      if (entry.status === State.pending) this.releaseClaim(entry)
      else this.#remove(entry)
    }
  }
  /** Lookup observes retention without allocating waiters or modifying a claim's lifetime. */
  readonly lookup = (scope: string, key: string, now: number): IRpcIdempotencyLookup => {
    /** Missing/expired/body-evicted keys are unknown; continuity belongs to the actual store owner. */
    /** Read-only observation borrows the same scoped owner without refreshing retention. */
    const entry = this.#scopes.get(scope)?.get(key)
    if (
      !entry ||
      (entry.status === State.done && now - entry.settledAt! >= this.#retentionMs) ||
      entry.outcome === State.unavailable
    )
      return Object.freeze({ state: State.unknown })
    return entry.status === State.pending
      ? Object.freeze({ state: State.pending })
      : Object.freeze({ state: State.done, outcome: entry.outcome! })
  }
  /** Existing atomic claim retains one optional new-domain fingerprint until its result expires. */
  readonly claim = (
    scope: string,
    key: string,
    now: number,
    fingerprint?: string
  ): IRpcIdempotencyClaim => {
    this.#purge(now)
    /** Original identity decides both fingerprint collision and repeated ownership. */
    const existing = this.#scopes.get(scope)?.get(key)
    if (fingerprint !== undefined && existing && existing.fingerprint !== fingerprint)
      throw createRpcContractError(RpcCoreErrorText.runtimeIdempotencyConflict)
    if (existing?.status === State.done)
      return Object.freeze({ status: State.done, outcome: existing.outcome! })
    if (existing?.status === State.pending) return Object.freeze(new RpcIdempotencyWaiter(existing))
    /** An empty scope is published only after the original capacity checks admit this claim. */
    const scoped = this.#scopes.get(scope) ?? new Map<string, IEntry>()
    if (this.#entries >= this.#maxEntries || scoped.size >= this.#maxEntriesPerScope)
      return Object.freeze({ status: State.full })
    if (!this.#scopes.has(scope)) this.#scopes.set(scope, scoped)
    /** One original record alone owns this key, waiter set and eventual settlement rights. */
    const entry: IEntry = {
      scope,
      key,
      ...(fingerprint === undefined ? {} : { fingerprint }),
      waiters: new Set(),
      status: State.pending,
      bytes: 0
    }
    scoped.set(key, entry)
    this.#entries += 1
    return Object.freeze(new RpcIdempotencyClaim(this, entry))
  }

  /** Commit one exact pending claim, then release its waiters after ordered body eviction. */
  settleClaim(entry: IEntry, outcome: IRpcIdempotencyOutcome, settledAt: number): void {
    if (entry.status !== State.pending || this.#scopes.get(entry.scope)?.get(entry.key) !== entry)
      return
    /** Byte measurement preserves the original provider-value access and failure point. */
    /** Measure the original result once before changing pending ownership or retention state. */
    const size = outcomeBytes(outcome)
    entry.status = State.done
    entry.settledAt = settledAt
    entry.outcome = size > this.#maxOutcomeBytes ? State.unavailable : outcome
    entry.bytes = size > this.#maxOutcomeBytes ? 0 : size
    this.#bytes += entry.bytes
    this.#expiry.set(entry, true)
    if (entry.outcome !== State.unavailable) this.#bodies.set(entry, true)
    this.#enforceByteBudget()
    for (const waiter of entry.waiters) waiter(entry.outcome!)
    entry.waiters.clear()
  }

  /** Release a pending exact claim without affecting any replacement or already-settled body. */
  releaseClaim(entry: IEntry): void {
    if (entry.status !== State.pending || this.#scopes.get(entry.scope)?.get(entry.key) !== entry)
      return
    this.#remove(entry)
    for (const waiter of entry.waiters) waiter(undefined)
    entry.waiters.clear()
  }
}

/** Provide one bounded store; pending claims expire only by settlement or explicit release. */
export function createRpcIdempotencyStore(
  options: IRpcIdempotencyStoreOptions = {}
): IRpcIdempotencyStore {
  return Object.freeze(new RpcIdempotencyStore(options))
}
