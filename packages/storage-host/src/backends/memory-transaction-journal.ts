// Transaction text drafts, TTL and journal images for the memory backend (see ./memory.ts).
import {
  StorageContractError,
  StorageContractErrorCode,
  type IQuad,
  type IStorageVectorPoint,
  type IStorageKey,
  type IConflictPolicy
} from '@migaia/storage-contract'
import { lockKey } from '../authoring/concurrency.js'
import { encodeOrderedStorageKey, snapshotStorageKeyPrefix } from '../authoring/key.js'
import { snapshotStorageVectorUpsert } from '../authoring/vector.js'
import { memoryJournalDeadlineTarget, snapshotMemoryJournalTarget } from './memory-journal-image.js'
import type {
  IStorageJournalChange,
  IStorageJournalImage,
  IStorageJournalTarget
} from '../journal/types.js'
import { encodeStorageJournalImage, decodeStorageJournalImage } from '../journal/image.js'
import type { IStorageChannel } from '../errors.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { encodeFlatStorageKey } from '../core/key-domain.js'
import { identity, entryBytes } from './memory-entries.js'
import { ttlChannel, ttlKey } from './memory-keyvalue.js'
import { captureRdfEntries } from './memory-namespace-base.js'
import {
  txWrite,
  txRemove,
  txSnapshot,
  stageDraft,
  txRead,
  txEntry,
  txVectorPoints,
  txRdfWrite,
  txRows
} from './memory-transaction.js'
import type { IMemoryTransactionContext } from './memory-transaction.js'
import { vectorKey } from './memory-vector.js'
import type { IMemoryTtlTarget, IMemoryChannel, IMemoryDraft } from './memory.js'

/** Native text batches stage only into this attempt's existing draft and revision baseline. */
export function createMemoryTransactionTextDraft<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>
): IMemoryTransactionContext<T, R>['textDraft'] {
  return {
    write: (
      channel: IStorageChannel,
      key: IStorageKey,
      value: unknown,
      policy: IConflictPolicy,
      ttlMs?: number
    ) => txWrite(transactionContext, channel, key, value, policy, ttlMs),
    remove: (channel: IStorageChannel | 'vector', key: IStorageKey) =>
      txRemove(transactionContext, channel, key),
    clear: (channel) => {
      /** Blob has no shared image target, so an all-channel clear must not silently delete it. */
      if (channel === undefined && transactionContext.namespaceContext.blobs.size !== 0)
        throw new StorageContractError(StorageContractErrorCode.unsupported)
      transactionContext.clearedChannels =
        channel === undefined ? transactionContext.namespaceContext.physicalChannels : [channel]
      transactionContext.clearAllRequested = channel === undefined
      transactionContext.clearChanged = transactionContext.clearedChannels.some(
        (current) => transactionContext.namespaceContext.data[current].size !== 0
      )
      for (const current of transactionContext.clearedChannels) {
        if (!transactionContext.snapshotEpochs.has(current))
          transactionContext.snapshotEpochs.set(
            current,
            transactionContext.namespaceContext.revisions.epoch(
              current === 'value' ? 'text' : current
            )
          )
        /** Native Map iteration advances safely when the original TTL owner prunes an entry. */
        for (const [encoded, entry] of transactionContext.namespaceContext.data[current]) {
          const snapshot = txSnapshot(transactionContext, current, encoded, entry.key)
          if (snapshot !== undefined)
            stageDraft(transactionContext, { ...snapshot, channel: current, encoded, remove: true })
        }
      }
    },
    ttl: (target, ms, persist) => txTtl(transactionContext, target, ms, persist),
    increment: (key, increment) => {
      const result = increment(txRead(transactionContext, 'value', key) as string | undefined)
      txWrite(transactionContext, 'value', key, String(result), 'conflict')
      return result
    },
    upsertVector: (collection, points, sizes, ttlMs) => {
      /** Captured vector inputs enter the existing native draft without a second public pipeline. */
      const now = transactionContext.namespaceContext.scheduler.now()
      for (const [index, point] of points.entries()) {
        const key = vectorKey(transactionContext.namespaceContext, collection, point.id)
        const encoded = encodeFlatStorageKey(key)
        const current = txEntry(transactionContext, 'vector', key)
        const deadline = ttlMs === undefined ? current?.deadline : now + ttlMs
        if (deadline !== undefined && deadline <= now) {
          txRemove(transactionContext, 'vector', key)
          continue
        }
        stageDraft(transactionContext, {
          channel: 'vector',
          key,
          encoded,
          value: point,
          remove: false,
          ordered: current?.ordered ?? encodeOrderedStorageKey(key, STORAGE_MEMORY_BACKEND),
          bytes: sizes[index],
          deadline
        })
      }
    },
    deleteVector: (collection, predicate) => {
      let count = 0
      for (const point of txVectorPoints(transactionContext, collection))
        if (
          predicate(point) &&
          txRemove(
            transactionContext,
            'vector',
            vectorKey(transactionContext.namespaceContext, collection, point.id)
          )
        )
          count++
      return count
    },
    rdf: (input: readonly IQuad[], remove: boolean) =>
      txRdfWrite(transactionContext, input, remove),
    setMany: (entries) => {
      for (const entry of entries)
        txWrite(transactionContext, 'value', entry.key, entry.value, 'conflict', entry.ttlMs)
    },
    removeMany: (keys) => {
      /** Duplicate identities can only remove the first still-present draft entry. */
      let count = 0
      for (const key of keys) if (txRemove(transactionContext, 'value', key)) count++
      return count
    },
    removeByPrefix: (prefix, channel = 'value') => {
      /** Native prefix localization reuses the original canonical bounds and ordered draft merge. */
      const captured = snapshotStorageKeyPrefix(prefix, STORAGE_MEMORY_BACKEND)
      /** Count only actual removals in this channel and this native attempt. */
      let count = 0
      for (const row of txRows(transactionContext, channel, {
        lower: captured.lower,
        upper: captured.upper,
        upperOpen: true
      }))
        if (captured.matches(row.key) && txRemove(transactionContext, channel, row.key)) count++
      return count
    }
  }
}

