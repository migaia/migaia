import type { IBackendStageBindings } from '@migaia/storage-contract'
import type { IStorageHooks } from './hook-types.js'
import type { IStorageHookEmitter } from './hooks.js'
import { assimilateCapturedThen } from '@migaia/utils/function'
import {
  defineFeature as defineNativeFeature,
  definePlugin as defineNativePlugin,
  type IPluginHostCore,
  type IFeatureRecord
} from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IStorageBase } from '@migaia/storage-contract'
import type { IScheduler } from '@migaia/utils/scheduler'
import { createStorageTypeError, StorageErrorCode } from './errors.js'
import { installStorageFeatures, type IStorageFeatureProjection } from './feature-install.js'
import { pluginNameFromBackendId } from './names.js'
import { STORAGE_DESCRIPTOR_METADATA, STORAGE_RESERVED_EXPOSE } from './state-constants.js'
import { StorageErrorText } from './error-text.js'
import type {
  IStorageBackendKind,
  IStorageDefinePlugin,
  IStorageDefineFeature,
  IStoragePluginCore,
  IStorageFeatureExpose,
  IStorageExecutionPort,
  IStoragePipelineInput,
  IStorageNativePluginDescriptor
} from './types.js'
/** Authentic kind objects are local identities, never diagnostic names or public type brands. */
const kinds = new WeakSet<object>()
/** Defined storage Features retain their required kind identities without a second Feature system. */
const featureTargets = new WeakMap<object, readonly object[]>()
/** Handles resolve to one original native definition; installation state remains PluginHost-owned. */
const nativePluginDefinitions = new WeakMap<object, object>()
/** Immutable definition metadata contains no store, driver or registration lifetime. */
const nativePluginMetadata = new WeakMap<object, { readonly id: string }>()
/** Storage's private additions attached only after a native hook observes the caller output. */
type IStorageNativeProjectionFields = Readonly<Record<PropertyKey, unknown>>

/**
 * Projects caller-owned data descriptors with Storage-owned fields without probing caller values.
 * PluginHost remains responsible for one real `then` read, validation, and rejection containment.
 */
const createNativeDataProjection = (
  value: unknown,
  fields: IStorageNativeProjectionFields,
  preserveMethodReceiver = false
): unknown => {
  if (value === null || typeof value !== 'object') return value
  /** Empty target keeps Proxy invariants independent of frozen caller-owned output. */
  const target = Object.create(null)
  return new Proxy(target, {
    getPrototypeOf: () => Object.getPrototypeOf(value),
    get: (_target, key) => {
      /** Native owns the one observable property read, including hostile dynamic `then` getters. */
      const result = Reflect.get(value, key, value)
      if (key !== 'then' || typeof result !== 'function') return result
      return (resolve: (output: unknown) => void, reject: (error: unknown) => void): void => {
        void assimilateCapturedThen(result, value).then(resolve, reject)
      }
    },
    ownKeys: () => [...new Set([...Reflect.ownKeys(value), ...Reflect.ownKeys(fields)])],
    getOwnPropertyDescriptor: (_target, key) => {
      /**
       * Caller descriptors always win so native validation observes their exact data/accessor
       * shape.
       */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor !== undefined) {
        if (
          preserveMethodReceiver &&
          key !== 'then' &&
          'value' in descriptor &&
          typeof descriptor.value === 'function'
        ) {
          return {
            ...descriptor,
            value: (...args: unknown[]) => Reflect.apply(descriptor.value, value, args),
            configurable: true
          }
        }
        return { ...descriptor, configurable: true }
      }
      /** Storage-private fields fill only keys absent from the caller output. */
      const field = Object.getOwnPropertyDescriptor(fields, key)
      return field === undefined ? undefined : { ...field, configurable: true }
    }
  })
}

/** Maps a caller descriptor hook only after PluginHost has observed its own data descriptor. */
type IStorageDescriptorHook = (() => unknown) | undefined

/** Storage-owned hooks supplied by the transparent descriptor projection. */
type IStorageDescriptorHooks = Readonly<{
  readonly install: (hook: IStorageDescriptorHook) => () => unknown
  readonly featureExpose: (hook: IStorageDescriptorHook) => () => unknown
}>

/**
 * Preserves the caller descriptor's real shape for PluginHost, replacing only admitted hook data
 * functions with Storage's existing registration bridges.
 */
