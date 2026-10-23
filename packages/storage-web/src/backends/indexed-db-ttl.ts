import { compareStorageKeys, type IStorageKey } from '@migaia/storage-contract'
import { encodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
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

/**
 * Maintain deadline metadata only inside a supplied, already-owned native transaction. Accepted
 * operations, request admission, commit, rollback, cancellation and physical cleanup remain with
 * the caller's original IDB/transaction owners.
 */
export function createIndexedDbTtlAccess(input: IIndexedDbTtlInput) {
  /** Only this native snapshot's observed keys are retained; no history survives its transaction. */
  const observations = new Map<string, IIndexedDbTtlObservation>()
  /** Canonical physical-key encoding is borrowed from the same original key owner as data locks. */
  const identity = (channel: IIndexedDbTtlChannel, key: IStorageKey) =>
    JSON.stringify([channel, encodeFlatStorageKey(key)])
  /** Private array keys cannot collide with the public string metadata channel. */
  const metadataKey = (channel: IIndexedDbTtlChannel, key: IStorageKey): IDBValidKey => [
    input.namespace,
    IndexedDbTtlLayout.namespace,
    channel,
    encodeFlatStorageKey(key)
  ]
  /** First access decides expiry; subsequent reads retain this native snapshot and its own draft. */
  const observe = async (channel: IIndexedDbTtlChannel, key: IStorageKey) => {
    /** Both data and metadata reuse the exact same native transaction supplied by the owner. */
    const id = identity(channel, key)
    /** Derived operation views share one retained first observation, including overlapping reads. */
    let current = observations.get(id)
    if (current === undefined) {
      /** Capture before any request await and publish this pending observation before native I/O. */
      const observedAt = input.now()
      current = {
        channel,
        key,
        metadataKey: metadataKey(channel, key),
        observedDeadline: undefined,
        loaded: undefined,
        present: false,
        expired: false,
        deadline: undefined
      }
      observations.set(id, current)
      /** This exact retained record, rather than a later caller, receives the native result. */
      const captured = current
      captured.loaded = (async () => {
        /** Only backend-owned private rows carry authoritative expiry. */
        const stored = await input.request(() => input.metadata.get(captured.metadataKey))
        /** The original channel lookup distinguishes missing data from an unlimited live entry. */
        const present = await input.present(channel, key)
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
          if (present) await input.remove(channel, key)
          if (stored !== undefined)
            await input.request(() => input.metadata.delete(captured.metadataKey))
        }
      })()
    }
    await current.loaded
    return current
  }
  return {
    /** All reads in the supplied native transaction share the first expiry observation. */
    present: async (channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<boolean> =>
      (await observe(channel, key)).present,
    /**
     * Missing sidecars retain their original orphan handling unless this snapshot really expired
     * data.
     */
    expired: async (channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<boolean> =>
      (await observe(channel, key)).expired,
    /** A native overwrite preserves a live target's deadline; newly created data is unlimited. */
    written: async (channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<void> => {
      /** The caller observes all conflicting channels before issuing its original data write. */
      const current = await observe(channel, key)
      current.present = true
    },
    /** Explicit delete/replace removes exactly the old target's metadata in the same transaction. */
    removed: async (channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<void> => {
      /** An existing observation retains its original deadline solely for final conflict validation. */
      const prior = observations.get(identity(channel, key))
      if (prior !== undefined) {
        prior.present = false
        prior.deadline = undefined
      }
      await input.request(() => input.metadata.delete(metadataKey(channel, key)))
    },
    /** A real TTL write uses the same native draft as the data and publishes only after commit. */
    expire: async (
      channel: IIndexedDbTtlChannel,
      key: IStorageKey,
      ms: number
    ): Promise<boolean> => {
      const current = await observe(channel, key)
      if (!current.present) return false
      if (ms === 0) {
        current.present = false
        current.expired = true
        current.deadline = undefined
        await input.remove(channel, key)
        await input.request(() => input.metadata.delete(current.metadataKey))
      } else {
        current.deadline = input.now() + ms
        await input.request(() =>
          input.metadata.put(
            { [IndexedDbTtlLayout.expiresAt]: current.deadline },
            current.metadataKey
          )
        )
        input.changed(channel, key)
      }
      return true
    },
    /** Unlimited or missing targets have no expiry to remove, matching the original TTL owner. */
    persist: async (channel: IIndexedDbTtlChannel, key: IStorageKey): Promise<boolean> => {
      const current = await observe(channel, key)
      if (!current.present || current.deadline === undefined) return false
      current.deadline = undefined
      await input.request(() => input.metadata.delete(current.metadataKey))
      input.changed(channel, key)
      return true
    },
    /**
     * Remaining duration decreases on the original scheduler while the native value stays
     * snapshotted.
     */
    remaining: async (
      channel: IIndexedDbTtlChannel,
      key: IStorageKey
    ): Promise<number | undefined> => {
      const current = await observe(channel, key)
      return current.deadline === undefined
        ? undefined
        : Math.max(0, current.deadline - input.now())
    },
    /** Native clear removes only this channel's private contiguous metadata range. */
    clear: async (channel: IIndexedDbTtlChannel): Promise<void> => {
      const prefix = [input.namespace, IndexedDbTtlLayout.namespace, channel]
      const cursorRequest = input.metadata.openCursor(input.keyRange?.lowerBound(prefix))
      let cursor = await input.request(() => cursorRequest)
      if (
        input.keyRange === undefined &&
        cursor !== null &&
        compareStorageKeys(cursor.key as IStorageKey, prefix) < 0
      )
        cursor = await input.request(() => {
          cursor!.continue(prefix)
          return cursorRequest
        })
      while (cursor !== null) {
        const key = cursor.key
        if (
          !Array.isArray(key) ||
          key[0] !== prefix[0] ||
          key[1] !== prefix[1] ||
          key[2] !== channel
        )
          break
        await input.request(() => cursor!.delete())
        cursor = await input.request(() => {
          cursor!.continue()
          return cursorRequest
        })
      }
      for (const value of observations.values())
        if (value.channel === channel) {
          value.present = false
          value.deadline = undefined
        }
    },
    /**
     * Original commit policy receives the observed target if time invalidated its retained
     * snapshot.
     */
    expiredObservation: ():
      | { readonly channel: IIndexedDbTtlChannel; readonly key: IStorageKey }
      | undefined => {
      const now = input.now()
      for (const value of observations.values())
        if (value.observedDeadline !== undefined && value.observedDeadline <= now) return value
      return undefined
    }
  }
}
