import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import type { ICapabilityInstallPort } from '@migaia/storage-contract'
import { createPostgresStore, type IPostgresConstruction } from './store.js'
import type {
  IPostgresStore,
  IPgDriver,
  IPostgresTransactionScope,
  IPostgresOptions,
  IPgServer,
  IPgConnection,
  IPgNativeOperation
} from './types.js'
import { PgNames } from './constants.js'
import type { IPgQuantizedOptions } from './features/quantized.js'
import type { IPgReplicationSelection } from './logical-replication.js'
/** Exact backend identity gates each selected Feature before any native client can be borrowed. */
export const postgresBackendKind = defineStorageBackendKind<
  IPostgresStore<IPgServer>,
  IPgDriver,
  {
    getTransactionClient(scope: IPostgresTransactionScope): IPgConnection
    readonly runNative: IPgNativeOperation
    selectVector(): void
    selectQuantized(mode: IPgQuantizedOptions['mode']): void
    selectReplication(options: IPgReplicationSelection): void
    getReplicationRoute(): import('./types.js').IPgLogicalReplicationRoute
    getServer(): IPgServer
    createDurableApi(): import('@migaia/storage-contract').IDurableChangeFeedApi
    reportReplication(maxSlotWalKeepSize: string): void
    assertNativeRoot(value: object): void
    createVectorApi(): import('@migaia/storage-contract').IVectorApi<true>
  }
>()(PgNames.backend)
/** Definition is pure; installation alone probes the real server and initializes native tables. */
export function postgresBackendPlugin<
  TValue = unknown,
  const TServer extends IPgServer = 'postgres',
  const TId extends string = 'postgres',
  const F extends IStorageFeatureRecord = {}
>(
  options: IPostgresOptions<TServer> & { readonly id?: TId },
  features?: F &
    IStorageFeatureStoreCompatibility<
      typeof postgresBackendKind,
      NoInfer<F>,
      IPostgresStore<NoInfer<TServer>, TValue>
    >
): IStorageBackendPlugin<
  typeof postgresBackendKind,
  NoInfer<TId>,
  F,
  IPostgresStore<NoInfer<TServer>, TValue>
> {
  const captured = {
    driver: options.driver,
    server: options.server,
    schema: options.schema,
    prefix: options.prefix,
    concurrency: options.concurrency,
    owner: options.owner,
    maxLockMs: options.maxLockMs
  }
  const id = (options.id ?? PgNames.backend) as TId
  const factory = (core: IStoragePluginCore<F>) => {
    let construction: IPostgresConstruction<TValue>
    /** Selection is captured once by the original Feature factory, before native installation. */
    let vectorSelected = false
    /** One selected mode belongs to the original Feature installation and every bound org. */
    let quantized: IPgQuantizedOptions['mode'] | undefined
    /** One selected Feature owns its resources; no organization replays that factory. */
    let replication: IPgReplicationSelection | undefined
    return {
      kind: postgresBackendKind,
      install: async () => {
        construction = await createPostgresStore<TValue>(
          captured,
          core,
          () => vectorSelected,
          () => replication,
          () => quantized
        )
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        core.registerOrgBinding(construction.store, construction.orgBinding)
        core.registerDetect(async (signal) => {
          if (signal.aborted) return
          await captured.driver.query('SELECT 1', [], { signal })
        })
        return {}
      },
      journalBinding: () => construction.journalBinding,
      capabilityInstaller: (_store: IPostgresStore<TServer, TValue>): ICapabilityInstallPort =>
        construction.installer,
      featureExpose: () => ({
        getClient: () => captured.driver,
        getTransactionClient: (scope: IPostgresTransactionScope) =>
          construction.getTransactionClient(scope),
        runNative: ((...args) => construction.runNative(...args)) satisfies IPgNativeOperation,
        selectVector: () => {
          vectorSelected = true
        },
        selectQuantized: (mode: IPgQuantizedOptions['mode']) => {
          quantized = mode
        },
        selectReplication: (options: IPgReplicationSelection) => {
          replication = options
        },
        getServer: () => construction.configuration.server,
        getReplicationRoute: () => ({
          schema: construction.configuration.schema,
          prefix: construction.configuration.prefix
        }),
        createDurableApi: () => construction.createDurableApi(),
        reportReplication: (maxSlotWalKeepSize: string) =>
          construction.reportReplication(maxSlotWalKeepSize),
        assertNativeRoot: (value: object) => construction.assertNativeRoot(value),
        createVectorApi: () => construction.createVectorApi()
      })
    }
  }
  return definePlugin<TId, typeof factory, F>(id, factory, features) as IStorageBackendPlugin<
    typeof postgresBackendKind,
    NoInfer<TId>,
    F,
    IPostgresStore<NoInfer<TServer>, TValue>
  >
}
