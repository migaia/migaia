import { asyncDisposeKey } from '@migaia/plugin-host'
import { walkErrorCauses } from '@migaia/utils/error'
import {
  entityHost as sourceEntityHost,
  memoryBackend as sourceMemoryBackend
} from '../helpers/memory.ts'
import { defineEntityPlugin as defineSourceEntityPlugin } from '../../src/entity.ts'
import { defineFeature } from '../../src/contracts.ts'
import { registerEntityUnit, entityUnitTarget } from '../../src/entity/assembly.ts'
import { EntityQueryOwner } from '../../src/entity/query-owner.ts'
import type { EntityRepositoryOwner } from '../../src/entity/repository.ts'
import { EntityFeatureName } from '../../src/entity/constants.ts'
import { entityQueryFeature as sourceEntityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityMigrationFeature as sourceEntityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityMigrationFeature } from '@migaia/storage-host/entity/features/migration'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineEntityPlugin } from '@migaia/storage-host/entity'
import { entityUniqueFeature } from '@migaia/storage-host/entity/features/unique'
import { entityQueryFeature } from '@migaia/storage-host/entity/features/query'
import { entityIndexesFeature } from '@migaia/storage-host/entity/features/indexes'
import { entityKeysetFeature } from '@migaia/storage-host/entity/features/keyset'
import {
  StorageHostErrorCode,
  STORAGE_HOST_ERROR_SOURCE
} from '@migaia/storage-contract/error-code'
import {
  createStorageHost,
  type IStorageBackendPluginHandle,
  type IStorageHost
} from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import { PluginHostErrorCode, PLUGIN_HOST_SOURCE } from '@migaia/plugin-host'
/** These public-entry cases keep one emitted package identity for host, transactions and entities. */
const hosts: Array<{ dispose(): Promise<void> }> = []
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.dispose()
})
/** Public-entry entity plugins stay with the same emitted storage wrapper identity. */
async function entityHost<const P extends readonly IStorageBackendPluginHandle[]>(
  ...plugins: P
): Promise<IStorageHost<P>> {
  /** This is an actual native installation, owned by the existing public-entry fixture cleanup. */
  const host = await createStorageHost({ plugins: plugins as never })
  hosts.push(host)
  return host as IStorageHost<P>
}
/** Exercise actual package exports without mixing their transaction identity with source fixtures. */
async function memoryBackend() {
  const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
  hosts.push(host)
  return host.backend('memory')
}

/** Business records keep the same fixture across basic and explicitly assembled repositories. */
type IRow = { id: string; group: string }

/** Every missing unit names its exact public migration entry before any backend work. */
function missing(name: string) {
  return {
    source: STORAGE_HOST_ERROR_SOURCE,
    code: StorageHostErrorCode.entityFeatureRequired,
    message: expect.stringContaining(`@migaia/storage-host/entity/${name}`)
  }
}

/** Native inspection must recognize the original opaque identities from every public unit. */
function nativeEntityFeatureIdentity(): void {
  /** Caller-owned aliases deliberately differ from the package-private role names. */
  const features = {
    reads: entityQueryFeature(),
    lookup: entityIndexesFeature(),
    constraints: entityUniqueFeature(),
    upgrades: entityMigrationFeature(),
    pages: entityKeysetFeature()
  }
  /** Native composition validates identity without evaluating an entity install hook. */
  const inspection = inspectFeatures(features)
  expect(inspection.roots).toEqual(features)
  expect(inspection.ordered).toHaveLength(5)
  /** Five roles are fixed by the record literal above, so membership assertions stay bounded. */
  for (const feature of Object.values(features)) {
    expect(inspection.ordered).toContain(feature)
    expect(Reflect.ownKeys(feature)).toEqual([])
    expect(Object.isFrozen(feature)).toBe(true)
  }
}

/** Reject the removed container and structural shapes before a backend is connected. */
function rejectsLegacyEntityFeatureShapes(): void {
  /** A copied opaque object loses the identity recorded by native definition ownership. */
  const feature = entityQueryFeature()
  /** These were reachable legacy forms; none can impersonate a native definition. */
  const values = [
    [feature],
    {
      old: {
        name: 'query',
        /** The removed custom factory shape must never run during admission. */
        create() {
          throw new Error('legacy create must not execute')
        }
      }
    },
    { copied: { ...feature } }
  ]
  for (const features of values)
    expect(() =>
      defineEntityPlugin<IRow>()('legacy-feature-shape', {
        name: 'legacy-feature-shape',
        key: 'id',
        features: features as never
      })
    ).toThrow(
      expect.objectContaining({
        source: STORAGE_HOST_ERROR_SOURCE,
        code: StorageHostErrorCode.invalidConfig,
        cause: expect.any(TypeError)
      })
    )
}

