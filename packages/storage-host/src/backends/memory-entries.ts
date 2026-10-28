// Entry lifecycle, capacity planning and physical writes for the memory backend (see ./memory.ts).
import {
  StorageContractError,
  StorageContractErrorCode,
  type IQuad,
  type IStorageVectorPoint,
  type IStorageKey,
  type IWriteOptions,
  type IOperationContextSnapshot,
  type ILockKey,
  type IStorageChange,
  type IConcurrencyHolder,
  type IConflictPolicy
} from '@migaia/storage-contract'
import {
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange,
  lockKey,
  runWithConcurrency
} from '../authoring/concurrency.js'
import {
  snapshotStorageKey,
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix
} from '../authoring/key.js'
import { encodeStorageRdfQuad } from '../authoring/rdf.js'
import { isUint8Array, utf8ByteLength } from '@migaia/utils/bytes'
import { StorageError, type IStorageChannel } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { MemoryOperation, MemoryState } from './memory-constants.js'
import { encodeFlatStorageKey } from '../core/key-domain.js'
import { planChannelWrite } from '../core/channel-write.js'
import { isStorageErrorFamily } from '../core/error-family.js'
import { StorageHookName } from '../hook-names.js'
import { memoryCapacityValueBytes, type IMemoryCapacityChange } from './memory-capacity.js'
import { transact } from './memory-transaction.js'
import type {
  IMemoryNamespaceContext,
  IMemoryPhysicalChannel,
  IMemoryChannel,
  IMemoryEntry,
  IMemoryRootMutation
} from './memory.js'

/** Root lifecycle finalization releases each namespace's physical facts exactly once. */
export async function finalize<T>(namespaceContext: IMemoryNamespaceContext<T>) {
  await namespaceContext.locks.dispose()
  for (const channel of namespaceContext.physicalChannels) {
    namespaceContext.data[channel].clear()
    namespaceContext.ordered[channel].clear()
    namespaceContext.revisions.clear(channel === 'value' ? 'text' : channel)
  }
  namespaceContext.deadlines.clear()
  namespaceContext.expiring?.clear()
  namespaceContext.capacityIndex?.clear()
  namespaceContext.vectorCollections.clear()
  namespaceContext.rdfIndex.clear()
  namespaceContext.blobs.clear()
  namespaceContext.journal.clear()
}

/** Unknown backend callback failures gain their original memory transaction boundary. */
export function normalize<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  cause: unknown,
  expiredScope?: true
) {
  return isStorageErrorFamily(cause)
    ? cause
    : new StorageError(StorageHostErrorCode.transactionFailed, {
        backend: STORAGE_MEMORY_BACKEND,
        ...(expiredScope ? { operation: MemoryOperation.transactionScope } : {}),
        cause
      })
}

/** One active attempt captures the actual store identity rather than the transaction callback. */
export function holding<T>(namespaceContext: IMemoryNamespaceContext<T>): IConcurrencyHolder {
  return {
    status: 'held',
    owner: namespaceContext.ownerId,
    label: namespaceContext.label,
    scope: 'local',
    since: Date.now(),
    ...(namespaceContext.pid === undefined ? {} : { pid: namespaceContext.pid })
  }
}

/** One physical channel plus the existing flat wire gives an unambiguous revision identity. */
export function identity<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryPhysicalChannel,
  encoded: string
): string {
  return MemoryState.identity(channel, encoded)
}

/** Revision changes remain independent of whether an entry is currently present. */
export function revision<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  encoded: string
): number {
  return namespaceContext.revisions.read(channel === 'value' ? 'text' : channel, encoded)
}

/** Every successful physical change advances only its own channel's original revision. */
export function bump<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  encoded: string
): void {
  namespaceContext.revisions.write(channel === 'value' ? 'text' : channel, encoded)
}

