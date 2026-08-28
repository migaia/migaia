import { createStorageTypeError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import type {
  IStorageBackendFeature,
  IStorageBackendKind,
  IStorageBackendKindStore,
  IStorageBackendPlugin,
  IStorageBackendPluginDefinition,
  IStorageBackendPluginHandle,
  IStorageBackendPluginContext,
  IStorageBackendPluginPrepare,
  IFeaturesEnableReactive
} from './types.js'
import type { IStorageReactiveFeatureMetadata } from './types.js'
import type { IKeyValueStore } from '@migaia/storage-contract'

/** Exact runtime authority for custom backend kind tokens. */
const backendKinds = new WeakSet<object>()
/** Exact runtime metadata for feature descriptors; object properties remain opaque. */
const featureMetadata = new WeakMap<
  object,
  {
    readonly backendKind: object
    readonly capability: string
    readonly reactive?: IStorageReactiveFeatureMetadata
  }
>()
/** Exact runtime metadata for plugin definitions; object properties remain opaque. */
const pluginMetadata = new WeakMap<
  object,
  {
    readonly backendKind: object
    readonly extensionKey: symbol
    readonly create: (
      context: IStorageBackendPluginContext
    ) => IKeyValueStore | PromiseLike<IKeyValueStore>
    readonly prepare: IStorageBackendPluginPrepare<IKeyValueStore> | undefined
    readonly features: readonly object[]
    readonly timeoutMs: number | undefined
  }
>()

type IStorageBackendDefinitionInput = {
  readonly backendKind: IStorageBackendKind<string, IKeyValueStore>
  readonly id: string
  readonly create: (
    context: IStorageBackendPluginContext
  ) => IKeyValueStore | PromiseLike<IKeyValueStore>
  readonly prepare?: unknown
  readonly features?: readonly object[]
  readonly timeoutMs?: number
}

type IStorageBackendDefinitionSnapshot = {
  readonly backendKind: IStorageBackendKind<string, IKeyValueStore>
  readonly id: string
  readonly create: (
    context: IStorageBackendPluginContext
  ) => IKeyValueStore | PromiseLike<IKeyValueStore>
  readonly prepare: IStorageBackendPluginPrepare<IKeyValueStore> | undefined
  readonly features: readonly object[]
  readonly timeoutMs: number | undefined
}

/** Read backend definition accessors once and retain the exact hostile failure for the boundary. */
const snapshotStorageBackendDefinition = (
  definition: IStorageBackendDefinitionInput
): IStorageBackendDefinitionSnapshot => {
  try {
    const backendKind = definition.backendKind
    const id = definition.id
    const create = definition.create
    const prepare = definition.prepare
    const timeoutMs = definition.timeoutMs
    const features = Object.freeze(Array.from(definition.features ?? []))
    return {
      backendKind,
      id,
      create,
      prepare: prepare as IStorageBackendPluginPrepare<IKeyValueStore> | undefined,
      features,
      timeoutMs
    }
  } catch (cause) {
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid,
      cause
    )
  }
}

/** Validates the bounded, case-sensitive backend identifier contract before any mutation. */
export const assertStorageBackendId: (id: unknown) => asserts id is string = (id) => {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw createStorageTypeError(
      StorageErrorCode.backendIdInvalid,
      StorageErrorText.backendIdInvalid
    )
  }
}

/** Creates one opaque backend kind token and records its module-private identity. */
export const defineStorageBackendKind = <TStore extends IKeyValueStore>(): (<
  const TName extends string
>(
  name: TName
) => IStorageBackendKind<TName, TStore>) => {
  return <const TName extends string>(name: TName): IStorageBackendKind<TName, TStore> => {
    assertStorageBackendId(name)
    const token = Object.freeze({ name }) as IStorageBackendKind<TName, TStore>
    backendKinds.add(token)
    return token
  }
}

/** Creates a module-private feature descriptor for compiler fixtures and future feature owners. */
export const defineStorageBackendFeature = <
  TBackendKind extends IStorageBackendKind<string, IKeyValueStore>,
  const TCapability extends string
>(
  backendKind: TBackendKind,
  capability: TCapability,
  reactive?: IStorageReactiveFeatureMetadata<IStorageBackendKindStore<TBackendKind>>
): IStorageBackendFeature<IStorageBackendKindStore<TBackendKind>, TBackendKind, TCapability> => {
  if (!backendKinds.has(backendKind) || capability.length === 0) {
    throw createStorageTypeError(
      StorageErrorCode.reactiveFeatureInvalid,
      StorageErrorText.reactiveFeatureInvalid
    )
  }
  const descriptor = Object.freeze({})
  featureMetadata.set(
    descriptor,
    Object.freeze({
      backendKind,
      capability,
      reactive: reactive as IStorageReactiveFeatureMetadata | undefined
    })
  )
  return descriptor as IStorageBackendFeature<
    IStorageBackendKindStore<TBackendKind>,
    TBackendKind,
    TCapability
  >
}

/** Creates a backend plugin handle while snapshotting mutable definition inputs exactly once. */
export const defineStorageBackendPlugin = <
  const TBackendKind extends IStorageBackendKind<string, IKeyValueStore>,
  const TId extends string,
  const TFeatures extends readonly IStorageBackendFeature<
    IStorageBackendKindStore<TBackendKind>,
    TBackendKind,
    string
  >[] = readonly []
>(
  definition: IStorageBackendPluginDefinition<
    IStorageBackendKindStore<TBackendKind>,
    TBackendKind,
    TId,
    TFeatures
  >
): IStorageBackendPlugin<
  IStorageBackendKindStore<TBackendKind>,
  TBackendKind,
  TId,
  IFeaturesEnableReactive<TFeatures>
> => {
  const snapshot = snapshotStorageBackendDefinition(definition)
  const { backendKind, id, create, prepare, features, timeoutMs } = snapshot
  assertStorageBackendId(id)
  if (
    !backendKinds.has(backendKind) ||
    typeof create !== 'function' ||
    (prepare !== undefined && typeof prepare !== 'function') ||
    (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0))
  ) {
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  }
  for (const feature of features) {
    const metadata = featureMetadata.get(feature)
    if (metadata === undefined || metadata.backendKind !== backendKind) {
      throw createStorageTypeError(
        StorageErrorCode.reactiveFeatureInvalid,
        StorageErrorText.reactiveFeatureInvalid
      )
    }
  }
  const handle = Object.freeze({ id }) as IStorageBackendPlugin<
    IStorageBackendKindStore<TBackendKind>,
    TBackendKind,
    TId,
    IFeaturesEnableReactive<TFeatures>
  >
  pluginMetadata.set(
    handle,
    Object.freeze({
      backendKind,
      extensionKey: Symbol(`storage-web/backend/${id}`),
      create: create as (
        context: IStorageBackendPluginContext
      ) => IKeyValueStore | PromiseLike<IKeyValueStore>,
      prepare: prepare as IStorageBackendPluginPrepare<IKeyValueStore> | undefined,
      features,
      timeoutMs
    })
  )
  return handle
}

/** Reads private plugin metadata for the facade/compiler without exposing definition authority. */
export const readStorageBackendPluginMetadata = (plugin: IStorageBackendPluginHandle) =>
  pluginMetadata.get(plugin)

/** Reads private feature metadata for the pure compiler. */
export const readStorageBackendFeatureMetadata = (feature: object) => featureMetadata.get(feature)
