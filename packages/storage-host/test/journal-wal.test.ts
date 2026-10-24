import { describe, expect, it } from 'vitest'
import { Logger } from '@migaia/logger'
import { binlog, wal, memoryLogStore, type ILogPayloadInput } from '@migaia/logger/plugins/durable'
import { lockKey, ttl, type IStorageResource } from '@migaia/storage-contract'
import { createStorageHost, createOrgId, memoryBackendPlugin } from '../src/index.js'
import { resolveStorageJournalBinding } from '../src/journal/binding.js'
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
  it('recovers committed intents by the original marker and aborts uncommitted intents without touching foreign targets', async () => {
    await using records = memoryLogStore()
    await using intents = memoryLogStore()
    const logger = new Logger({
      execution,
      runtimeManager,
      plugins: [binlog({ store: records }), wal({ store: intents })]
    })
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
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
      plugins: [memoryBackendPlugin()],
      journal: { logger, namespace: 'automatic-wal' }
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

  it('rejects damaged owned intents and missing external-await authority before opening a business scope', async () => {
    await using records = memoryLogStore()
    await using intents = memoryLogStore()
    const logger = new Logger({
      execution,
      runtimeManager,
      plugins: [binlog({ store: records }), wal({ store: intents })]
    })
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
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
