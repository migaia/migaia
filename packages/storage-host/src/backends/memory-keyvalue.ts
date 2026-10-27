// Key-value, time-to-live and counter capabilities for the memory backend (see ./memory.ts).
import {
  assertStringStorageKey,
  assertStorageTtlDuration,
  type ITtlTarget,
  type IStorageKey
} from '@migaia/storage-contract'
import { snapshotConcurrencyLockRange, lockKey } from '../authoring/concurrency.js'
import { snapshotStorageBatchKeys, snapshotStorageKeyPrefix } from '../authoring/key.js'
import { snapshotStorageTtlTarget } from '../authoring/ttl.js'
import { snapshotStorageCounterIncrement } from '../authoring/counter.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { MemoryOperation } from './memory-constants.js'
import { encodeFlatStorageKey } from '../core/key-domain.js'
import {
  read,
  liveEntry,
  identity,
  setDeadline,
  bump,
  publish,
  mutationEntry,
  capacityFact,
  entryBytes,
  write
} from './memory-entries.js'
import {
  batchSize,
  observeBatch,
  asyncEntry,
  readTextBatch,
  atomicEntry,
  captureTextEntries
} from './memory-namespace-base.js'
import type { IMemoryNamespaceContext, IMemoryTtlTarget, IMemoryChannel } from './memory.js'

/** Retain the original native KV members before provider publication replaces the root has overload. */
export function createMemoryNamespaceKeyValue<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['keyValue'] {
  return {
    get: namespaceContext.base.get,
    set: namespaceContext.base.set,
    remove: namespaceContext.base.remove,
    has: namespaceContext.base.has,
    keys: namespaceContext.base.keys,
    clearValues: namespaceContext.base.clearValues,
    clearAll: namespaceContext.base.clearAll,
    sync: namespaceContext.base.sync,
    getMany: async (keys, ctx) => {
      const count = batchSize(namespaceContext, keys)
      if (count === 0) return []
      return observeBatch(namespaceContext, MemoryOperation.getMany, count, () =>
        asyncEntry(namespaceContext, MemoryOperation.getMany, keys, ctx, (input) =>
          readTextBatch(
            namespaceContext,
            input,
            (key) => read(namespaceContext, 'value', key) as string | undefined
          )
        )
      )
    },
    setMany: async (entries, ctx) => {
      const count = batchSize(namespaceContext, entries)
      if (count === 0) return
      return observeBatch(namespaceContext, MemoryOperation.setMany, count, () =>
        atomicEntry(
          namespaceContext,
          MemoryOperation.setMany,
          () => entries,
          ctx,
          (input) => {
            /** Preparation precedes implicit lock derivation and the sole native transaction. */
            const captured = captureTextEntries(namespaceContext, input)
            return {
              keys: captured.map((entry) => lockKey.text(entry.key)),
              ranges: [],
              invoke: (_scope, draft) => draft.setMany(captured)
            }
          }
        )
      )
    },
    removeMany: async (keys, ctx) => {
      const count = batchSize(namespaceContext, keys)
      if (count === 0) return 0
      return observeBatch(namespaceContext, MemoryOperation.removeMany, count, () =>
        atomicEntry(
          namespaceContext,
          MemoryOperation.removeMany,
          () => keys,
          ctx,
          (input) => {
            /** Every structural identity detaches before native admission or any removal. */
            const captured = snapshotStorageBatchKeys(input, STORAGE_MEMORY_BACKEND)
              .filter(({ firstIndex }, index) => firstIndex === index)
              .map(({ key }) => key)
            return {
              keys: captured.map((key) => lockKey.text(key)),
              ranges: [],
              invoke: (_scope, draft) => draft.removeMany(captured)
            }
          }
        )
      )
    },
    removeByPrefix: (prefix, ctx) =>
      observeBatch(namespaceContext, MemoryOperation.removeByPrefix, undefined, () =>
        atomicEntry(
          namespaceContext,
          MemoryOperation.removeByPrefix,
          () => prefix,
          ctx,
          (input) => {
            /** The same prefix owner supplies native radix bounds and the original range lock probe. */
            const captured = snapshotStorageKeyPrefix(input, STORAGE_MEMORY_BACKEND)
            return {
              ranges: [
                {
                  channel: 'text',
                  ...snapshotConcurrencyLockRange(
                    { channel: 'text', prefix: captured.key },
                    STORAGE_MEMORY_BACKEND
                  )
                }
              ],
              invoke: (_scope, draft) => draft.removeByPrefix(captured.key)
            }
          }
        )
      )
  }
}

/** Capture canonical target identity and reject channels that this native unit does not implement. */
export function captureTtlTarget<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: ITtlTarget
): IMemoryTtlTarget {
  /** The original lock owner validates and detaches the complete channel-specific identity. */
  const target = snapshotStorageTtlTarget(input, STORAGE_MEMORY_BACKEND)
  return target
}

