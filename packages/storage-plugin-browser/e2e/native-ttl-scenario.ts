import { indexedDbTestFeatures } from '../test/helpers/indexed-db-features.ts'
import { createStorageHost } from '@migaia/storage-host'
import { kv, ttl } from '@migaia/storage-contract'
import { createManualScheduler } from '@migaia/utils/testing'
import { indexedDbBackendPlugin } from '../src/indexed-db.ts'

declare global {
  /** Declaration merging attaches one real native TTL scenario to the existing browser runner. */
  interface Window {
    runIndexedDbNativeTtlScenario(): Promise<{
      expired: boolean
      rolledBack: boolean
      reopened: boolean
      remaining: boolean
    }>
  }
}

/**
 * Real browser IDB transactions own the deadlines, rollback and reopen; virtual elapsed time is
 * injected.
 */
window.runIndexedDbNativeTtlScenario = async () => {
  const scheduler = createManualScheduler()
  const dbName = 'native-ttl-' + crypto.randomUUID()
  const host = await createStorageHost({
    scheduler,
    plugins: [indexedDbBackendPlugin({ dbName }, indexedDbTestFeatures)]
  })
  try {
    const store = host.backend('indexed-db')
    await store.use(kv).setMany([{ key: 'text', value: 'value', ttlMs: 10 }])
    await store.setBytes('bytes', new Uint8Array([1]))
    await store.putRecord({ value: 1 }, 'record')
    await store.use(ttl).expire({ channel: 'bytes', key: 'bytes' }, 10)
    await store.use(ttl).expire({ channel: 'record', key: 'record' }, 10)
    scheduler.advance(11)
    const rows: unknown[] = []
    for await (const row of store.iterateRecords()) rows.push(row)
    const expired =
      (await store.keys()).length === 0 &&
      (await store.get('text')) === null &&
      (await store.getBytes('bytes')) === null &&
      rows.length === 0
    await store.set('kept', 'value')
    try {
      await store.transaction(async (scope) => {
        await scope.use(ttl).expire({ channel: 'text', key: 'kept' }, 0)
        throw new Error('rollback browser TTL draft')
      })
    } catch {
      /* The state assertion below proves rollback of the original native transaction. */
    }
    const rolledBack = (await store.get('kept')) === 'value'
    return { expired, rolledBack, ...(await reopen()) }
  } finally {
    await host.dispose()
  }
}

/** Default-clock installations compare one persisted deadline after the original connection closes. */
async function reopen() {
  const dbName = 'native-ttl-reopen-' + crypto.randomUUID()
  const first = await createStorageHost({
    plugins: [indexedDbBackendPlugin({ dbName }, indexedDbTestFeatures)]
  })
  const before = first.backend('indexed-db')
  await before.set('kept', 'value')
  await before.use(ttl).expire({ channel: 'text', key: 'kept' }, 60000)
  await first.dispose()
  const second = await createStorageHost({
    plugins: [indexedDbBackendPlugin({ dbName }, indexedDbTestFeatures)]
  })
  try {
    const after = second.backend('indexed-db')
    const duration = await after.use(ttl).remaining({ channel: 'text', key: 'kept' })
    return {
      reopened: (await after.get('kept')) === 'value',
      remaining: duration !== undefined && duration > 0 && duration <= 60000
    }
  } finally {
    await second.dispose()
  }
}
