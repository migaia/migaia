import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotConcurrencyLockKeys,
  type ILockKey,
  type IStorageKey
} from '@migaia/storage-contract'
import {
  StorageError as JournalError,
  StorageErrorCode as JournalErrorCode,
  StorageErrorText as JournalErrorText,
  type IStorageJournalChange,
  type IStorageJournalImage,
  type IStorageJournalTarget
} from '@migaia/storage-host'
import {
  createStorageToken,
  decodeFlatStorageKey,
  encodeFlatStorageKey,
  encodeStorageJournalImage
} from '@migaia/storage-host/authoring/backend'
import { StorageBackend } from '../constants.js'

/** Original physical channels retain their native store names and public lock identities. */
export type IIndexedDbImageChannel = 'value' | 'bytes' | 'record'
/** Birth plus a retained tombstone version prevents delete/recreate and clear ABA. */
type IIndexedDbImageRevision = { readonly birth: string | null; readonly version: number }
/** One actual native attempt retains only the keys it reads or changes. */
type IIndexedDbImageEntry = {
  readonly channel: IIndexedDbImageChannel
  readonly key: IStorageKey
  readonly lock: ILockKey
  readonly revisionKey: IDBValidKey
  revision: IIndexedDbImageRevision
  current: IStorageJournalImage | undefined
  writing: Promise<void> | undefined
}
/** Stable native revision tuple tag; clear preserves it to retain complete undo identity. */
const revisionTag = 'journal-point'
/** Stable persisted deadline target tag maps images back to the original data point lock. */
const deadlineTag = 'indexed-db.journal.deadline'

/** Snapshot native identities through the original contract and flat-key owners. */
export function indexedDbJournalTarget(target: IStorageJournalTarget): {
  readonly channel: IIndexedDbImageChannel
  readonly key: IStorageKey
  readonly lock: ILockKey
  readonly metadata: boolean
} {
  let input: IStorageJournalTarget = target
  const metadata = target.channel === 'metadata'
  if (metadata) {
    const decoded = decodeFlatStorageKey(target.key)
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 3 ||
      decoded[0] !== deadlineTag ||
      typeof decoded[2] !== 'string'
    )
      throw invalid()
    const key = decodeFlatStorageKey(decoded[2])
    if (key === undefined) throw invalid()
    input = { channel: decoded[1], key } as ILockKey
  }
  const lock = snapshotConcurrencyLockKeys([input as ILockKey], StorageBackend.indexedDb).keys[0]!
  if (lock.channel === 'rdf' || lock.channel === 'vector')
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  if (metadata && indexedDbDeadlineTarget(lock).key !== target.key) throw invalid()
  return {
    lock,
    key: lock.key,
    channel: lock.channel === 'text' ? 'value' : lock.channel,
    metadata
  }
}

/** Private deadline identity never enters business metadata or creates another lock table. */
export function indexedDbDeadlineTarget(
  lock: ILockKey
): Extract<IStorageJournalTarget, { channel: 'metadata' }> {
  if (lock.channel === 'rdf' || lock.channel === 'vector')
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  return {
    channel: 'metadata',
    key: encodeFlatStorageKey([deadlineTag, lock.channel, encodeFlatStorageKey(lock.key)])
  }
}

/** Clear retains these original private tombstones while deleting obsolete record/index revisions. */
export function isIndexedDbJournalRevision(key: IDBValidKey, namespace: string): boolean {
  return Array.isArray(key) && key.length === 4 && key[0] === namespace && key[1] === revisionTag
}

/** Image ports reuse one native attempt's ordered revisions and journal history. */
type IIndexedDbImageAccess = {
  mutate<R>(
    channel: IIndexedDbImageChannel,
    key: IStorageKey,
    present: boolean,
    value: unknown,
    run: () => Promise<R>
  ): Promise<R>
  clear<R>(
    channel: IIndexedDbImageChannel,
    keys: readonly IStorageKey[],
    run: () => Promise<R>
  ): Promise<R>
  deadline<R>(
    channel: IIndexedDbImageChannel,
    key: IStorageKey,
    before: number | undefined,
    after: number | undefined,
    run: () => Promise<R>
  ): Promise<R>
  revision(channel: IIndexedDbImageChannel, key: IStorageKey): Promise<IIndexedDbImageRevision>
  changes(): readonly IStorageJournalChange[]
}

/**
 * Ordered images and complete revisions borrow one original native transaction. Every contract
 * mutation advances its point revision; only explicitly selected attempts allocate image history.
 */