/** Distinct native identities with one role remain duplicates under unrelated caller aliases. */
async function rejectsDuplicateEntityFeatureRoles(): Promise<void> {
  /** Install this named declaration at the actual native admission boundary. */
  const admission2EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity2-2', {
    name: 'duplicate-role',
    key: 'id',
    features: { firstReader: entityQueryFeature(), secondReader: entityQueryFeature() }
  })
  /** Preserve the outer installation failure before inspecting its original native cause chain. */
  const failure = await entityHost(admission2EntityPlugin).catch((error: unknown) => error)
  expect(failure).toMatchObject({
    source: STORAGE_HOST_ERROR_SOURCE,
    code: StorageHostErrorCode.backendInstallFailed
  })
  expect(walkErrorCauses(failure)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.pluginInstallFailed
      }),
      expect.objectContaining({
        source: STORAGE_HOST_ERROR_SOURCE,
        code: StorageHostErrorCode.invalidConfig,
        cause: expect.any(TypeError)
      }),
      expect.any(TypeError)
    ])
  )
}

/** Reversing caller aliases preserves the complete existing migration/query/write workload. */
async function recordOrderPreservesEntityBehavior(): Promise<void> {
  /** Both declarations borrow the same owning backend while keeping separate namespaces. */
  const store = await memoryBackend()
  /** Forward and reverse records contain the same built-in roles with arbitrary caller keys. */
  const declarations = [
    {
      name: 'record-forward',
      features: {
        reads: entityQueryFeature(),
        lookup: entityIndexesFeature(),
        constraints: entityUniqueFeature(),
        upgrades: entityMigrationFeature(),
        pages: entityKeysetFeature()
      }
    },
    {
      name: 'record-reverse',
      features: {
        pages: entityKeysetFeature(),
        upgrades: entityMigrationFeature(),
        constraints: entityUniqueFeature(),
        lookup: entityIndexesFeature(),
        reads: entityQueryFeature()
      }
    }
  ]
  for (const { name, features } of declarations) {
    await store.putRecord({ version: 1, state: { id: 'a', group: 'old' } }, [name, 'a'])
    /** All runtime owners come from this declaration's native feature installation. */

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity3EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity3-3', {
      name,
      key: 'id',
      version: 2,
      features,
      indexes: { byGroup: { path: 'group', unique: true } },
      migrations: { 2: (state) => ({ ...(state as IRow), group: 'migrated' }) }
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity3EntityPluginHost = await entityHost(entity3EntityPlugin)
    const repository = entity3EntityPluginHost.extensions[entity3EntityPlugin.id](store)
    expect(await repository.migrate()).toMatchObject({ migrated: 1 })
    expect(await repository.query().index('byGroup', 'migrated').all()).toEqual([
      { id: 'a', group: 'migrated' }
    ])
    await repository.put({ id: 'b', group: 'two' })
    await expect(repository.put({ id: 'c', group: 'two' })).rejects.toMatchObject({
      code: StorageHostErrorCode.indexUniqueConflict
    })
    /** Cursor continuation retains the original query identity and canonical source fingerprint. */
    const query = repository.query()
    /** Pagination keeps its original cursor path after native unit assembly. */
    const first = await query.page(1)
    expect(first.items).toEqual([{ id: 'a', group: 'migrated' }])
    expect(await query.after(first.next!).all()).toEqual([{ id: 'b', group: 'two' }])
  }
}

it(
  'A2 recognizes all entity units as opaque native feature identities',
  nativeEntityFeatureIdentity
)
it(
  'A1/A2 rejects legacy arrays, custom shapes and copied native identities',
  rejectsLegacyEntityFeatureShapes
)
it('A3 rejects duplicate roles under distinct caller keys', rejectsDuplicateEntityFeatureRoles)
it(
  'A1/A4 preserves business behavior under reversed arbitrary record keys',
  recordOrderPreservesEntityBehavior
)

/** Count actual native installation separately from repository-local query owner construction. */
type IEntityFactoryCounts = { installs: number; repositories: number }

