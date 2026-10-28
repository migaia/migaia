import { Logger, type ILoggerCore } from '@migaia/logger'
import {
  binlog,
  memoryLogStore,
  type ILogStore,
  type IBinlogExt
} from '@migaia/logger/plugins/durable'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/features/query'
import { asRecordStore, kv, type IKeyValueStore } from '@migaia/storage-contract'
import { lockKey, useStorageCapability } from '@migaia/storage-host/sdk'
import { createStore } from '@migaia/store-light'
import { persist } from '@migaia/store-persist/light'
import { persistTransaction } from '@migaia/store-persist'

/** The same public business code runs unchanged in Node and real IndexedDB browsers. */
type IProgramRow = { id: string; score: number }
/** Plain output compares business values independently of native backend implementation. */
export type IStorageProgramResult = {
  rows: readonly { id: string; score: number }[]
  persisted: unknown
  status: string | null
}

/** Entity, persistence and explicit key locks all borrow one authentic native transaction. */
export async function runStorageProgramApp(
  storage: IKeyValueStore
): Promise<IStorageProgramResult> {
  const store = asRecordStore<IProgramRow>(storage)
  const repo = defineEntity<IProgramRow>()({
    features: [entityQueryFeature()],
    name: 'program-rows',
    key: 'id'
  }).connect(store)
  const state = createStore({ count: 0 })
  const handle = persist(state, { key: 'program-state', storage: store, version: 1 })
  try {
    await handle.ready
    await repo.put({ id: 'a', score: 1 })
    await repo.put({ id: 'b', score: 2 })
    await persistTransaction(
      store,
      [handle],
      async (scope) => {
        state.count = 3
        await handle.flush(scope)
        await repo.in(scope).put({ id: 'a', score: 3 })
        await scope.set('program-status', 'committed')
      },
      { lock: [repo.lockKey('a'), lockKey.text('program-state'), lockKey.text('program-status')] }
    )
    await handle.flush()
    return {
      rows: await repo.query().where('score', 'gte', 2).limit(2).select('id', 'score').all(),
      persisted: JSON.parse((await store.get('program-state'))!),
      status: await store.get('program-status')
    }
  } finally {
    await handle.disposeAsync()
    await state.$dispose()
  }
}

/** Native batch effects use the same keys and one deliberately conflicting late entry everywhere. */
export async function runStorageProgramBatch(storage: IKeyValueStore) {
  const store = asRecordStore<IProgramRow>(storage)
  const api = useStorageCapability(store, kv)
  await api.setMany([
    { key: 'batch-a', value: 'a' },
    { key: 'batch-b', value: 'b' }
  ])
  const ordered = await api.getMany(['batch-b', 'batch-a', 'missing', 'batch-a'])
  const removed = await api.removeMany(['batch-b', 'batch-b', 'missing'])
  await store.putRecord({ id: 'occupied', score: 0 }, ['batch-occupied'])
  let code: unknown
  try {
    await api.setMany([
      { key: 'batch-uncommitted', value: 'first' },
      { key: ['batch-occupied'], value: 'conflict' }
    ])
  } catch (cause) {
    code = cause instanceof Error ? Reflect.get(cause, 'code') : undefined
  }
  return {
    ordered,
    removed,
    failed: typeof code === 'string',
    unchanged: (await store.get('batch-uncommitted')) === null,
    record: await store.getRecord(['batch-occupied'])
  }
}

/** The unchanged application selects the same original binlog owner in Node and browser hosts. */
export function createStorageProgramJournal(): {
  logs: ILogStore
  logger: Pick<ILoggerCore, 'dispatchRaw' | 'onFailure' | 'hook' | 'flush' | 'defer'> &
    IBinlogExt & { shutdown(reason: 'manual'): Promise<unknown> }
} {
  const logs = memoryLogStore()
  const logger = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [binlog({ store: logs })],
    runtimeManager: {
      randomUUID: () => crypto.randomUUID(),
      defer: (task: () => void) => queueMicrotask(task),
      write: () => undefined
    }
  })
  return { logs, logger }
}

/** The same logical key stays isolated through two fixed organization views and one target drop. */
export async function runStorageProgramOrgs(
  root: Pick<IKeyValueStore, 'get' | 'set'>,
  one: Pick<IKeyValueStore, 'get' | 'set'>,
  two: Pick<IKeyValueStore, 'get' | 'set'>,
  dropOne: () => Promise<unknown>
) {
  await root.set('org-same', 'default')
  await one.set('org-same', 'one')
  await two.set('org-same', 'two')
  const before = await Promise.all([root.get('org-same'), one.get('org-same'), two.get('org-same')])
  await dropOne()
  const after = await Promise.all([root.get('org-same'), one.get('org-same'), two.get('org-same')])
  return { before, after }
}

/** Count the actual public pipeline and observer events for each unchanged batch call. */
export function storageProgramBatchObservations(
  pipelines: readonly string[],
  events: readonly string[]
): Record<string, number[]> {
  return Object.fromEntries(
    ['getMany', 'setMany', 'removeMany'].map((operation) => {
      const matching = (value: string) => value === operation || value.endsWith('.' + operation)
      return [
        operation,
        [
          pipelines.filter(matching).length,
          ...['before:', 'after:', 'error:'].map(
            (kind) =>
              events.filter((value) => value.startsWith(kind) && matching(value.slice(kind.length)))
                .length
          )
        ]
      ]
    })
  )
}
