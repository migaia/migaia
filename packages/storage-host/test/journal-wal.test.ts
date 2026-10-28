import { storageJournalPlugin } from '../src/journal.js'
import { describe, expect, it } from 'vitest'
import { Logger } from '@migaia/logger'
import {
  binlog,
  undoLog,
  wal,
  memoryLogStore,
  type ILogPayloadInput
} from '@migaia/logger/plugins/durable'
import { lockKey } from '../src/authoring/concurrency.js'
import { ttl, type IStorageResource } from '@migaia/storage-contract'
import { createStorageHost, createOrgId } from '../src/index.js'
import { memoryBackendPlugin } from '../src/plugins/memory.js'
import { resolveStorageJournalBinding } from '../src/journal/binding.js'
import { snapshotStorageJournalConfiguration } from '../src/journal/configuration-options.js'
import { createStorageNativeJournal } from '../src/journal/commit.js'
import { StorageJournalKind } from '../src/journal/constants.js'

/** Real durable plugins use their existing scheduling and explicit execution budget. */
const runtimeManager = {
  randomUUID: () => crypto.randomUUID(),
  defer: (task: () => void) => queueMicrotask(task),
  write: () => undefined
}
/** Disable only the existing logger timeout for this deterministic storage fixture. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

describe('external storage WAL', () => {
  it('retains the selected original WAL and refuses a different pending owner', async () => {
    await using first = memoryLogStore()
    await using second = memoryLogStore()
    const logger = new Logger({ execution, runtimeManager, plugins: [wal({ store: first })] })
    const other = new Logger({ execution, runtimeManager, plugins: [wal({ store: second })] })
    try {
      const snapshot = snapshotStorageJournalConfiguration({
        logger,
        namespace: 'redo',
        redoWal: logger.wal
      })
      expect(snapshot.redoWal).toBe(logger.wal)
      expect(snapshot.logger.wal).toBe(logger.wal)
      expect(() =>
        snapshotStorageJournalConfiguration({ logger, namespace: 'redo', redoWal: other.wal })
      ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }))
    } finally {
      await logger.shutdown('manual')
      await other.shutdown('manual')
    }
  })
  it('recovers committed intents by the original marker and aborts uncommitted intents without touching foreign targets', async () => {
    await using records = memoryLogStore()
    await using intents = memoryLogStore()
    const logger = new Logger({
      execution,
      runtimeManager,
      plugins: [binlog({ store: records }), wal({ store: intents })]
    })
    await using host = await createStorageHost({
      plugins: [storageJournalPlugin(), memoryBackendPlugin()]
    })
    const store = host.backend('memory')
    const access = resolveStorageJournalBinding(host, 'memory')
    const resources: IStorageResource[] = []
    const reports: unknown[] = []
    let fail = true
    const original = new RangeError('binlog unavailable after actual native commit')
    const selected = {
      ...logger,
      wal: logger.wal,
      binlog: {
        ...logger.binlog,
        append: <T>(kind: string, payload: T & ILogPayloadInput<T>) =>
          fail ? Promise.reject(original) : logger.binlog.append(kind, payload)
      }
    }
    const options = {
      access: {
        ...access,
        retain: (resource: IStorageResource) => {
          resources.push(resource)
          return access.retain(resource)
        }
      },
      backend: store.backend,
      namespace: 'wal-target',
      logger: selected,
      report: (error: unknown) => {
        reports.push(error)
      },
      onBinlogAppendError: (_txId: string, error: unknown) => {
        reports.push(error)
      }
    }
    try {
      const bridge = await createStorageNativeJournal(options)
      let attempt: ReturnType<typeof bridge.begin> | undefined
      await store
        .tx()
        .lock(lockKey.text('value'))
        .run(async (scope) => {
          attempt = bridge.begin(scope)
          await scope.set('value', 'durable private value')
          await scope.use(ttl).expire({ channel: 'text', key: 'value' }, 60_000)
          await attempt.record(scope)
          expect(await access.binding.hasCommitMarker!(attempt.txId)).toBe(false)
          expect(await logger.binlog.read(1)).toEqual([])
        })
      await attempt!.settle?.()
      expect(await store.get('value')).toBe('durable private value')
      expect(await access.binding.hasCommitMarker!(attempt!.txId)).toBe(true)
      expect(reports).toEqual([original])
      const [pending] = await logger.wal.pending()
      expect(JSON.stringify(pending!.payload)).toContain('durable private value')
      const foreign = structuredClone(pending!.payload) as {
        target: { orgId: string }
        commit: { target: { orgId: string } }
      }
      foreign.target.orgId = createOrgId()
      foreign.commit.target.orgId = foreign.target.orgId
      const foreignSeq = await logger.wal.begin(StorageJournalKind.intent, foreign)
      const damagedForeignSeq = await logger.wal.begin(StorageJournalKind.intent, {
        target: foreign.target,
        commit: false
      })
      const unrelatedSeq = await logger.wal.begin('application.intent', { own: false })
      await resources[0]!.dispose()
      fail = false
      const recovered = await createStorageNativeJournal(options)
      expect((await logger.binlog.read(1))[0]!.payload).toMatchObject({ txId: attempt!.txId })
      expect(JSON.stringify((await logger.binlog.read(1))[0]!.payload)).not.toContain(
        'durable private value'
      )
      expect(await access.binding.hasCommitMarker!(attempt!.txId)).toBe(false)
      expect((await logger.wal.pending()).map((entry) => entry.seq)).toEqual([
        foreignSeq,
        damagedForeignSeq,
        unrelatedSeq
      ])
      /** A crash before commit leaves this exact valid intent but no marker or business change. */
      await logger.wal.begin(StorageJournalKind.intent, pending!.payload)
      await resources[1]!.dispose()
      await createStorageNativeJournal(options)
      expect(await logger.binlog.read(1)).toHaveLength(1)
      expect((await logger.wal.pending()).map((entry) => entry.seq)).toEqual([
        foreignSeq,
        damagedForeignSeq,
        unrelatedSeq
      ])
      expect(recovered.headLocks).toEqual([])
    } finally {
      await logger.shutdown('manual')
    }
  })

  it('uses actual global preparation and aborts an intent after a native rollback', async () => {
    await using records = memoryLogStore()
    await using intents = memoryLogStore()
    const logger = new Logger({
      execution,
      runtimeManager,
      plugins: [binlog({ store: records }), wal({ store: intents })]
    })
    await using host = await createStorageHost({
      plugins: [storageJournalPlugin({ logger, namespace: 'automatic-wal' }), memoryBackendPlugin()]
    })
    try {
      const store = host.backend('memory')
      await store.set('key', 'committed')
      expect(await logger.binlog.read(1)).toHaveLength(1)
      expect(await logger.wal.pending()).toEqual([])
      const access = resolveStorageJournalBinding(host, 'memory')
      const bridge = await createStorageNativeJournal({
        access,
        backend: store.backend,
        namespace: 'manual-rollback',
        logger
      })
      let attempt: ReturnType<typeof bridge.begin> | undefined
      const original = new RangeError('rollback after durable intent')
      await expect(
        store
          .tx()
          .lock(lockKey.text('key'))
          .run(async (scope) => {
            attempt = bridge.begin(scope)
            await scope.set('key', 'rollback')
            await attempt.record(scope)
            throw original
          })
      ).rejects.toMatchObject({ cause: original })
      await attempt!.settle?.()
      expect(await logger.wal.pending()).toEqual([])
      expect(await store.get('key')).toBe('committed')
      expect(await logger.binlog.read(1)).toHaveLength(1)
    } finally {
      await logger.shutdown('manual')
    }
  })

  it('publishes external undo through the same global WAL and records undo as a new native commit', async () => {
    await using images = memoryLogStore()
    await using intents = memoryLogStore()
    const logger = new Logger({
      execution,
      runtimeManager,
      plugins: [undoLog({ store: images }), wal({ store: intents })]
    })
    await using host = await createStorageHost({
      plugins: [
        storageJournalPlugin({ logger, namespace: 'external-undo-only' }),
        memoryBackendPlugin()
      ]
    })
    try {
      const store = host.backend('memory')
      await store.set('value', 'before')
      await store
        .tx()
        .lock(lockKey.text('value'))
        .run(async (scope) => {
          await scope.set('value', 'intermediate')
          await scope.set('value', 'after')
          await scope.use(ttl).expire({ channel: 'text', key: 'value' }, 60_000)
        })
      const txId = (await logger.undo.list())[0]!.txId
      expect(JSON.stringify(await logger.undo.get(txId))).toContain('before')
      expect(JSON.stringify(await logger.undo.get(txId))).toContain('after')
      expect(await logger.wal.pending()).toEqual([])
      const restored = await store.undo(txId)
      expect(restored.txId).not.toBe(txId)
      expect(await store.get('value')).toBe('before')
      expect(await store.use(ttl).remaining({ channel: 'text', key: 'value' })).toBeUndefined()
      expect(await logger.undo.get(restored.txId)).toBeDefined()
      expect(await logger.wal.pending()).toEqual([])
    } finally {
      await logger.shutdown('manual')
    }
  })

  it('recovers an external mirror after publication failure and skips only an identical already-published mirror', async () => {
    await using images = memoryLogStore()
    await using intents = memoryLogStore()
    const logger = new Logger({
      execution,
      runtimeManager,
      plugins: [undoLog({ store: images }), wal({ store: intents })]
    })
    await using host = await createStorageHost({
      plugins: [storageJournalPlugin(), memoryBackendPlugin()]
    })
    const store = host.backend('memory')
    await store.set('value', 'before')
    const access = resolveStorageJournalBinding(host, 'memory')
    const resources: IStorageResource[] = []
    const reports: unknown[] = []
    const original = new RangeError('external undo publication failed after commit')
    const completeFailure = new RangeError('intent completion failed after mirror publication')
    let failRecord = true
    let failComplete = true
    const selected = {
      undo: {
        ...logger.undo,
        record: (...args: Parameters<typeof logger.undo.record>) =>
          failRecord ? Promise.reject(original) : logger.undo.record(...args)
      },
      wal: {
        ...logger.wal,
        complete: (seq: number) =>
          failComplete ? Promise.reject(completeFailure) : logger.wal.complete(seq)
      }
    }
    const options = {
      access: {
        ...access,
        retain: (resource: IStorageResource) => {
          resources.push(resource)
          return access.retain(resource)
        }
      },
      backend: store.backend,
      namespace: 'recover-external-undo',
      logger: selected,
      report: (error: unknown) => {
        reports.push(error)
      }
    }
    try {
      const bridge = await createStorageNativeJournal(options)
      let attempt: ReturnType<typeof bridge.begin> | undefined
      await store
        .tx()
        .lock(lockKey.text('value'))
        .run(async (scope) => {
          attempt = bridge.begin(scope)
          await scope.set('value', 'after')
          await attempt.record(scope)
        })
      await attempt!.settle?.()
      expect(await store.get('value')).toBe('after')
      expect(await logger.undo.get(attempt!.txId)).toBeUndefined()
      expect(reports).toEqual([original])
      expect(await access.binding.hasCommitMarker!(attempt!.txId)).toBe(true)
      expect(await logger.wal.pending()).toHaveLength(1)
      await resources[0]!.dispose()
      failRecord = false
      await expect(createStorageNativeJournal(options)).rejects.toMatchObject({
        code: 'JOURNAL_RECOVERY_FAILED',
        cause: completeFailure
      })
      const committedImages = (await logger.undo.get(attempt!.txId))!
      expect(committedImages).toBeDefined()
      expect(await logger.wal.pending()).toHaveLength(1)
      failComplete = false
      /** A borrowed logger cannot silently replace this target's recovery mirror. */
      await logger.undo.forget(attempt!.txId)
      await logger.undo.record(attempt!.txId, [
        { ...committedImages[0]!, before: { present: false } }
      ])
      await expect(createStorageNativeJournal(options)).rejects.toMatchObject({
        code: 'JOURNAL_RECORD_INVALID'
      })
      expect(await logger.wal.pending()).toHaveLength(1)
      expect(await store.get('value')).toBe('after')
      await logger.undo.forget(attempt!.txId)
      await logger.undo.record(attempt!.txId, committedImages)
      await createStorageNativeJournal(options)
      expect(await logger.undo.list()).toHaveLength(1)
      expect(await logger.wal.pending()).toEqual([])
      expect(await access.binding.hasCommitMarker!(attempt!.txId)).toBe(false)
    } finally {
      await logger.shutdown('manual')
    }
  })

  it('rejects damaged owned intents and missing external-await authority before opening a business scope', async () => {
    await using records = memoryLogStore()
    await using intents = memoryLogStore()
    const logger = new Logger({
      execution,
      runtimeManager,
      plugins: [binlog({ store: records }), wal({ store: intents })]
    })
    await using host = await createStorageHost({
      plugins: [storageJournalPlugin(), memoryBackendPlugin()]
    })
    try {
      const access = resolveStorageJournalBinding(host, 'memory')
      const options = { access, backend: host.backend('memory').backend, namespace: 'bad', logger }
      await expect(
        createStorageNativeJournal({
          ...options,
          access: { ...access, binding: { ...access.binding, externalWal: undefined } }
        })
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
      await logger.wal.begin(StorageJournalKind.intent, { version: 2 })
      await expect(createStorageNativeJournal(options)).rejects.toMatchObject({
        code: 'JOURNAL_RECORD_INVALID'
      })
      expect(await host.backend('memory').get('unchanged')).toBeNull()
      expect(await logger.binlog.read(1)).toEqual([])
      expect(await logger.wal.pending()).toHaveLength(1)
    } finally {
      await logger.shutdown('manual')
    }
  })
})