/** TTL metadata changes stage beside the original value and never create a second draft. */
export function txTtl<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  target: IMemoryTtlTarget,
  ms: number | undefined,
  persist: boolean
): boolean {
  /** A TTL target has already been captured by the original contract lock owner. */
  const channel = ttlChannel(transactionContext.namespaceContext, target)
  const current = txEntry(
    transactionContext,
    channel,
    ttlKey(transactionContext.namespaceContext, target)
  )
  if (current === undefined || (persist && current.deadline === undefined)) return false
  stageDraft(
    transactionContext,
    {
      ...current,
      channel,
      encoded: encodeFlatStorageKey(current.key),
      remove: ms === 0,
      deadline: persist ? undefined : transactionContext.namespaceContext.scheduler.now() + ms!
    },
    true
  )
  return true
}

/** Remaining duration observes the same retained transaction value and captured deadline. */
export function txRemaining<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  target: IMemoryTtlTarget
): number | undefined {
  /** Missing and unlimited rows share the documented undefined result. */
  const current = txEntry(
    transactionContext,
    ttlChannel(transactionContext.namespaceContext, target),
    ttlKey(transactionContext.namespaceContext, target)
  )
  return current?.deadline === undefined
    ? undefined
    : Math.max(0, current.deadline - transactionContext.namespaceContext.scheduler.now())
}

/** Resolve logical journal identities through this exact org's existing physical key mapping. */
function journalRow<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: IStorageJournalTarget
) {
  const captured = snapshotMemoryJournalTarget(input)
  const target = captured.lock
  const channel: IMemoryChannel = target.channel === 'text' ? 'value' : target.channel
  const key =
    target.channel === 'rdf'
      ? captureRdfEntries(transactionContext.namespaceContext, [target.quad])[0]!.key
      : target.channel === 'vector'
        ? vectorKey(transactionContext.namespaceContext, target.collection, target.id)
        : target.key
  const encoded = target.channel === 'rdf' ? (key as string) : encodeFlatStorageKey(key)
  const proposed = transactionContext.draft.get(
    identity(transactionContext.namespaceContext, channel, encoded)
  )
  const current =
    target.channel === 'rdf'
      ? proposed
        ? proposed.remove
          ? undefined
          : proposed
        : txSnapshot(transactionContext, channel, encoded, key)
      : txEntry(transactionContext, channel, key)
  return { ...captured, channel, key, encoded, current }
}

/** Images observe the same draft and deadline as this native transaction's final physical row. */
export function readJournalImage<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: IStorageJournalTarget
): IStorageJournalImage {
  const row = journalRow(transactionContext, input)
  const current = row.current
  const present =
    current !== undefined &&
    (current.deadline === undefined ||
      current.deadline > transactionContext.namespaceContext.scheduler.now())
  return row.metadata
    ? encodeStorageJournalImage(present && current!.deadline !== undefined, current?.deadline)
    : encodeStorageJournalImage(
        present,
        row.channel === 'rdf' ? true : current?.value,
        row.channel === 'bytes'
      )
}