const createNativeDescriptorProjection = (
  value: unknown,
  hooks: IStorageDescriptorHooks
): unknown => {
  if (value === null || typeof value !== 'object') return value
  /** Empty target permits projection of frozen or non-configurable caller descriptors. */
  const target = Object.create(null)
  /** These are the only descriptor hooks Storage bridges into its existing registration closure. */
  const hookNames = new Set<string>(['install', 'featureExpose'])
  return new Proxy(target, {
    getPrototypeOf: () => Object.getPrototypeOf(value),
    get: (_target, key) => {
      /** A real source read preserves dynamic thenable detection and its original receiver. */
      const result = Reflect.get(value, key, value)
      if (key !== 'then' || typeof result !== 'function') return result
      return (resolve: (output: unknown) => void, reject: (error: unknown) => void): void => {
        void assimilateCapturedThen(result, value).then(resolve, reject)
      }
    },
    ownKeys: () => [
      ...new Set([
        ...Reflect.ownKeys(value).filter(
          (key) => !STORAGE_DESCRIPTOR_METADATA.some((field) => field === key)
        ),
        ...hookNames
      ])
    ],
    getOwnPropertyDescriptor: (_target, key) => {
      /** Native inspects the source descriptor once before any Storage bridge can execute it. */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        typeof key === 'string' &&
        hookNames.has(key) &&
        (descriptor === undefined ||
          ('value' in descriptor && typeof descriptor.value === 'function'))
      ) {
        return {
          value: hooks[key as keyof IStorageDescriptorHooks](
            descriptor?.value as IStorageDescriptorHook
          ),
          enumerable: descriptor?.enumerable ?? true,
          configurable: true,
          writable: true
        }
      }
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true }
    }
  })
}

/** Define a diagnostic kind token whose exact object identity is checked during installation. */
export function defineStorageBackendKind<
  S extends IStorageBase,
  C = undefined,
  E extends object = {}
