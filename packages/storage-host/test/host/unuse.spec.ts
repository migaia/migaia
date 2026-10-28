import { expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { levelPlugin } from '@migaia/log-host'
import { createStorageHost, definePlugin } from '../../src/index.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'
import { storageJournalPlugin } from '../../src/journal.ts'
import { storageProbe } from '../../src/plugins/probe/index.ts'

/** A plugin that borrows the memory backend the way a cache tier or archive source does. */
const borrower = (target: string) =>
  definePlugin('borrower', (core) => ({
    install() {
      core.getPublishedBackend(target)
      return {}
    }
  }))

it('removes one backend, closes its store once and accepts the same id again', async () => {
  await using host = await createStorageHost({
    plugins: [memoryBackendPlugin(), memoryBackendPlugin({ id: 'other' })]
  })
  const store = host.backend('memory')
  await store.set('key', 'value')
  await host.unUse('memory')
  expect(host.hasBackend('memory')).toBe(false)
  expect(host.hasBackend('other')).toBe(true)
  await expect(store.get('key')).rejects.toBeDefined()
  // @ts-expect-error The static host type keeps listing a removed id; the runtime accepts it again.
  await host.use(memoryBackendPlugin())
  await host.detect()
  expect(await host.backend('memory').get('key')).toBeNull()
})

it('refuses a borrowed backend until its borrower is removed', async () => {
  await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
  const extended = await host.use(borrower('memory'))
  await expect(extended.unUse('memory')).rejects.toMatchObject({
    code: StorageHostErrorCode.backendInUse
  })
  expect(host.hasBackend('memory')).toBe(true)
  await extended.unUse('borrower')
  await extended.unUse('memory')
  expect(host.hasBackend('memory')).toBe(false)
})

it('rejects an unknown id, a configured journal plugin and removal during an install', async () => {
  /** A borrowed telemetry logger is the smallest real journal configuration. */
  const logger = createLogHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [levelPlugin()]
  })
  await using host = await createStorageHost({
    plugins: [
      storageJournalPlugin({ logger, namespace: 'unuse', telemetry: true }),
      memoryBackendPlugin()
    ]
  })
  await expect(host.unUse('missing' as never)).rejects.toMatchObject({
    code: StorageHostErrorCode.backendNotInstalled
  })
  await expect(host.unUse('storage-journal')).rejects.toMatchObject({
    code: StorageHostErrorCode.invalidConfig
  })
  /** A removal issued during an install waits for it, then runs in call order. */
  const installing = host.use(memoryBackendPlugin({ id: 'later' }))
  const removing = host.unUse('memory')
  await installing
  await removing
  expect(host.hasBackend('memory')).toBe(false)
  expect(host.hasBackend('later')).toBe(true)
  await host.dispose()
  await logger.shutdown('manual')
})

it('stops every probe listener when the probe is removed', async () => {
  const initial: string[] = []
  await using host = await createStorageHost({
    plugins: [
      storageProbe({ beforeBackendPluginInstall: ({ backendId }) => initial.push(backendId) })
    ]
  })
  const later: string[] = []
  host.extensions.observe('beforeBackendPluginInstall', ({ backendId }) => later.push(backendId))
  await host.use(memoryBackendPlugin({ id: 'first' }))
  expect([initial, later]).toEqual([['first'], ['first']])
  await host.unUse('storage-probe')
  await host.use(memoryBackendPlugin({ id: 'second' }))
  expect([initial, later]).toEqual([['first'], ['first']])
  expect('observe' in host.extensions).toBe(false)
})