/** The installed output creates ordinary query owners and retains no repository context. */
class CountingQueryUnit {
  /** This test-owned counter records the two distinct lifecycle boundaries. */
  readonly #counts: IEntityFactoryCounts

  /** Borrow one counter shared by this explicit feature definition. */
  constructor(counts: IEntityFactoryCounts) {
    this.#counts = counts
  }

  /** Native installation publishes a factory without creating a repository owner. */
  install() {
    this.#counts.installs++
    return {
      create: (context: EntityRepositoryOwner<any, any, any, any, any>) => this.create(context)
    }
  }

  /** Every repository request receives a fresh original business owner. */
  create(context: EntityRepositoryOwner<any, any, any, any, any>) {
    this.#counts.repositories++
    return new EntityQueryOwner(context)
  }
}

/** Installing one declaration once must serve many repositories and remain isolated across hosts. */
async function nativeInstallationIsReused(): Promise<void> {
  /** Install and repository counts must not be conflated by a passing business query. */
  const counts: IEntityFactoryCounts = { installs: 0, repositories: 0 }
  /** This private seam observes the real native factory without replacing the plugin runtime. */
  const counter = new CountingQueryUnit(counts)
  /** Metadata is attached to the exact native definition consumed by the entity plugin. */
  const countedQuery = registerEntityUnit(
    defineFeature(entityUnitTarget, () => counter.install()),
    EntityFeatureName.query
  )
  /** A source-only seam keeps source metadata and source host identities together. */
  const countedEntityPlugin = defineSourceEntityPlugin<IRow>()('counted-entity', {
    name: 'counted-entity',
    key: 'id',
    features: { reads: countedQuery }
  })
  /** This genuine backend stays separately owned from both entity registrations. */
  const store = await sourceMemoryBackend()
  /** One host installation publishes the reusable factory output. */
  const firstHost = await sourceEntityHost(countedEntityPlugin)
  /** Two requests must create two repository owners without another native install. */
  const first = firstHost.extensions[countedEntityPlugin.id](store)
  const second = firstHost.extensions[countedEntityPlugin.id](store)
  expect(counts).toEqual({ installs: 1, repositories: 2 })
  await first.put({ id: 'a', group: 'original' })
  expect(await second.query().all()).toEqual([{ id: 'a', group: 'original' }])
  expect(counts).toEqual({ installs: 1, repositories: 2 })
  /** A separate native host gets its own install and lifetime for the same declaration. */
  const secondHost = await sourceEntityHost(countedEntityPlugin)
  /** The second registration reuses no repository-local state from the first registration. */
  const isolated = secondHost.extensions[countedEntityPlugin.id](store)
  expect(counts).toEqual({ installs: 2, repositories: 3 })
  await firstHost.unUse(countedEntityPlugin.id)
  expect(await isolated.get('a')).toEqual({ id: 'a', group: 'original' })
  /** Independent registration IDs admit two versions of one persisted entity namespace. */
  const upgradedEntityPlugin = defineSourceEntityPlugin<IRow>()('counted-entity-upgraded', {
    name: 'counted-entity',
    key: 'id',
    version: 2,
    features: { reads: sourceEntityQueryFeature(), upgrades: sourceEntityMigrationFeature() },
    migrations: { 2: (value) => ({ ...(value as IRow), group: 'upgraded' }) }
  })
  /** The original entity and its alternative version coexist in one actual host. */
  const versionsHost = await sourceEntityHost(countedEntityPlugin, upgradedEntityPlugin)
  expect(await versionsHost.extensions[countedEntityPlugin.id](store).get('a')).toEqual({
    id: 'a',
    group: 'original'
  })
  expect(await versionsHost.extensions[upgradedEntityPlugin.id](store).get('a')).toEqual({
    id: 'a',
    group: 'upgraded'
  })
}