/** Restore through original staging, cloning, channel-conflict, TTL and RDF admission owners. */
export function writeJournalImage<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: IStorageJournalTarget,
  image: IStorageJournalImage
): void {
  const row = journalRow(transactionContext, input)
  const captured = decodeStorageJournalImage(image, row.channel === 'bytes' && !row.metadata)
  const value = captured.value
  if (row.metadata) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    if (row.current === undefined) {
      if (value === undefined) return
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    }
    stageDraft(
      transactionContext,
      {
        ...row.current,
        channel: row.channel,
        encoded: row.encoded,
        remove: value !== undefined && value <= transactionContext.namespaceContext.scheduler.now(),
        deadline: value as number | undefined
      },
      true
    )
    return
  }
  if (row.lock.channel === 'rdf') {
    if (captured.present && value !== true)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    txRdfWrite(transactionContext, [row.lock.quad], !captured.present)
    return
  }
  if (!captured.present) {
    txRemove(transactionContext, row.channel as IStorageChannel | 'vector', row.key)
    return
  }
  if (row.lock.channel === 'vector') {
    const configuration = transactionContext.namespaceContext.vectorCollections.get(
      row.lock.collection
    )
    if (configuration === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    /** The canonical upsert capture validates this decoded wire before any row is staged. */
    const point = snapshotStorageVectorUpsert(
      [value as IStorageVectorPoint<unknown>],
      configuration,
      STORAGE_MEMORY_BACKEND
    )[0]!
    if (point.id !== row.lock.id)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    stageDraft(transactionContext, {
      channel: 'vector',
      key: row.key,
      encoded: row.encoded,
      ordered: row.current?.ordered ?? encodeOrderedStorageKey(row.key, STORAGE_MEMORY_BACKEND),
      value: point,
      bytes: entryBytes(transactionContext.namespaceContext, 'vector', point),
      remove: false,
      deadline: row.current?.deadline
    })
    return
  }
  txWrite(transactionContext, row.channel as IStorageChannel, row.key, value, 'replace')
}

/** Full revisions include the original clear generation and the final draft's tombstone effect. */
export function readJournalRevision<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: IStorageJournalTarget
) {
  const row = journalRow(transactionContext, input)
  const id = identity(transactionContext.namespaceContext, row.channel, row.encoded)
  const proposed = transactionContext.draft.get(id)
  const removes =
    proposed?.remove === true ||
    (proposed?.deadline !== undefined &&
      proposed.deadline <= transactionContext.namespaceContext.scheduler.now())
  const changed =
    proposed !== undefined && (!removes || transactionContext.snapshots.get(id) !== undefined)
  if (transactionContext.clearedChannels?.includes(row.channel))
    return {
      epoch: transactionContext.snapshotEpochs.get(row.channel)! + 1,
      revision: 0
    }
  return {
    epoch: transactionContext.snapshotEpochs.get(row.channel)!,
    revision: transactionContext.expected.get(id)!.revision + (changed ? 1 : 0)
  }
}

/** Capture each actual native staging step before it changes this attempt's existing draft. */
export function captureJournalStage<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  entry: IMemoryDraft,
  metadataOnly: boolean
): void {
  if (transactionContext.journalChanges === undefined) return
  const id = identity(transactionContext.namespaceContext, entry.channel, entry.encoded)
  const previous = transactionContext.draft.get(id)
  const before = previous
    ? previous.remove
      ? undefined
      : previous
    : txSnapshot(transactionContext, entry.channel, entry.encoded, entry.key)
  const target =
    entry.channel === 'value'
      ? lockKey.text(entry.key)
      : entry.channel === 'bytes'
        ? lockKey.bytes(entry.key as string)
        : entry.channel === 'record'
          ? lockKey.record(entry.key)
          : entry.channel === 'vector'
            ? lockKey.vector(
                (entry.key as readonly [string, string])[0],
                (entry.key as readonly [string, string])[1]
              )
            : entry.rdfLock!
  const after = entry.remove ? undefined : entry
  /** All image encoding finishes before either a draft row or the ordered fact list changes. */
  const proposed: Array<Omit<IStorageJournalChange, 'afterRevision'>> = []
  if (!metadataOnly || entry.remove) {
    const beforeImage = encodeStorageJournalImage(
      before !== undefined,
      entry.channel === 'rdf' ? true : before?.value,
      entry.channel === 'bytes'
    )
    const afterImage = encodeStorageJournalImage(
      after !== undefined,
      entry.channel === 'rdf' ? true : after?.value,
      entry.channel === 'bytes'
    )
    if (beforeImage.present || afterImage.present)
      proposed.push({ target, before: beforeImage, after: afterImage })
  }
  if (target.channel !== 'rdf' && before?.deadline !== after?.deadline)
    proposed.push({
      target: memoryJournalDeadlineTarget(target),
      before: encodeStorageJournalImage(before?.deadline !== undefined, before?.deadline),
      after: encodeStorageJournalImage(after?.deadline !== undefined, after?.deadline)
    })
  transactionContext.journalChanges.push(...proposed)
}

/** Begin capture before the first write, then return detached ordered facts with final revisions. */
export function changes<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>
): readonly IStorageJournalChange[] {
  if (transactionContext.journalChanges === undefined) {
    if (transactionContext.draft.size !== 0)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    transactionContext.journalChanges = []
  }
  const result: IStorageJournalChange[] = []
  for (const change of transactionContext.journalChanges) {
    const row = journalRow(transactionContext, change.target)
    const afterRevision = readJournalRevision(transactionContext, change.target)
    /** A new row removed again leaves no physical mutation or storage.commit to describe. */
    if (
      afterRevision.revision ===
      transactionContext.expected.get(
        identity(transactionContext.namespaceContext, row.channel, row.encoded)
      )!.revision
    )
      continue
    result.push({ ...change, afterRevision })
  }
  return result
}