/** One deadline mutation keeps the original Map and optional candidate index synchronized. */
export function setDeadline<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  encoded: string,
  deadline: number | undefined
): void {
  /** Existing canonical identity and old clock fact identify the exact expiry leaf to replace. */
  const id = identity(namespaceContext, channel, encoded)
  /** No secondary expiry structure exists on the original unbounded path. */
  const previous = namespaceContext.deadlines.get(id)
  if (namespaceContext.expiring !== undefined && previous !== undefined)
    namespaceContext.expiring.delete(
      encodeOrderedStorageKey([previous, channel, encoded], STORAGE_MEMORY_BACKEND)
    )
  if (deadline === undefined) namespaceContext.deadlines.delete(id)
  else {
    namespaceContext.deadlines.set(id, deadline)
    namespaceContext.expiring?.set(
      encodeOrderedStorageKey([deadline, channel, encoded], STORAGE_MEMORY_BACKEND),
      {
        channel,
        encoded
      }
    )
  }
}

/** Accounting never inspects record values unless the explicit byte limit needs their encoding. */
export function entryBytes<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  value: unknown
): number {
  if (namespaceContext.capacity?.maxBytes === undefined) return 0
  if (channel === 'value') return utf8ByteLength(value as string)
  if (channel === 'bytes') return (value as Uint8Array).byteLength
  if (channel === 'vector') {
    /** Native JS number components are binary64; this is accounting, not a portable vector wire. */
    const point = value as IStorageVectorPoint<unknown>
    return (
      point.vector.length * Float64Array.BYTES_PER_ELEMENT +
      (point.payload === undefined ? 0 : memoryCapacityValueBytes(point.payload))
    )
  }
  if (channel === 'rdf')
    return encodeStorageRdfQuad(value as IQuad, STORAGE_MEMORY_BACKEND).byteLength
  return memoryCapacityValueBytes(value)
}

/** One already owned physical identity is shared by the native entry and its policy metadata. */
export function capacityFact<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryPhysicalChannel,
  key: IStorageKey,
  bytes?: number,
  rdfLock?: ILockKey
): IMemoryCapacityChange {
  /** RDF already owns its original canonical identity; other channels retain the flat-key owner. */
  const encoded = channel === 'rdf' ? (key as string) : encodeFlatStorageKey(key)
  return {
    id: identity(namespaceContext, channel, encoded),
    channel,
    encoded,
    key,
    bytes,
    lock: rdfLock
  }
}

/** Capacity uses only native physical channels already known to this namespace. */
export function capacityLock<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  entry: IMemoryCapacityChange
): ILockKey | undefined {
  if (entry.channel === 'blob') return undefined
  if (entry.channel === 'value') return lockKey.text(entry.key)
  if (entry.channel === 'bytes') return lockKey.bytes(entry.key as string)
  if (entry.channel === 'rdf') return entry.lock!
  if (entry.channel === 'vector') {
    /** Vector rows already own the canonical collection/id tuple used by their lock owner. */
    const key = entry.key as readonly [string, string]
    return lockKey.vector(key[0], key[1])
  }
  return lockKey.record(entry.key)
}

/** Derive only elapsed deadline leaves, followed by actual policy victims of proposed writes. */
export function planCapacity<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  changes: readonly IMemoryCapacityChange[]
) {
  /** An omitted capacity never allocates accounting or candidate work. */
  if (namespaceContext.capacityIndex === undefined || namespaceContext.expiring === undefined)
    return undefined
  /** Inclusive now is expressed through the original tuple-prefix upper bound. */
  const upper = snapshotStorageKeyPrefix(
    [namespaceContext.scheduler.now()],
    STORAGE_MEMORY_BACKEND
  ).upper
  /** Actual expired rows alone enter the removal plan; no live-key table scan occurs. */
  const expired: IMemoryCapacityChange[] = []
  for (const leaf of namespaceContext.expiring.range({ upper, upperOpen: true })) {
    const { channel, encoded } = leaf.value
    const entry = namespaceContext.data[channel].get(encoded)
    if (entry !== undefined) expired.push(capacityFact(namespaceContext, channel, entry.key))
  }
  /** Preview restores the exact policy links before any lock wait or user callback can happen. */
  const victims = namespaceContext.capacityIndex.preview([...expired, ...changes])
  /** Canonical point identities feed only the existing physical lock owner and its original FIFO. */
  const identities = snapshotConcurrencyLockKeys(
    [...expired, ...victims]
      .map((entry: IMemoryCapacityChange) => capacityLock(namespaceContext, entry))
      .filter((key): key is ILockKey => key !== undefined),
    STORAGE_MEMORY_BACKEND
  ).identities
  return { expired, victims, identities }
}

