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
import { createSqliteStore, type ISqliteConstruction } from './store.ts'
import { SqliteNames } from './constants.ts'
import type {
  ISqliteStore,
  ISqliteDriver,
  ISqliteTransactionScope,
  ISqliteOptions
} from './types.ts'
/** Exact kind identity gates Features before native client access or construction. */
export const sqliteBackendKind = defineStorageBackendKind<
  ISqliteStore,
  ISqliteDriver,
  { getTransactionClient(scope: ISqliteTransactionScope): ISqliteDriver }
>()(SqliteNames.backend)
/** One native installation owns its organization registry and exact provider authority. */
class SqliteInstallation<TValue, F extends IStorageFeatureRecord> {
  /** Captured deployment fields stay fixed while installation or later org creation can await. */
  readonly #options: ISqliteOptions
  /** Only the original installation window can register root and child resources. */
  readonly #core: IStoragePluginCore<F>
  /** Root construction retains the one physical connection, limiter and native layout. */
  #construction!: ISqliteConstruction<TValue>
  /** Late authoring authority ensures children drain before their original root resource. */
  #author!: ReturnType<IStoragePluginCore['createOrgAuthoringPort']>
  /** Explicit organization views retain one authentic transaction owner each. */
  readonly #organizations = new Map<string, ISqliteConstruction<TValue>>()
  /** Definition remains pure; native construction starts only from the own install port. */
  constructor(options: ISqliteOptions, core: IStoragePluginCore<F>) {
    this.#options = options
    this.#core = core
  }
  /** Reuse the original connection, admission limiter and schema for each authenticated route. */
  #organization(orgId: string): ISqliteConstruction<TValue> {
    this.#construction.controller.assertLive()
    const existing = this.#organizations.get(orgId)
    if (existing !== undefined) return existing
    const ports = this.#core.getOrgContext(orgId)
    const child = this.#construction.createOrg(orgId, { ...this.#core, ...this.#author, ...ports })
    this.#author.registerChangeController(child.store, child.controller)
    this.#organizations.set(orgId, child)
    return child
  }
  /** Borrow one native client only after authenticating the exact ordinary or explicit org owner. */
  #transactionClient(scope: object, orgId: string): ISqliteDriver {
    if (orgId === this.#core.defaultOrgId) {
      try {
        return this.#construction.getTransactionClient(scope as ISqliteTransactionScope)
      } catch (error) {
        if (
          !(error instanceof StorageContractError) ||
          error.code !== StorageContractErrorCode.invalidArgument
        )
          throw error
      }
    }
    return this.#organization(orgId).getTransactionClient(scope as ISqliteTransactionScope)
  }
  /** Every journal route borrows the same original organization construction. */
  #journalBinding(orgId: string): IStorageJournalBackendBinding {
    return {
      ...(orgId === this.#core.defaultOrgId ? this.#construction : this.#organization(orgId))
        .journal,
      forOrg: (current) => this.#journalBinding(current)
    }
  }
  /** Register native resources and organization authority in their original order. */
  #install() {
    this.#construction = createSqliteStore<TValue>(this.#options, {
      core: this.#core,
      orgId: this.#core.defaultOrgId,
      ensureOrg: (orgId) => {
        this.#organization(orgId)
      }
    })
    this.#core.registerStore(this.#construction.store)
    this.#core.registerChangeController(this.#construction.store, this.#construction.controller)
    this.#author = this.#core.createOrgAuthoringPort()
    this.#core.registerOrgBinding(this.#construction.store, {
      backend: (orgId) => this.#organization(orgId).store,
      drop: (orgId) => this.#organization(orgId).dropOrg()
    })
    this.#core.registerFeatureClientResolver(this.#construction.store, {
      getClient: (orgId) =>
        orgId === this.#core.defaultOrgId
          ? this.#construction.client
          : this.#organization(orgId).client,
      getTransactionClient: (scope, orgId) => this.#transactionClient(scope, orgId)
    })
    this.#core.registerDetect(async (signal) => {
      if (signal.aborted) return
      this.#options.driver.prepare('SELECT 1').get()
    })
    return {}
  }
  /** Plugin projection receives own callbacks; native class methods are invoked directly. */
  open() {
    return {
      kind: sqliteBackendKind,
      install: () => this.#install(),
      journalBinding: () => this.#journalBinding(this.#core.defaultOrgId),
      capabilityInstaller: (_store: ISqliteStore<TValue>): ICapabilityInstallPort =>
        this.#construction.installer,
      featureExpose: () => ({
        getClient: () => this.#construction.client,
        getTransactionClient: (scope: ISqliteTransactionScope) =>
          this.#construction.getTransactionClient(scope)
      })
    }
  }
}
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
  /** Deployment fields remain stable when installation is deferred after plugin definition. */
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
  const descriptorFactory = (core: IStoragePluginCore<F>) =>
    new SqliteInstallation<TValue, F>(captured, core).open()
  return definePlugin<TId, typeof descriptorFactory, F>(id, descriptorFactory, features)
}
