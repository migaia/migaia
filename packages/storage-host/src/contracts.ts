import type { IBackendStageBindings } from '@migaia/storage-contract'
import type { IStorageHooks } from './hook-types.js'
import type { IStorageHookEmitter } from './hooks.js'
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
import {
  STORAGE_DESCRIPTOR_METADATA,
  STORAGE_DESCRIPTOR_HOOKS,
  STORAGE_RESERVED_EXPOSE
} from './state-constants.js'
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
 * Project ordinary own descriptors for native admission. Promise outputs remain the actual native
 * Promise so PluginHost can reject and observe their rejection without another assimilation owner.
 */
function createNativeDataProjection(
  value: unknown,
  fields: IStorageNativeProjectionFields,
  preserveMethodReceiver = false,
  projectValue?: (key: PropertyKey, value: unknown, receiver: object) => unknown
): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Promise) return value
  /** Keep the original prototype and own data/accessor shape for PluginHost's closed boundary. */
  const output = Object.create(Object.getPrototypeOf(value))
  for (const key of Reflect.ownKeys(value)) {
    /** Captured definitions survive later caller mutation while keeping native rejection semantics. */
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (projectValue !== undefined && 'value' in descriptor)
      Object.defineProperty(output, key, {
        ...descriptor,
        value: projectValue(key, descriptor.value, value),
        configurable: true
      })
    else if (
      preserveMethodReceiver &&
      key !== 'then' &&
      'value' in descriptor &&
      typeof descriptor.value === 'function'
    )
      Object.defineProperty(output, key, {
        ...descriptor,
        value: (...args: unknown[]) => Reflect.apply(descriptor.value, value, args),
        configurable: true
      })
    else Object.defineProperty(output, key, { ...descriptor, configurable: true })
  }
  for (const key of Reflect.ownKeys(fields))
    if (!Object.hasOwn(value, key))
      Object.defineProperty(output, key, {
        ...Object.getOwnPropertyDescriptor(fields, key),
        configurable: true
      })
  return output
}

/** Native owns validation; Storage replaces only admitted hook data functions. */
type IStorageDescriptorHook = (() => unknown) | undefined

/** Finite registration bridges attach no additional native lifecycle authority. */
type IStorageDescriptorHooks = Readonly<{
  readonly install: (hook: IStorageDescriptorHook) => () => unknown
  readonly featureExpose: (hook: IStorageDescriptorHook) => () => unknown
  readonly expose: (hook: IStorageDescriptorHook) => () => unknown
}>

/** Preserve unknown keys and invalid descriptors so native admission remains their single owner. */
function createNativeDescriptorProjection(value: unknown, hooks: IStorageDescriptorHooks): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Promise) return value
  /** Author-only metadata is removed before the original closed descriptor admission. */
  const output = Object.create(Object.getPrototypeOf(value))
  /** Native always receives installation and Feature bridges; expose remains optional. */
  const keys = new Set([
    ...Reflect.ownKeys(value).filter(
      (key) => !STORAGE_DESCRIPTOR_METADATA.some((field) => field === key)
    ),
    ...STORAGE_DESCRIPTOR_HOOKS.filter((key) => key !== 'expose')
  ])
  for (const key of keys) {
    /** Only own data callbacks are bridged; accessors retain the native rejection path. */
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      typeof key === 'string' &&
      STORAGE_DESCRIPTOR_HOOKS.some((hook) => hook === key) &&
      (key !== 'expose' || descriptor !== undefined) &&
      (descriptor === undefined ||
        ('value' in descriptor && typeof descriptor.value === 'function'))
    )
      Object.defineProperty(output, key, {
        value: hooks[key as keyof IStorageDescriptorHooks](
          descriptor?.value as IStorageDescriptorHook
        ),
        enumerable: descriptor?.enumerable ?? true,
        configurable: true,
        writable: true
      })
    else if (descriptor !== undefined)
      Object.defineProperty(output, key, { ...descriptor, configurable: true })
  }
  return output
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
    const kind = { name }
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
  return [...selected]
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
  readonly registerJournalRuntime: IStoragePluginCore['registerJournalRuntime']
  readonly journal: IStoragePluginCore['journal']
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
  readonly createOrgAuthoringPort: IStoragePluginCore['createOrgAuthoringPort']
  readonly createTransactionApi: IStoragePluginCore['createTransactionApi']
  readonly getChainMethods: IStoragePluginCore['getChainMethods']
  setStorageFeatureProjection(projection: IStorageFeatureProjection | undefined): void
  getStorageFeatureClientResolver(): ReturnType<
    import('./store-cell.js').IStorageStoreCell['getFeatureClientResolver']
  >
  setStorageJournalBinding(
    binding: import('./journal/types.js').IStorageJournalBackendBinding
  ): void
  readonly defaultOrgId: string
  readonly createRevisionPort: IStoragePluginCore['createRevisionPort']
  readonly createChangeController: IStoragePluginCore['createChangeController']
  readonly registerChangeController: IStoragePluginCore['registerChangeController']
  readonly registerValueCommit: IStoragePluginCore['registerValueCommit']
  readonly getChangeController: IStorageFeatureExpose<IStorageBackendKind>['getChangeController']
  readonly getPublishedBackend: IStoragePluginCore['getPublishedBackend']
  readonly registerDetect: IStoragePluginCore['registerDetect']
  readonly registerOrgBinding: IStoragePluginCore['registerOrgBinding']
  readonly registerFeatureClientResolver: IStoragePluginCore['registerFeatureClientResolver']
  readonly getOrgContext: IStoragePluginCore['getOrgContext']
  captureStorageExtension(key: PropertyKey, value: unknown, receiver: object): unknown
}
/** Immutable definition data is shared across registrations without retaining any native Store. */
type IStoragePluginDefinitionContext = {
  readonly name: string
  readonly descriptorFactory: (core: IStoragePluginCore) => IStorageNativePluginDescriptor
  readonly features?: IFeatureRecord
  readonly plan?: ReturnType<typeof inspectFeatures>
}