/** Native metadata deletion is shared by expiry, explicit removal and committed capacity victims. */
export function deletePhysical<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryPhysicalChannel,
  encoded: string
): IMemoryEntry | undefined {
  if (channel === 'blob') {
    const entry = namespaceContext.blobs.removeEncoded(encoded)
    if (entry !== undefined)
      namespaceContext.capacityIndex?.remove(identity(namespaceContext, channel, encoded))
    return entry
  }
  const entry = namespaceContext.data[channel].get(encoded)
  if (entry === undefined) return undefined
  namespaceContext.data[channel].delete(encoded)
  if (channel === 'rdf') namespaceContext.rdfIndex.delete(entry.rdfKeys!)
  else namespaceContext.ordered[channel].delete(entry.ordered)
  setDeadline(namespaceContext, channel, encoded, undefined)
  namespaceContext.capacityIndex?.remove(identity(namespaceContext, channel, encoded))
  bump(namespaceContext, channel, encoded)
  return entry
}

/** Records and bytes detach ownership before an eviction or committed mutation occurs. */
export function clone<T, V>(
  namespaceContext: IMemoryNamespaceContext<T>,
  value: V,
  key?: IStorageKey
): V {
  try {
    return (globalThis as unknown as { structuredClone<W>(input: W): W }).structuredClone(value)
  } catch (cause) {
    throw new StorageError(StorageHostErrorCode.serializeFailed, {
      backend: STORAGE_MEMORY_BACKEND,
      key,
      cause
    })
  }
}

/** Memory values use one original clone rule for reads, writes and drafts. */
export function copyValue<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  value: unknown,
  key: IStorageKey
): unknown {
  return channel === 'value' || channel === 'rdf'
    ? value
    : channel === 'bytes'
      ? cloneBytes(namespaceContext, value as Uint8Array, key)
      : clone(namespaceContext, value, key)
}

/** Byte carriers preserve the original cross-realm guard and detached view-copy rule. */
function cloneBytes<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  value: Uint8Array,
  key: IStorageKey
): Uint8Array {
  try {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
  } catch (cause) {
    throw new StorageError(StorageHostErrorCode.serializeFailed, {
      backend: STORAGE_MEMORY_BACKEND,
      key,
      cause
    })
  }
}

/** Public scalar and byte writes retain their existing runtime input errors. */
export function prepare<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  value: unknown,
  key: IStorageKey
): unknown {
  if (channel === 'value' && typeof value !== 'string')
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      backend: STORAGE_MEMORY_BACKEND,
      key,
      cause: new TypeError(StorageErrorText.memoryTextValue)
    })
  if (channel === 'bytes' && !isUint8Array(value))
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      backend: STORAGE_MEMORY_BACKEND,
      key,
      cause: new TypeError(StorageErrorText.memoryBytesValue)
    })
  return copyValue(namespaceContext, channel, value, key)
}

