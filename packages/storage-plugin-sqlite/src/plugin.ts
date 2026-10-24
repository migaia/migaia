import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore,
  type IStorageJournalBackendBinding
} from '@migaia/storage-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ICapabilityInstallPort
} from '@migaia/storage-contract'
import { createSqliteStore, type ISqliteConstruction } from './store.js'
import { SqliteNames } from './constants.js'
import type {
  ISqliteStore,
  ISqliteDriver,
  ISqliteTransactionScope,
  ISqliteOptions
} from './types.js'
/** Exact kind identity gates Features before native client access or construction. */
export const sqliteBackendKind = defineStorageBackendKind<
  ISqliteStore,
  ISqliteDriver,
  { getTransactionClient(scope: ISqliteTransactionScope): ISqliteDriver }
>()(SqliteNames.backend)
/** Define an install-time SQLite backend; the injected connection remains caller-owned. */
export function sqliteBackendPlugin<
  TValue = unknown,
  const TId extends string = 'sqlite',
  const F extends IStorageFeatureRecord = {}
>(
  options: ISqliteOptions & { readonly id?: TId },
  features?: F &
    IStorageFeatureStoreCompatibility<typeof sqliteBackendKind, NoInfer<F>, ISqliteStore<TValue>>
): IStorageBackendPlugin<typeof sqliteBackendKind, NoInfer<TId>, F, ISqliteStore<TValue>> {
  /** Public option getters are captured once while the plugin definition remains pure. */
  const captured = {
    driver: options.driver,
    table: options.table,
    concurrency: options.concurrency,
    owner: options.owner,
    maxLockMs: options.maxLockMs,
    wal: options.wal
  }
  /** Literal default ids survive host-context inference. */
  const id = (options.id ?? SqliteNames.backend) as TId
  const descriptorFactory = (core: IStoragePluginCore<F>) => {
    /** Each actual host installation gets its own store/owner, never a module singleton. */
    let construction: ISqliteConstruction<TValue>
    /** Context redirects reuse the same organization constructor installed below. */
    let ensureOrg: (orgId: string) => void
    /** The existing physical organization constructor also supplies exact private journal ports. */
    let organization: (orgId: string) => ISqliteConstruction<TValue>
    return {
      kind: sqliteBackendKind,
      install() {
        construction = createSqliteStore<TValue>(captured, {
          core,
          orgId: core.defaultOrgId,
          ensureOrg: (orgId) => ensureOrg(orgId)
        })
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        /** Capture late construction authority after the root resource so children drain first. */
        const author = core.createOrgAuthoringPort()
        /**
         * Root remains the ordinary native endpoint; every explicit org receives its own scope
         * owner.
         */
        const organizations = new Map<string, ISqliteConstruction<TValue>>()
        /** Reuse the one physical connection, original limiter and already-created schema. */
        const forOrg = (orgId: string): ISqliteConstruction<TValue> => {
          construction.controller.assertLive()
          const existing = organizations.get(orgId)
          if (existing !== undefined) return existing
          const ports = core.getOrgContext(orgId)
          const child = construction.createOrg(orgId, { ...core, ...author, ...ports })
          author.registerChangeController(child.store, child.controller)
          organizations.set(orgId, child)
          return child
        }
        organization = forOrg
        ensureOrg = (orgId) => {
          forOrg(orgId)
        }
        core.registerOrgBinding(construction.store, {
          backend: (orgId) => forOrg(orgId).store,
          drop: (orgId) => forOrg(orgId).dropOrg()
        })
        core.registerFeatureClientResolver(construction.store, {
          getClient: (orgId) =>
            orgId === core.defaultOrgId ? construction.client : forOrg(orgId).client,
          getTransactionClient: (scope, orgId) => {
            /** Ordinary and explicit default-org scopes have distinct owners on the same client. */
            if (orgId === core.defaultOrgId) {
              try {
                return construction.getTransactionClient(scope as ISqliteTransactionScope)
              } catch (error) {
                /** Only an ownership mismatch can try the explicit default-org owner. */
                if (
                  !(error instanceof StorageContractError) ||
                  error.code !== StorageContractErrorCode.invalidArgument
                )
                  throw error
              }
            }
            return forOrg(orgId).getTransactionClient(scope as ISqliteTransactionScope)
          }
        })
        core.registerDetect(async (signal) => {
          if (signal.aborted) return
          captured.driver.prepare('SELECT 1').get()
        })
        return {}
      },
      journalBinding: () => {
        const binding = (orgId: string): IStorageJournalBackendBinding => ({
          ...(orgId === core.defaultOrgId ? construction : organization(orgId)).journal,
          forOrg: binding
        })
        return binding(core.defaultOrgId)
      },
      capabilityInstaller: (_store: ISqliteStore<TValue>): ICapabilityInstallPort =>
        construction.installer,
      featureExpose: () => ({
        getClient: () => construction.client,
        getTransactionClient: (scope: ISqliteTransactionScope) =>
          construction.getTransactionClient(scope)
      })
    }
  }
  return definePlugin<TId, typeof descriptorFactory, F>(id, descriptorFactory, features)
}