/** One native images snapshot owns its existing observations and original transaction ports. */
type IIndexedDbImageContext = {
  /** Original input is captured before native construction begins. */
  readonly input: {
    readonly namespace: string
    readonly revisions: IDBObjectStore
    readonly request: <R>(make: () => IDBRequest<R>) => Promise<R>
    readonly read: (
      channel: IIndexedDbImageChannel,
      key: IStorageKey
    ) => Promise<{ present: boolean; value?: unknown }>
  }

  /** Pending first observations are shared without serializing unrelated native requests. */
  entries: Map<string, Promise<IIndexedDbImageEntry>>

  /** Captured immutable steps preserve the actual native enqueue order, including repeated keys. */
  steps:
    | Array<{
        readonly entry: IIndexedDbImageEntry
        readonly target: IStorageJournalTarget
        readonly before: IStorageJournalImage
        readonly after: IStorageJournalImage
      }>
    | undefined

  /** Late capture cannot manufacture a before image after an accepted business mutation. */
  mutated: boolean
}
export function createIndexedDbJournalImages(input: {
  readonly namespace: string
  readonly revisions: IDBObjectStore
  readonly request: <R>(make: () => IDBRequest<R>) => Promise<R>
  readonly read: (
    channel: IIndexedDbImageChannel,
    key: IStorageKey
  ) => Promise<{ present: boolean; value?: unknown }>
}): IIndexedDbImageAccess {
  /** Initialize native facts in original construction order before publishing any port. */
  const nativeState = { input } as IIndexedDbImageContext

  /** Pending first observations are shared without serializing unrelated native requests. */
  nativeState.entries = new Map<string, Promise<IIndexedDbImageEntry>>()

  /** Late capture cannot manufacture a before image after an accepted business mutation. */
  nativeState.mutated = false
  return createNativeMethods(nativeState)
}

function observe(
  nativeState: IIndexedDbImageContext,
  channel: IIndexedDbImageChannel,
  key: IStorageKey
): Promise<IIndexedDbImageEntry> {
  const lock = snapshotConcurrencyLockKeys(
    [{ channel: channel === 'value' ? 'text' : channel, key } as ILockKey],
    StorageBackend.indexedDb
  ).keys[0]!
  const id = encodeFlatStorageKey([lock.channel, encodeFlatStorageKey(key)])
  let pending = nativeState.entries.get(id)
  if (pending === undefined) {
    pending = (async () => {
      const revisionKey: IDBValidKey = [
        nativeState.input.namespace,
        revisionTag,
        lock.channel,
        encodeFlatStorageKey(key)
      ]
      const raw: unknown = await nativeState.input.request(() =>
        nativeState.input.revisions.get(revisionKey)
      )
      const revision =
        raw === undefined ? { birth: null, version: 0 } : (raw as IIndexedDbImageRevision)
      if (
        typeof revision !== 'object' ||
        revision === null ||
        typeof revision.birth !== 'string' ||
        !Number.isSafeInteger(revision.version) ||
        revision.version < 0
      ) {
        if (raw !== undefined) throw invalid()
      }
      const stored =
        nativeState.steps === undefined ? undefined : await nativeState.input.read(channel, key)
      return {
        channel,
        key,
        lock,
        revisionKey,
        revision: revision,
        current:
          stored === undefined
            ? undefined
            : encodeStorageJournalImage(stored.present, stored.value, channel === 'bytes'),
        writing: undefined
      }
    })()
    nativeState.entries.set(id, pending)
  }
  return pending
}

/** One point advances once per native attempt; all later operations share the staged revision. */
function revise(nativeState: IIndexedDbImageContext, entry: IIndexedDbImageEntry): Promise<void> {
  if (entry.writing !== undefined) return entry.writing
  const revision = {
    birth: entry.revision.birth ?? createStorageToken(),
    version: entry.revision.version + 1
  }
  if (!Number.isSafeInteger(revision.version)) throw invalid()
  entry.revision = revision
  return (entry.writing = nativeState.input
    .request(() => nativeState.input.revisions.put(revision, entry.revisionKey))
    .then(() => undefined))
}