/** Registration-local transfer state borrows lifecycle and installation authority from PluginHost. */
type IStorageNativeRegistrationContext = {
  readonly definition: IStoragePluginDefinitionContext
  readonly nativeCore: IStorageNativeCore
  transferActive: boolean
  transferred: boolean
  expiredTransferConsumed: boolean
}

/** Author metadata is captured before asynchronous install or later caller descriptor mutation. */
type IStorageNativeDescriptorContext = {
  readonly registration: IStorageNativeRegistrationContext
  readonly descriptor: IStorageNativePluginDescriptor
  readonly kind?: IStorageBackendKind
  readonly capabilityInstaller?: IStorageNativePluginDescriptor['capabilityInstaller']
  readonly journalBinding?: IStorageNativePluginDescriptor['journalBinding']
}

/** Define one native plugin; original PluginHost remains the registration and lifecycle owner. */
export const definePlugin: IStorageDefinePlugin = ((
  name: string,
  descriptorFactory: (core: IStoragePluginCore) => IStorageNativePluginDescriptor,
  features?: IFeatureRecord
) => {
  assertStorageBackendId(name)
  /** Inspect the existing dependency closure without running any Feature factory. */
  const context: IStoragePluginDefinitionContext = {
    name,
    descriptorFactory,
    features,
    plan: features === undefined ? undefined : inspectFeatures(features)
  }
  /** Native invokes one bounded adapter for each actual registration. */
  const definition = defineNativePlugin(
    pluginNameFromBackendId(name),
    (core) => createStorageNativeRegistration(context, core as unknown as IStorageNativeCore),
    features as never
  )
  /** Public diagnostic identity retains no mutable registration authority. */
  const handle = { id: name }
  nativePluginDefinitions.set(handle, definition)
  nativePluginMetadata.set(handle, { id: name })
  return handle
}) as IStorageDefinePlugin

/** Create one explicit transfer owner before exposing the original native capabilities to authors. */
function createStorageNativeRegistration(
  definition: IStoragePluginDefinitionContext,
  nativeCore: IStorageNativeCore
): never {
  nativeCore.setStorageRegistrationCore(nativeCore)
  /** Transfer flags live only for this native registration, never on a public plugin definition. */
  const registration: IStorageNativeRegistrationContext = {
    definition,
    nativeCore,
    transferActive: false,
    transferred: false,
    expiredTransferConsumed: false
  }
  /**
   * A factory remains an unbound callback, rather than acquiring this definition context as
   * receiver.
   */
  const descriptorFactory = definition.descriptorFactory
  /** Factory admission remains synchronous before native descriptor validation. */
  const descriptor = descriptorFactory(createStorageRegistrationCore(registration))
  /** Metadata must survive install awaits without rereading the caller's descriptor. */
  const context = captureStorageDescriptor(registration, descriptor)
  assertStorageFeatureTargets(context)
  nativeCore.setStorageKind(context.kind)
  return createNativeDescriptorProjection(descriptor, {
    install: (install) => () => runStorageNativeInstall(context, install),
    expose: (hook) => () => projectStorageNativeExpose(context, hook),
    featureExpose: (hook) => () => projectStorageNativeFeatureExpose(context, hook)
  }) as never
}

