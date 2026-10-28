import {
  createBackendChangeController,
  runTransactionOperation,
  assertTransactionOwner,
  provideCapabilities,
  createStorageOperationReporter
} from '@migaia/storage-host/sdk'
import type { IPgQuantizedOptions } from './features/quantized.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  implement,
  kv,
  records,
  ttl,
  counter,
  sql,
  vector,
  durableChangeFeed,
  type IOperationContext,
  type IStorageStore
} from '@migaia/storage-contract'
import type {
  IStoragePluginCore,
  IStorageBackendOrgContext,
  IStorageOrgBinding,
  IStorageJournalBackendBinding
} from '@migaia/storage-host'
import { snapshotPostgresOptions, postgresTables, ensurePostgresTables } from './schema.js'
import { probePostgres } from './probe.js'
import { createPgTransactions } from './transaction.js'
import { createPgChanges } from './changes.js'
import type { IPgReplicationSelection } from './logical-replication.js'
import type { IPgState } from './native.js'
import { PgNames } from './constants.js'
import { normalizePostgresError } from './errors.js'
import { PostgresErrorText } from './error-text.js'
import type {
  IPostgresStore,
  IPostgresOptions,
  IPostgresTransactionScope,
  IPgServer,
  IPgConnection
} from './types.js'
import {
  createPgOrgTtlApi,
  createPgOrgCounterApi,
  createPgOrgRecordsApi,
  createPgOrgJournalImages,
  createPgOrgVectorApi,
  createPgOrgDurableApi,
  createPgOrgJournal,
  pgOrgVectors,
  reportPgReplication
} from './store-apis.js'
import { createPgOrgBase } from './store-org-base.js'
import { createPgOrgScope } from './store-scope.js'
import {
  runPgRootOperation,
  observePgOrgOperation,
  recordsScope,
  ttlScope,
  counterScope
} from './store-state.js'
import type {
  IPgOrganizationContext,
  IPgScope,
  IPgStoreEnvironment,
  IPostgresConstruction
} from './store-state.js'

/** Borrow native execution only for the root route and outside an active journal. */
function runPgNative<T, R>(
  organization: IPgOrganizationContext<T>,
  scope: IPostgresTransactionScope | undefined,
  operation: string,
  ctx: IOperationContext | undefined,
  run: (client: IPgConnection, ctx: IOperationContext | undefined) => Promise<R>
): Promise<R> {
  return scope === undefined
    ? runPgRootOperation(
        organization,
        operation,
        ctx,
        () => ({}),
        (state) => {
          if (organization.orgView || organization.runtime.journal?.active())
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: PgNames.backend
            })
          return run(state.client, state.ctx)
        },
        undefined,
        true
      )
    : runTransactionOperation(scope as IPgScope<T>, (current) => {
        const state = organization.engine.stateFor(current)
        return observePgOrgOperation(organization, operation, current, () => {
          if (organization.orgView || organization.runtime.journal?.active())
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: PgNames.backend
            })
          return run(state.client, state.ctx)
        })
      })
}
/** Authenticate the original root store or one of its authentic native scopes. */
function assertPgNativeRoot<T>(organization: IPgOrganizationContext<T>, value: object): void {
  if (!organization.orgView && value === organization.store) return
  const binding = organization.environment.states.get(value)
  if (binding !== undefined) {
    assertTransactionOwner(binding.store, value)
    if (!organization.orgView && binding.store === organization.store) return
  }
  throw new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: PgNames.backend
  })
}