/** Notifications retain original commit-after eviction order. */
export function publish<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryPhysicalChannel,
  kind: IStorageChange['kind'],
  keys?: readonly IStorageKey[]
): void {
  if (namespaceContext.pendingChanges !== undefined) {
    namespaceContext.pendingChanges.push({ channel, kind, keys })
    return
  }
  namespaceContext.controller.publish({
    channel: channel === 'vector' || channel === 'rdf' || channel === 'blob' ? 'all' : channel,
    kind,
    orgId: namespaceContext.orgId,
    // Broad RDF/object invalidations never expose physical graph or organization key envelopes.
    ...(keys === undefined || channel === 'rdf' || channel === 'blob' ? {} : { keys })
  })
}

/** Capacity mutations and their events share the original final synchronous native turn. */
export function commitCapacity<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  plan: ReturnType<typeof planCapacity>,
  run: () => R,
  committed?: () => void
): R {
  if (plan === undefined) {
    const result = run()
    committed?.()
    return result
  }
  namespaceContext.pendingChanges = []
  /** Counts retain only actual capacity removals, never ordinary expiry or user values. */
  const counts = new Map<IMemoryPhysicalChannel, number>()
  try {
    for (const entry of plan.expired) {
      const removed = deletePhysical(
        namespaceContext,
        entry.channel as IMemoryChannel,
        entry.encoded
      )
      if (removed !== undefined)
        publish(namespaceContext, entry.channel as IMemoryChannel, 'remove', [removed.key])
    }
    /** Input preparation and final lock checks have already completed before this callback. */
    const result = run()
    for (const entry of plan.victims) {
      const channel = entry.channel as IMemoryPhysicalChannel
      const removed = deletePhysical(namespaceContext, channel, entry.encoded)
      if (removed === undefined) continue
      publish(namespaceContext, channel, 'remove', [removed.key])
      counts.set(channel, (counts.get(channel) ?? 0) + 1)
    }
    committed?.()
    return result
  } finally {
    /** Clear the native event buffer before observers can synchronously reenter this store. */
    const changes = namespaceContext.pendingChanges
    namespaceContext.pendingChanges = undefined
    for (const change of changes)
      publish(namespaceContext, change.channel, change.kind, change.keys)
    for (const [channel, count] of counts)
      namespaceContext.core.emit(StorageHookName.onEvict, () => ({
        backendId: namespaceContext.core.getBackendId(),
        backend: STORAGE_MEMORY_BACKEND,
        orgId: namespaceContext.orgId,
        channel,
        count
      }))
  }
}

/** Every physical access shares one deadline check and the original removal/revision path. */
export function liveEntry<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IMemoryChannel,
  encoded: string
): IMemoryEntry | undefined {
  /** Physical membership and deadline use the same canonical channel/key identity. */
  const entry = namespaceContext.data[channel].get(encoded)
  /** Omitted deadlines remain unlimited, including keys first written before TTL is used. */
  const id = identity(namespaceContext, channel, encoded)
  /** The original monotonic clock is consulted once for this physical access. */
  const deadline = namespaceContext.deadlines.get(id)
  if (
    entry !== undefined &&
    deadline !== undefined &&
    deadline <= namespaceContext.scheduler.now()
  ) {
    deletePhysical(namespaceContext, channel, encoded)
    publish(namespaceContext, channel, 'remove', [entry.key])
    return undefined
  }
  return entry
}