>(): <const N extends string>(name: N) => IStorageBackendKind<N, S, C, E> {
  return <const N extends string>(name: N): IStorageBackendKind<N, S, C, E> => {
    assertStorageBackendId(name)
    /** Capture this registration kind before backend construction or publication. */
    const kind = Object.freeze({ name })
    kinds.add(kind)
    return kind as IStorageBackendKind<N, S, C, E>
  }
}
/** Reject a forged target before any Feature factory or native driver can run. */
function requireTargets(target: unknown): readonly object[] {
  /** Retain the complete accepted target set for this definition. */
  const selected = Array.isArray(target) ? target : [target]
  if (
    selected.length === 0 ||
    selected.some((kind) => typeof kind !== 'object' || kind === null || !kinds.has(kind))
  )
    throw createStorageTypeError(
      StorageErrorCode.backendKindMismatch,
      StorageErrorText.backendKindMismatch
    )
  return Object.freeze([...selected])
}
/** Storage annotates original native Feature identities; PluginHost still compiles their graph. */
export const defineFeature: IStorageDefineFeature = ((
  target: unknown,
  factory: Function,
  dependencies?: IFeatureRecord
) => {
  /** Retain the complete accepted target set for this definition. */
  const selected = requireTargets(target)
  for (const dependency of Object.values(dependencies ?? {})) {
    /** Read private Feature identity metadata instead of public type fields. */
    const expected = featureTargets.get(dependency)
    if (expected === undefined || selected.some((kind) => !expected.includes(kind)))
      throw createStorageTypeError(
        StorageErrorCode.backendKindMismatch,
        StorageErrorText.backendKindMismatch
      )
  }
  /** Retain the actual native Feature identity used by the dependency owner. */
  const feature = defineNativeFeature(factory as never, dependencies as never)
  featureTargets.set(feature, selected)
  return feature
}) as unknown as IStorageDefineFeature
/** Installation-local native additions come from the original facade, never public object fields. */
type IStorageNativeCore = IPluginHostCore<IStoragePipelineInput> & {
  setStorageRegistrationCore(core: object): void
  runStorageInstall<T>(operation: () => Promise<T>): Promise<T>
  isStorageInstallExpired(): boolean
  registerStore(store: IStorageBase): void
  getStore(): IStorageBase
  getBackendId(): string
  getScheduler(): IScheduler
  setStorageKind(kind: IStorageBackendKind | undefined): void
  readonly features: Readonly<Record<string, object>>
  readonly featureExpose: object
  readonly execution: IStorageExecutionPort
  getStageBindings(): IBackendStageBindings
  getStorageHooks(): IStorageHooks
  readonly emit: IStorageHookEmitter
  readonly createKeyLockPort: IStoragePluginCore['createKeyLockPort']
  readonly createTransactionApi: IStoragePluginCore['createTransactionApi']
  readonly getChainMethods: IStoragePluginCore['getChainMethods']
  setStorageFeatureProjection(projection: IStorageFeatureProjection | undefined): void
  readonly defaultOrgId: string
  readonly createRevisionPort: IStoragePluginCore['createRevisionPort']
  readonly createChangeController: IStoragePluginCore['createChangeController']
  readonly registerChangeController: IStoragePluginCore['registerChangeController']
  readonly getChangeController: IStorageFeatureExpose<IStorageBackendKind>['getChangeController']
  readonly getPublishedBackend: IStoragePluginCore['getPublishedBackend']
  readonly registerDetect: IStoragePluginCore['registerDetect']
}
/** Define one native plugin while preserving the original descriptor snapshot and install ownership. */
export const definePlugin: IStorageDefinePlugin = ((
  name: string,
  descriptorFactory: (core: IStoragePluginCore) => IStorageNativePluginDescriptor,
  features?: IFeatureRecord
) => {
  assertStorageBackendId(name)
  /** Inspect the existing native dependency closure for target compatibility. */
  const plan = features === undefined ? undefined : inspectFeatures(features)
  /** The original PluginHost definition remains the registration and lifecycle owner. */
  const definition = defineNativePlugin(
    pluginNameFromBackendId(name),
    (core) => {
      /** Only the facade-issued native core can supply registration authority. */
      const nativeCore = core as unknown as IStorageNativeCore
      nativeCore.setStorageRegistrationCore(core)
      /** Only the original install hook can transfer a completed store. */
      let transferActive = false
      /** A registration transfers ownership of its exact store at most once. */
      let transferred = false
      /** A late store may be cleaned up once after installation expiry. */
      let expiredTransferConsumed = false
      /** Forward original capabilities without exposing host mutation authority. */
      const storageCore = {
        get operation() {
          return nativeCore.operation
        },
        get lifecycle() {
          return nativeCore.lifecycle
        },
        onDispose: nativeCore.onDispose,
        usePipeline: nativeCore.usePipeline,
        useAsyncPipeline: nativeCore.useAsyncPipeline,
        get defaultOrgId() {
          return nativeCore.defaultOrgId
        },
        execution: nativeCore.execution,
        get hooks() {
          return nativeCore.getStorageHooks()
        },
        get stageBindings() {
          return nativeCore.getStageBindings()
        },
        emit: nativeCore.emit,
        createKeyLockPort: nativeCore.createKeyLockPort,
        createTransactionApi: nativeCore.createTransactionApi,
        getChainMethods: nativeCore.getChainMethods,
        createRevisionPort: nativeCore.createRevisionPort,
        createChangeController: nativeCore.createChangeController,
        registerChangeController: nativeCore.registerChangeController,
        getPublishedBackend: nativeCore.getPublishedBackend,
        registerDetect: nativeCore.registerDetect,
        registerStore: (store: IStorageBase) => {
          if (transferred)
            throw createStorageTypeError(
              StorageErrorCode.backendPluginInvalid,
              StorageErrorText.backendPluginInvalid
            )
          if (!transferActive) {
            if (nativeCore.isStorageInstallExpired() && !expiredTransferConsumed) {
              expiredTransferConsumed = true
              nativeCore.registerStore(store)
            }
            throw createStorageTypeError(
              StorageErrorCode.backendPluginInvalid,
              StorageErrorText.backendPluginInvalid
            )
          }
          nativeCore.registerStore(store)
          transferred = true
        },
        getStore: () => nativeCore.getStore(),
        getBackendId: () => nativeCore.getBackendId(),
        get features() {
          return nativeCore.features
        },
        get featureExpose() {
          return nativeCore.featureExpose
        }
      } as unknown as IStoragePluginCore
      /** Let the native snapshot validate the caller descriptor after its factory runs. */
      const descriptor = descriptorFactory(storageCore)
      /** Snapshot author-only fields once before running install or exposing native capabilities. */
      const metadata: Record<string, unknown> = Object.create(null)
      for (const key of STORAGE_DESCRIPTOR_METADATA) {
        /** Snapshot author metadata before the native closed descriptor boundary. */
        const property = Object.getOwnPropertyDescriptor(descriptor, key)
        if (
          property !== undefined &&
          (!('value' in property) || (key !== 'kind' && typeof property.value !== 'function'))
        )
          throw createStorageTypeError(
            StorageErrorCode.backendPluginInvalid,
            StorageErrorText.backendPluginInvalid
          )
        metadata[key] = property?.value
      }
      /** Registration-local identity cannot be changed by later descriptor mutation. */
      const kind = metadata.kind as IStorageBackendKind | undefined
      /** The provider-issued installation port belongs to this exact backend construction. */
      const capabilityInstaller =
        metadata.capabilityInstaller as IStorageNativePluginDescriptor['capabilityInstaller']

      if (kind !== undefined && !kinds.has(kind))
        throw createStorageTypeError(
          StorageErrorCode.backendKindMismatch,
          StorageErrorText.backendKindMismatch
        )
      for (const feature of plan?.ordered ?? []) {
        /** Read private Feature identity metadata instead of public type fields. */
        const expected = featureTargets.get(feature)
        if (
          kind !== undefined
            ? expected === undefined || !expected.includes(kind)
            : expected !== undefined
        )
          throw createStorageTypeError(
            StorageErrorCode.backendKindMismatch,
            StorageErrorText.backendKindMismatch
          )
      }
      nativeCore.setStorageKind(kind)
      return createNativeDescriptorProjection(descriptor, {
        install: (install) => async () => {
          transferActive = true
          try {
            return await nativeCore.runStorageInstall(async () => {
              /** Capture the actual install result before native extension publication. */
              const extensions = install === undefined ? {} : await install()
              if (kind !== undefined && !transferred)
                throw createStorageTypeError(
                  StorageErrorCode.backendPluginInvalid,
                  StorageErrorText.backendPluginInvalid
                )
              if (kind !== undefined && features !== undefined) {
                /** Original registration cleanup drops only its own selected Feature projection. */
                nativeCore.onDispose(() => nativeCore.setStorageFeatureProjection(undefined))
                nativeCore.setStorageFeatureProjection(
                  installStorageFeatures({
                    name,
                    store: nativeCore.getStore(),
                    features: nativeCore.features,
                    installer:
                      capabilityInstaller === undefined
                        ? undefined
                        : Reflect.apply(capabilityInstaller, descriptor, [nativeCore.getStore()]),
                    execution: nativeCore.execution,
                    expose: nativeCore.featureExpose as Readonly<Record<string, Function>>,
                    onDispose: nativeCore.onDispose
                  })
                )
              }
              if (
                extensions === null ||
                typeof extensions !== 'object' ||
                Array.isArray(extensions)
              )
                return extensions as never
              /** Preserve caller extension descriptors rather than spreading away their behavior. */
              const output = Object.create(null)
              Object.setPrototypeOf(output, Object.getPrototypeOf(extensions))
              Object.defineProperties(output, Object.getOwnPropertyDescriptors(extensions))
              return output
            })
          } finally {
            transferActive = false
          }
        },
        featureExpose: (hook) => () => {
          /** Keep native getters lazy until actual execution after store admission. */
          const expose = hook === undefined ? {} : hook()
          /** Authors cannot replace host-issued registration functions. */
          const reserved = STORAGE_RESERVED_EXPOSE
          if (
            expose !== null &&
            (typeof expose === 'object' || typeof expose === 'function') &&
            reserved.some((key) => key in expose)
          )
            throw createStorageTypeError(
              StorageErrorCode.backendPluginInvalid,
              StorageErrorText.backendPluginInvalid
            )
          return createNativeDataProjection(
            expose,
            {
              getKind: () => kind,
              getChangeController: nativeCore.getChangeController,
              getStore: () => nativeCore.getStore(),
              getBackendId: () => nativeCore.getBackendId(),
              getLifecycle: () => nativeCore.lifecycle,
              onDispose: nativeCore.onDispose,
              getScheduler: () => nativeCore.getScheduler(),
              getPublishedBackend: nativeCore.getPublishedBackend,
              emit: nativeCore.emit,
              registerDetect: nativeCore.registerDetect
            },
            true
          ) as never
        }
      }) as never
    },
    features as never
  )
  /** Expose an immutable id while the native definition stays private. */
  const handle = Object.freeze({ id: name })
  nativePluginDefinitions.set(handle, definition)
  nativePluginMetadata.set(handle, Object.freeze({ id: name }))
  return handle
}) as IStorageDefinePlugin
/** Resolve trusted definition identity without exposing its mutable registration authority. */
export const readStorageNativePluginMetadata = (plugin: object) => nativePluginMetadata.get(plugin)
/** Only the facade can turn a public handle into its original PluginHost definition. */
export const readStorageNativePluginDefinition = (plugin: object) =>
  nativePluginDefinitions.get(plugin)
/** Bound case-sensitive IDs make exact lookup and duplicate registration unambiguous. */
export const assertStorageBackendId: (id: unknown) => asserts id is string = (id) => {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(id))
    throw createStorageTypeError(
      StorageErrorCode.backendIdInvalid,
      StorageErrorText.backendIdInvalid
    )
}