/** Assemble one fixed organization from named jobs without sharing lexical mutable state. */
function createPgOrganization<T>(
  environment: IPgStoreEnvironment,
  runtime: IStorageBackendOrgContext,
  orgView: boolean
): Omit<IPostgresConstruction<T>, 'configuration' | 'tables' | 'orgBinding' | 'journalBinding'> & {
  readonly journal: Omit<IStorageJournalBackendBinding, 'forOrg'>
} {
  const organization: IPgOrganizationContext<T> = {
    environment,
    runtime,
    orgView,
    store: undefined!,
    installer: undefined!,
    engine: undefined!,
    symbolic: undefined!,
    vectors: undefined!,
    vectorPublication: undefined!,
    durablePublication: undefined!,
    durableApi: undefined!,
    base: undefined!,
    ttlApi: undefined!,
    counterApi: undefined!,
    recordsApi: undefined!,
    journalImages: undefined!,
    journal: undefined!
  }
  organization.base = createPgOrgBase(organization)
  organization.ttlApi = createPgOrgTtlApi(organization)
  organization.counterApi = createPgOrgCounterApi(organization)
  organization.recordsApi = createPgOrgRecordsApi(organization)
  organization.journalImages = createPgOrgJournalImages(organization)
  organization.store = provideCapabilities(
    organization.base,
    [
      implement(kv, organization.base, { forTransaction: (scope) => scope }),
      implement(records, organization.recordsApi, {
        forTransaction: (scope) => (scope as IPgScope<T>)[recordsScope]
      }),
      implement(ttl, organization.ttlApi, {
        forTransaction: (scope) => (scope as IPgScope<T>)[ttlScope]
      }),
      implement(counter, organization.counterApi, {
        forTransaction: (scope) => (scope as IPgScope<T>)[counterScope]
      }),
      implement(
        sql,
        { sql: organization.base.sql },
        { forTransaction: (scope) => ({ sql: (scope as IPgScope<T>).sql }) }
      )
    ] as const,
    {
      onInstaller: (value) => {
        organization.installer = value
      }
    }
  ) as IPostgresStore<IPgServer, T>
  organization.engine = createPgTransactions({
    states: organization.environment.states,
    store: organization.store,
    configuration: organization.environment.configuration,
    tables: organization.environment.tables,
    runtime: organization.runtime,
    controller: organization.environment.controller,
    createScope: (_state: IPgState) => createPgOrgScope(organization, _state),
    publish: (state) => organization.environment.changes!.publish(state),
    journalCapture: (state) => organization.journalImages.capture(state),
    beforeCommit: (state) => organization.environment.changes!.beforeCommit(state),
    onIsolation: (isolationLevel) =>
      organization.environment.core.emit('onCapabilityProbe', () => ({
        backend: PgNames.backend,
        backendId: organization.environment.core.getBackendId(),
        orgId: organization.runtime.orgId,
        version: organization.environment.probe.version,
        isolationLevel,
        capabilities: organization.store.capabilities
      }))
  })
  if (organization.orgView && organization.environment.vectorSelected()) {
    organization.vectorPublication = organization.installer!.prepare([
      implement(vector, createPgOrgVectorApi(organization))
    ])
    organization.vectorPublication.publish()
  }
  if (organization.orgView && organization.environment.replicationSelected() !== undefined) {
    organization.durablePublication = organization.installer!.prepare([
      implement(durableChangeFeed, createPgOrgDurableApi(organization))
    ])
    organization.durablePublication.publish()
  }
  organization.journal = createPgOrgJournal(organization)
  return {
    journal: organization.journal,
    store: organization.store,
    installer: organization.installer!,
    controller: organization.environment.controller,
    createVectorApi: () => createPgOrgVectorApi(organization),
    dropVectorOrg: async (client, orgId) => {
      await pgOrgVectors(organization).dropOrg(client, orgId)
    },
    createDurableApi: () => createPgOrgDurableApi(organization),
    reportReplication: (facts) => reportPgReplication(organization, facts),
    releaseOrgCapabilities: () => {
      organization.vectorPublication?.release()
      organization.durablePublication?.release()
    },
    runNative: (scope, operation, ctx, run) =>
      runPgNative(organization, scope, operation, ctx, run),
    getTransactionClient: (scope) => {
      const binding = organization.environment.states.get(scope)
      assertTransactionOwner(binding?.store ?? organization.store, scope)
      return binding!.state.client
    },
    assertNativeRoot: (value) => assertPgNativeRoot(organization, value)
  }
}

/** One physical owner creates stable organization instances without per-org DDL. */
class PgOrganizationRegistry<T> implements IStorageOrgBinding {
  /** Shared layout, native controller and drivers remain owned by their original backend. */
  readonly #environment: IPgStoreEnvironment
  /** The default route is constructed once and shares the host's original installer. */
  readonly #root: ReturnType<typeof createPgOrganization<T>>
  /** Each immutable organization route retains exactly one provider table and transaction owner. */
  readonly #organizations = new Map<string, ReturnType<typeof createPgOrganization<T>>>()

