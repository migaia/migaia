import { createStorageTypeError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import {
  defineFeature as defineNativeFeature,
  definePlugin as defineNativePlugin,
  type IPluginHostCore,
  type IFeatureOutputs,
  type IFeature,
  type IFeatureRecord,
  type IFeatureRecordRequiredExpose,
  invokeCaptured
} from '@migaia/plugin-host'
import { assimilateCapturedThen } from '@migaia/lifecycle'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type {
  IStorageBackendKind,
  IStorageBackendPlugin,
  IStorageBackendPluginHandle
} from './types.js'
import type { IStorageReactiveFeatureMetadata } from './types.js'
import type { IKeyValueStore } from '@migaia/storage-contract'
import {
  registerReactiveAdapter,
  type IStorageReactiveAdapter,
  type IStorageReactiveService
} from './reactive.js'

/** Trusted Storage-native definitions retain their identity in PluginHost, not the legacy compiler. */
const nativePluginMetadata = new WeakMap<
  object,
  {
    readonly id: string
    readonly backendKind: object | undefined
    readonly storeKey: symbol
    readonly reactiveFeatureName: string | undefined
    readonly reactiveBundleKey: symbol | undefined
    readonly reactiveExpectedKinds: readonly object[]
  }
>()

/** Maps Storage's public opaque handle to the exact frozen PluginHost definition it owns. */
const nativePluginDefinitions = new WeakMap<object, object>()

/** Private marker binds Storage's reactive finalizer bridge to one native Feature definition. */
const nativeReactiveFeatures = new WeakMap<object, object | undefined>()

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
            value: (...args: unknown[]) => invokeCaptured(descriptor.value, value, args),
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
  readonly shared: (hook: IStorageDescriptorHook) => () => unknown
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
  const hookNames = new Set<string>(['install', 'shared', 'featureExpose'])
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
    ownKeys: () => [...new Set([...Reflect.ownKeys(value), ...hookNames])],
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

/**
 * Native Feature exposure always includes Storage's registration-local capabilities and cannot be
 * thenable.
 */
export type IStorageNativeFeatureExpose<
  TFeatures extends IFeatureRecord,
  TStore extends IKeyValueStore = IKeyValueStore
> = {
  readonly getStore: () => TStore
  readonly getBackendId: () => string
  readonly then?: never
} & IFeatureRecordRequiredExpose<TFeatures>

/** Storage authority supplied only to a native plugin during its own Host registration. */
export type IStoragePluginCore<
  TStore extends IKeyValueStore = IKeyValueStore,
  TFeatures extends IFeatureRecord = Record<never, never>
> = {
  readonly registerStore: (store: TStore) => void
  readonly getStore: () => TStore
  readonly getBackendId: () => string
  readonly getShared: IPluginHostCore['getShared']
  readonly features: IFeatureOutputs<TFeatures>
  readonly featureExpose: IStorageNativeFeatureExpose<TFeatures, TStore>
}

/** Native descriptor vocabulary owned by Storage's short public definition form. */
export type IStorageNativePluginDescriptor = {
  readonly install?: () => Record<string, unknown> | PromiseLike<Record<string, unknown>>
  readonly expose?: () => Record<string, unknown>
  readonly featureExpose?: () => object
  readonly shared?: () => Record<PropertyKey, unknown>
}

/** Combines the separately-owned install and explicit public extension outputs. */
export type IStorageNativePluginExtensions<TDescriptor extends IStorageNativePluginDescriptor> =
  (TDescriptor extends { readonly install?: () => infer TInstall }
    ? Awaited<TInstall> extends object
      ? Awaited<TInstall>
      : Record<never, never>
    : Record<never, never>) &
    (TDescriptor extends { readonly expose?: () => infer TExpose }
      ? TExpose extends object
        ? TExpose
        : Record<never, never>
      : Record<never, never>)

/** Reads the narrowest Store capability demanded by the selected Feature exposes. */
type IStorageFeatureStore<TFeatures extends IFeatureRecord> =
  IFeatureRecordRequiredExpose<TFeatures> extends {
    readonly getStore: () => infer TStore extends IKeyValueStore
  }
    ? TStore
    : IKeyValueStore

/** Rejects a caller-supplied Store type that cannot satisfy a selected Feature's Store expose. */
type IStorageFeatureStoreCompatibility<
  TStore extends IKeyValueStore,
  TFeatures extends IFeatureRecord
> =
  TStore extends IStorageFeatureStore<TFeatures>
    ? unknown
    : { readonly storageFeatureStoreMustSatisfyRequiredExpose: never }

/** Defines a Storage Feature with the registration-local Store capabilities available by default. */
export const defineFeature = <
  const TDependencies extends IFeatureRecord = Record<never, never>,
  TOutput extends object = Record<never, never>
>(
  factory: (
    core: { readonly featureExpose: IStorageNativeFeatureExpose<Record<never, never>> },
    dependencies: IFeatureOutputs<TDependencies>
  ) => TOutput,
  dependencies?: TDependencies
): IFeature<IStorageNativeFeatureExpose<Record<never, never>>, TOutput, TDependencies> =>
  defineNativeFeature(factory as never, dependencies as never) as IFeature<
    IStorageNativeFeatureExpose<Record<never, never>>,
    TOutput,
    TDependencies
  >

/** Internal Storage-native Feature factory that retains a built-in backend's exact reactive policy. */
export const defineNativeReactiveFeature = <TStore extends IKeyValueStore>(
  metadata: IStorageReactiveFeatureMetadata<TStore>,
  expectedBackendKind?: object
): IFeature<
  IStorageNativeFeatureExpose<Record<never, never>, TStore>,
  {
    readonly attach: (
      service: IStorageReactiveService,
      report: (error: unknown) => void
    ) => IStorageReactiveAdapter
  }
> => {
  const feature = defineFeature((core) => ({
    attach: (service: IStorageReactiveService, report: (error: unknown) => void) =>
      registerReactiveAdapter(
        service,
        core.featureExpose.getBackendId(),
        core.featureExpose.getStore() as TStore,
        report,
        metadata as IStorageReactiveFeatureMetadata,
        metadata.subscribe as IStorageReactiveFeatureMetadata['subscribe']
      )
  })) as IFeature<
    IStorageNativeFeatureExpose<Record<never, never>, TStore>,
    {
      readonly attach: (
        service: IStorageReactiveService,
        report: (error: unknown) => void
      ) => IStorageReactiveAdapter
    }
  >
  nativeReactiveFeatures.set(feature, expectedBackendKind)
  return feature
}

/**
 * Defines a Storage plugin through PluginHost's canonical function form. The Host supplies the
 * implicit per-registration store capability; callers cannot replace it.
 */
export const definePlugin = <
  const TName extends string,
  const TFeatures extends IFeatureRecord = Record<never, never>,
  TStore extends IKeyValueStore = IKeyValueStore,
  TDescriptor extends IStorageNativePluginDescriptor = IStorageNativePluginDescriptor
>(
  name: TName,
  descriptorFactory: (core: IStoragePluginCore<TStore, TFeatures>) => TDescriptor,
  features?: TFeatures & IStorageFeatureStoreCompatibility<TStore, TFeatures>
): IStorageBackendPluginHandle<IStorageNativePluginExtensions<TDescriptor>, TStore> & {
  readonly id: TName
} => {
  const reactiveFeatureName =
    features === undefined
      ? undefined
      : Object.entries(features).find(([, feature]) => nativeReactiveFeatures.has(feature))?.[0]
  /** PluginHost owns dependency closure traversal; Storage only reads its opaque ordered result. */
  const featureClosure = features === undefined ? undefined : inspectFeatures(features).ordered
  const reactiveExpectedKinds = Object.freeze(
    (featureClosure ?? [])
      .map((feature) => nativeReactiveFeatures.get(feature))
      .filter((kind): kind is object => kind !== undefined)
  )
  const reactiveBundleKey =
    reactiveFeatureName === undefined ? undefined : Symbol(`storage-web/reactive/${name}`)
  /** Private Store identity shared only with this native registration's finalizer. */
  const storeKey = Symbol(`storage-web/store/${name}`)
  const definition = defineNativePlugin<
    Record<string, never>,
    Record<string, unknown>,
    never,
    TName,
    TFeatures,
    IStorageNativeFeatureExpose<TFeatures>,
    Record<string, unknown>
  >(
    name,
    (core) => {
      const nativeCore = core as unknown as IStoragePluginCore<TStore, TFeatures> & {
        readonly setStorageRegistrationCore: (value: unknown) => void
        readonly runStorageInstall: <T>(operation: () => Promise<T>) => Promise<T>
        readonly isStorageInstallExpired: () => boolean
      }
      nativeCore.setStorageRegistrationCore(core)
      let transferActive = false
      let transferred = false
      let expiredTransferConsumed = false
      const storageCore: IStoragePluginCore<TStore, TFeatures> = {
        registerStore: (store) => {
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
        getShared: nativeCore.getShared,
        get features() {
          return nativeCore.features
        },
        get featureExpose() {
          return nativeCore.featureExpose
        }
      }
      const descriptor = descriptorFactory(storageCore)
      return createNativeDescriptorProjection(descriptor, {
        install: (install) => async () => {
          transferActive = true
          try {
            const extensions =
              install === undefined ? {} : await nativeCore.runStorageInstall(async () => install())
            if (extensions === null || typeof extensions !== 'object' || Array.isArray(extensions))
              return extensions as never
            const output = Object.create(null) as Record<PropertyKey, unknown>
            Object.setPrototypeOf(output, Object.getPrototypeOf(extensions))
            Object.defineProperties(output, Object.getOwnPropertyDescriptors(extensions ?? {}))
            Object.defineProperty(output, storeKey, {
              value: nativeCore.getStore(),
              enumerable: true,
              configurable: true,
              writable: false
            })
            return output
          } finally {
            transferActive = false
          }
        },
        shared: (shared) => () =>
          createNativeDataProjection(shared === undefined ? {} : (shared() ?? {}), {
            [storeKey]: nativeCore.getStore(),
            ...(reactiveBundleKey === undefined
              ? {}
              : {
                  [reactiveBundleKey]: Object.freeze({
                    // This Store came through this registration's single-assignment bridge.
                    // The adapter verifies it before using the Feature-owned attach closure.
                    store: nativeCore.getStore(),
                    attach: (nativeCore.features as Record<string, { readonly attach: unknown }>)[
                      reactiveFeatureName!
                    ]?.attach
                  })
                })
          }),
        featureExpose: (featureExpose) => () => {
          const expose = featureExpose === undefined ? {} : featureExpose()
          if (
            expose !== null &&
            (typeof expose === 'object' || typeof expose === 'function') &&
            ('getStore' in expose || 'getBackendId' in expose)
          )
            throw createStorageTypeError(
              StorageErrorCode.backendPluginInvalid,
              StorageErrorText.backendPluginInvalid
            )
          return createNativeDataProjection(
            expose,
            {
              getStore: () => nativeCore.getStore(),
              getBackendId: () => nativeCore.getBackendId()
            },
            true
          ) as IStorageNativeFeatureExpose<TFeatures>
        }
      }) as never
    },
    features
  )
  /** The public handle has a real runtime id while its definition stays opaque to callers. */
  const handle = Object.freeze({ id: name })
  nativePluginDefinitions.set(handle, definition)
  nativePluginMetadata.set(
    handle,
    Object.freeze({
      id: name,
      backendKind: undefined,
      storeKey,
      reactiveFeatureName,
      reactiveBundleKey,
      reactiveExpectedKinds
    })
  )
  return handle as unknown as IStorageBackendPluginHandle<
    IStorageNativePluginExtensions<TDescriptor>,
    TStore
  > & {
    readonly id: TName
  }
}

/** Binds one first-party native definition to its opaque backend kind before Host admission. */
export const defineBuiltInPlugin = <
  TStore extends IKeyValueStore,
  TBackendKind extends IStorageBackendKind<string, TStore>,
  const TName extends string,
  const TFeatures extends IFeatureRecord = Record<never, never>,
  TDescriptor extends IStorageNativePluginDescriptor = IStorageNativePluginDescriptor
>(
  backendKind: TBackendKind,
  name: TName,
  descriptorFactory: (core: IStoragePluginCore<TStore, TFeatures>) => TDescriptor,
  features?: TFeatures
): IStorageBackendPlugin<
  TStore,
  TBackendKind,
  TName,
  boolean,
  IStorageNativePluginExtensions<TDescriptor>
> => {
  const plugin = definePlugin(
    name,
    descriptorFactory,
    features as TFeatures & IStorageFeatureStoreCompatibility<TStore, TFeatures>
  )
  const metadata = nativePluginMetadata.get(plugin)
  if (metadata === undefined)
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  nativePluginMetadata.set(plugin, Object.freeze({ ...metadata, backendKind }))
  return plugin as IStorageBackendPlugin<
    TStore,
    TBackendKind,
    TName,
    boolean,
    IStorageNativePluginExtensions<TDescriptor>
  >
}

/** Carries the reactive brand only for first-party definitions with a bound native Feature. */
export const defineBuiltInReactivePlugin = <
  TStore extends IKeyValueStore,
  TBackendKind extends IStorageBackendKind<string, TStore>,
  const TName extends string,
  const TFeatures extends IFeatureRecord,
  TDescriptor extends IStorageNativePluginDescriptor = IStorageNativePluginDescriptor
>(
  backendKind: TBackendKind,
  name: TName,
  descriptorFactory: (core: IStoragePluginCore<TStore, TFeatures>) => TDescriptor,
  features: TFeatures
): IStorageBackendPlugin<
  TStore,
  TBackendKind,
  TName,
  true,
  IStorageNativePluginExtensions<TDescriptor>
> =>
  defineBuiltInPlugin(backendKind, name, descriptorFactory, features) as IStorageBackendPlugin<
    TStore,
    TBackendKind,
    TName,
    true,
    IStorageNativePluginExtensions<TDescriptor>
  >

/** Reads native Storage admission metadata without exposing its mutable definition authority. */
export const readStorageNativePluginMetadata = (plugin: object) => nativePluginMetadata.get(plugin)

/** Resolves a trusted opaque Storage handle to its one PluginHost definition. */
export const readStorageNativePluginDefinition = (plugin: object) =>
  nativePluginDefinitions.get(plugin)

/** Validates the bounded, case-sensitive backend identifier contract before any mutation. */
export const assertStorageBackendId: (id: unknown) => asserts id is string = (id) => {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw createStorageTypeError(
      StorageErrorCode.backendIdInvalid,
      StorageErrorText.backendIdInvalid
    )
  }
}

/** Creates one first-party-only opaque backend kind token for native adapter matching. */
export const defineBuiltInBackendKind = <TStore extends IKeyValueStore>(): (<
  const TName extends string
>(
  name: TName
) => IStorageBackendKind<TName, TStore>) => {
  return <const TName extends string>(name: TName): IStorageBackendKind<TName, TStore> => {
    assertStorageBackendId(name)
    const token = Object.freeze({ name }) as IStorageBackendKind<TName, TStore>
    return token
  }
}