/** Forward lazy native capabilities; Feature and lifecycle getters must remain late native reads. */
function createStorageRegistrationCore(
  context: IStorageNativeRegistrationContext
): IStoragePluginCore {
  return {
    get operation() {
      return context.nativeCore.operation
    },
    get lifecycle() {
      return context.nativeCore.lifecycle
    },
    onDispose: context.nativeCore.onDispose,
    usePipeline: context.nativeCore.usePipeline,
    useAsyncPipeline: context.nativeCore.useAsyncPipeline,
    get defaultOrgId() {
      return context.nativeCore.defaultOrgId
    },
    execution: context.nativeCore.execution,
    registerJournalRuntime: context.nativeCore.registerJournalRuntime,
    journal: context.nativeCore.journal,
    get hooks() {
      return context.nativeCore.getStorageHooks()
    },
    get stageBindings() {
      return context.nativeCore.getStageBindings()
    },
    emit: context.nativeCore.emit,
    createKeyLockPort: context.nativeCore.createKeyLockPort,
    createOrgAuthoringPort: context.nativeCore.createOrgAuthoringPort,
    createTransactionApi: context.nativeCore.createTransactionApi,
    getChainMethods: context.nativeCore.getChainMethods,
    createRevisionPort: context.nativeCore.createRevisionPort,
    createChangeController: context.nativeCore.createChangeController,
    registerChangeController: context.nativeCore.registerChangeController,
    registerValueCommit: context.nativeCore.registerValueCommit,
    registerOrgBinding: context.nativeCore.registerOrgBinding,
    registerFeatureClientResolver: context.nativeCore.registerFeatureClientResolver,
    getOrgContext: context.nativeCore.getOrgContext,
    getPublishedBackend: context.nativeCore.getPublishedBackend,
    registerDetect: context.nativeCore.registerDetect,
    registerStore: (store: IStorageBase) => registerStorageTransfer(context, store),
    getStore: () => context.nativeCore.getStore(),
    getBackendId: () => context.nativeCore.getBackendId(),
    get features() {
      return context.nativeCore.features
    },
    get featureExpose() {
      return context.nativeCore.featureExpose
    }
  } as unknown as IStoragePluginCore
}

/** Accept one exact Store transfer, including one native cleanup handoff after install expiry. */
function registerStorageTransfer(
  context: IStorageNativeRegistrationContext,
  store: IStorageBase
): void {
  if (context.transferred)
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  if (!context.transferActive) {
    if (context.nativeCore.isStorageInstallExpired() && !context.expiredTransferConsumed) {
      context.expiredTransferConsumed = true
      context.nativeCore.registerStore(store)
    }
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  }
  context.nativeCore.registerStore(store)
  context.transferred = true
}