  /** Construct the default organization after physical installation succeeds. */
  constructor(environment: IPgStoreEnvironment) {
    this.#environment = environment
    this.#root = createPgOrganization<T>(
      environment,
      environment.core.getOrgContext(environment.core.defaultOrgId),
      false
    )
  }
  /** Return the original default construction, preserving provider and resource identity. */
  get root(): ReturnType<typeof createPgOrganization<T>> {
    return this.#root
  }
  /** Resolve one host-authenticated org without registering another physical resource. */
  #organization(orgId: string): ReturnType<typeof createPgOrganization<T>> {
    let current = this.#organizations.get(orgId)
    if (current === undefined) {
      current = createPgOrganization<T>(
        this.#environment,
        this.#environment.core.getOrgContext(orgId),
        true
      )
      this.#organizations.set(orgId, current)
    }
    return current
  }
  /** Borrow the fixed org's store only while the original physical controller is live. */
  backend(orgId: string) {
    this.#environment.controller.assertLive()
    return this.#organization(orgId).store
  }
  /** Delete only the selected org using one original native transaction and vector owner. */
  async drop(orgId: string): Promise<void> {
    const client = await this.#environment.configuration.driver.connect()
    try {
      await client.query('BEGIN', [])
      for (const table of Object.values(this.#environment.tables).filter(
        (table) => table !== this.#environment.tables.vectorConfiguration
      ))
        await client.query('DELETE FROM ' + table + ' WHERE org_id=$1', [orgId])
      await this.#organization(orgId).dropVectorOrg(client, orgId)
      await client.query('COMMIT', [])
    } catch (cause) {
      try {
        await client.query('ROLLBACK', [])
      } catch (secondary) {
        throw normalizePostgresError(
          new AggregateError([cause, secondary], PostgresErrorText.sqlFailed)
        )
      }
      throw cause
    } finally {
      await client.dispose()
    }
  }
  /** Every journal route resolves the same original org and never caches another index. */
  journalBinding(orgId: string): IStorageJournalBackendBinding {
    return {
      forOrg: (current) => this.journalBinding(current),
      ...(orgId === this.#environment.core.defaultOrgId
        ? this.#root.journal
        : this.#organization(orgId).journal)
    }
  }
  /** Release child provider publications once the physical controller finishes disposal. */
  dispose(): void {
    for (const organization of this.#organizations.values()) organization.releaseOrgCapabilities()
    this.#organizations.clear()
  }
}

/** Backend construction probes actual facts before native DDL and borrows its injected driver. */
export async function createPostgresStore<T>(
  options: IPostgresOptions<IPgServer>,
  core: IStoragePluginCore,
  vectorSelected: () => boolean,
  replicationSelected: () => IPgReplicationSelection | undefined,
  quantizedSelected: () => IPgQuantizedOptions['mode'] | undefined
): Promise<IPostgresConstruction<T>> {
  /** Installation probes and DDL await; deployment metadata must stay fixed across that work. */
  const configuration = snapshotPostgresOptions(options)
  if (
    quantizedSelected() !== undefined &&
    (!vectorSelected() || configuration.server !== 'postgres')
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  const probe = await probePostgres(configuration)
  const tables = postgresTables(configuration, probe.maxIdentifierBytes)
  await ensurePostgresTables(configuration, tables)
  const report = createStorageOperationReporter()
  /**
   * Original native scope bindings share physical organization ownership without granting
   * authority.
   */
  const states = new WeakMap<object, { readonly store: IStorageStore; readonly state: IPgState }>()
  let changes: Awaited<ReturnType<typeof createPgChanges>> | undefined
  /** Logical organization closures release together with the original physical controller. */
  let releaseOrganizations = () => {}
  const controller = core.createChangeController(
    {
      backend: PgNames.backend,
      origin:
        PgNames.backend +
        ':' +
        String(
          (await configuration.driver.query('SELECT gen_random_uuid()::text AS origin', [])).rows[0]
            ?.origin
        ),
      finalize: async () => {
        try {
          await changes?.resource?.dispose()
        } finally {
          releaseOrganizations()
        }
      }
    },
    createBackendChangeController
  )
  try {
    if (configuration.server === 'postgres' && configuration.driver.listen === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: PgNames.backend
      })
    changes = await createPgChanges(configuration, controller)
    /** The registry owns root and child organization instances under this physical controller. */
    const environment: IPgStoreEnvironment = {
      configuration,
      core,
      probe,
      tables,
      report,
      states,
      controller,
      changes,
      vectorSelected,
      replicationSelected,
      quantizedSelected
    }
    const organizations = new PgOrganizationRegistry<T>(environment)
    const root = organizations.root
    releaseOrganizations = () => organizations.dispose()

    core.emit('onCapabilityProbe', () => ({
      backend: PgNames.backend,
      backendId: core.getBackendId(),
      orgId: core.defaultOrgId,
      version: probe.version,
      isolationLevel: probe.isolationLevel,
      capabilities: root.store.capabilities
    }))

    return {
      ...root,
      configuration,
      tables,
      orgBinding: organizations,
      journalBinding: organizations.journalBinding(core.defaultOrgId)
    }
  } catch (cause) {
    try {
      await controller.dispose()
    } catch (secondary) {
      throw normalizePostgresError(
        new AggregateError([cause, secondary], PostgresErrorText.sqlFailed)
      )
    }
    throw cause
  }
}
export type { IPostgresConstruction } from './store-state.js'
