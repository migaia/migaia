import { StorageLogObserver } from '../../storage-host/test/helpers/log-observer.ts'
import { storageJournalPlugin } from '@migaia/storage-host/plugins/journal'
import { expect, it, onTestFinished } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { levelPlugin } from '@migaia/log-host'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { kv } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'
import { sqliteBackendPlugin } from '../src/index.ts'
import { nodeSqliteDriver } from '../src/node.ts'

/** The borrowed logger sink observes completed work; it owns no backend execution or cleanup. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

it('observes original native keys once and hides private work and short views', async () => {
  const connection = nodeSqliteDriver(':memory:')
  /** A real installed plugin observes the asynchronous log host's original entries. */
  const observer = new StorageLogObserver()
  /** Keep the existing assertions over the observer's exact entry array. */
  const entries = observer.entries
  const logger = createLogHost({ execution, plugins: [levelPlugin(), observer] })
  const initialized: string[] = []
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin(({ orgId }) => {
        initialized.push(orgId)
        return { logger, namespace: 'native-telemetry', telemetry: true }
      }),
      sqliteBackendPlugin({ driver: connection })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await logger.shutdown('manual')
    await connection.dispose()
  })
  const store = host.backend('sqlite')
  await store.set('one', 'before')
  await logger.flush()
  expect(entries.map((entry) => entry.message)).toEqual(['set'])
  expect(entries[0]!.meta).toMatchObject({
    outcome: 'success',
    payload: { key: 'one', value: 'before' },
    keys: [lockKey.text('one'), lockKey.bytes('one'), lockKey.record('one')]
  })
  entries.length = 0
  await store.metadata.set('private', 1)
  await logger.flush()
  expect(entries).toEqual([])
  await store.transaction(async (scope) => {
    expect(await scope.get('one')).toBe('before')
    await scope.set('one', 'after')
    await scope.putRecord({ value: 2 }, ['record', 1])
  })
  await logger.flush()
  expect(entries.map((entry) => entry.message)).toEqual(['transaction'])
  expect(entries[0]!.meta).toMatchObject({
    outcome: 'success',
    keys: [
      lockKey.text('one'),
      lockKey.bytes('one'),
      lockKey.record('one'),
      lockKey.record(['record', 1]),
      lockKey.text(['record', 1])
    ]
  })
  entries.length = 0
  expect(await store.get('one')).toBe('after')
  await logger.flush()
  expect(entries[0]!.meta).toMatchObject({ keys: [lockKey.text('one')] })
  entries.length = 0
  const keyValue = store.use(kv)
  expect(await keyValue.getMany(['one', 'missing', 'one'])).toEqual(['after', undefined, 'after'])
  await logger.flush()
  expect(entries).toHaveLength(1)
  expect(entries[0]!.meta).toMatchObject({ keys: [lockKey.text('one'), lockKey.text('missing')] })
  entries.length = 0
  const original = new RangeError('native telemetry original')
  await expect(
    store.transaction(async (scope) => {
      await scope.get('one')
      throw original
    })
  ).rejects.toMatchObject({ cause: original })
  await logger.flush()
  expect(entries).toHaveLength(1)
  expect(entries[0]!.meta).toMatchObject({
    outcome: 'error',
    keys: [lockKey.text('one')],
    code: 'TRANSACTION_FAILED'
  })
  entries.length = 0
  const orgId = createOrgId()
  expect(await host.org(orgId).backend('sqlite').get('fresh')).toBeNull()
  expect(initialized.filter((value) => value === orgId)).toHaveLength(1)
  await logger.flush()
  expect(entries).toHaveLength(1)
  expect(entries[0]!.meta).toMatchObject({ orgId, keys: [lockKey.text('fresh')] })
})

it('retains ordinary operations with telemetry disabled', async () => {
  const connection = nodeSqliteDriver(':memory:')
  /** A real installed plugin observes the asynchronous log host's original entries. */
  const observer = new StorageLogObserver()
  /** Keep the existing assertions over the observer's exact entry array. */
  const entries = observer.entries
  const logger = createLogHost({ execution, plugins: [levelPlugin(), observer] })
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin({ logger, namespace: 'disabled', telemetry: false }),
      sqliteBackendPlugin({ driver: connection })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await logger.shutdown('manual')
    await connection.dispose()
  })
  const store = host.backend('sqlite')
  await store.set('key', 'value')
  await store.transaction(async (scope) => {
    await scope.remove('key')
  })
  expect(await store.get('key')).toBeNull()
  await logger.flush()
  expect(entries).toEqual([])
})
