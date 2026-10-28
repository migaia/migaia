import { StorageLogObserver } from './helpers/log-observer.ts'
import { storageJournalPlugin } from '../src/journal.ts'
import { describe, expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { levelPlugin } from '@migaia/log-host'
import { ConcurrencyPolicy, lockKey } from '../src/authoring/concurrency.ts'
import { deferred } from '@migaia/utils/promise'
import { createOrgId, createStorageHost } from '../src/index.ts'
import { memoryBackendPlugin } from '../src/plugins/memory.ts'

/** Use the actual borrowed level plugin without a second logger or observation owner. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

describe('ordinary storage telemetry', () => {
  it('preserves payloads, original errors, fixed org and one record for a retried public transaction', async () => {
    /** Observation stays installed in the real logger rather than on its frozen public facade. */
    const observer = new StorageLogObserver()
    /** The fixture reads the exact snapshots retained by its own observation plugin. */
    const entries = observer.entries
    const logger = createLogHost({ execution, plugins: [levelPlugin(), observer] })
    /** Every first endpoint shares the original once-per-org initializer. */
    const preparations = new Map<string, number>()
    await using host = await createStorageHost({
      plugins: [
        storageJournalPlugin(({ orgId }) => {
          preparations.set(orgId, (preparations.get(orgId) ?? 0) + 1)
          return { logger, namespace: 'telemetry', telemetry: true }
        }),
        memoryBackendPlugin()
      ]
    })
    try {
      const store = host.backend('memory')
      await store.set('key', 'before')
      await logger.flush()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        tag: 'storage',
        message: 'set',
        meta: {
          backend: 'memory',
          operation: 'set',
          keys: [lockKey.text('key')],
          outcome: 'success',
          payload: { key: 'key', value: 'before' }
        }
      })
      const payload = { nested: { visible: true } }
      await store.putRecord(payload, 'record')
      await logger.flush()
      expect((entries[1]!.meta!.payload as { value: unknown }).value).toBe(payload)
      entries.length = 0
      const entered = deferred<void>()
      const resume = deferred<void>()
      let calls = 0
      const pending = store.transaction(
        async (scope) => {
          calls++
          const value = await scope.get('key')
          if (calls === 1) {
            entered.resolve()
            await resume.promise
          }
          await scope.set('key', value + ':transaction')
        },
        { concurrency: ConcurrencyPolicy.optimistic({ retries: 1, backoffMs: 0 }) }
      )
      await entered.promise
      await store.set('key', 'concurrent')
      resume.resolve()
      await pending
      expect(calls).toBe(2)
      await logger.flush()
      const transactions = entries.filter((entry) => entry.message === 'transaction')
      expect(transactions).toHaveLength(1)
      expect(transactions[0]!.meta).toMatchObject({
        keys: [lockKey.text('key'), lockKey.bytes('key'), lockKey.record('key')],
        outcome: 'success'
      })
      expect(entries.map((entry) => entry.message)).toEqual(['set', 'transaction'])
      entries.length = 0
      const original = new RangeError('original public transaction failure')
      await expect(
        store.transaction(async (scope) => {
          await scope.get('key')
          throw original
        })
      ).rejects.toMatchObject({ cause: original })
      await logger.flush()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        tag: 'storage',
        meta: { outcome: 'error', code: expect.any(String) }
      })
      expect((entries[0]!.args[0] as Error).cause).toBe(original)
      entries.length = 0
      const orgId = createOrgId()
      const other = host.org(orgId).backend('memory')
      await other.transaction(async (scope) => {
        await scope.set('key', 'org')
      })
      await logger.flush()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.message).toBe('transaction')
      expect(entries[0]!.meta).toMatchObject({
        orgId,
        keys: [lockKey.text('key'), lockKey.bytes('key'), lockKey.record('key')]
      })
      const extracted = other.get
      expect(await extracted('key')).toBe('org')
      await logger.flush()
      expect(entries[1]!.meta!.orgId).toBe(orgId)
      expect(preparations.get(orgId)).toBe(1)
      entries.length = 0
      const readOrgId = createOrgId()
      const readOnly = host.org(readOrgId).backend('memory')
      expect(await readOnly.get('missing')).toBeNull()
      await logger.flush()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        message: 'get',
        meta: { orgId: readOrgId, keys: [lockKey.text('missing')], outcome: 'success' }
      })
      expect(preparations.get(readOrgId)).toBe(1)
    } finally {
      await logger.shutdown('manual')
    }
  })

  it('keeps telemetry disabled and contains a borrowed level capability failure', async () => {
    const logger = createLogHost({ execution, plugins: [levelPlugin()] })
    let calls = 0
    const borrowed = {
      atLevel: (...args: Parameters<typeof logger.atLevel>) => {
        calls++
        return logger.atLevel(...args)
      }
    }
    await using disabled = await createStorageHost({
      plugins: [
        storageJournalPlugin({ logger: borrowed, namespace: 'disabled' }),
        memoryBackendPlugin()
      ]
    })
    await disabled.backend('memory').set('key', 'value')
    expect(calls).toBe(0)
    /** A borrowed capability may fail even though the real log host itself never throws. */
    const original = new RangeError('borrowed telemetry capability failed')
    /** Preserve the real level methods while making its borrowed invocation failure explicit. */
    const failing = {
      ...logger,
      /** Keep storage's existing catch/report boundary observable with the exact original error. */
      atLevel() {
        throw original
      }
    }
    const reports: unknown[] = []
    await using enabled = await createStorageHost({
      plugins: [
        storageJournalPlugin({ logger: failing, namespace: 'enabled', telemetry: true }),
        memoryBackendPlugin()
      ],
      report: (error) => {
        reports.push(error)
      }
    })
    await logger.shutdown('manual')
    await expect(enabled.backend('memory').set('key', 'committed')).resolves.toBeUndefined()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toBe(original)
    expect(await disabled.backend('memory').get('key')).toBe('value')
  })
})