/** Retained entry points expire with entity registration while the borrowed backend stays usable. */
async function entityRemovalRevokesRetainedWork(): Promise<void> {
  /** This independently owned backend must outlive entity removal and host disposal. */
  const store = await memoryBackend()
  /** Native disposal observations must not be replaced by an inferred resource count. */
  const closed = vi.spyOn(store, 'dispose')
  /** Entity namespace and native registration identity are independent public arguments. */
  const lifecycleEntityPlugin = defineEntityPlugin<IRow>()('lifecycle-entity', {
    name: 'lifecycle-entity',
    key: 'id',
    features: { reads: entityQueryFeature() }
  })
  /** The actual public entity host owns the native revocation signal. */
  const host = await entityHost(lifecycleEntityPlugin)
  /** Hold the repository and delayed source handles before the registration is removed. */
  const repository = host.extensions[lifecycleEntityPlugin.id](store)
  await repository.put({ id: 'a', group: 'one' })
  /** Any backend read after revocation would violate admission before source work. */
  const recordReads = vi.spyOn(store, 'getRecord')
  /** Delayed query streams must reject before opening their original record iterator. */
  const recordIterations = vi.spyOn(store, 'iterateRecords')
  /** These handles are valid before unUse and retained without starting their backend work. */
  const query = repository.query()
  const stream = repository.stream()
  await store.transaction(async (scope) => {
    /** This authentic bound view exists before the entity's signal is revoked. */
    const bound = repository.in(scope)
    /** Transaction queries must observe the same native signal as their bound repository view. */
    const boundQuery = bound.query()
    await host.unUse(lifecycleEntityPlugin.id)
    await expect(repository.get('a')).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(query.all()).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(stream.next()).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(bound.get('a')).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(boundQuery.all()).rejects.toMatchObject({ code: 'ABORTED' })
    await scope.set('entity-lifetime', 'backend-still-open')
  })
  expect(recordReads).not.toHaveBeenCalled()
  expect(recordIterations).not.toHaveBeenCalled()
  expect(closed).not.toHaveBeenCalled()
  expect(await store.get('entity-lifetime')).toBe('backend-still-open')
  /** Disposing another native host must revoke its retained handles independently. */
  const disposedHost = await entityHost(lifecycleEntityPlugin)
  const disposedRepository = disposedHost.extensions[lifecycleEntityPlugin.id](store)
  const disposedQuery = disposedRepository.query()
  const disposedStream = disposedRepository.stream()
  await disposedHost.dispose()
  await expect(disposedRepository.get('a')).rejects.toMatchObject({ code: 'ABORTED' })
  await expect(disposedQuery.all()).rejects.toMatchObject({ code: 'ABORTED' })
  await expect(disposedStream.next()).rejects.toMatchObject({ code: 'ABORTED' })
  expect(closed).not.toHaveBeenCalled()
  await store.set('entity-lifetime', 'still-independent')
  expect(await store.get('entity-lifetime')).toBe('still-independent')
}

it('A7 installs once, reuses factories and isolates host registrations', nativeInstallationIsReused)
it(
  'A8 revokes retained repositories and sources without closing the backend',
  entityRemovalRevokesRetainedWork
)

