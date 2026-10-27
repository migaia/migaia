// @vitest-environment node
import { locks } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Logger } from '@migaia/logger'
import { memoryLogStore, wal } from '@migaia/logger/plugins/durable'
import { kv } from '@migaia/storage-contract'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { decodeStorageJournalImage } from '@migaia/storage-host/authoring/backend'
import { storageJournalPlugin } from '@migaia/storage-host/journal'
import { cookieBackendPlugin } from '../../src/cookies.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'

afterEach(() => vi.unstubAllGlobals())

/** The actual logger index and native cookie semantics remain the only recovery participants. */
const createLogger = (store = memoryLogStore()) =>
  new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [wal({ store })]
  })

describe('visible-cookie redo', () => {
  it('recovers an ordered partial native assignment in the original fixed scope', async () => {
    vi.stubGlobal('navigator', { locks })
    const logger = createLogger()
    const document = fakeCookieDocument()
    const options = {
      document,
      namespace: 'cookie-redo',
      redo: true as const,
      scope: { path: '/cookies' }
    }
    const journal = { logger, namespace: 'cookies', redoWal: logger.wal }
    const host = await createStorageHost({
      plugins: [storageJournalPlugin(journal), cookieBackendPlugin(options)]
    })
    const original = Object.getOwnPropertyDescriptor(document, 'cookie')!.set!
    let writes = 0
    const failure = vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
      if (++writes === 2) throw new DOMException('cookie assignment failed', 'QuotaExceededError')
      Reflect.apply(original, document, [value])
    })
    try {
      await expect(
        host
          .backend('cookies')
          .use(kv)
          .setMany([
            { key: 'a', value: 'one' },
            { key: 'b', value: 'two' }
          ])
      ).rejects.toMatchObject({ code: 'JOURNAL_RECOVERY_FAILED' })
      expect(await logger.wal.pending()).toHaveLength(1)
      failure.mockRestore()
      await host.dispose()
      await using reopened = await createStorageHost({
        plugins: [storageJournalPlugin(journal), cookieBackendPlugin(options)]
      })
      const reads = vi.spyOn(document, 'cookie', 'get')
      expect(await reopened.backend('cookies').use(kv).getMany(['a', 'b', 'a'])).toEqual([
        'one',
        'two',
        'one'
      ])
      expect(reads).toHaveBeenCalledTimes(1)
      reads.mockRestore()
      await reopened.backend('cookies').transaction(async (scope) => {
        await scope.set('a', 'draft')
        expect(await scope.use(kv).get('a')).toBe('draft')
        await scope.remove('b')
      })
      expect(await reopened.backend('cookies').get('a')).toBe('draft')
      expect(await reopened.backend('cookies').get('b')).toBeNull()
      const org = reopened.org(createOrgId()).backend('cookies')
      await org.transaction((scope) => scope.set('a', 'foreign org'))
      expect(await org.get('a')).toBe('foreign org')
      expect(await reopened.backend('cookies').get('a')).toBe('draft')
      expect(await logger.wal.pending()).toHaveLength(0)
    } finally {
      failure.mockRestore()
      await host.dispose()
      await logger.shutdown('manual')
    }
  })

  it('persists relative expiry as an absolute image and never renews it during replay', async () => {
    vi.stubGlobal('navigator', { locks })
    const carrier = memoryLogStore()
    const logger = createLogger(carrier)
    const document = fakeCookieDocument()
    const options = { document, namespace: 'cookie-expiry', redo: true as const }
    const journal = { logger, namespace: 'cookies', redoWal: logger.wal }
    const host = await createStorageHost({
      plugins: [storageJournalPlugin(journal), cookieBackendPlugin(options)]
    })
    const fail = vi
      .spyOn(carrier, 'setState')
      .mockRejectedValueOnce(new RangeError('keep expiry intent pending'))
    let clock: ReturnType<typeof vi.spyOn> | undefined
    try {
      await expect(
        host.backend('cookies').set('expiring', 'value', { maxAge: 60, expires: new Date(0) })
      ).rejects.toMatchObject({ code: 'JOURNAL_RECOVERY_FAILED' })
      const pending = (await logger.wal.pending())[0]!
      const change = (
        pending.payload as { changes: Array<{ after: { present: true; value: string } }> }
      ).changes[0]!
      const image = decodeStorageJournalImage(change.after).value as {
        value: string
        expiresAt: number
      }
      expect(image.value).toBe('value')
      expect(image.expiresAt).toBeGreaterThan(Date.now())
      fail.mockRestore()
      await host.dispose()
      clock = vi.spyOn(Date, 'now').mockReturnValue(image.expiresAt + 1000)
      await using reopened = await createStorageHost({
        plugins: [storageJournalPlugin(journal), cookieBackendPlugin(options)]
      })
      expect(await reopened.backend('cookies').get('expiring')).toBeNull()
      expect(await logger.wal.pending()).toHaveLength(0)
    } finally {
      clock?.mockRestore()
      fail.mockRestore()
      await host.dispose()
      await logger.shutdown('manual')
    }
  })
})