/** Apply one already prepared root write synchronously, then publish its complete result. */
export function write<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey,
  value: unknown,
  policy: IConflictPolicy = 'conflict',
  bytes = entryBytes(namespaceContext, channel, value)
): void {
  namespaceContext.controller.assertLive()
  /** Snapshot and prepare before touching any conflicting channel. */
  const captured = key
  /** All data channels share the same existing flat logical-key identity. */
  const encoded = encodeFlatStorageKey(captured)
  /** Cloning completed before lock admission, so no borrowed getter can reopen this final turn. */
  const prepared = value
  /** One canonical ordered encoding is retained by the live entry and affected native indexes. */
  const encodedBytes = encodeOrderedStorageKey(captured, STORAGE_MEMORY_BACKEND)
  /** Overwrite keeps the already retained live bytes for the exact canonical identity. */
  const keyBytes = namespaceContext.ordered[channel].get(encodedBytes)?.key ?? encodedBytes
  /** Actual physical membership alone determines channel replacement. */
  const existing = new Set(
    MemoryState.channels.filter(
      (current) => liveEntry(namespaceContext, current, encoded) !== undefined
    )
  )
  /** Shared conflict policy owns one removal order for all backends. */
  const plan = planChannelWrite(captured, channel, existing, policy, STORAGE_MEMORY_BACKEND)
  for (const previous of plan.remove) {
    deletePhysical(namespaceContext, previous, encoded)
  }
  /** The hash and radix owners share this exact committed entry reference. */
  const entry = { key: captured, value: prepared, ordered: keyBytes, bytes }
  namespaceContext.data[channel].set(encoded, entry)
  namespaceContext.ordered[channel].set(keyBytes, entry)
  namespaceContext.capacityIndex?.put({
    ...capacityFact(namespaceContext, channel, captured),
    bytes
  })
  bump(namespaceContext, channel, encoded)
  for (const previous of plan.remove) publish(namespaceContext, previous, 'remove', [captured])
  publish(namespaceContext, channel, 'put', [captured])
}

/** Root deletes remain genuine no-ops when the original channel has no such key. */
export function remove<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey
): void {
  namespaceContext.controller.assertLive()
  /** Deletes detach caller-owned key objects before recording a committed event. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** The same wire identity is used by reads, writes and revision tombstones. */
  const encoded = encodeFlatStorageKey(captured)
  /** The actual entry already owns the canonical ordered bytes needed for removal. */
  const entry = liveEntry(namespaceContext, channel, encoded)
  if (!entry) return
  deletePhysical(namespaceContext, channel, encoded)
  publish(namespaceContext, channel, 'remove', [captured])
}

/** Clear invalidates the actual channel snapshot even when membership was already empty. */
export function clear<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  notify = true
): void {
  namespaceContext.controller.assertLive()
  /** Preserve the original rule that an empty clear emits no notification. */
  const changed = namespaceContext.data[channel].size !== 0
  for (const encoded of namespaceContext.data[channel].keys()) {
    setDeadline(namespaceContext, channel, encoded, undefined)
    namespaceContext.capacityIndex?.remove(identity(namespaceContext, channel, encoded))
  }
  namespaceContext.data[channel].clear()
  namespaceContext.ordered[channel].clear()
  namespaceContext.revisions.clear(channel === 'value' ? 'text' : channel)
  if (changed && notify) publish(namespaceContext, channel, 'clear')
}

/** All flat reads retain string-only validation and old null/undefined missing results. */
export function read<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey
): unknown {
  namespaceContext.controller.assertLive()
  /** Record keys remain structured; flat text and bytes remain string-only. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** Reading never allocates a revision or changes physical membership. */
  const entry = liveEntry(namespaceContext, channel, encodeFlatStorageKey(captured))
  if (entry !== undefined)
    namespaceContext.capacityIndex?.touch(
      identity(namespaceContext, channel, encodeFlatStorageKey(captured))
    )
  return entry === undefined
    ? undefined
    : copyValue(namespaceContext, channel, entry.value, captured)
}

/** Replace admits every possible displaced channel in the same fixed canonical order. */
function mutationKeys<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey,
  policy?: IConflictPolicy
): readonly ILockKey[] {
  return (policy === 'replace' ? MemoryState.channels : [channel]).flatMap<ILockKey>((current) =>
    current === 'value'
      ? [lockKey.text(key)]
      : current === 'record'
        ? [lockKey.record(key)]
        : typeof key === 'string'
          ? [lockKey.bytes(key)]
          : []
  )
}

