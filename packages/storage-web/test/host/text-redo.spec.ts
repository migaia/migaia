// @vitest-environment node
import { locks } from 'node:worker_threads'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Logger, type ILogEntry } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'
import { binlog, memoryLogStore, wal } from '@migaia/logger/plugins/durable'
import { ConcurrencyPolicy, kv, lockKey } from '@migaia/storage-contract'
import { createStorageHost, createOrgId, definePlugin } from '@migaia/storage-host'
import {
  decodeStorageJournalImage,
  encodeStorageJournalImage
} from '@migaia/storage-host/authoring/backend'
import { localStorageBackendPlugin } from '../../src/local-storage.js'
import { sessionStorageBackendPlugin } from '../../src/session-storage.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'

/** Native LockManager, original durable plugins and the native-shaped Storage port own the work. */
const createLogger = () =>
  new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [wal({ store: memoryLogStore() }), binlog({ store: memoryLogStore() })]
  })

afterEach(() => vi.unstubAllGlobals())

describe('text redo through the original host and WAL owners', () => {
  for (const kind of ['local', 'session'] as const) {
    it(`${kind} preserves ordered draft writes and does not persist callback rollback`, async () => {
      vi.stubGlobal('navigator', { locks })
      const logger = createLogger()
      const storage = fakeWebStorage()
      const plugin =
        kind === 'local'
          ? localStorageBackendPlugin({ storage, namespace: kind, redo: true })
          : sessionStorageBackendPlugin({ storage, namespace: kind, redo: true })
      const host = await createStorageHost({
        plugins: [plugin],
        journal: { logger, namespace: 'text-redo', redoWal: logger.wal, binlogValues: true }
      })
      try {
        const store = host.backend(kind)
        expect(store.capabilities.transactions).toBe(true)
        await store.use(kv).setMany([
          { key: 'a', value: 'one' },
          { key: 'b', value: 'two' }
        ])
        await store.transaction(async (scope) => {
          expect(await scope.use(kv).get('a')).toBe('one')
          await scope.set('a', 'draft')
          expect(await scope.get('a')).toBe('draft')
          await scope.remove('a')
          await scope.set('a', 'final')
        })
        expect(await store.get('a')).toBe('final')
        const rows = await logger.binlog.read(1)
        expect(rows).toHaveLength(2)
        expect(
          (rows[1]!.payload as { changes: Array<{ value: string }> }).changes.map(({ value }) =>
            value === undefined
              ? undefined
              : decodeStorageJournalImage({ present: true, value }).value
          )
        ).toEqual(['draft', undefined, 'final'])
        const original = new RangeError('callback rollback')
        await expect(
          store.transaction(async (scope) => {
            await scope.set('a', 'never applied')
            throw original
          })
        ).rejects.toMatchObject({ cause: original })
        expect(await store.get('a')).toBe('final')
        expect(await logger.binlog.read(1)).toHaveLength(2)
        expect(await logger.wal.pending()).toHaveLength(0)
      } finally {
        await host.dispose()
        await logger.shutdown('manual')
      }
    })
  }

  it('preserves a partially applied native failure and recovers through the same WAL object on reopen', async () => {
    vi.stubGlobal('navigator', { locks })
    const logger = createLogger()
    const storage = fakeWebStorage()
    const options = { storage, namespace: 'partial', redo: true as const }
    const journal = { logger, namespace: 'text-redo', redoWal: logger.wal }
    const host = await createStorageHost({ plugins: [localStorageBackendPlugin(options)], journal })
    const original = new DOMException('native assignment failure', 'QuotaExceededError')
    const setItem = storage.setItem
    let assignments = 0
    const fail = vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (++assignments === 2) throw original
      setItem(key, value)
    })
    try {
      await expect(
        host
          .backend('local')
          .use(kv)
          .setMany([
            { key: 'a', value: 'one' },
            { key: 'b', value: 'two' }
          ])
      ).rejects.toMatchObject({ code: 'JOURNAL_RECOVERY_FAILED' })
      expect(await logger.wal.pending()).toHaveLength(1)
      await expect(host.backend('local').get('a')).rejects.toBeDefined()
      fail.mockRestore()
      await host.dispose()
      await using recovered = await createStorageHost({
        plugins: [localStorageBackendPlugin(options)],
        journal
      })
      expect(await recovered.backend('local').get('a')).toBe('one')
      expect(await recovered.backend('local').get('b')).toBe('two')
      expect(await logger.wal.pending()).toHaveLength(0)
      expect(await logger.binlog.read(1)).toHaveLength(1)
    } finally {
      fail.mockRestore()
      await host.dispose()
      await logger.shutdown('manual')
    }
  })

  it('recovers a failed durable completion before an already-open peer reads and notifies', async () => {
    vi.stubGlobal('navigator', { locks })
    const carrier = memoryLogStore()
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [wal({ store: carrier })]
    })
    const storage = fakeWebStorage()
    const options = { storage, namespace: 'complete', redo: true as const }
    const journal = { logger, namespace: 'text-redo', redoWal: logger.wal }
    const host = await createStorageHost({ plugins: [localStorageBackendPlugin(options)], journal })
    const peer = await createStorageHost({ plugins: [localStorageBackendPlugin(options)], journal })
    const original = new RangeError('durable completion failed')
    const failure = vi.spyOn(carrier, 'setState').mockRejectedValueOnce(original)
    const listener = vi.fn()
    peer.backend('local').subscribeChanges(listener)
    try {
      const rejected = await host
        .backend('local')
        .set('a', 'applied')
        .catch((error) => error)
      expect(rejected).toMatchObject({ code: 'JOURNAL_RECOVERY_FAILED' })
      expect(walkErrorCauses(rejected)).toContain(original)
      expect(await logger.wal.pending()).toHaveLength(1)
      failure.mockRestore()
      expect(await peer.backend('local').get('a')).toBe('applied')
      expect(await logger.wal.pending()).toHaveLength(0)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      failure.mockRestore()
      await peer.dispose()
      await host.dispose()
      await logger.shutdown('manual')
    }
  })

  it('isolates independent same-instance root callers while a redo draft is active, including wait policy', async () => {
    vi.stubGlobal('navigator', { locks })
    const logger = createLogger()
    const storage = fakeWebStorage()
    const host = await createStorageHost({
      plugins: [localStorageBackendPlugin({ storage, namespace: 'same-instance', redo: true })],
      journal: { logger, namespace: 'text-redo', redoWal: logger.wal }
    })
    const store = host.backend('local')
    const entered = deferred<void>()
    const release = deferred<void>()
    const assigned = vi.spyOn(storage, 'setItem')
    const transaction = store.transaction(async (scope) => {
      await scope.set('a', 'draft')
      expect(await scope.get('a')).toBe('draft')
      entered.resolve()
      await release.promise
    })
    try {
      await entered.promise
      await expect(store.get('a')).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
      await expect(
        store.set('b', 'independent caller', { concurrency: ConcurrencyPolicy.wait() })
      ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
      expect(assigned).not.toHaveBeenCalled()
      expect(await logger.wal.pending()).toHaveLength(0)
      expect(await logger.binlog.read(1)).toHaveLength(0)
      release.resolve()
      await transaction
      expect(await store.get('a')).toBe('draft')
      expect(await store.get('b')).toBeNull()
    } finally {
      release.resolve()
      await transaction
      await host.dispose()
      await logger.shutdown('manual')
    }
  })

  it('rejects cancellation while waiting for the original native lock without running late work', async () => {
    vi.stubGlobal('navigator', { locks })
    const logger = createLogger()
    const storage = fakeWebStorage()
    const options = { storage, namespace: 'cancel', redo: true as const }
    const journal = { logger, namespace: 'text-redo', redoWal: logger.wal }
    const host = await createStorageHost({ plugins: [localStorageBackendPlugin(options)], journal })
    const peer = await createStorageHost({ plugins: [localStorageBackendPlugin(options)], journal })
    const entered = deferred<void>()
    const release = deferred<void>()
    const transaction = host.backend('local').transaction(async (scope) => {
      entered.resolve()
      await release.promise
      await scope.set('a', 'committed')
    })
    try {
      await entered.promise
      const controller = new AbortController()
      const original = new DOMException('cancel queued native read', 'AbortError')
      const waiting = peer
        .backend('local')
        .get('a', { signal: controller.signal })
        .catch((error) => error)
      controller.abort(original)
      expect(walkErrorCauses(await waiting)).toContain(original)
      expect(await logger.wal.pending()).toHaveLength(0)
    } finally {
      release.resolve()
      await transaction
      await peer.dispose()
      await host.dispose()
      await logger.shutdown('manual')
    }
  })

  it('rejects explicit redo without WAL or the exact selected owner before any data assignment', async () => {
    vi.stubGlobal('navigator', { locks })
    const storage = fakeWebStorage()
    const assigned = vi.spyOn(storage, 'setItem')
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    try {
      await expect(
        createStorageHost({
          plugins: [localStorageBackendPlugin({ storage, redo: true })],
          journal: { logger, namespace: 'missing' }
        })
      ).rejects.toBeDefined()
      expect(storage.length).toBe(0)
      assigned.mockClear()
      const durable = createLogger()
      try {
        await expect(
          createStorageHost({
            plugins: [localStorageBackendPlugin({ storage, redo: true })],
            journal: { logger: durable, namespace: 'unselected' }
          })
        ).rejects.toBeDefined()
        expect(storage.length).toBe(0)
      } finally {
        await durable.shutdown('manual')
      }
      const walOnly = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [wal({ store: memoryLogStore() })]
      })
      try {
        await expect(
          createStorageHost({
            plugins: [localStorageBackendPlugin({ storage })],
            journal: {
              logger: walOnly,
              namespace: 'missing-backend-selection',
              redoWal: walOnly.wal
            }
          })
        ).rejects.toBeDefined()
        expect(storage.length).toBe(0)
      } finally {
        await walOnly.shutdown('manual')
      }
    } finally {
      await logger.shutdown('manual')
    }
  })

  it('runs one batch pipeline and preserves transformed scope inputs and commit failures inside intervention', async () => {
    vi.stubGlobal('navigator', { locks })
    const logger = createLogger()
    const storage = fakeWebStorage()
    const operations: string[] = []
    let observed: unknown
    const intervention = definePlugin('text-redo-intervention', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          operations.push(input.operation)
          if (input.operation === 'local-storage.set' && !Array.isArray(input.input)) {
            const value = input.input as { key: string; value: string }
            return next({ ...input, input: { ...value, value: value.value + '-changed' } })
          }
          try {
            return await next(input)
          } catch (cause) {
            observed = cause
            throw cause
          }
        })
        return {}
      }
    }))
    const host = await createStorageHost({
      plugins: [
        localStorageBackendPlugin({ storage, namespace: 'pipeline', redo: true }),
        intervention
      ],
      journal: { logger, namespace: 'text-redo', redoWal: logger.wal }
    })
    try {
      operations.length = 0
      await host
        .backend('local')
        .use(kv)
        .setMany([{ key: 'a', value: 'batch' }])
      expect(operations).toEqual(['local-storage.setMany'])
      await host.backend('local').transaction(async (scope) => {
        await scope.set('a', 'scope')
        expect(await scope.get('a')).toBe('scope-changed')
      })
      expect(await host.backend('local').get('a')).toBe('scope-changed')
      const original = new DOMException(
        'native commit failed in intervention',
        'QuotaExceededError'
      )
      const fail = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
        throw original
      })
      try {
        const failure = await host
          .backend('local')
          .transaction((scope) => scope.set('a', 'failed'))
          .catch((error) => error)
        expect(failure).toBe(observed)
        expect(walkErrorCauses(failure)).toContain(original)
      } finally {
        fail.mockRestore()
      }
    } finally {
      await host.dispose()
      await logger.shutdown('manual')
    }
  })

  it('keeps ordinary and telemetry-only scalar behavior and the original selected sync guard', async () => {
    const storage = fakeWebStorage()
    await using ordinary = await createStorageHost({
      plugins: [localStorageBackendPlugin({ storage })]
    })
    ordinary.backend('local').sync.set('ordinary', 'sync')
    expect(ordinary.backend('local').sync.get('ordinary')).toBe('sync')
    expect(ordinary.backend('local').capabilities.transactions).toBe(false)
    await expect(
      ordinary
        .backend('local')
        .use(kv)
        .setMany([{ key: 'x', value: 'unsupported' }])
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [level({ level: 'debug' })]
    })
    const entries: ILogEntry[] = []
    logger.useSink((entry) => {
      entries.push(entry)
    })
    const initialized: string[] = []
    const host = await createStorageHost({
      plugins: [localStorageBackendPlugin({ storage, namespace: 'observation' })],
      journal: ({ orgId }) => {
        initialized.push(orgId)
        return { logger, namespace: 'observation', telemetry: true }
      }
    })
    try {
      const org = createOrgId()
      const store = host.org(org).backend('local')
      expect(await store.get('fresh')).toBeNull()
      await logger.flush()
      expect(initialized).toContain(org)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.meta).toMatchObject({
        orgId: org,
        keys: [lockKey.text('fresh')],
        outcome: 'success'
      })
      await store.set('fresh', 'observed')
      expect(await store.get('fresh')).toBe('observed')
      expect(() => host.backend('local').sync.set('blocked', 'value')).toThrowError(
        expect.objectContaining({ code: 'ASYNC_STAGE_IN_SYNC_ENTRY' })
      )
    } finally {
      await host.dispose()
      await logger.shutdown('manual')
    }
  })

  it('rejects an owned persisted non-text image before replaying any native assignment', async () => {
    vi.stubGlobal('navigator', { locks })
    const logger = createLogger()
    const storage = fakeWebStorage()
    const options = { storage, namespace: 'corrupt', redo: true as const }
    const journal = { logger, namespace: 'text-redo', redoWal: logger.wal }
    const host = await createStorageHost({ plugins: [localStorageBackendPlugin(options)], journal })
    const fail = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('capture persisted intent', 'QuotaExceededError')
    })
    try {
      await expect(host.backend('local').set('key', 'text')).rejects.toMatchObject({
        code: 'JOURNAL_RECOVERY_FAILED'
      })
      fail.mockRestore()
      await host.dispose()
      const row = (await logger.wal.pending())[0]!
      const payload = structuredClone(row.payload) as {
        changes: Array<{ after: ReturnType<typeof encodeStorageJournalImage> }>
      }
      payload.changes[0]!.after = encodeStorageJournalImage(true, 42)
      await logger.wal.abort(row.seq)
      await logger.wal.begin(row.kind, payload)
      const failure = await createStorageHost({
        plugins: [localStorageBackendPlugin(options)],
        journal
      }).catch((error) => error)
      expect(walkErrorCauses(failure)).toContainEqual(
        expect.objectContaining({ code: 'JOURNAL_RECORD_INVALID' })
      )
      expect(storage.length).toBe(0)
      expect(await logger.wal.pending()).toHaveLength(1)
    } finally {
      fail.mockRestore()
      await host.dispose()
      await logger.shutdown('manual')
    }
  })
})