describe('explicit entity assembly', () => {
  it('keeps definition, connection and ordinary reads/writes usable without optional units', async () => {
    /** Omitted and empty declarations borrow the same store and must expose the same basic data. */
    const store = await memoryBackend()

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity4EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity4-4', {
      name: 'basic',
      key: 'id'
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity4EntityPluginHost = await entityHost(entity4EntityPlugin)
    const repository = entity4EntityPluginHost.extensions[entity4EntityPlugin.id](store)
    /** An explicit empty record installs no optional role. */

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity5EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity5-5', {
      name: 'basic',
      key: 'id',
      features: {}
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity5EntityPluginHost = await entityHost(entity5EntityPlugin)
    const empty = entity5EntityPluginHost.extensions[entity5EntityPlugin.id](store)
    await repository.put({ id: 'a', group: 'one' })
    expect(await repository.get('a')).toEqual({ id: 'a', group: 'one' })
    expect(await empty.get('a')).toEqual({ id: 'a', group: 'one' })
    expect(() => empty.query()).toThrow(expect.objectContaining(missing('query')))
    expect(() => repository.query()).toThrow(expect.objectContaining(missing('query')))
    expect(() => repository.migrate()).toThrow(expect.objectContaining(missing('migration')))
    await repository.remove('a')
    expect(await repository.get('a')).toBeUndefined()
  })

  it('query alone executes the existing where/select/all workload and rejects undeclared keyset/index use', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity6EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity6-6', {
      name: 'query-only',
      key: 'id',
      features: { query: entityQueryFeature() }
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity6EntityPluginHost = await entityHost(entity6EntityPlugin)
    const repository = entity6EntityPluginHost.extensions[entity6EntityPlugin.id](
      await memoryBackend()
    )
    await repository.put({ id: 'a', group: 'one' })
    expect(await repository.query().where('group', 'eq', 'one').select('id').all()).toEqual([
      { id: 'a' }
    ])
    expect(() => repository.query().index('missing' as never)).toThrow(
      expect.objectContaining(missing('indexes'))
    )
    await expect(repository.query().page(1)).rejects.toMatchObject(missing('keyset'))
  })

  it('migrates an older record through the public migration unit without enabling queries', async () => {
    const store = await memoryBackend()
    await store.putRecord({ version: 1, state: { id: 'a', group: 'one' } }, ['migration-only', 'a'])

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity7EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity7-7', {
      name: 'migration-only',
      key: 'id',
      version: 2,
      features: { migration: entityMigrationFeature() },
      migrations: { 2: (state) => ({ ...(state as IRow), group: 'migrated' }) }
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity7EntityPluginHost = await entityHost(entity7EntityPlugin)
    const repository = entity7EntityPluginHost.extensions[entity7EntityPlugin.id](store)
    expect(await repository.get('a')).toEqual({ id: 'a', group: 'migrated' })
    expect(() => repository.query()).toThrow(expect.objectContaining(missing('query')))
  })

  it('persists migration-only memory records across native batches without unique or query units', async () => {
    /** The basic public repository creates the original persisted version-one envelopes. */
    const store = await memoryBackend()

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity8EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity8-8', {
      name: 'persisted-migration-only',
      key: 'id'
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity8EntityPluginHost = await entityHost(entity8EntityPlugin)
    const original = entity8EntityPluginHost.extensions[entity8EntityPlugin.id](store)
    for (const id of ['a', 'b', 'c']) await original.put({ id, group: 'one' })
    /** Only migration is selected; two native batches must not resolve another optional owner. */

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity9EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity9-9', {
      name: 'persisted-migration-only',
      key: 'id',
      version: 2,
      features: { migration: entityMigrationFeature() },
      migrations: { 2: (state) => ({ ...(state as IRow), group: 'migrated' }) }
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity9EntityPluginHost = await entityHost(entity9EntityPlugin)
    const repository = entity9EntityPluginHost.extensions[entity9EntityPlugin.id](store)
    await expect(repository.migrate({ batchSize: 2 })).resolves.toEqual({
      scanned: 3,
      eligible: 3,
      migrated: 3,
      alreadyCurrent: 0,
      skipped: 0,
      conflicted: 0
    })
    /** Inspect persisted native envelopes so lazy read migration cannot satisfy this assertion. */
    const persisted: unknown[] = []
    for await (const [, envelope] of store.iterateRecords()) persisted.push(envelope)
    expect(persisted).toEqual(
      ['a', 'b', 'c'].map((id) => ({ version: 2, state: { id, group: 'migrated' } }))
    )
    expect(() => repository.query()).toThrow(expect.objectContaining(missing('query')))
  })

  it('still rejects a migration declaration with unique constraints but no unique unit', async () => {
    /** Install this named declaration at the actual native admission boundary. */
    const admission3EntityPlugin = defineEntityPlugin<IRow>()(
      'entity-assembly-spec-ts-entity10-10',
      {
        name: 'migration-missing-unique',
        key: 'id',
        version: 2,
        features: { migration: entityMigrationFeature(), indexes: entityIndexesFeature() },
        indexes: { group: { path: 'group', unique: true } },
        migrations: { 2: (state) => state }
      }
    )
    await expect(entityHost(admission3EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining(missing('unique'))])
    )
  })

  it('never hides a missing migration assembly behind the invalid-record skip policy', async () => {
    const store = await memoryBackend()
    await store.putRecord({ version: 2, state: { id: 'a', group: 'one' } }, ['query-version', 'a'])

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity11EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity11-11', {
      name: 'query-version',
      key: 'id',
      features: { query: entityQueryFeature() }
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity11EntityPluginHost = await entityHost(entity11EntityPlugin)
    const repository = entity11EntityPluginHost.extensions[entity11EntityPlugin.id](store)
    await expect(repository.query().all()).rejects.toMatchObject(missing('migration'))
    await expect(repository.list({ onInvalid: 'skip' })).rejects.toMatchObject(missing('migration'))
  })

  it('admits keyset only through its independent assembly and keeps the original cursor path', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity12EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity12-12', {
      name: 'keyset',
      key: 'id',
      features: { query: entityQueryFeature(), keyset: entityKeysetFeature() }
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity12EntityPluginHost = await entityHost(entity12EntityPlugin)
    const repository = entity12EntityPluginHost.extensions[entity12EntityPlugin.id](
      await memoryBackend()
    )
    await repository.put({ id: 'a', group: 'one' })
    await repository.put({ id: 'b', group: 'two' })
    const query = repository.query()
    const first = await query.page(1)
    expect(first.items).toEqual([{ id: 'a', group: 'one' }])
    expect(await query.after(first.next!).all()).toEqual([{ id: 'b', group: 'two' }])
  })

  it('enforces unique writes without installing index planning', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity13EntityPlugin = defineEntityPlugin<IRow>()('entity-assembly-spec-ts-entity13-13', {
      name: 'unique-only',
      key: 'id',
      features: { query: entityQueryFeature(), unique: entityUniqueFeature() },
      indexes: { group: { path: 'group', unique: true } }
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entity13EntityPluginHost = await entityHost(entity13EntityPlugin)
    const repository = entity13EntityPluginHost.extensions[entity13EntityPlugin.id](
      await memoryBackend()
    )
    await repository.put({ id: 'a', group: 'one' })
    await expect(repository.put({ id: 'b', group: 'one' })).rejects.toMatchObject({
      code: StorageHostErrorCode.indexUniqueConflict
    })
    expect(() => repository.query().index('group')).toThrow(
      expect.objectContaining(missing('indexes'))
    )
  })

  it('rejects missing declaration assemblies during entity installation', async () => {
    /** Install this named declaration at the actual native admission boundary. */
    const admission4EntityPlugin = defineEntityPlugin<IRow>()(
      'entity-assembly-spec-ts-entity14-14',
      {
        name: 'versions',
        key: 'id',
        version: 2,
        migrations: { 2: (value) => value }
      }
    )
    await expect(entityHost(admission4EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining(missing('migration'))])
    )
    /** Install this named declaration at the actual native admission boundary. */
    const admission5EntityPlugin = defineEntityPlugin<IRow>()(
      'entity-assembly-spec-ts-entity15-15',
      { name: 'indexed', key: 'id', indexes: { group: { path: 'group' } } }
    )
    await expect(entityHost(admission5EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining(missing('indexes'))])
    )
    /** Install this named declaration at the actual native admission boundary. */
    const admission6EntityPlugin = defineEntityPlugin<IRow>()(
      'entity-assembly-spec-ts-entity16-16',
      {
        name: 'unique',
        key: 'id',
        features: { indexes: entityIndexesFeature() },
        indexes: { group: { path: 'group', unique: true } }
      }
    )
    await expect(entityHost(admission6EntityPlugin).catch(walkErrorCauses)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining(missing('unique'))])
    )
  })
})

