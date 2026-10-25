import { it, expect } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { createStorageHost, memoryBackendPlugin, definePlugin } from '@migaia/storage-host'
import { archivePlugin } from '../src/index.js'

/** Genuine IndexedDB installation must be rejected without attempting a cold object operation. */
it('rejects the actual IndexedDB hot backend before cold I/O while leaving borrowed storage alive', async () => {
  let calls = 0
  const host = await createStorageHost({
    plugins: [
      indexedDbBackendPlugin({
        id: 'idb',
        dbName: 'archive-' + crypto.randomUUID(),
        factory: new IDBFactory(),
        keyRange: IDBKeyRange
      }),
      memoryBackendPlugin({ id: 'cold' }),
      definePlugin('counter', (core) => ({
        install() {
          core.useAsyncPipeline(async (input, next) => {
            if (input.backendId === 'cold' && input.operation.startsWith('blob.')) calls++
            await next(input)
          })
          return {}
        }
      }))
    ]
  })
  try {
    const error = await host
      .use(
        archivePlugin({
          id: 'archive',
          hot: 'idb',
          cold: 'cold',
          rules: [{ name: 'all', prefix: '', olderThanMs: 0, where: () => ({}) }]
        })
      )
      .catch((error) => error)
    expect(error).toHaveProperty('cause.cause.code', 'UNSUPPORTED_CAPABILITY')
    expect(calls).toBe(0)
    await host.detect()
    await host.backend('idb').putRecord({ safe: true }, 'safe')
    expect(await host.backend('idb').getRecord('safe')).toEqual({ safe: true })
  } finally {
    await host.dispose()
  }
})
