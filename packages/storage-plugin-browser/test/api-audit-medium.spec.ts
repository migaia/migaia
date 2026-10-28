import { entityTestFeatures } from './helpers/entity-features.ts'
import { describe, expect, it } from 'vitest'
import { lengthPrefixedNamespaceCodec } from '../src/index.ts'
import { StorageError } from '@migaia/storage-host'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { defineEntity } from '@migaia/storage-host/entity'
import { fromStandardSchema } from '@migaia/storage-host/entity'
import { createMemoryTestStore } from './helpers/installed-backends.ts'
import { createLocalTestStore } from './helpers/installed-backends.ts'
import { fakeWebStorage } from '../src/testing/fake-web-storage.ts'

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

describe('storage-plugin-browser audit medium severity regressions', () => {
  it('retains an extension StorageError itself and its custom message', async () => {
    /** The primary already owns a deeper cause; preserving only this leaf is insufficient. */
    const leaf = new Error('leaf')
    /** StorageError is frozen, so missing operation metadata requires a traceable wrapper. */
    const primary = new StorageError(
      StorageHostErrorCode.validationFailed,
      { cause: leaf },
      'application validation message'
    )
    /** Exercise the public schema-to-repository write path. */
    const store = await createMemoryTestStore()
    try {
      /** This is a supported throwing schema, not a forged backend. */
      const repo = defineEntity<{ id: string }>({
        features: entityTestFeatures,
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
        source: 'storage.host',
        code: 'VALIDATION_FAILED',
        message: primary.message
      })
      expect(reaches(failure, primary)).toBe(true)
      expect(reaches(failure, leaf)).toBe(true)
    } finally {
      await store.dispose()
    }
  })

  it.each([undefined, {}])('keeps a current-only v2 plan explicit: %s', async (migrations) => {
    const store = await createMemoryTestStore()
    const previous = defineEntity<{ id: string }>({
      features: entityTestFeatures,
      name: 'audit-graph',
      key: 'id'
    }).connect(store)
    await previous.put({ id: 'old' })
    const current = defineEntity<{ id: string }>({
      features: entityTestFeatures,
      name: 'audit-graph',
      key: 'id',
      version: 2,
      ...(migrations === undefined ? {} : { migrations })
    }).connect(store)
    await current.put({ id: 'current' })
    await expect(current.get('current')).resolves.toEqual({ id: 'current' })
    await expect(current.get('old')).rejects.toMatchObject({
      source: 'storage.host',
      code: 'VERSION_UNSUPPORTED'
    })
    await store.dispose()
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
      source: 'storage.host',
      code: 'VALIDATION_FAILED',
      cause: primary
    })
  })

  it('retains a moved schema failure owner through repository read staging', async () => {
    /** Toggle only the actual validator so a public write can seed the subsequent read. */
    let rejectValidation = false
    /** Preserve this exact validator failure through host and repository wrappers. */
    const primary = new Error('read validator rejected')
    /** The moved adapter remains the error owner through the same host repository boundary. */
    const schema = fromStandardSchema<{ id: string }>({
      '~standard': {
        version: 1,
        vendor: 'moved-schema',
        async validate(value) {
          if (rejectValidation) throw primary
          return { value: value as { id: string } }
        }
      }
    })
    /** Drive the existing public storage and entity entries instead of internal staging helpers. */
    const store = await createMemoryTestStore()
    try {
      /** Reads must preserve the host error, its stage and the original validator cause. */
      const repository = defineEntity({
        features: entityTestFeatures,
        name: 'moved-schema',
        key: 'id',
        schema
      }).connect(store)
      await repository.put({ id: 'row' })
      rejectValidation = true
      /** The cause graph must retain the exact original rejection after stage enrichment. */
      const failure = await repository.get('row').then(
        () => undefined,
        (error: unknown) => error
      )
      expect(failure).toMatchObject({
        source: 'storage.host',
        code: 'VALIDATION_FAILED',
        stage: 'validate',
        extensionStage: 'schema'
      })
      expect(reaches(failure, primary)).toBe(true)
    } finally {
      await store.dispose()
    }
  })

  it('skips malformed foreign physical keys while enumerating its own namespace', async () => {
    expect(lengthPrefixedNamespaceCodec.decode('app', 'sw1:3:%GG:foreign')).toBeUndefined()
    /** Reuse the existing complete RAM Storage port; no user persistence is touched. */
    const storage = fakeWebStorage()
    storage.setItem('sw1:3:%GG:foreign', 'foreign')
    /** The public backend must keep unrelated physical data from blocking its own keys. */
    const store = await createLocalTestStore({ namespace: 'app', storage })
    try {
      store.sync.set('owned', 'value')
      expect(store.sync.keys()).toEqual(['owned'])
      expect(storage.getItem('sw1:3:%GG:foreign')).toBe('foreign')
    } finally {
      await store.dispose()
    }
  })
})