/** The same turn records an image and issues its original business request, without user callbacks. */
async function mutate<R>(
  nativeState: IIndexedDbImageContext,
  channel: IIndexedDbImageChannel,
  key: IStorageKey,
  present: boolean,
  value: unknown,
  run: () => Promise<R>
): Promise<R> {
  const entry = await observe(nativeState, channel, key)
  if (nativeState.steps !== undefined && entry.current === undefined) {
    const stored = await nativeState.input.read(channel, key)
    entry.current = encodeStorageJournalImage(stored.present, stored.value, channel === 'bytes')
  }
  const after =
    nativeState.steps === undefined
      ? undefined
      : encodeStorageJournalImage(present, value, channel === 'bytes')
  await revise(nativeState, entry)
  nativeState.mutated = true
  if (nativeState.steps !== undefined) {
    nativeState.steps.push({ entry, target: entry.lock, before: entry.current!, after: after! })
    entry.current = after
  }
  return run()
}
/** Publish native images ports on their original transaction state. */
function createNativeMethods(nativeState: IIndexedDbImageContext): IIndexedDbImageAccess {
  return {
    mutate: <R>(
      channel: IIndexedDbImageChannel,
      key: IStorageKey,
      present: boolean,
      value: unknown,
      run: () => Promise<R>
    ) => nativeImageMutate(nativeState, channel, key, present, value, run),
    /** Original one-shot native clear retains ordered per-key images and revision tombstones. */
    clear: <R>(
      channel: IIndexedDbImageChannel,
      keys: readonly IStorageKey[],
      run: () => Promise<R>
    ) => nativeImageClear(nativeState, channel, keys, run),
    /** Deadline changes retain their own images and the original point's complete revision. */
    deadline: <R>(
      channel: IIndexedDbImageChannel,
      key: IStorageKey,
      before: number | undefined,
      after: number | undefined,
      run: () => Promise<R>
    ) => nativeImageDeadline(nativeState, channel, key, before, after, run),
    revision: (channel: IIndexedDbImageChannel, key: IStorageKey) =>
      nativeImageRevision(nativeState, channel, key),
    changes: () => nativeImageChanges(nativeState)
  }
}

/** Native-owned revision or target corruption retains its original diagnostic cause. */
function invalid(cause?: unknown): JournalError {
  return new JournalError(
    JournalErrorCode.journalRecordInvalid,
    { cause },
    JournalErrorText.journalRecordInvalid
  )
}

/** Perform native mutate through this snapshot's original images owner. */
function nativeImageMutate<R>(
  nativeState: IIndexedDbImageContext,
  channel: IIndexedDbImageChannel,
  key: IStorageKey,
  present: boolean,
  value: unknown,
  run: () => Promise<R>
) {
  return mutate(nativeState, channel, key, present, value, run)
}
/** Perform native clear through this snapshot's original images owner. */
async function nativeImageClear<R>(
  nativeState: IIndexedDbImageContext,
  channel: IIndexedDbImageChannel,
  keys: readonly IStorageKey[],
  run: () => Promise<R>
): Promise<R> {
  const captured = await Promise.all(keys.map((key) => observe(nativeState, channel, key)))
  await Promise.all(captured.map((entry: IIndexedDbImageEntry) => revise(nativeState, entry)))
  if (captured.length !== 0) nativeState.mutated = true
  for (const entry of captured) {
    if (nativeState.steps !== undefined)
      nativeState.steps.push({
        entry,
        target: entry.lock,
        before: entry.current!,
        after: { present: false }
      })
    entry.current = { present: false }
  }
  return run()
}
/** Perform native deadline through this snapshot's original images owner. */
async function nativeImageDeadline<R>(
  nativeState: IIndexedDbImageContext,
  channel: IIndexedDbImageChannel,
  key: IStorageKey,
  before: number | undefined,
  after: number | undefined,
  run: () => Promise<R>
): Promise<R> {
  if (before === after) return run()
  const entry = await observe(nativeState, channel, key)
  const previous =
    nativeState.steps === undefined
      ? undefined
      : encodeStorageJournalImage(before !== undefined, before)
  const next =
    nativeState.steps === undefined
      ? undefined
      : encodeStorageJournalImage(after !== undefined, after)
  await revise(nativeState, entry)
  nativeState.mutated = true
  if (nativeState.steps !== undefined)
    nativeState.steps.push({
      entry,
      target: indexedDbDeadlineTarget(entry.lock),
      before: previous!,
      after: next!
    })
  return run()
}
/** Perform native revision through this snapshot's original images owner. */
async function nativeImageRevision(
  nativeState: IIndexedDbImageContext,
  channel: IIndexedDbImageChannel,
  key: IStorageKey
) {
  return (await observe(nativeState, channel, key)).revision
}
/** Perform native changes through this snapshot's original images owner. */
function nativeImageChanges(nativeState: IIndexedDbImageContext): readonly IStorageJournalChange[] {
  if (nativeState.steps === undefined) {
    if (nativeState.mutated) throw new StorageContractError(StorageContractErrorCode.unsupported)
    nativeState.steps = []
  }
  return nativeState.steps.map(({ entry, ...step }) => ({
    ...step,
    afterRevision: entry.revision
  }))
}
