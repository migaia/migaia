import { createStorageHost } from '@migaia/storage-host'
import { kv } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '../src/indexed-db.js'

declare global {
  /** Declaration merging adds this scenario to the existing browser runner's real Window. */
  interface Window {
    runIndexedDbNativeBatchScenario(): Promise<{
      ordered: readonly (string | undefined)[]
      rollbackCode?: string
      rolledBack: boolean
      recordPreserved: boolean
      removed: number
      prefixRemoved: number
      outside: readonly (string | undefined)[]
    }>
  }
}

/** The original browser runner exercises native batches on one actual admitted IndexedDB store. */
window.runIndexedDbNativeBatchScenario = async () => {
  /** Each real host owns its original connection and disposes after the complete scenario. */
  const host = await createStorageHost({
    plugins: [indexedDbBackendPlugin({ dbName: `native-batch-${crypto.randomUUID()}` })]
  })
  try {
    const store = host.backend('indexed-db')
    const api = store.use(kv)
    await api.setMany([
      { key: new Date(1), value: 'date' },
      { key: '1', value: 'string' },
      { key: ['items', 1], value: 'tuple' }
    ])
    const ordered = await api.getMany([['items', 1], new Date(1), 'missing', new Date(1), '1'])
    await store.putRecord({ occupied: true }, ['occupied'])
    let rollbackCode: string | undefined
    try {
      await api.setMany([
        { key: 'uncommitted', value: 'first' },
        { key: ['occupied'], value: 'conflict' }
      ])
    } catch (cause) {
      rollbackCode = (cause as { code?: string }).code
    }
    const rolledBack = (await api.getMany(['uncommitted']))[0] === undefined
    /** The known fixture record remains authoritative after the conflicting text batch rolls back. */
    const record = (await store.getRecord(['occupied'])) as { occupied: boolean } | undefined
    const recordPreserved = record?.occupied === true
    const removed = await api.removeMany([new Date(1), new Date(1), ['items', 1], 'missing'])
    await api.setMany([
      { key: ['prefix', 1], value: 'a' },
      { key: ['prefix', 2], value: 'b' },
      { key: ['prefix-other', 1], value: 'c' }
    ])
    const prefixRemoved = await api.removeByPrefix(['prefix'])
    const outside = await api.getMany([['prefix', 1], ['prefix-other', 1], '1'])
    return { ordered, rollbackCode, rolledBack, recordPreserved, removed, prefixRemoved, outside }
  } finally {
    await host.dispose()
  }
}