/** One finite range per affected channel uses the original contract's encoded identity bounds. */
export function mutationRanges<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channels: readonly IMemoryChannel[]
) {
  return channels.map((channel) => {
    /** Physical text identity is shared by scalar and typed transaction text keys. */
    const target: ILockKey['channel'] = channel === 'value' ? 'text' : channel
    return {
      channel: target,
      ...snapshotConcurrencyLockRange({ channel: target }, STORAGE_MEMORY_BACKEND)
    }
  })
}

/** Busy synchronous writes cannot run a policy or wait; diagnostics identify the actual holder. */
export function assertUnlocked<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  keys: readonly ILockKey[],
  ranges?: IMemoryRootMutation<unknown>['ranges']
): void {
  /** Canonical admission pairs detached keys with the sole original identity representation. */
  const captured = snapshotConcurrencyLockKeys(keys, STORAGE_MEMORY_BACKEND)
  /** Point checks perform only fixed-channel Map lookups; clear examines its affected bucket. */
  const held = namespaceContext.locks.probe(captured.identities, ranges)
  if (held !== undefined)
    throw new StorageContractError(StorageContractErrorCode.lockRejected, {
      backend: STORAGE_MEMORY_BACKEND,
      keys: [held.key],
      holder: held.holder
    })
}

/** Capture borrowed payload before admission; the eventual physical mutation never calls it again. */
export function prepareWrite<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChannel,
  key: IStorageKey,
  value: unknown,
  policy?: IConflictPolicy
): IMemoryRootMutation<void> {
  /** Caller-owned key segments and record/byte values detach before waiting can begin. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** A clone failure cannot remove a displaced row or acquire a logical key. */
  const prepared = prepare(namespaceContext, channel, value, captured)
  /** Byte-domain admission precedes every possible displaced channel or draft mutation. */
  const bytes = entryBytes(namespaceContext, channel, prepared)
  return {
    keys: mutationKeys(namespaceContext, channel, captured, policy),
    capacityChanges:
      namespaceContext.capacity === undefined
        ? undefined
        : () => {
            /** Only the same logical key's original conflict channels participate in replacement. */
            const changes: IMemoryCapacityChange[] =
              policy === 'replace'
                ? MemoryState.channels
                    .filter((current) => current !== channel)
                    .map((current) => capacityFact(namespaceContext, current, captured))
                : []
            changes.push(capacityFact(namespaceContext, channel, captured, bytes))
            return changes
          },
    invoke: (draft) => draft.write(channel, captured, prepared, policy ?? 'conflict'),
    run: () => write(namespaceContext, channel, captured, prepared, policy, bytes)
  }
}

