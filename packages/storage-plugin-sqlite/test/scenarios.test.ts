import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, onTestFinished } from 'vitest'
import { createStorageHost, defineFeature } from '@migaia/storage-host'
import type { IStorageChange } from '@migaia/storage-contract'
import { sqliteBackendPlugin, sqliteBackendKind } from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'
import { sqliteMaintenanceFeature } from '../src/features/maintenance.js'
/** Maintenance runs through the real selected Feature and the original connection's SQL tag. */
it('backs up and vacuums the actual database while rejecting an occupied connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-maintenance-'))
  const connection = nodeSqliteDriver(join(directory, 'source.sqlite'))
  const host = await createStorageHost({
    plugins: [
      sqliteBackendPlugin({ driver: connection }, { maintenance: sqliteMaintenanceFeature() })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  const store = host.backend('sqlite')
  await store.set('sentinel', 'kept')
  const target = join(directory, 'backup.sqlite')
  await store.api.maintenance.backup(target)
  const copy = nodeSqliteDriver(target)
  const copied = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: copy })] as const
  })
  try {
    expect(await copied.backend('sqlite').get('sentinel')).toBe('kept')
  } finally {
    await copied.dispose()
    await copy.dispose()
  }
  await store.api.maintenance.vacuum()
  expect(await store.get('sentinel')).toBe('kept')
  await expect(store.api.maintenance.backup(target)).rejects.toMatchObject({
    code: 'SQLITE_FAILED',
    cause: expect.any(Error)
  })
  await store.transaction(async () => {
    await expect(store.api.maintenance.vacuum()).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED'
    })
  })
})

/** Publication reaches the real controller through the supported selected Feature getter. */
it('publishes canonical changed keys once in fixed channel order only after commit', async () => {
  const connection = nodeSqliteDriver(':memory:')
  const notifications = defineFeature(sqliteBackendKind, ({ featureExpose }) => ({
    capabilities: [],
    chain: {},
    api: {
      store: {
        async controller() {
          return featureExpose.getChangeController()
        }
      },
      transaction: {}
    }
  }))
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection }, { notifications })] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
  })
  const store = host.backend('sqlite')
  const events: IStorageChange[] = []
  const controller = await store.api.controller()
  const unsubscribe = controller!.subscribe((event) => events.push(event))
  onTestFinished(unsubscribe)
  const keys = [[1, 'array'], new Date(1), new Uint8Array([1, 2]).buffer] as const
  await store.transaction(async (tx) => {
    for (const key of keys) {
      await tx.putRecord({ version: 1 }, key)
      await tx.putRecord({ version: 2 }, key)
    }
    await tx.setBytes('binary', new Uint8Array([1]))
    await tx.set('text', '1')
    await tx.set('text', '2')
    expect(events).toEqual([])
  })
  expect(events.map((event) => event.channel)).toEqual(['value', 'bytes', 'record'])
  expect(events.map((event) => event.keys)).toEqual([['text'], ['binary'], keys])
  expect(events[2]!.keys![0]).not.toBe(keys[0])
  events.length = 0
  await store.transaction(async (tx) => {
    await tx.remove('missing')
  })
  expect(events).toEqual([])
  await expect(
    store.transaction(async (tx) => {
      await tx.set('rolled-back', '1')
      throw new Error('rollback publication')
    })
  ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  expect(events).toEqual([])
})
