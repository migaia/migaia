import {
  type IStorageBackendPlugin,
  type IStorageBackendType,
  type IStorageFeatureDefiner,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore,
  type IStorageBackendPluginDefiner
} from '@migaia/storage-host'
import { defineBackendPlugin, defineStorageFeature } from '@migaia/storage-host/sdk'
import type { ICapabilityInstallPort } from '@migaia/storage-contract'
import { createRedisStore, type IRedisConstruction } from './store.ts'
import type { IRedisOptions, IRedisStore } from './types.ts'
import type { IRedisDriver } from './driver.ts'
import { RedisText } from './constants.ts'

/** The Redis engine as a type: its Store and the borrowed native driver. */
export type IRedisBackend = IStorageBackendType<IRedisStore, IRedisDriver>
/** Defines this package's Features; the annotation carries the Redis backend type. */
export const defineRedisFeature: IStorageFeatureDefiner<IRedisBackend> = defineStorageFeature
/** One plugin installation owns the selected construction and borrowed driver metadata. */
class RedisInstallation<F extends IStorageFeatureRecord> {
  /** Captured deployment options remain stable until deferred installation. */
  readonly #options: IRedisOptions
  /** Existing host core owns registration, detection and close order. */
  readonly #core: IStoragePluginCore<F>
  /** Install creates exactly one construction borrowed by finite descriptor ports. */
  #construction!: IRedisConstruction
  /** Capture descriptor inputs without native work or another lifetime. */
  constructor(options: IRedisOptions, core: IStoragePluginCore<F>) {
    this.#options = options
    this.#core = core
  }
  /** Install remains an own port, preserving the host's existing finite descriptor shape. */
  readonly install = () => {
    this.#construction = createRedisStore(this.#options, this.#core)
    this.#core.registerStore(this.#construction.store)
    this.#core.registerChangeController(this.#construction.store, this.#construction.controller)
    this.#core.registerOrgBinding(this.#construction.store, this.#construction.orgBinding)
    this.#core.registerDetect(async (signal) => {
      if (!signal.aborted) await this.#construction.detect()
    })
    return {}
  }
  /** Journal selection borrows this exact native construction. */
  readonly journalBinding = (_store: IRedisStore) => this.#construction.journalBinding
  /** Publish through the original installer without another registry. */
  readonly capabilityInstaller = (_store: IRedisStore): ICapabilityInstallPort =>
    this.#construction.installer
  /** Features receive the original borrowed driver identity. */
  readonly featureExpose = () => ({ getClient: () => this.#options.driver })
}
/** Capture pure configuration; the original host alone owns detection, installation and cleanup. */
export function redisBackendPlugin<
  const TId extends string = 'redis',
  const F extends IStorageFeatureRecord = {}
>(
  options: IRedisOptions & {
    /** Plugin name and backend lookup key; `'redis'` when omitted. */
    readonly name?: TId
    /** Features installed on this backend. */
    readonly features?: F &
      IStorageFeatureStoreCompatibility<IRedisBackend, NoInfer<F>, IRedisStore>
  }
): IStorageBackendPlugin<IRedisBackend, NoInfer<TId>, F, IRedisStore> {
  const owner = options.owner,
    captured: IRedisOptions = {
      driver: options.driver,
      prefix: options.prefix,
      concurrency: options.concurrency,
      owner: owner === undefined ? undefined : { label: owner.label },
      maxLockMs: options.maxLockMs
    },
    id = (options.name ?? RedisText.backend) as TId
  return (defineBackendPlugin as IStorageBackendPluginDefiner<IRedisBackend>)<
    TId,
    (core: IStoragePluginCore<F>) => RedisInstallation<F>,
    F
  >({
    name: id,
    features: options.features as never,
    open: ((core: IStoragePluginCore<F>) => new RedisInstallation(captured, core)) as never
  })
}
