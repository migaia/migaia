import { entityQueryFeature } from '../../src/entity/query-feature.js'
import { entityUniqueFeature } from '../../src/entity/unique-feature.js'
import { entityMigrationFeature } from '../../src/entity/migration-feature.js'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.js'
import { entityKeysetFeature } from '../../src/entity/keyset.js'
import { describe, expect, it } from 'vitest'
import { defineEntity } from '../../src/entity.js'
import { memoryBackend } from '../helpers/memory.js'
import { StorageErrorCode } from '../../src/errors.js'
import { StorageContractErrorCode } from '@migaia/storage-contract'

describe('defineEntity runtime contract', () => {
  it('rejects direct indexed declarations at runtime', () => {
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'direct-indexed',
        key: 'id',
        indexes: { id: { path: 'id' } }
      } as never)
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
  })

  it('retains parsed indexes and rejects ambiguous declarations', () => {
    expect(() =>
      defineEntity<{ id: string; profile: { email: string } }>()({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'indexed-users',
        key: 'id',
        indexes: {
          email: { path: 'profile.email' },
          selector: {
            select: (value: { id: string }) => ({ kind: 'single' as const, key: value.id }),
            revision: 2
          }
        }
      })
    ).not.toThrow()
    expect(() =>
      defineEntity<{ id: string }>()({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'ambiguous-index',
        key: 'id',
        indexes: {
          invalid: {
            path: 'id',
            select: (value: { id: string }) => ({ kind: 'single' as const, key: value.id })
          } as never
        }
      })
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
    expect(() =>
      defineEntity<{ id: string }>()({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'unversioned-selector',
        key: 'id',
        indexes: {
          invalid: {
            select: (value: { id: string }) => ({ kind: 'single' as const, key: value.id })
          } as never
        }
      })
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
  })
  it.each([
    ['', 'entity name must be non-empty'],
    ['__internal', 'entity name uses reserved prefix']
  ])('rejects reserved or empty name: %s', (name) => {
    expect(() =>
      defineEntity<{ id: string }>({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name,
        key: 'id'
      })
    ).toThrow(StorageErrorCode.invalidConfig)
  })

  it('rejects invalid version and incomplete migration graph', () => {
    expect(() => defineEntity({ name: 'null-version', key: 'id', version: null } as never)).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() =>
      defineEntity<{ id: string }>({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'invalid-version',
        key: 'id',
        version: 0
      })
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
    expect(() =>
      defineEntity<{ id: string }>({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'missing-migration',
        key: 'id',
        version: 3,
        migrations: { 2: async (value) => value }
      })
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
    expect(() =>
      defineEntity<{ id: string }>({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'unsafe-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER + 1
      })
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
    expect(() =>
      defineEntity<{ id: string }>({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'unsafe-migration-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER,
        migrations: { '9007199254740993': async (value: unknown) => value } as never
      })
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
    expect(() =>
      defineEntity<{ id: string }>({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'sparse-huge-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER,
        migrations: { 2: async (value: unknown) => value }
      })
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
  })

  it('normalizes null, arrays, and primitive runtime definitions to INVALID_ARGUMENT', () => {
    for (const value of [null, undefined, [], 'entity', 42, true])
      expect(() => defineEntity(value as never)).toThrowError(
        expect.objectContaining({ code: StorageErrorCode.invalidConfig })
      )
  })

  it('normalizes invalid connected stores to INVALID_ARGUMENT', async () => {
    const entity = defineEntity<{ id: string }>({
      features: [
        entityQueryFeature(),
        entityUniqueFeature(),
        entityMigrationFeature(),
        entityIndexesFeature(),
        entityKeysetFeature()
      ],
      name: 'store-guard',
      key: 'id'
    })
    for (const store of [null, undefined, [], {}, { backend: 'memory' }])
      expect(() => entity.connect(store as never)).toThrowError(
        expect.objectContaining({ code: StorageErrorCode.invalidConfig })
      )
    const actual = await memoryBackend()
    expect(() => entity.connect(actual)).not.toThrow()
    const alienStore = {
      backend: 'alien',
      capabilities: {},
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined,
      dispose: async () => undefined
    }
    expect(() => entity.connect(alienStore as never)).toThrowError(
      expect.objectContaining({ code: StorageErrorCode.invalidConfig })
    )
    expect(() =>
      entity.connect({
        ...alienStore,
        backend: 'memory',
        capabilities: { syncRead: 'yes' }
      } as never)
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
    expect(() =>
      entity.connect({
        ...alienStore,
        backend: 'memory',
        capabilities: {
          syncRead: true,
          binary: false,
          records: false,
          transactions: false,
          iteration: false,
          opaqueEntries: false,
          maxValueBytes: 1.5
        }
      } as never)
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
  })

  it('rejects malformed custom codecs at definition time', () => {
    const invalidCodecs = [null, [], {}, { name: 'codec' }, { name: 'codec', output: 'unknown' }]
    for (const codec of invalidCodecs)
      expect(() => defineEntity({ name: 'codec-guard', key: 'id', codec } as never)).toThrow(
        StorageContractErrorCode.invalidArgument
      )
    expect(() =>
      defineEntity<{ id: string }>({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'valid-codec',
        key: 'id',
        codec: {
          name: 'valid',
          output: 'structured',
          encode: async (value) => value,
          decode: async (value) => value
        }
      })
    ).not.toThrow()
  })

  it('rejects malformed custom schemas and retains the original class receiver', async () => {
    const invalidSchemas = [null, [], {}, { name: 'schema' }, { name: 'schema', validate: true }]
    for (const schema of invalidSchemas)
      expect(() => defineEntity({ name: 'schema-guard', key: 'id', schema } as never)).toThrow(
        StorageErrorCode.invalidConfig
      )
    /** A legitimate private field proves definition admission borrows the original schema. */
    class ValidSchema {
      /** The selected domain field must be read on this original instance during validation. */
      readonly #key = 'id'
      /** The public schema label does not substitute for private receiver identity. */
      readonly name = 'valid'
      /** Return the admitted domain value through the original private-state receiver. */
      async validate(value: unknown): Promise<{ id: string }> {
        return { id: (value as Record<string, string>)[this.#key]! }
      }
    }
    const definition = defineEntity<{ id: string }>({
      features: [
        entityQueryFeature(),
        entityUniqueFeature(),
        entityMigrationFeature(),
        entityIndexesFeature(),
        entityKeysetFeature()
      ],
      name: 'valid-schema',
      key: 'id',
      schema: new ValidSchema()
    })
    await using store = await memoryBackend()
    const repository = definition.connect(store)
    await repository.put({ id: 'stable-schema' })
    await expect(repository.get('stable-schema')).resolves.toEqual({ id: 'stable-schema' })
  })

  it('rejects non-boolean validateOnRead at definition time', () => {
    for (const validateOnRead of [null, 'yes', 1, []])
      expect(() =>
        defineEntity({ name: 'validate-on-read-guard', key: 'id', validateOnRead } as never)
      ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
  })

  it('rejects malformed key, diagnostic, ordering, and schema contracts', () => {
    expect(() =>
      defineEntity({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'invalid-key',
        key: ''
      })
    ).toThrow(StorageErrorCode.invalidConfig)
    expect(() =>
      defineEntity({ name: 'invalid-diagnostic', key: 'id', onDiagnostic: 'warn' } as never)
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
    expect(() =>
      defineEntity({ name: 'invalid-order', key: 'id', defaultOrderBy: 'order' } as never)
    ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
    for (const field of ['encode', 'decode', 'normalize'])
      expect(() =>
        defineEntity({
          name: `invalid-schema-${field}`,
          key: 'id',
          schema: { name: 'schema', validate: async (value: unknown) => value, [field]: true }
        } as never)
      ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
  })

  it('rejects malformed migration containers at definition time', () => {
    for (const migrations of [null, [], 'migrations', 42])
      expect(() =>
        defineEntity({
          features: [entityMigrationFeature()],
          name: 'migration-guard',
          key: 'id',
          version: 1,
          migrations
        } as never)
      ).toThrowError(expect.objectContaining({ code: StorageErrorCode.invalidConfig }))
  })

  it('ignores prototype migration steps under the shared current-only plan', () => {
    const migrations = Object.create({ 2: async (value: unknown) => value }) as Record<
      number,
      (value: unknown) => Promise<unknown>
    >
    expect(() =>
      defineEntity({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
        name: 'prototype-migration',
        key: 'id',
        version: 2,
        migrations
      })
    ).not.toThrow()
  })
})