/** A retained non-transaction query stream exposes its resource protocol and closes on revocation. */
async function retainedQueryStreamProtocol(): Promise<void> {
  const store = await memoryBackend()
  const streamEntityPlugin = defineEntityPlugin<IRow>()('stream-protocol-entity', {
    name: 'stream-protocol-entity',
    key: 'id',
    features: { reads: entityQueryFeature() }
  })
  const host = await entityHost(streamEntityPlugin)
  const repository = host.extensions[streamEntityPlugin.id](store)
  await repository.put({ id: 'a', group: 'one' })
  await repository.put({ id: 'b', group: 'two' })
  /** Early return and both disposal forms reach the guarded original iterator. */
  const early = repository.query().stream()
  expect(await early.next()).toMatchObject({ done: false })
  await early.return?.(undefined)
  await early.dispose()
  await early[asyncDisposeKey]()
  /** Repository streams keep their own symbolic disposal channel. */
  const direct = repository.stream()
  await direct[asyncDisposeKey]()
  /** A stream opened before removal rejects every later advance and closes its source once. */
  const retained = repository.query().stream()
  expect(await retained.next()).toMatchObject({ done: false })
  await host.unUse(streamEntityPlugin.id)
  await expect(retained.next()).rejects.toMatchObject({ code: 'ABORTED' })
  await expect(retained.next()).rejects.toMatchObject({ code: 'ABORTED' })
  await store.dispose()
}

it(
  'A8 exposes the guarded stream protocol and closes it on revocation',
  retainedQueryStreamProtocol
)
