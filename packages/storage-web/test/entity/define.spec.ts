import { describe, expect, it } from 'vitest'
import { defineEntity } from '../../src/entity'
import { memoryStorage } from '../../src/backends/memory'
import { StorageErrorCode } from '../../src/types/errors'
import { StorageContractErrorCode } from '@migaia/storage-contract'

describe('defineEntity runtime contract', () => {
  it('SWV2-T35 rejects direct indexed declarations at runtime', () => {
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'direct-indexed',
        key: 'id',
        indexes: { id: { path: 'id' } }
      } as never)
    ).toThrow(StorageErrorCode.invalidConfig)
  })

  it('SWV2-T15 snapshots indexes and rejects ambiguous or hostile declarations', () => {
    expect(() =>
      defineEntity<{ id: string; profile: { email: string } }>()({
        name: 'indexed-users',
        key: 'id',
        indexes: {
          email: { path: 'profile.email' },
          selector: { select: (value: { id: string }) => value.id, revision: 2 }
        }
      })
    ).not.toThrow()
    expect(() =>
      defineEntity<{ id: string }>()({
        name: 'ambiguous-index',
        key: 'id',
        indexes: { invalid: { path: 'id', select: (value: { id: string }) => value.id } as never }
      })
    ).toThrow(StorageErrorCode.invalidConfig)
    expect(() =>
      defineEntity<{ id: string }>()({
        name: 'unversioned-selector',
        key: 'id',
        indexes: { invalid: { select: (value: { id: string }) => value.id } as never }
      })
    ).toThrow(StorageErrorCode.invalidConfig)
    expect(() =>
      defineEntity<{ id: string }>()({
        name: 'hostile-index',
        key: 'id',
        indexes: Object.defineProperty({}, 'email', {
          enumerable: true,
          get: () => {
            throw new Error('hostile index getter')
          }
        })
      })
    ).toThrow(StorageErrorCode.invalidConfig)
  })
  it.each([
    ['', 'entity name must be non-empty'],
    ['__internal', 'entity name uses reserved prefix']
  ])('rejects reserved or empty name: %s', (name) => {
    expect(() => defineEntity<{ id: string }>({ name, key: 'id' })).toThrow(
      StorageErrorCode.invalidConfig
    )
  })

  it('rejects invalid version and incomplete migration graph', () => {
    expect(() => defineEntity({ name: 'null-version', key: 'id', version: null } as never)).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() =>
      defineEntity<{ id: string }>({ name: 'invalid-version', key: 'id', version: 0 })
    ).toThrow(StorageErrorCode.invalidConfig)
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'missing-migration',
        key: 'id',
        version: 3,
        migrations: { 2: async (value) => value }
      })
    ).toThrow(StorageErrorCode.invalidConfig)
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'unsafe-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER + 1
      })
    ).toThrow(StorageErrorCode.invalidConfig)
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'unsafe-migration-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER,
        migrations: { '9007199254740993': async (value: unknown) => value } as never
      })
    ).toThrow(StorageErrorCode.invalidConfig)
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'sparse-huge-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER,
        migrations: { 2: async (value: unknown) => value }
      })
    ).toThrow(StorageErrorCode.invalidConfig)
  })

  it('normalizes null, arrays, and primitive runtime definitions to INVALID_ARGUMENT', () => {
    for (const value of [null, undefined, [], 'entity', 42, true])
      expect(() => defineEntity(value as never)).toThrow(StorageErrorCode.invalidConfig)
  })

  it('normalizes invalid connected stores to INVALID_ARGUMENT', () => {
    const entity = defineEntity<{ id: string }>({ name: 'store-guard', key: 'id' })
    for (const store of [null, undefined, [], {}, { backend: 'memory' }])
      expect(() => entity.connect(store as never)).toThrow(StorageErrorCode.invalidConfig)
    expect(() => entity.connect(memoryStorage())).not.toThrow()
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
    expect(() => entity.connect(alienStore as never)).toThrow(StorageErrorCode.invalidConfig)
    expect(() =>
      entity.connect({
        ...alienStore,
        backend: 'memory',
        capabilities: { syncRead: 'yes' }
      } as never)
    ).toThrow(StorageErrorCode.invalidConfig)
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
    ).toThrow(StorageErrorCode.invalidConfig)
  })

  it('rejects malformed custom codecs at definition time', () => {
    const invalidCodecs = [null, [], {}, { name: 'codec' }, { name: 'codec', output: 'unknown' }]
    for (const codec of invalidCodecs)
      expect(() => defineEntity({ name: 'codec-guard', key: 'id', codec } as never)).toThrow(
        StorageContractErrorCode.invalidArgument
      )
    expect(() =>
      defineEntity<{ id: string }>({
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

  it('rejects malformed custom schemas at definition time', () => {
    const invalidSchemas = [null, [], {}, { name: 'schema' }, { name: 'schema', validate: true }]
    for (const schema of invalidSchemas)
      expect(() => defineEntity({ name: 'schema-guard', key: 'id', schema } as never)).toThrow(
        StorageErrorCode.invalidConfig
      )
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'valid-schema',
        key: 'id',
        schema: { name: 'valid', validate: async (value) => value as { id: string } }
      })
    ).not.toThrow()
  })

  it('definition、schema 与 migration 字段只读取一次', async () => {
    let optionReads = 0
    let schemaReads = 0
    let migrationReads = 0
    const schema = {
      get name() {
        schemaReads += 1
        return 'getter-schema'
      },
      get validate() {
        schemaReads += 1
        return async (value: unknown) => value as { id: string }
      },
      get encode() {
        schemaReads += 1
        return undefined
      },
      get decode() {
        schemaReads += 1
        return undefined
      },
      get normalize() {
        schemaReads += 1
        return undefined
      }
    }
    const migrations = Object.defineProperty({}, '2', {
      enumerable: true,
      get: () => {
        migrationReads += 1
        return async (value: unknown) => value
      }
    })
    const definition = defineEntity<{ id: string }>({
      get name() {
        optionReads += 1
        return 'getter-definition'
      },
      get key() {
        optionReads += 1
        return 'id' as const
      },
      get schema() {
        optionReads += 1
        return schema
      },
      get codec() {
        optionReads += 1
        return undefined
      },
      get version() {
        optionReads += 1
        return 2
      },
      get migrations() {
        optionReads += 1
        return migrations as never
      },
      get validateOnRead() {
        optionReads += 1
        return true
      },
      get onDiagnostic() {
        optionReads += 1
        return undefined
      },
      get defaultOrderBy() {
        optionReads += 1
        return undefined
      }
    })
    await definition.connect(memoryStorage()).put({ id: 'stable' })
    expect(optionReads).toBe(9)
    expect(schemaReads).toBe(5)
    expect(migrationReads).toBe(1)
  })

  it('rejects non-boolean validateOnRead at definition time', () => {
    for (const validateOnRead of [null, 'yes', 1, []])
      expect(() =>
        defineEntity({ name: 'validate-on-read-guard', key: 'id', validateOnRead } as never)
      ).toThrow(StorageErrorCode.invalidConfig)
  })

  it('rejects malformed migration containers at definition time', () => {
    for (const migrations of [null, [], 'migrations', 42])
      expect(() =>
        defineEntity({ name: 'migration-guard', key: 'id', version: 1, migrations } as never)
      ).toThrow(StorageErrorCode.invalidConfig)
  })

  it('does not satisfy migration continuity from the prototype chain', () => {
    const migrations = Object.create({ 2: async (value: unknown) => value }) as Record<
      number,
      (value: unknown) => Promise<unknown>
    >
    expect(() =>
      defineEntity({ name: 'prototype-migration', key: 'id', version: 2, migrations })
    ).toThrow(StorageErrorCode.invalidConfig)
  })

  it('freezes the returned definition', () => {
    const definition = defineEntity<{ id: string }>({ name: 'frozen', key: 'id' })
    expect(Object.isFrozen(definition)).toBe(true)
  })
})