/** Root writes reuse the original execution list, policy loop, member lease and lock provider. */
export function mutationEntry<T, I, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  input: I,
  ctx: IWriteOptions | undefined,
  prepareMutation: (captured: I, context: IOperationContextSnapshot) => IMemoryRootMutation<R>,
  journaled = true
): Promise<R> {
  /** Original metadata/drop operations must not recursively journal their own invalidation. */
  const selectedJournal = journaled ? namespaceContext.core.journal : undefined
  /** Pipeline intervention fixes this input before the original loop derives affected keys. */
  let capturedInput = input
  /** The sole derivation captures inputs and affected keys once, before any native attempt. */
  let mutation!: IMemoryRootMutation<R>
  /** The last readonly preflight is consumed immediately by the same native synchronous terminal. */
  let capacityPlan: ReturnType<typeof planCapacity>
  /** Only this selected native attempt's real victim identities enter the original lock provider. */
  let capacityIdentities: readonly string[] = []
  /** Preparation is accepted work of this original controller, including close races. */
  const preparing =
    selectedJournal === undefined ? undefined : namespaceContext.controller.beginMutation()
  const pending = runWithConcurrency<R>(
    {
      store: namespaceContext.base,
      options: ctx === undefined ? {} : ctx,
      prepare: selectedJournal === undefined ? undefined : () => selectedJournal!.prepare(),
      execute: (context, invoke) =>
        namespaceContext.core.execution.run(
          {
            operation,
            input,
            ctx: context,
            keys: () => mutation?.keys ?? [],
            internal: journaled ? undefined : true
          },
          (captured) => {
            namespaceContext.controller.assertLive()
            /** Direct closure retains accepted work until queued/native admission truly finishes. */
            const release = namespaceContext.controller.beginMutation()
            capturedInput = captured
            try {
              return invoke().finally(release)
            } catch (cause) {
              /** Input/implicit-lock admission can reject before the loop returns its Promise. */
              release()
              throw cause
            }
          }
        ),
      lock: (context) => {
        mutation = prepareMutation(capturedInput, context)
        return selectedJournal === undefined
          ? mutation.keys
          : [...mutation.keys, ...selectedJournal.headLocks()]
      }
    },
    {
      attempt: (attempt) => {
        if (selectedJournal?.active()) {
          if (mutation.invoke === undefined)
            throw new StorageContractError(StorageContractErrorCode.unsupported)
          return namespaceContext.locks.attempt(
            attempt,
            holding(namespaceContext),
            {
              attempt: () =>
                transact(
                  namespaceContext,
                  (_scope, draft) => mutation.invoke!(draft),
                  attempt,
                  mutation.ranges,
                  (identities) => {
                    capacityIdentities = identities
                  }
                )
            },
            namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
            namespaceContext.controller.closingSignal,
            mutation.ranges,
            namespaceContext.capacity === undefined ? undefined : () => capacityIdentities
          )
        }
        return namespaceContext.locks.attemptWrite(
          attempt,
          holding(namespaceContext),
          () => commitCapacity(namespaceContext, capacityPlan, mutation.run),
          namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
          namespaceContext.controller.closingSignal,
          mutation.ranges,
          undefined,
          namespaceContext.capacity === undefined
            ? undefined
            : () => {
                capacityPlan =
                  mutation.capacityChanges === undefined
                    ? undefined
                    : planCapacity(namespaceContext, mutation.capacityChanges())
                return capacityPlan?.identities ?? []
              }
        )
      }
    }
  )
  return preparing === undefined ? pending : pending.finally(preparing)
}

/** All-channel clearing retains its original one coarse event after one synchronous merge. */
export function clearAll<T>(namespaceContext: IMemoryNamespaceContext<T>, notify = true): void {
  namespaceContext.controller.assertLive()
  /** Empty physical channels still advance epochs without manufacturing change notifications. */
  const changed =
    namespaceContext.blobs.size !== 0 ||
    namespaceContext.physicalChannels.some((channel) => namespaceContext.data[channel].size !== 0)
  for (const channel of namespaceContext.physicalChannels) {
    namespaceContext.data[channel].clear()
    namespaceContext.ordered[channel].clear()
    namespaceContext.revisions.clear(channel === 'value' ? 'text' : channel)
  }
  namespaceContext.deadlines.clear()
  namespaceContext.expiring?.clear()
  namespaceContext.capacityIndex?.clear()
  namespaceContext.rdfIndex.clear()
  namespaceContext.blobs.clear()
  if (changed && notify)
    namespaceContext.controller.publish({
      channel: 'all',
      kind: 'clear',
      orgId: namespaceContext.orgId
    })
}

/** Channel selection is captured before the shared provider's final synchronous range check. */
export function clearEntry<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  channel: IStorageChannel | undefined,
  ctx: IWriteOptions | undefined
): Promise<void> {
  return mutationEntry(namespaceContext, operation, channel, ctx, (captured) => ({
    keys: [],
    ranges: mutationRanges(
      namespaceContext,
      captured === undefined ? namespaceContext.physicalChannels : [captured]
    ),
    invoke: (draft) => draft.clear(captured),
    run: () =>
      captured === undefined ? clearAll(namespaceContext) : clear(namespaceContext, captured)
  }))
}
