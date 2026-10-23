import { describe, expect, it } from 'vitest'
import { StorageError, StorageErrorCode, lengthPrefixedNamespaceCodec } from '../src/index.js'
import { defineEntity } from '../src/entity.js'
import { fromStandardSchema } from '@migaia/storage-host/entity'
import { memoryStorageHost } from '../src/memory.js'
import { localStorageHost } from '../src/local-storage.js'
import { fakeWebStorage } from '../src/testing/fake-web-storage.js'

/** Follow only standard error links to prove the exact original instance remains reachable. */
const reaches = (error: unknown, original: unknown, seen = new Set<unknown>()): boolean => {
  if (error === original) return true
  if (error === null || typeof error !== 'object' || seen.has(error)) return false
  seen.add(error)
  /** Native cause/errors are the traceability contract, independently of storage metadata. */
  const links = error as { cause?: unknown; errors?: unknown[] }
  return (
    reaches(links.cause, original, seen) ||
    (Array.isArray(links.errors) && links.errors.some((value) => reaches(value, original, seen)))
  )
}

describe('storage-web audit medium severity regressions', () => {
  it('retains an extension StorageError itself and its custom message', async () => {
    /** The primary already owns a deeper cause; preserving only this leaf is insufficient. */
    const leaf = new Error('leaf')
    /** StorageError is frozen, so missing operation metadata requires a traceable wrapper. */
    const primary = new StorageError(
      StorageErrorCode.validationFailed,
      { cause: leaf },
      'application validation message'
    )
    /** Exercise the public schema-to-repository write path. */
    const store = memoryStorageHost()
    try {
      /** This is a supported throwing schema, not a forged backend. */
      const repo = defineEntity<{ id: string }>({
        name: 'audit-error-chain',
        key: 'id',
        schema: {
          name: 'throwing-schema',
          async validate() {
            throw primary
          }
        }
      }).connect(store)
      /**
       * Capture the failure for identity assertions without asserting an implementation wrapper
       * count.
       */
      const failure = await repo.put({ id: 'row' }).then(
        () => undefined,
        (error: unknown) => error
      )
      expect(failure).toMatchObject({
        source: '@migaia/storage-web',
        code: 'VALIDATION_FAILED',
        message: primary.message
      })
      expect(reaches(failure, primary)).toBe(true)
      expect(reaches(failure, leaf)).toBe(true)
    } finally {
      await store.dispose()
    }
  })

  it.each([undefined, {}])('rejects a missing complete v2 migration graph: %s', (migrations) => {
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'audit-graph',
        key: 'id',
        version: 2,
        ...(migrations === undefined ? {} : { migrations })
      })
    ).toThrowError(
      expect.objectContaining({ source: '@migaia/storage-web', code: 'INVALID_CONFIG' })
    )
  })

  it('classifies an asynchronous Standard Schema rejection and preserves its cause', async () => {
    /** A complete Standard Schema port is allowed to reject instead of returning issues. */
    const primary = new Error('validator rejected')
    /** The public adapter alone owns validation classification. */
    const schema = fromStandardSchema({
      '~standard': {
        version: 1,
        vendor: 'audit',
        async validate() {
          throw primary
        }
      }
    })
    await expect(schema.validate('input')).rejects.toMatchObject({
      source: '@migaia/storage-host',
      code: 'VALIDATION_FAILED',
      cause: primary
    })
  })

  it('skips malformed foreign physical keys while enumerating its own namespace', async () => {
    expect(lengthPrefixedNamespaceCodec.decode('app', 'sw1:3:%GG:foreign')).toBeUndefined()
    /** Reuse the existing complete RAM Storage port; no user persistence is touched. */
    const storage = fakeWebStorage()
    storage.setItem('sw1:3:%GG:foreign', 'foreign')
    /** The public backend must keep unrelated physical data from blocking its own keys. */
    const store = localStorageHost({ namespace: 'app', storage })
    try {
      store.sync.set('owned', 'value')
      expect(store.sync.keys()).toEqual(['owned'])
      expect(storage.getItem('sw1:3:%GG:foreign')).toBe('foreign')
    } finally {
      await store.dispose()
    }
  })
})
