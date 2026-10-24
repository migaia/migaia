import {
  compareStorageKeys,
  StorageContractError,
  StorageContractErrorCode,
  type IStorageKey
} from '@migaia/storage-contract'
import { encodeFlatStorageKey, decodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
import type { IScheduler } from '@migaia/utils/scheduler'

/** The original META store alone owns deadline rows and its native expiry index. */
export const IndexedDbTtlLayout = {
  namespace: 'ttl',
  index: '__storage_web_ttl_expiry__',
  expiresAt: '__storage_web_expires_at__'
} as const
/** Physical IDB channels retain their existing names; the public text lock maps to value. */
export type IIndexedDbTtlChannel = 'value' | 'bytes' | 'record'
/** One native snapshot remembers a deadline observation without creating a backend deadline cache. */
type IIndexedDbTtlObservation = {
  readonly channel: IIndexedDbTtlChannel
  readonly key: IStorageKey
  readonly metadataKey: IDBValidKey
  observedDeadline: number | undefined
  /** Concurrent accepted reads share this one original native observation, without another queue. */
  loaded: Promise<void> | undefined
  present: boolean
  /** Distinguish TTL deletion from an unrelated orphaned native sidecar. */
  expired: boolean
  deadline: number | undefined
}
/** This native transaction borrows its original data requests and deletion/revision path. */
export type IIndexedDbTtlInput = {
  readonly metadata: IDBObjectStore
  readonly namespace: string
  readonly keyRange: typeof IDBKeyRange | undefined
  readonly request: <T>(make: () => IDBRequest<T>) => Promise<T>
  readonly now: () => number
  readonly present: (channel: IIndexedDbTtlChannel, key: IStorageKey) => Promise<boolean>
  readonly remove: (channel: IIndexedDbTtlChannel, key: IStorageKey) => Promise<void>
  readonly changed: (channel: IIndexedDbTtlChannel, key: IStorageKey) => void
  /** Private deadline mutations use the same original point revision and ordered capture owner. */
  readonly deadline: <R>(
    channel: IIndexedDbTtlChannel,
    key: IStorageKey,
    before: number | undefined,
    after: number | undefined,
    run: () => Promise<R>
  ) => Promise<R>
}

/**
 * Capture the native monotonic epoch mapping once. Subsequent elapsed time belongs exclusively to
 * the already-installed scheduler, including a caller's deterministic scheduler.
 */
export function captureIndexedDbTtlClock(scheduler: IScheduler): () => number {
  /** The fixed native realm origin makes persisted default-clock deadlines comparable across pages. */
  const clock = globalThis.performance
  /** Platform samples are captured at installation, never consulted again by expiry operations. */
  const offset = clock.timeOrigin + clock.now() - scheduler.now()
  return () => offset + scheduler.now()
}

/** Native TTL ports retain the same observed deadline and supplied transaction. */
type IIndexedDbTtlAccess = {
  present(channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<boolean>
  expired(channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<boolean>
  written(channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<void>
  removed(channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<void>
  expire(channel: IIndexedDbTtlChannel, key: IStorageKey, ms: number): Promise<boolean>
  persist(channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<boolean>
  remaining(channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<number | undefined>
  clear(channel: IIndexedDbTtlChannel): Promise<void>
  expiredObservation():
    | { readonly channel: IIndexedDbTtlChannel; readonly key: IStorageKey }
    | undefined
  restore(
    channel: IIndexedDbTtlChannel,
    key: IStorageKey,
    deadline: number | undefined
  ): Promise<void>
  deadline(channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<number | undefined>
}

/**
 * Maintain deadline metadata only inside a supplied, already-owned native transaction. Accepted
 * operations, request admission, commit, rollback, cancellation and physical cleanup remain with
 * the caller's original IDB/transaction owners.
 */

/** One native ttl snapshot owns its existing observations and original transaction ports. */
type IIndexedDbTtlContext = {
  /** Original input is captured before native construction begins. */
  readonly input: IIndexedDbTtlInput

  /** Only this native snapshot's observed keys are retained; no history survives its transaction. */
  observations: Map<string, IIndexedDbTtlObservation>
}
export function createIndexedDbTtlAccess(input: IIndexedDbTtlInput): IIndexedDbTtlAccess {
  /** Initialize native facts in original construction order before publishing any port. */
  const nativeState = { input } as IIndexedDbTtlContext

  /** Only this native snapshot's observed keys are retained; no history survives its transaction. */
  nativeState.observations = new Map<string, IIndexedDbTtlObservation>()
  return createNativeMethods(nativeState)
}

/** Canonical physical-key encoding is borrowed from the same original key owner as data locks. */
function identity(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
) {
  return JSON.stringify([channel, encodeFlatStorageKey(key)])
}

/** Private array keys cannot collide with the public string metadata channel. */
function metadataKey(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
): IDBValidKey {
  return [
    nativeState.input.namespace,
    IndexedDbTtlLayout.namespace,
    channel,
    encodeFlatStorageKey(key)
  ]
}

/** First access decides expiry; subsequent reads retain this native snapshot and its own draft. */
async function observe(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
) {
  /** Both data and metadata reuse the exact same native transaction supplied by the owner. */
  const id = identity(nativeState, channel, key)
  /** Derived operation views share one retained first observation, including overlapping reads. */
  let current = nativeState.observations.get(id)
  if (current === undefined) {
    /** Capture before any request await and publish this pending observation before native I/O. */
    const observedAt = nativeState.input.now()
    current = {
      channel,
      key,
      metadataKey: metadataKey(nativeState, channel, key),
      observedDeadline: undefined,
      loaded: undefined,
      present: false,
      expired: false,
      deadline: undefined
    }
    nativeState.observations.set(id, current)
    /** This exact retained record, rather than a later caller, receives the native result. */
    const captured = current
    captured.loaded = (async () => {
      /** Only backend-owned private rows carry authoritative expiry. */
      const stored = await nativeState.input.request(() =>
        nativeState.input.metadata.get(captured.metadataKey)
      )
      /** The original channel lookup distinguishes missing data from an unlimited live entry. */
      const present = await nativeState.input.present(channel, key)
      /** Deadline values originate only from this same native metadata writer. */
      const deadline = stored?.[IndexedDbTtlLayout.expiresAt] as number | undefined
      captured.present = present
      captured.deadline = deadline
      captured.observedDeadline =
        present && deadline !== undefined && deadline > observedAt ? deadline : undefined
      if (!present || (deadline !== undefined && deadline <= observedAt)) {
        captured.expired = present
        captured.present = false
        captured.deadline = undefined
        if (present) await nativeState.input.remove(channel, key)
        if (stored !== undefined)
          await nativeState.input.deadline(channel, key, deadline, undefined, () =>
            nativeState.input.request(() => nativeState.input.metadata.delete(captured.metadataKey))
          )
      }
    })()
  }
  await current.loaded
  return current
}
/** Publish native ttl ports on their original transaction state. */
function createNativeMethods(nativeState: IIndexedDbTtlContext): IIndexedDbTtlAccess {
  return {
    /** All reads in the supplied native transaction share the first expiry observation. */
    present: (channel: IIndexedDbTtlChannel, key: IStorageKey) =>
      nativeTtlPresent(nativeState, channel, key),
    /**
     * Missing sidecars retain their original orphan handling unless this snapshot really expired
     * data.
     */
    expired: (channel: IIndexedDbTtlChannel, key: IStorageKey) =>
      nativeTtlExpired(nativeState, channel, key),
    /** A native overwrite preserves a live target's deadline; newly created data is unlimited. */
    written: (channel: IIndexedDbTtlChannel, key: IStorageKey) =>
      nativeTtlWritten(nativeState, channel, key),
    /** Explicit delete/replace removes exactly the old target's metadata in the same transaction. */
    removed: (channel: IIndexedDbTtlChannel, key: IStorageKey) =>
      nativeTtlRemoved(nativeState, channel, key),
    /** A real TTL write uses the same native draft as the data and publishes only after commit. */
    expire: (channel: IIndexedDbTtlChannel, key: IStorageKey, ms: number) =>
      nativeTtlExpire(nativeState, channel, key, ms),
    /** Unlimited or missing targets have no expiry to remove, matching the original TTL owner. */
    persist: (channel: IIndexedDbTtlChannel, key: IStorageKey) =>
      nativeTtlPersist(nativeState, channel, key),
    /**
     * Remaining duration decreases on the original scheduler while the native value stays
     * snapshotted.
     */
    remaining: (channel: IIndexedDbTtlChannel, key: IStorageKey) =>
      nativeTtlRemaining(nativeState, channel, key),
    /** Native clear removes only this channel's private contiguous metadata range. */
    clear: (channel: IIndexedDbTtlChannel) => nativeTtlClear(nativeState, channel),
    /**
     * Original commit policy receives the observed target if time invalidated its retained
     * snapshot.
     */
    expiredObservation: () => nativeTtlExpiredObservation(nativeState),
    /** Private undo restores the exact physical deadline without performing a business read. */
    restore: (channel: IIndexedDbTtlChannel, key: IStorageKey, deadline: number | undefined) =>
      nativeTtlRestore(nativeState, channel, key, deadline),
    /** Physical image comparison never expires data or resamples a relative duration. */
    deadline: (channel: IIndexedDbTtlChannel, key: IStorageKey) =>
      nativeTtlDeadline(nativeState, channel, key)
  }
}

/** Perform native present through this snapshot's original ttl owner. */
async function nativeTtlPresent(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
): Promise<boolean> {
  return (await observe(nativeState, channel, key)).present
}
/** Perform native expired through this snapshot's original ttl owner. */
async function nativeTtlExpired(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
): Promise<boolean> {
  return (await observe(nativeState, channel, key)).expired
}
/** Perform native written through this snapshot's original ttl owner. */
async function nativeTtlWritten(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
): Promise<void> {
  /** The caller observes all conflicting channels before issuing its original data write. */
  const current = await observe(nativeState, channel, key)
  current.present = true
}
/** Perform native removed through this snapshot's original ttl owner. */
async function nativeTtlRemoved(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
): Promise<void> {
  /** An existing observation retains its original deadline solely for final conflict validation. */
  const prior = nativeState.observations.get(identity(nativeState, channel, key))
  const before = prior?.deadline
  if (prior !== undefined) {
    prior.present = false
    prior.deadline = undefined
  }
  const stored =
    prior === undefined
      ? await nativeState.input.request(() =>
          nativeState.input.metadata.get(metadataKey(nativeState, channel, key))
        )
      : undefined
  const deadline = before ?? (stored?.[IndexedDbTtlLayout.expiresAt] as number | undefined)
  await nativeState.input.deadline(channel, key, deadline, undefined, () =>
    nativeState.input.request(() =>
      nativeState.input.metadata.delete(metadataKey(nativeState, channel, key))
    )
  )
}
/** Perform native expire through this snapshot's original ttl owner. */
async function nativeTtlExpire(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey,
  ms: number
): Promise<boolean> {
  const current = await observe(nativeState, channel, key)
  if (!current.present) return false
  if (ms === 0) {
    const before = current.deadline
    current.present = false
    current.expired = true
    current.deadline = undefined
    await nativeState.input.remove(channel, key)
    await nativeState.input.deadline(channel, key, before, undefined, () =>
      nativeState.input.request(() => nativeState.input.metadata.delete(current.metadataKey))
    )
  } else {
    const before = current.deadline
    current.deadline = nativeState.input.now() + ms
    await nativeState.input.deadline(channel, key, before, current.deadline, () =>
      nativeState.input.request(() =>
        nativeState.input.metadata.put(
          { [IndexedDbTtlLayout.expiresAt]: current.deadline },
          current.metadataKey
        )
      )
    )
    nativeState.input.changed(channel, key)
  }
  return true
}
/** Perform native persist through this snapshot's original ttl owner. */
async function nativeTtlPersist(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
): Promise<boolean> {
  const current = await observe(nativeState, channel, key)
  if (!current.present || current.deadline === undefined) return false
  const before = current.deadline
  current.deadline = undefined
  await nativeState.input.deadline(channel, key, before, undefined, () =>
    nativeState.input.request(() => nativeState.input.metadata.delete(current.metadataKey))
  )
  nativeState.input.changed(channel, key)
  return true
}
/** Perform native remaining through this snapshot's original ttl owner. */
async function nativeTtlRemaining(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
): Promise<number | undefined> {
  const current = await observe(nativeState, channel, key)
  return current.deadline === undefined
    ? undefined
    : Math.max(0, current.deadline - nativeState.input.now())
}
/** Perform native clear through this snapshot's original ttl owner. */
async function nativeTtlClear(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel
): Promise<void> {
  const prefix = [nativeState.input.namespace, IndexedDbTtlLayout.namespace, channel]
  const cursorRequest = nativeState.input.metadata.openCursor(
    nativeState.input.keyRange?.lowerBound(prefix)
  )
  let cursor = await nativeState.input.request(() => cursorRequest)
  if (
    nativeState.input.keyRange === undefined &&
    cursor !== null &&
    compareStorageKeys(cursor.key as IStorageKey, prefix) < 0
  )
    cursor = await nativeState.input.request(() => {
      cursor!.continue(prefix)
      return cursorRequest
    })
  while (cursor !== null) {
    const key = cursor.key
    if (!Array.isArray(key) || key[0] !== prefix[0] || key[1] !== prefix[1] || key[2] !== channel)
      break
    const before = cursor.value?.[IndexedDbTtlLayout.expiresAt] as number | undefined
    const encoded = key[3]
    const original = typeof encoded === 'string' ? decodeFlatStorageKey(encoded) : undefined
    if (original === undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    await nativeState.input.deadline(channel, original, before, undefined, () =>
      nativeState.input.request(() => cursor!.delete())
    )
    cursor = await nativeState.input.request(() => {
      cursor!.continue()
      return cursorRequest
    })
  }
  for (const value of nativeState.observations.values())
    if (value.channel === channel) {
      value.present = false
      value.deadline = undefined
    }
}
/** Perform native expiredObservation through this snapshot's original ttl owner. */
function nativeTtlExpiredObservation(
  nativeState: IIndexedDbTtlContext
): { readonly channel: IIndexedDbTtlChannel; readonly key: IStorageKey } | undefined {
  const now = nativeState.input.now()
  for (const value of nativeState.observations.values())
    if (value.observedDeadline !== undefined && value.observedDeadline <= now) return value
  return undefined
}
/** Perform native restore through this snapshot's original ttl owner. */
async function nativeTtlRestore(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey,
  deadline: number | undefined
): Promise<void> {
  const target = metadataKey(nativeState, channel, key)
  const stored = await nativeState.input.request(() => nativeState.input.metadata.get(target))
  const before = stored?.[IndexedDbTtlLayout.expiresAt] as number | undefined
  await nativeState.input.deadline(channel, key, before, deadline, async () => {
    if (deadline === undefined)
      await nativeState.input.request(() => nativeState.input.metadata.delete(target))
    else
      await nativeState.input.request(() =>
        nativeState.input.metadata.put({ [IndexedDbTtlLayout.expiresAt]: deadline }, target)
      )
  })
  nativeState.input.changed(channel, key)
}
/** Perform native deadline through this snapshot's original ttl owner. */
async function nativeTtlDeadline(
  nativeState: IIndexedDbTtlContext,
  channel: IIndexedDbTtlChannel,
  key: IStorageKey
): Promise<number | undefined> {
  const stored = await nativeState.input.request(() =>
    nativeState.input.metadata.get(metadataKey(nativeState, channel, key))
  )
  return stored?.[IndexedDbTtlLayout.expiresAt] as number | undefined
}