/** Capture only author metadata; the original descriptor's remaining shape goes to native admission. */
function captureStorageDescriptor(
  registration: IStorageNativeRegistrationContext,
  descriptor: IStorageNativePluginDescriptor
): IStorageNativeDescriptorContext {
  /** Stable metadata outlives factory return and asynchronous install. */
  const metadata: Record<string, unknown> = Object.create(null)
  for (const key of STORAGE_DESCRIPTOR_METADATA) {
    /** Author-only data fields cannot inject execution through accessors. */
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
  return {
    registration,
    descriptor,
    kind: metadata.kind as IStorageBackendKind | undefined,
    capabilityInstaller:
      metadata.capabilityInstaller as IStorageNativePluginDescriptor['capabilityInstaller'],
    journalBinding: metadata.journalBinding as IStorageNativePluginDescriptor['journalBinding']
  }
}

/** Check exact private kind identities before a Feature or native driver executes. */
function assertStorageFeatureTargets(context: IStorageNativeDescriptorContext): void {
  if (context.kind !== undefined && !kinds.has(context.kind))
    throw createStorageTypeError(
      StorageErrorCode.backendKindMismatch,
      StorageErrorText.backendKindMismatch
    )
  for (const feature of context.registration.definition.plan?.ordered ?? []) {
    /** Dependency compatibility belongs to original Feature identities, not public type metadata. */
    const expected = featureTargets.get(feature)
    if (
      context.kind !== undefined
        ? expected === undefined || !expected.includes(context.kind)
        : expected !== undefined
    )
      throw createStorageTypeError(
        StorageErrorCode.backendKindMismatch,
        StorageErrorText.backendKindMismatch
      )
  }
}

/** Keep Store transfer admission active until the native installation owner settles. */
async function runStorageNativeInstall(
  context: IStorageNativeDescriptorContext,
  install: IStorageDescriptorHook
): Promise<unknown> {
  context.registration.transferActive = true
  try {
    return await context.registration.nativeCore.runStorageInstall(() =>
      finishStorageNativeInstall(context, install)
    )
  } finally {
    context.registration.transferActive = false
  }
}

/** Native install result settlement precedes journal, Feature, and extension publication in order. */
async function finishStorageNativeInstall(
  context: IStorageNativeDescriptorContext,
  install: IStorageDescriptorHook
): Promise<unknown> {
  /** Await exactly the author's original install result before validating Store handoff. */
  const extensions = install === undefined ? {} : await install()
  if (context.kind !== undefined && !context.registration.transferred)
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  if (context.kind !== undefined && context.journalBinding !== undefined) {
    /** A selected backend Feature may omit journal ownership on its basic storage path. */
    const binding = Reflect.apply(context.journalBinding, context.descriptor, [
      context.registration.nativeCore.getStore()
    ])
    if (binding !== undefined) context.registration.nativeCore.setStorageJournalBinding(binding)
  }
  publishStorageNativeFeatures(context)
  if (extensions === null || typeof extensions !== 'object' || Array.isArray(extensions))
    return extensions
  /** Install definitions outlive this await and must not follow later mutations of the result. */
  const definitions = Object.create(Object.getPrototypeOf(extensions))
  Object.defineProperties(definitions, Object.getOwnPropertyDescriptors(extensions))
  return projectStorageNativeExtensions(context, definitions)
}

/** Publish only selected roots after Store and optional journal admission. */
function publishStorageNativeFeatures(context: IStorageNativeDescriptorContext): void {
  if (context.kind === undefined || context.registration.definition.features === undefined) return
  /** The original registration owns every provider and cleanup endpoint. */
  const nativeCore = context.registration.nativeCore
  /** Empty selection produces neither a projection nor a cleanup registration. */
  const projection = installStorageFeatures({
    name: context.registration.definition.name,
    store: nativeCore.getStore(),
    features: nativeCore.features,
    installer:
      context.capabilityInstaller === undefined
        ? undefined
        : Reflect.apply(context.capabilityInstaller, context.descriptor, [nativeCore.getStore()]),
    execution: nativeCore.execution,
    expose: nativeCore.featureExpose as Readonly<Record<string, Function>>,
    onDispose: nativeCore.onDispose,
    callContext: nativeCore.getOrgContext(nativeCore.defaultOrgId).callContext,
    clientResolver: nativeCore.getStorageFeatureClientResolver()
  })
  if (projection !== undefined) {
    nativeCore.onDispose(() => nativeCore.setStorageFeatureProjection(undefined))
    nativeCore.setStorageFeatureProjection(projection)
  }
}

/** Flat extension methods retain original callable definitions for organization projections. */
function projectStorageNativeExtensions(
  context: IStorageNativeDescriptorContext,
  value: unknown
): unknown {
  return createNativeDataProjection(value, {}, false, (key, member, receiver) =>
    context.registration.nativeCore.captureStorageExtension(key, member, receiver)
  )
}

/** Native remains the single owner of optional public extension validation and publication. */
function projectStorageNativeExpose(
  context: IStorageNativeDescriptorContext,
  hook: IStorageDescriptorHook
): unknown {
  return projectStorageNativeExtensions(context, hook === undefined ? {} : hook())
}

/**
 * Add reserved registration capabilities without replacing the author's real Feature expose
 * receiver.
 */
function projectStorageNativeFeatureExpose(
  context: IStorageNativeDescriptorContext,
  hook: IStorageDescriptorHook
): unknown {
  /** Native's Feature owner performs the final own-data method admission. */
  const expose = hook === undefined ? {} : hook()
  if (
    expose !== null &&
    (typeof expose === 'object' || typeof expose === 'function') &&
    STORAGE_RESERVED_EXPOSE.some((key) => key in expose)
  )
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  /** Lazy reads preserve pre-Feature initialization and later registration expiry semantics. */
  const nativeCore = context.registration.nativeCore
  return createNativeDataProjection(
    expose,
    {
      getKind: () => context.kind,
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
  )
}
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
