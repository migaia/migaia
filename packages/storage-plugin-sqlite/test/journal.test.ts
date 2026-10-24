import type { ISqliteValue } from '../src/types.js'
import { decodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { Logger } from '@migaia/logger'
import {
  binlog,
  undoLog,
  wal,
  memoryLogStore,
  LogRecordState,
  type ILogStore
} from '@migaia/logger/plugins/durable'
import { lockKey } from '@migaia/storage-host/authoring/concurrency'
import { ttl } from '@migaia/storage-contract'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/journal'
import { sqliteBackendPlugin } from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'

/** Every case owns only its temporary native file; the connection outlives the installed host. */
async function installed(options: { memory?: boolean; wal?: boolean } = { memory: true }) {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-journal-'))
  const connection = nodeSqliteDriver(options.memory ? ':memory:' : join(directory, 'data.sqlite'))
  const orgId = createOrgId()
  const host = await createStorageHost({
    org: orgId,
    plugins: [
      storageJournalPlugin(),
      sqliteBackendPlugin({ driver: connection, wal: options.wal })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  return { host, connection, orgId, store: host.backend('sqlite') }
}

it('keeps original native log indexes outside business keys and isolates fixed organizations', async () => {
  const { host, store } = await installed()
  const orgId = createOrgId()
  const organization = host.org(orgId)
  const root = await storageLogStore(host, 'sqlite', { prefix: 'private-log' })
  const other = await storageLogStore(organization, 'sqlite', { prefix: 'private-log' })
  try {
    expect(await root.append([{ kind: 'first', payload: { value: '\0\ud800' } }])).toEqual([1])
    expect(await other.append([{ kind: 'organization', payload: null }])).toEqual([1])
    await store.set('business', 'value')
    await store.clearAll()
    expect(await store.keys()).toEqual([])
    expect((await root.read(1, 10)).map((row) => row.kind)).toEqual(['first'])
    expect((await other.read(1, 10)).map((row) => row.kind)).toEqual(['organization'])
    expect((await root.read(1, 1))[0]!.payload).toEqual({ value: '\0\ud800' })
    await expect(storageLogStore(host, 'sqlite', { prefix: 'private-log' })).rejects.toMatchObject({
      code: 'LOCK_REJECTED'
    })
  } finally {
    await other.dispose()
    await root.dispose()
  }
  const reopened = await storageLogStore(host, 'sqlite', { prefix: 'private-log' })
  try {
    expect(await reopened.lastSeq()).toBe(1)
    expect(await reopened.append([{ kind: 'second', payload: null }])).toEqual([2])
  } finally {
    await reopened.dispose()
  }
})

it.each([false, true])(
  'shares a current journal index across independent file connections (wal:%s)',
  async (wal) => {
    const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-current-'))
    const path = join(directory, 'data.sqlite')
    const org = createOrgId()
    const firstConnection = nodeSqliteDriver(path)
    const secondConnection = nodeSqliteDriver(path)
    const firstHost = await createStorageHost({
      org,
      plugins: [storageJournalPlugin(), sqliteBackendPlugin({ driver: firstConnection, wal })]
    })
    const secondHost = await createStorageHost({
      org,
      plugins: [storageJournalPlugin(), sqliteBackendPlugin({ driver: secondConnection, wal })]
    })
    try {
      const one = await storageLogStore(firstHost, 'sqlite', { prefix: 'current-file' })
      const two = await storageLogStore(secondHost, 'sqlite', { prefix: 'current-file' })
      try {
        const batches = await Promise.all(
          Array.from({ length: 12 }, (_, i) =>
            (i % 2 === 0 ? one : two).append([{ kind: 'shared', payload: i }])
          )
        )
        expect(batches.flat().sort((a, b) => a - b)).toEqual(
          Array.from({ length: 12 }, (_, i) => i + 1)
        )
        expect(await one.lastSeq()).toBe(12)
        expect(await two.states(LogRecordState.pending)).toEqual(
          Array.from({ length: 12 }, (_, i) => i + 1)
        )
        await one.setState(1, LogRecordState.done)
        expect(await two.states(LogRecordState.pending)).toEqual(
          Array.from({ length: 11 }, (_, i) => i + 2)
        )
        await two.truncate(3)
        expect((await one.read(1, 20)).map((row) => row.seq)).toEqual(
          Array.from({ length: 10 }, (_, i) => i + 3)
        )
      } finally {
        await Promise.all([one.dispose(), two.dispose()])
      }
      await using reopened = await storageLogStore(firstHost, 'sqlite', { prefix: 'current-file' })
      expect(await reopened.lastSeq()).toBe(12)
      expect((await reopened.read(1, 20)).map((row) => row.seq)).toEqual(
        Array.from({ length: 10 }, (_, i) => i + 3)
      )
      expect(await reopened.append([{ kind: 'recovered', payload: null }])).toEqual([13])
    } finally {
      await Promise.all([firstHost.dispose(), secondHost.dispose()])
      await Promise.all([firstConnection.dispose(), secondConnection.dispose()])
      rmSync(directory, { recursive: true, force: true })
    }
  }
)

it('invalidates cached private indexes at org drop while keeping original business views usable', async () => {
  const { host, store, orgId } = await installed()
  const defaultOrg = host.org(orgId)
  const otherOrg = host.org(createOrgId())
  const root = await storageLogStore(host, 'sqlite', { prefix: 'root-before-drop' })
  const same = await storageLogStore(defaultOrg, 'sqlite', { prefix: 'default-before-drop' })
  const other = await storageLogStore(otherOrg, 'sqlite', { prefix: 'other-before-drop' })
  try {
    await root.append([{ kind: 'root', payload: null }])
    await same.append([{ kind: 'default', payload: null }])
    await other.append([{ kind: 'other', payload: null }])
    await host.dropOrg(orgId)
    await expect(root.lastSeq()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(same.read(1, 10)).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(root.append([{ kind: 'stale', payload: null }])).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    expect((await other.read(1, 10)).map((entry) => entry.kind)).toEqual(['other'])
    await store.set('reused', 'root')
    expect(await defaultOrg.backend('sqlite').get('reused')).toBe('root')
    await defaultOrg.backend('sqlite').set('reused', 'default')
    expect(await store.get('reused')).toBe('default')
  } finally {
    await Promise.all([root.dispose(), same.dispose(), other.dispose()])
  }
  const reopened = await storageLogStore(defaultOrg, 'sqlite', { prefix: 'root-before-drop' })
  try {
    expect(await reopened.lastSeq()).toBe(0)
    expect(await reopened.append([{ kind: 'fresh', payload: null }])).toEqual([1])
  } finally {
    await reopened.dispose()
  }
})

it.each([false, true])(
  'restores external images, deadlines and revisions through native SQLite (wal:%s)',
  async (walMode) => {
    const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-undo-'))
    const connection = nodeSqliteDriver(join(directory, 'data.sqlite'))
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [
        binlog({ store: memoryLogStore() }),
        wal({ store: memoryLogStore() }),
        undoLog({ store: memoryLogStore() })
      ]
    })
    const host = await createStorageHost({
      plugins: [
        storageJournalPlugin(),
        sqliteBackendPlugin({ driver: connection, wal: walMode })
      ] as const,
      journal: { logger, namespace: 'external-native' }
    })
    onTestFinished(async () => {
      await host.dispose()
      await logger.shutdown('manual')
      await connection.dispose()
      rmSync(directory, { recursive: true, force: true })
    })
    const store = host.backend('sqlite')
    const lastTx = async () =>
      ((await logger.binlog.read(await logger.binlog.lastSeq()))[0]!.payload as { txId: string })
        .txId
    await store.set('text', 'before')
    await store.setBytes('bytes', new Uint8Array([1]))
    await store.putRecord(null, 'nullable')
    await store.use(ttl).expire(lockKey.text('text'), 60000)
    await store.transaction(async (scope) => {
      await scope.set('text', 'middle')
      await scope.set('text', 'after')
      await scope.setBytes('bytes', new Uint8Array([2]))
      await scope.set('created', 'new')
      await scope.deleteRecord('nullable')
      await scope.use(ttl).expire(lockKey.text('text'), 120000)
    })
    const txId = await lastTx()
    const undone = await store.undo(txId, {
      timeoutMs: 60000
    })
    expect(undone.txId).not.toBe(txId)
    expect(await store.get('text')).toBe('before')
    expect(await store.getBytes('bytes')).toEqual(new Uint8Array([1]))
    expect(await store.get('created')).toBeNull()
    expect(await store.getRecord('nullable')).toBeNull()
    expect(await store.use(ttl).remaining(lockKey.text('text'))).toBeGreaterThan(0)
    expect(await store.use(ttl).remaining(lockKey.text('text'))).toBeLessThan(60000)
    expect(await logger.undo.get(undone.txId)).toBeDefined()
    await expect(store.undo(txId)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
    await store.set('aba', 'one')
    await store.set('aba', 'two')
    const old = await lastTx()
    await store.set('aba', 'three')
    await store.set('aba', 'two')
    await expect(store.undo(old)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
    expect(await store.get('aba')).toBe('two')
    expect(connection.prepare('SELECT count(*) AS n FROM migaia_commit_markers').get()!.n).toBe(0)
  }
)

it('keeps data and native binlog/undo indexes at the same actual memory commit', async () => {
  const connection = nodeSqliteDriver(':memory:')
  const logs: Array<{ dispose(): Promise<void> }> = []
  const makeLogger = (changes: ILogStore, images: ILogStore) =>
    new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [binlog({ store: changes }), undoLog({ store: images })]
    })
  let logger: ReturnType<typeof makeLogger> | undefined
  const host = await createStorageHost({
    plugins: [storageJournalPlugin(), sqliteBackendPlugin({ driver: connection })] as const,
    journal: async ({ storageLogStore: openNativeLog }) => {
      const changes = await openNativeLog('sqlite', { prefix: 'native-binlog' })
      const images = await openNativeLog('sqlite', { prefix: 'native-undo' })
      logs.push(changes, images)
      const current = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [binlog({ store: changes }), undoLog({ store: images })]
      })
      logger = current
      return {
        logger: current,
        namespace: 'same-native',
        binlogValues: true,
        atomicBinlog: { sqlite: changes },
        atomicUndo: { sqlite: images }
      }
    }
  })
  onTestFinished(async () => {
    await host.dispose()
    await logger?.shutdown('manual')
    await Promise.all(logs.map((store) => store.dispose()))
    await connection.dispose()
  })
  const store = host.backend('sqlite')
  const current = logger!
  await store.set('point', 'before')
  const before = await current.binlog.lastSeq()
  await store.transaction(async (scope) => {
    await scope.set('point', 'after')
    expect(await current.binlog.lastSeq()).toBe(before)
    expect(await current.undo.list()).toHaveLength(before)
  })
  expect(await current.binlog.lastSeq()).toBe(before + 1)
  const txId = ((await current.binlog.read(before + 1))[0]!.payload as { txId: string }).txId
  await store.undo(txId)
  expect(await store.get('point')).toBe('before')
  const committed = await current.binlog.lastSeq()
  await expect(
    store.transaction(async (scope) => {
      await scope.set('point', 'rolled-back')
      throw new RangeError('native rollback')
    })
  ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  expect(await store.get('point')).toBe('before')
  expect(await current.binlog.lastSeq()).toBe(committed)
  expect(() => store.sync!.set('sync-bypass', 'never')).toThrowError(
    expect.objectContaining({ code: 'ASYNC_STAGE_IN_SYNC_ENTRY' })
  )
  expect(await store.get('sync-bypass')).toBeNull()
  expect(await current.binlog.lastSeq()).toBe(committed)
  await store.transaction(async (scope) => {
    await scope.set('ordered', 'first')
    await scope.putRecord({ value: 'record' }, 'ordered-record')
    await scope.set('tail', 'third')
    await scope.set('ordered', 'last')
  })
  const ordered = (await current.binlog.read(await current.binlog.lastSeq()))[0]!.payload as {
    txId: string
    changes: Array<{ target: { channel: string; key: string }; value: string }>
  }
  expect(
    ordered.changes.map((change) => [
      change.target.channel,
      decodeFlatStorageKey(change.target.key)
    ])
  ).toEqual([
    ['text', 'ordered'],
    ['record', 'ordered-record'],
    ['text', 'tail'],
    ['text', 'ordered']
  ])
  const wire = defineCollectionsJsonCodec({ version: 1 })
  expect(
    ordered.changes
      .filter((change) => change.target.channel === 'text')
      .map((change) => JSON.parse((wire.decode(change.value) as { value: string }).value))
  ).toEqual(['first', 'third', 'last'])
  await store.undo(ordered.txId)
  expect(await store.get('ordered')).toBeNull()
  expect(await store.getRecord('ordered-record')).toBeUndefined()
  expect(await store.get('tail')).toBeNull()
})

it('keeps revision births unique after upgrading an old private layout and dropping its org', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-revision-birth-'))
  const connection = nodeSqliteDriver(join(directory, 'data.sqlite'))
  connection.exec(
    'CREATE TABLE migaia_revisions(org_id TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(org_id,key))'
  )
  const orgId = createOrgId()
  const logger = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [
      binlog({ store: memoryLogStore() }),
      wal({ store: memoryLogStore() }),
      undoLog({ store: memoryLogStore() })
    ]
  })
  const host = await createStorageHost({
    org: orgId,
    plugins: [storageJournalPlugin(), sqliteBackendPlugin({ driver: connection })] as const,
    journal: { logger, namespace: 'old-native-layout' }
  })
  onTestFinished(async () => {
    await host.dispose()
    await logger.shutdown('manual')
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  const store = host.backend('sqlite')
  await store.set('point', 'old-before')
  await store.set('point', 'after')
  const txId = (
    (await logger.binlog.read(await logger.binlog.lastSeq()))[0]!.payload as { txId: string }
  ).txId
  const first = connection
    .prepare('SELECT birth FROM migaia_revisions WHERE org_id=?')
    .all(orgId)
    .map((row) => row.birth)
  expect(first.every((birth) => typeof birth === 'string' && birth.length > 0)).toBe(true)
  await host.dropOrg(orgId)
  await store.set('point', 'new-before')
  await store.set('point', 'after')
  const next = connection
    .prepare('SELECT birth FROM migaia_revisions WHERE org_id=?')
    .all(orgId)
    .map((row) => row.birth)
  expect(
    next.every((birth) => typeof birth === 'string' && birth.length > 0 && !first.includes(birth))
  ).toBe(true)
  await expect(store.undo(txId)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
  expect(await store.get('point')).toBe('after')
})

it('recovers a committed marker after a lost native COMMIT acknowledgement without replaying data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-wal-recovery-'))
  const connection = nodeSqliteDriver(join(directory, 'data.sqlite'))
  let failCommit = false
  const original = new RangeError('lost native COMMIT reply')
  const driver = {
    exec: (sql: string) => connection.exec(sql),
    prepare: (sql: string) => {
      const statement = connection.prepare(sql)
      return sql !== 'COMMIT'
        ? statement
        : {
            ...statement,
            run: (...values: readonly ISqliteValue[]) => {
              const result = statement.run(...values)
              if (
                failCommit &&
                connection.prepare('SELECT count(*) AS n FROM migaia_commit_markers').get()!.n !== 0
              ) {
                failCommit = false
                throw original
              }
              return result
            }
          }
    }
  }
  const logger = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [
      binlog({ store: memoryLogStore() }),
      wal({ store: memoryLogStore() }),
      undoLog({ store: memoryLogStore() })
    ]
  })
  const open = () =>
    createStorageHost({
      plugins: [storageJournalPlugin(), sqliteBackendPlugin({ driver })] as const,
      journal: { logger, namespace: 'native-marker-recovery' }
    })
  let host = await open()
  onTestFinished(async () => {
    await host.dispose()
    await logger.shutdown('manual')
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  await host.backend('sqlite').set('point', 'before')
  failCommit = true
  await expect(host.backend('sqlite').set('point', 'after')).rejects.toMatchObject({
    code: 'TRANSACTION_FAILED'
  })
  expect(await logger.wal.pending()).toHaveLength(1)
  const markerCount = connection.prepare('SELECT count(*) AS n FROM migaia_commit_markers').get()!.n
  expect(markerCount).toBe(1)
  await host.dispose()
  host = await open()
  expect(await host.backend('sqlite').get('point')).toBe('after')
  expect(await logger.wal.pending()).toHaveLength(0)
  expect(await logger.binlog.lastSeq()).toBe(2)
  expect(connection.prepare('SELECT count(*) AS n FROM migaia_commit_markers').get()!.n).toBe(0)
  const txId = ((await logger.binlog.read(2))[0]!.payload as { txId: string }).txId
  await host.backend('sqlite').undo(txId)
  expect(await host.backend('sqlite').get('point')).toBe('before')
})
