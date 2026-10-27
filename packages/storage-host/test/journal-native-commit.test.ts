import { storageJournalPlugin } from '../src/journal.js'
import { describe, expect, it } from 'vitest'
import { Logger } from '@migaia/logger'
import { binlog, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'
import { lockKey } from '../src/authoring/concurrency.js'
import { createStorageHost, createOrgId } from '../src/index.js'
import { memoryBackendPlugin } from '../src/plugins/memory.js'
import { storageLogStore } from '../src/journal.js'
import { resolveStorageJournalBinding } from '../src/journal/binding.js'
import { createStorageNativeJournal } from '../src/journal/commit.js'
import { decodeFlatStorageKey } from '../src/core/key-domain.js'

/** Real logger scheduling stays active while expected diagnostics avoid process output. */
const runtimeManager = {
  randomUUID: () => crypto.randomUUID(),
  defer: (task: () => void) => queueMicrotask(task),
  write: () => undefined
}
/** Durable plugin preparation uses the logger's required original execution-budget contract. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

describe('native storage journal commit bridge', () => {
  it('commits real binlog and coalesced undo images with data and leaves every index unchanged on rollback', async () => {
    await using host = await createStorageHost({
      plugins: [storageJournalPlugin(), memoryBackendPlugin()]
    })
    const store = host.backend('memory')
    const binlogStore = await storageLogStore(host, 'memory', { prefix: 'native-binlog' })
    const undoStore = await storageLogStore(host, 'memory', { prefix: 'native-undo' })
    const logger = new Logger({
      execution,
      runtimeManager,
      plugins: [binlog({ store: binlogStore }), undoLog({ store: undoStore })]
    })
    try {
      const native = await createStorageNativeJournal({
        access: resolveStorageJournalBinding(host, 'memory'),
        backend: store.backend,
        namespace: 'application',
        logger,
        atomicBinlog: binlogStore,
        atomicUndo: undoStore
      })
      const key = [new Date(0), new Uint8Array([9]).buffer]
      let txId = ''
      await store
        .tx()
        .lock(lockKey.text('text'), lockKey.record(key), ...native.headLocks)
        .run(async (scope) => {
          const attempt = native.begin(scope)
          txId = attempt.txId
          await scope.set('text', 'intermediate-secret')
          await scope.set('text', 'final-secret')
          await scope.putRecord({ nullable: null }, key)
          await attempt.record(scope)
          expect(await binlogStore.lastSeq()).toBe(0)
          expect(await logger.undo.get(txId)).toBeUndefined()
        })
      expect(await store.get('text')).toBe('final-secret')
      const records = await logger.binlog.read(1)
      expect(records).toHaveLength(1)
      expect(records[0]!.kind).toBe('storage.commit')
      expect(records[0]!.payload).toMatchObject({
        version: 1,
        target: { namespace: 'application', backendInstanceId: 'memory' },
        txId,
        changes: [{ present: true }, { present: true }, { present: true }]
      })
      expect(JSON.stringify(records[0]!.payload)).not.toContain('final-secret')
      const images = await logger.undo.get(txId)
      expect(images).toHaveLength(2)
      const text = images!.find((image) =>
        JSON.stringify(image.target).includes('"channel":"text"')
      )!
      expect(text.before).toEqual({ present: false })
      expect(text.after).toMatchObject({ present: true })
      expect(JSON.stringify(text.after)).toContain('final-secret')
      expect(text.target).toMatchObject({
        version: 1,
        namespace: 'application',
        backendInstanceId: 'memory',
        afterRevision: { epoch: 0, revision: 1 }
      })
      const record = images!.find((image) =>
        JSON.stringify(image.target).includes('"channel":"record"')
      )!
      const wire = JSON.parse(JSON.stringify(record.target))
      expect(decodeFlatStorageKey(wire.identity.key)).toEqual(key)
      const original = new RangeError('rollback after actual provisional logger append')
      let rolledBack = ''
      await expect(
        store
          .tx()
          .lock(lockKey.text('text'), ...native.headLocks)
          .run(async (scope) => {
            const attempt = native.begin(scope)
            rolledBack = attempt.txId
            await scope.set('text', 'rolled back')
            await attempt.record(scope)
            throw original
          })
      ).rejects.toMatchObject({ cause: original })
      expect(await store.get('text')).toBe('final-secret')
      expect(await binlogStore.lastSeq()).toBe(1)
      expect(await undoStore.lastSeq()).toBe(1)
      expect(await logger.undo.get(rolledBack)).toBeUndefined()
      await store
        .tx()
        .lock(lockKey.text('read-only'), ...native.headLocks)
        .run(async (scope) => {
          const attempt = native.begin(scope)
          await scope.get('read-only')
          await attempt.record(scope)
        })
      expect(await binlogStore.lastSeq()).toBe(1)
      const withValues = await createStorageNativeJournal({
        access: resolveStorageJournalBinding(host, 'memory'),
        backend: store.backend,
        namespace: 'with-values',
        logger,
        atomicBinlog: binlogStore,
        atomicUndo: undoStore,
        binlogValues: true
      })
      await store
        .tx()
        .lock(lockKey.text('value'), ...withValues.headLocks)
        .run(async (scope) => {
          const attempt = withValues.begin(scope)
          await scope.set('value', 'selected encoded value')
          await attempt.record(scope)
        })
      expect(JSON.stringify((await logger.binlog.read(2))[0]!.payload)).toContain(
        'selected encoded value'
      )
    } finally {
      await logger.shutdown('manual')
    }
  })

  it('rejects foreign or uncertified native handles and preserves the logger exact-store check', async () => {
    await using host = await createStorageHost({
      plugins: [storageJournalPlugin(), memoryBackendPlugin()]
    })
    const store = host.backend('memory')
    const selected = await storageLogStore(host, 'memory', { prefix: 'selected' })
    const actual = await storageLogStore(host, 'memory', { prefix: 'actual' })
    const logger = new Logger({ execution, runtimeManager, plugins: [binlog({ store: actual })] })
    try {
      const options = {
        access: resolveStorageJournalBinding(host, 'memory'),
        backend: store.backend,
        namespace: 'mismatch',
        logger,
        atomicBinlog: selected
      }
      await expect(
        createStorageNativeJournal({
          ...options,
          access: resolveStorageJournalBinding(host.org(createOrgId()), 'memory')
        })
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
      await using otherHost = await createStorageHost({
        plugins: [storageJournalPlugin(), memoryBackendPlugin()]
      })
      await expect(
        createStorageNativeJournal({
          ...options,
          access: resolveStorageJournalBinding(otherHost, 'memory')
        })
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
      await expect(
        createStorageNativeJournal({
          ...options,
          atomicBinlog: memoryLogStore()
        })
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
      const native = await createStorageNativeJournal(options)
      await expect(
        store
          .tx()
          .lock(lockKey.text('key'), ...native.headLocks)
          .run(async (scope) => {
            const attempt = native.begin(scope)
            await scope.set('key', 'uncommitted')
            await attempt.record(scope)
          })
      ).rejects.toMatchObject({ cause: { code: 'INVALID_OPTION' } })
      expect(await store.get('key')).toBeNull()
      expect(await selected.lastSeq()).toBe(0)
      expect(await actual.lastSeq()).toBe(0)
    } finally {
      await logger.shutdown('manual')
    }
  })
})