/** Only text differs from the original physical channel spelling. */
export function ttlChannel<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  target: IMemoryTtlTarget
): IMemoryChannel {
  return target.channel === 'text' ? 'value' : target.channel
}

/** Vector locks and deadlines identify the same independently tagged collection/point key. */
export function ttlKey<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  target: IMemoryTtlTarget
): IStorageKey {
  return target.channel === 'vector' ? [target.collection, target.id] : target.key
}

/** One metadata mutation keeps the same physical value, revision and local notification owner. */
function changeDeadline<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  target: IMemoryTtlTarget,
  ms: number | undefined,
  persist: boolean
): boolean {
  /** Canonical target snapshot has already detached every mutable key segment. */
  const channel = ttlChannel(namespaceContext, target)
  const encoded = encodeFlatStorageKey(ttlKey(namespaceContext, target))
  const current = liveEntry(namespaceContext, channel, encoded)
  const id = identity(namespaceContext, channel, encoded)
  if (current === undefined || (persist && !namespaceContext.deadlines.has(id))) return false
  setDeadline(
    namespaceContext,
    channel,
    encoded,
    persist ? undefined : namespaceContext.scheduler.now() + ms!
  )
  if (ms === 0) liveEntry(namespaceContext, channel, encoded)
  else {
    bump(namespaceContext, channel, encoded)
    publish(namespaceContext, channel, 'put', [current.key])
  }
  return true
}

/** TTL reads and writes use the original root pipeline, implicit locks and operation budget. */
export function createMemoryNamespaceTimeToLive<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['timeToLive'] {
  return {
    expire: (target, ms, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.ttlExpire, { target, ms }, ctx, (input) => {
        const target = captureTtlTarget(namespaceContext, input.target)
        /** The supplied duration remains fixed while the original policy waits for admission. */
        const ms = input.ms
        assertStorageTtlDuration(ms, STORAGE_MEMORY_BACKEND)
        return {
          keys: [target],
          invoke: (draft) => draft.ttl(target, ms, false),
          run: () => changeDeadline(namespaceContext, target, ms, false)
        }
      }),
    remaining: (target, ctx) =>
      asyncEntry(namespaceContext, MemoryOperation.ttlRemaining, target, ctx, (input) => {
        const target = captureTtlTarget(namespaceContext, input)
        const channel = ttlChannel(namespaceContext, target)
        const encoded = encodeFlatStorageKey(ttlKey(namespaceContext, target))
        if (liveEntry(namespaceContext, channel, encoded) === undefined) return undefined
        const deadline = namespaceContext.deadlines.get(
          identity(namespaceContext, channel, encoded)
        )
        return deadline === undefined
          ? undefined
          : Math.max(0, deadline - namespaceContext.scheduler.now())
      }),
    persist: (target, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.ttlPersist, target, ctx, (input) => {
        const target = captureTtlTarget(namespaceContext, input)
        return {
          keys: [target],
          invoke: (draft) => draft.ttl(target, undefined, true),
          run: () => changeDeadline(namespaceContext, target, undefined, true)
        }
      })
  }
}

/** A native counter read and write occupy the same original synchronous admitted mutation. */
export function createMemoryNamespaceCounters<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['counters'] {
  return {
    increment: (key, by, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.counterIncrement,
        { key, by },
        ctx,
        (input) => {
          /** Capture a pipeline-provided identity before lock derivation and native work. */
          const key = input.key
          assertStringStorageKey(key, STORAGE_MEMORY_BACKEND)
          /** Decimal and overflow validation stays with the original contract helper. */
          const increment = snapshotStorageCounterIncrement(input.by, STORAGE_MEMORY_BACKEND)
          /**
           * The capacity preflight retains this attempt's exact native calculation for its final
           * turn.
           */
          let capacityResult: ReturnType<typeof increment> | undefined
          return {
            keys: [lockKey.text(key)],
            invoke: (draft) => draft.increment(key, increment),
            capacityChanges:
              namespaceContext.capacity === undefined
                ? undefined
                : () => {
                    const encoded = encodeFlatStorageKey(key)
                    const deadline = namespaceContext.deadlines.get(
                      identity(namespaceContext, 'value', encoded)
                    )
                    const current =
                      deadline !== undefined && deadline <= namespaceContext.scheduler.now()
                        ? undefined
                        : (namespaceContext.data.value.get(encoded)?.value as string | undefined)
                    capacityResult = increment(current)
                    return [
                      capacityFact(
                        namespaceContext,
                        'value',
                        key,
                        entryBytes(namespaceContext, 'value', String(capacityResult))
                      )
                    ]
                  },
            run: () => {
              /** This calculation and its write share one synchronous admitted native turn. */
              const result =
                capacityResult ??
                increment(read(namespaceContext, 'value', key) as string | undefined)
              write(namespaceContext, 'value', key, String(result))
              return result
            }
          }
        }
      )
  }
}
