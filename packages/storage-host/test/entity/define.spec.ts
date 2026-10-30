import { walkErrorCauses } from '@migaia/utils/error'
import { entityHost } from '../helpers/memory.ts'
import { entityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityUniqueFeature } from '../../src/entity/unique-feature.ts'
import { entityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.ts'
import { entityKeysetFeature } from '../../src/entity/keyset.ts'
import { describe, expect, it } from 'vitest'
import { defineEntityPlugin } from '../../src/entity.ts'
import { memoryBackend } from '../helpers/memory.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageContractErrorCode } from '@migaia/storage-contract'

describe('defineEntityPlugin runtime contract', () => {
  it('rejects indexed declarations without the indexes role during installation', async () => {
    /** Install this named declaration at the actual native admission boundary. */
    const admission1EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-define-spec-ts-entity1-1',
      {
        name: 'direct-indexed',
        key: 'id',
        indexes: { id: { path: 'id' } }
      } as never
    )
    await expect(entityHost(admission1EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: StorageHostErrorCode.entityFeatureRequired })
      ])
    )
  })

  it('retains parsed indexes and rejects ambiguous declarations', async () => {
    /** Install this named declaration at the actual native admission boundary. */
    const admission2EntityPlugin = defineEntityPlugin<{ id: string; profile: { email: string } }>()(
      'entity-define-spec-ts-entity2-2',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'indexed-users',
        key: 'id',
        indexes: {
          email: { path: 'profile.email' },
          selector: {
            select: (value: { id: string }) => ({ kind: 'single' as const, key: value.id }),
            revision: 2
          }
        }
      }
    )
    await expect(entityHost(admission2EntityPlugin)).resolves.toBeDefined()
    /** Install this named declaration at the actual native admission boundary. */
    const admission3EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-define-spec-ts-entity3-3',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'ambiguous-index',
        key: 'id',
        indexes: {
          invalid: {
            path: 'id',
            select: (value: { id: string }) => ({ kind: 'single' as const, key: value.id })
          } as never
        }
      }
    )
    await expect(entityHost(admission3EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: StorageHostErrorCode.invalidConfig })
      ])
    )
    /** Install this named declaration at the actual native admission boundary. */
    const admission4EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-define-spec-ts-entity4-4',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'unversioned-selector',
        key: 'id',
        indexes: {
          invalid: {
            select: (value: { id: string }) => ({ kind: 'single' as const, key: value.id })
          } as never
        }
      }
    )
    await expect(entityHost(admission4EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: StorageHostErrorCode.invalidConfig })
      ])
    )
  })
  it.each([
    ['', 'entity name must be non-empty'],
    ['__internal', 'entity name uses reserved prefix']
  ])('rejects reserved or empty name: %s', (name) => {
    expect(() =>
      defineEntityPlugin<{ id: string }>()('entity-define-spec-ts-entity5-5', {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name,
        key: 'id'
      })
    ).toThrow(StorageHostErrorCode.invalidConfig)
  })

  it('rejects invalid version and incomplete migration graph', async () => {
    expect(() =>
      defineEntityPlugin('entity-define-spec-ts-entity6-6', {
        name: 'null-version',
        key: 'id',
        version: null
      } as never)
    ).toThrow(StorageHostErrorCode.invalidConfig)
    expect(() =>
      defineEntityPlugin<{ id: string }>()('entity-define-spec-ts-entity7-7', {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-version',
        key: 'id',
        version: 0
      })
    ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
    /** Install this named declaration at the actual native admission boundary. */
    const admission5EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-define-spec-ts-entity8-8',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'missing-migration',
        key: 'id',
        version: 3,
        migrations: { 2: async (value) => value }
      }
    )
    await expect(entityHost(admission5EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: StorageHostErrorCode.invalidConfig })
      ])
    )
    expect(() =>
      defineEntityPlugin<{ id: string }>()('entity-define-spec-ts-entity9-9', {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'unsafe-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER + 1
      })
    ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
    /** Install this named declaration at the actual native admission boundary. */
    const admission6EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-define-spec-ts-entity10-10',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'unsafe-migration-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER,
        migrations: { '9007199254740993': async (value: unknown) => value } as never
      }
    )
    await expect(entityHost(admission6EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: StorageHostErrorCode.invalidConfig })
      ])
    )
    /** Install this named declaration at the actual native admission boundary. */
    const admission7EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-define-spec-ts-entity11-11',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'sparse-huge-version',
        key: 'id',
        version: Number.MAX_SAFE_INTEGER,
        migrations: { 2: async (value: unknown) => value }
      }
    )
    await expect(entityHost(admission7EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: StorageHostErrorCode.invalidConfig })
      ])
    )
  })

  it('normalizes null, arrays, and primitive runtime definitions to INVALID_ARGUMENT', () => {
    for (const value of [null, undefined, [], 'entity', 42, true])
      expect(() =>
        defineEntityPlugin('entity-define-spec-ts-entity12-12', value as never)
      ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
  })

  it('normalizes invalid connected stores to INVALID_ARGUMENT', async () => {
    const entityEntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-define-spec-ts-entity-13',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'store-guard',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    for (const store of [null, undefined, [], {}, { backend: 'memory' }])
      expect(() =>
        entityEntityPluginHost.extensions[entityEntityPlugin.id](store as never)
      ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
    const actual = await memoryBackend()
    expect(() => entityEntityPluginHost.extensions[entityEntityPlugin.id](actual)).not.toThrow()
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
    expect(() =>
      entityEntityPluginHost.extensions[entityEntityPlugin.id](alienStore as never)
    ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
    expect(() =>
      entityEntityPluginHost.extensions[entityEntityPlugin.id]({
        ...alienStore,
        backend: 'memory',
        capabilities: { syncRead: 'yes' }
      } as never)
    ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
    expect(() =>
      entityEntityPluginHost.extensions[entityEntityPlugin.id]({
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
    ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
  })

  it('rejects malformed custom codecs at definition time', () => {
    const invalidCodecs = [null, [], {}, { name: 'codec' }, { name: 'codec', output: 'unknown' }]
    for (const codec of invalidCodecs)
      expect(() =>
        defineEntityPlugin('entity-define-spec-ts-entity14-14', {
          name: 'codec-guard',
          key: 'id',
          codec
        } as never)
      ).toThrow(StorageContractErrorCode.invalidArgument)
    expect(() =>
      defineEntityPlugin<{ id: string }>()('entity-define-spec-ts-entity15-15', {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
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
      expect(() =>
        defineEntityPlugin('entity-define-spec-ts-entity16-16', {
          name: 'schema-guard',
          key: 'id',
          schema
        } as never)
      ).toThrow(StorageHostErrorCode.invalidConfig)
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
    const definitionEntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-define-spec-ts-definition-17',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'valid-schema',
        key: 'id',
        schema: new ValidSchema()
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const definitionEntityPluginHost = await entityHost(definitionEntityPlugin)

    await using store = await memoryBackend()
    const repository = definitionEntityPluginHost.extensions[definitionEntityPlugin.id](store)
    await repository.put({ id: 'stable-schema' })
    await expect(repository.get('stable-schema')).resolves.toEqual({ id: 'stable-schema' })
  })

  it('rejects non-boolean validateOnRead at definition time', () => {
    for (const validateOnRead of [null, 'yes', 1, []])
      expect(() =>
        defineEntityPlugin('entity-define-spec-ts-entity18-18', {
          name: 'validate-on-read-guard',
          key: 'id',
          validateOnRead
        } as never)
      ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
  })

  it('rejects malformed key, diagnostic, ordering, and schema contracts', () => {
    expect(() =>
      defineEntityPlugin('entity-define-spec-ts-entity19-19', {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-key',
        key: ''
      })
    ).toThrow(StorageHostErrorCode.invalidConfig)
    expect(() =>
      defineEntityPlugin('entity-define-spec-ts-entity20-20', {
        name: 'invalid-diagnostic',
        key: 'id',
        onDiagnostic: 'warn'
      } as never)
    ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
    expect(() =>
      defineEntityPlugin('entity-define-spec-ts-entity21-21', {
        name: 'invalid-order',
        key: 'id',
        defaultOrderBy: 'order'
      } as never)
    ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
    for (const field of ['encode', 'decode', 'normalize'])
      expect(() =>
        defineEntityPlugin('entity-define-spec-ts-entity22-22', {
          name: `invalid-schema-${field}`,
          key: 'id',
          schema: { name: 'schema', validate: async (value: unknown) => value, [field]: true }
        } as never)
      ).toThrowError(expect.objectContaining({ code: StorageHostErrorCode.invalidConfig }))
  })

  it('rejects malformed migration containers during entity installation', async () => {
    for (const migrations of [null, [], 'migrations', 42]) {
      /** Install this named declaration at the actual native admission boundary. */
      const admission8EntityPlugin = defineEntityPlugin('entity-define-spec-ts-entity23-23', {
        features: { migration: entityMigrationFeature() },
        name: 'migration-guard',
        key: 'id',
        version: 1,
        migrations
      } as never)
      await expect(entityHost(admission8EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: StorageHostErrorCode.invalidConfig })
        ])
      )
    }
  })

  it('ignores prototype migration steps under the shared current-only plan', async () => {
    const migrations = Object.create({ 2: async (value: unknown) => value }) as Record<
      number,
      (value: unknown) => Promise<unknown>
    >
    /** Install this named declaration at the actual native admission boundary. */
    const admission9EntityPlugin = defineEntityPlugin('entity-define-spec-ts-entity24-24', {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'prototype-migration',
      key: 'id',
      version: 2,
      migrations
    })
    await expect(entityHost(admission9EntityPlugin)).resolves.toBeDefined()
  })
})
