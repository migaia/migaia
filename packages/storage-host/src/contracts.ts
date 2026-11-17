import { defineFeature as defineNativeFeature } from '@migaia/plugin-host/features'
import type { IBackendStageBindings } from '@migaia/storage-contract'
import type { IStorageHooks } from './hook-types.ts'
import type { IStorageHookEmitter } from './hooks.ts'
import {
  definePlugin as defineNativePlugin,
  type IPluginHostCore,
  type IFeatureRecord
} from '@migaia/plugin-host'
import type { IStorageBase } from '@migaia/storage-contract'
import type { IScheduler } from '@migaia/utils/scheduler'
import { walkErrorCauses } from '@migaia/utils/error'
import { createStorageTypeError } from './errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { installStorageFeatures, type IStorageFeatureProjection } from './feature-install.ts'
import {
  STORAGE_DESCRIPTOR_METADATA,
  STORAGE_DESCRIPTOR_HOOKS,
  STORAGE_RESERVED_EXPOSE
} from './state-constants.ts'
import { StorageErrorText } from './error-text.ts'
import type {
  IStorageBackendType,
  IStorageBackendPluginDefiner,
  IStorageDefinePlugin,
  IStorageFeatureDefiner,
  IStoragePluginCore,
  IStorageFeatureExpose,
  IStorageExecutionPort,
  IStoragePipelineInput,
  IStorageNativePluginDescriptor
} from './types.ts'
/**
 * Storage's private facts about each definition it produced, keyed by the native PluginHost
 * definition. A definition missing here was not made by a storage definer and is rejected.
 */
const storageDefinitions = new WeakMap<object, IStorageDefinitionMetadata>()
/** Immutable definition facts; they hold no store, driver or registration lifetime. */
export type IStorageDefinitionMetadata = {
  /** The plugin name, which is also the public backend lookup key. */
  readonly id: string
  /** True for `defineBackendPlugin`: the plugin must hand over a Store and gets backend hooks. */
  readonly backend: boolean
  /** The plugin's listed Features; read only to name a Feature whose factory failed. */
  readonly features: IFeatureRecord | undefined
}
/** Which plugin a failed Feature factory was running for, and its root key when it is a root. */
export type IStorageFeatureFailure = {
  /** Name of the plugin whose registration ran the factory. */
  readonly plugin: string
  /** Key under which that plugin lists the Feature; undefined for a dependency-only Feature. */
  readonly feature: string | undefined
}
/** What the factory wrapper knows when a Feature factory throws. */
type IStorageFeatureFailureRecord = {
  /** Name of the plugin whose registration ran the factory. */
  readonly plugin: string
  /** The failed Feature's own definition. */
  readonly definition: object | undefined
}
/**
 * Thrown values of failed Feature factories, mapped to where they failed. The thrown value itself
 * is rethrown unchanged; the install boundary reads this table to name the plugin and Feature.
 */
const featureFailures = new WeakMap<object, IStorageFeatureFailureRecord>()
/** Lets the factory wrapper name its own definition, which exists only after it is defined. */
type IStorageFeatureHolder = { feature?: object }

/** Run one Feature factory; on failure record its plugin and definition, then rethrow unchanged. */
function runStorageFeatureFactory(
  factory: Function,
  holder: IStorageFeatureHolder,
  core: unknown,
  dependencies: unknown
): unknown {
  try {
    return Reflect.apply(factory, undefined, [core, dependencies])
  } catch (error) {
    recordStorageFeatureFailure(error, holder, core)
    throw error
  }
}

/** Remember where a thrown object came from; the first record for one thrown value is kept. */
function recordStorageFeatureFailure(
  error: unknown,
  holder: IStorageFeatureHolder,
  core: unknown
): void {
  /** Primitives cannot be WeakMap keys, so a thrown primitive carries no attribution. */
  if (Object(error) !== error || featureFailures.has(error as object)) return
  /**
   * Every storage registration exposes its plugin name to its Features as `getBackendId`; the read
   * runs no user code. A core without it (not a storage registration) records nothing.
   */
  const plugin = (
    core as { featureExpose?: { getBackendId?(): string } } | null
  )?.featureExpose?.getBackendId?.()
  if (plugin !== undefined)
    featureFailures.set(error as object, { plugin, definition: holder.feature })
}

/**
 * Find the Feature failure behind an install error of the batch `plugins`. The cause chain and
 * `AggregateError.errors` are searched in order with the bounded walker; undefined means no Feature
 * factory threw it. The root key is looked up in the failing plugin's own definition, so it is
 * absent for a Feature that is only a dependency of a listed root.
 */
export function readStorageFeatureFailure(
  error: unknown,
  plugins: readonly object[]
): IStorageFeatureFailure | undefined {
  for (const candidate of walkErrorCauses(error)) {
    /** Recorded only for objects thrown by a storage Feature factory; a primitive finds nothing. */
    const record = featureFailures.get(candidate as object)
    if (record === undefined) continue
    return { plugin: record.plugin, feature: findStorageFeatureRootKey(record, plugins) }
  }
  return undefined
}

/** Names are unique within one batch, so the first definition of that name is the failing one. */
function findStorageFeatureRootKey(
  record: IStorageFeatureFailureRecord,
  plugins: readonly object[]
): string | undefined {
  for (const plugin of plugins) {
    /** Storage facts of one batch entry; undefined for a definition storage did not make. */
    const metadata = storageDefinitions.get(plugin)
    if (metadata?.id !== record.plugin) continue
    for (const [key, definition] of Object.entries(metadata.features ?? {}))
      if (definition === record.definition) return key
    return undefined
  }
  return undefined
}

/** Storage's private additions attached only after a native hook observes the caller output. */
type IStorageNativeProjectionFields = Readonly<Record<PropertyKey, unknown>>

/**
 * Copy a plugin's own fields for native admission by reading them directly; the prototype is kept
 * so class-based outputs still resolve their methods. Promise outputs stay the actual Promise so
 * PluginHost can observe their rejection.
 */
function createNativeDataProjection(
  value: unknown,
  fields: IStorageNativeProjectionFields,
  preserveMethodReceiver = false,
  projectValue?: (key: PropertyKey, value: unknown, receiver: object) => unknown
): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Promise) return value
  const source = value as Record<PropertyKey, unknown>
  const output = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(source)) {
    const member = source[key]
    output[key] =
      projectValue !== undefined
        ? projectValue(key, member, source)
        : preserveMethodReceiver && key !== 'then' && typeof member === 'function'
          ? (...args: unknown[]) => Reflect.apply(member, source, args)
          : member
  }
  for (const key of Reflect.ownKeys(fields))
    if (!Object.hasOwn(source, key)) output[key] = fields[key]
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

/**
 * Copy a plugin descriptor for native admission, dropping author-only metadata and wrapping the
 * install, featureExpose and expose hooks. Fields are read directly; native admission still owns
 * validation of whatever the author supplied.
 */
function createNativeDescriptorProjection(value: unknown, hooks: IStorageDescriptorHooks): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Promise) return value
  const source = value as Record<PropertyKey, unknown>
  const output = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(source))
    if (!STORAGE_DESCRIPTOR_METADATA.some((field) => field === key)) output[key] = source[key]
  for (const key of STORAGE_DESCRIPTOR_HOOKS) {
    const hook = source[key]
    if (key === 'expose' && hook === undefined) continue
    if (hook === undefined || typeof hook === 'function')
      output[key] = hooks[key as keyof IStorageDescriptorHooks](hook as IStorageDescriptorHook)
  }
  return output
}

/**
 * Define one storage Feature. The backend it extends exists only in the type: a backend package
 * annotates this same function as `IStorageFeatureDefiner<ItsBackend>` and defines its Features
 * with it. PluginHost owns the Feature identity and compiles the dependency graph.
 */
export const defineStorageFeature: IStorageFeatureDefiner<never> = ((
  factory: Function,
  dependencies?: IFeatureRecord
) => {
  /** Filled right after definition so the wrapper can name this Feature when its factory fails. */
  const holder: IStorageFeatureHolder = {}
  holder.feature = defineNativeFeature(
    ((core: unknown, resolved: unknown) =>
      runStorageFeatureFactory(factory, holder, core, resolved)) as never,
    dependencies as never
  )
  return holder.feature
}) as never
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
  readonly features: Readonly<Record<string, object>>
  readonly featureExpose: object
  readonly execution: IStorageExecutionPort
  getStageBindings(): IBackendStageBindings
  getStorageHooks(): IStorageHooks
  /** Subscribe after installation; the caller owns removal. Only `storageProbe()` uses it. */
  subscribeStorageHook: IStorageHooks['on']
  readonly emit: IStorageHookEmitter
  readonly createKeyLockPort: IStoragePluginCore['createKeyLockPort']
  readonly createOrgAuthoringPort: IStoragePluginCore['createOrgAuthoringPort']
  readonly createTransactionApi: IStoragePluginCore['createTransactionApi']
  readonly getChainMethods: IStoragePluginCore['getChainMethods']
  setStorageFeatureProjection(projection: IStorageFeatureProjection | undefined): void
  getStorageFeatureClientResolver(): ReturnType<
    import('./store-cell.ts').IStorageStoreCell['getFeatureClientResolver']
  >
  setStorageJournalBinding(
    binding: import('./journal/types.ts').IStorageJournalBackendBinding
  ): void
  readonly defaultOrgId: string
  readonly createRevisionPort: IStoragePluginCore['createRevisionPort']
  readonly createChangeController: IStoragePluginCore['createChangeController']
  readonly registerChangeController: IStoragePluginCore['registerChangeController']
  readonly registerValueCommit: IStoragePluginCore['registerValueCommit']
  readonly getChangeController: IStorageFeatureExpose<IStorageBackendType>['getChangeController']
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
  /** True when the plugin must hand over a Store; set by the definer, never by the author. */
  readonly backend: boolean
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
  readonly capabilityInstaller?: IStorageNativePluginDescriptor['capabilityInstaller']
  readonly journalBinding?: IStorageNativePluginDescriptor['journalBinding']
}

/**
 * Plugin names are bounded ASCII: a letter, then letters, digits, `_` or `-`, 64 characters at
 * most. The name is the backend lookup key and the PluginHost plugin name, so it excludes `.`
 * (PluginHost's separator) and `:` (used by the host's own internal plugin names).
 */
const STORAGE_PLUGIN_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** Reject a malformed plugin name with BACKEND_ID_INVALID before a definition is recorded. */
function assertStoragePluginName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !STORAGE_PLUGIN_NAME_PATTERN.test(name))
    throw createStorageTypeError(
      StorageHostErrorCode.backendIdInvalid,
      StorageErrorText.backendIdInvalid
    )
}

/** Shared by both definers: one native definition per call, recorded with its storage facts. */
function defineStoragePlugin(
  name: string,
  descriptorFactory: (core: IStoragePluginCore) => IStorageNativePluginDescriptor,
  features: IFeatureRecord | undefined,
  backend: boolean
): object {
  assertStoragePluginName(name)
  /** Definition data is shared by every registration of this plugin. */
  const context: IStoragePluginDefinitionContext = { name, descriptorFactory, features, backend }
  /** PluginHost inspects the Feature record and owns each registration. */
  const definition = defineNativePlugin(
    name,
    (core) => createStorageNativeRegistration(context, core as unknown as IStorageNativeCore),
    features as never
  )
  storageDefinitions.set(definition, { id: name, backend, features })
  return definition
}

/**
 * Define a backend plugin. `open` runs once per registration and returns the descriptor whose
 * `install` must hand over exactly one Store with `core.registerStore`; otherwise the install
 * rejects with BACKEND_PLUGIN_INVALID. Features come from the `features` record.
 */
export const defineBackendPlugin: IStorageBackendPluginDefiner<never> = ((definition: {
  readonly name: string
  readonly features?: IFeatureRecord
  readonly open: (core: IStoragePluginCore) => IStorageNativePluginDescriptor
}) => defineStoragePlugin(definition.name, definition.open, definition.features, true)) as never

/**
 * Define a plugin that owns no Store, such as the journal, the probe or an entity. `setup` runs
 * once per registration and returns the descriptor with the `install` hook.
 */
export const definePlugin: IStorageDefinePlugin = ((definition: {
  readonly name: string
  readonly features?: IFeatureRecord
  readonly setup: (core: IStoragePluginCore) => IStorageNativePluginDescriptor
}) => defineStoragePlugin(definition.name, definition.setup, definition.features, false)) as never

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
    subscribeStorageHook: context.nativeCore.subscribeStorageHook,
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
  if (!context.definition.backend || context.transferred)
    throw createStorageTypeError(
      StorageHostErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  if (!context.transferActive) {
    if (context.nativeCore.isStorageInstallExpired() && !context.expiredTransferConsumed) {
      context.expiredTransferConsumed = true
      context.nativeCore.registerStore(store)
    }
    throw createStorageTypeError(
      StorageHostErrorCode.backendPluginInvalid,
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
    if (property !== undefined && (!('value' in property) || typeof property.value !== 'function'))
      throw createStorageTypeError(
        StorageHostErrorCode.backendPluginInvalid,
        StorageErrorText.backendPluginInvalid
      )
    metadata[key] = property?.value
  }
  return {
    registration,
    descriptor,
    capabilityInstaller:
      metadata.capabilityInstaller as IStorageNativePluginDescriptor['capabilityInstaller'],
    journalBinding: metadata.journalBinding as IStorageNativePluginDescriptor['journalBinding']
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
  if (context.registration.definition.backend && !context.registration.transferred)
    throw createStorageTypeError(
      StorageHostErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  if (context.registration.definition.backend && context.journalBinding !== undefined) {
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
  if (
    !context.registration.definition.backend ||
    context.registration.definition.features === undefined
  )
    return
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
      StorageHostErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  /** Lazy reads preserve pre-Feature initialization and later registration expiry semantics. */
  const nativeCore = context.registration.nativeCore
  return createNativeDataProjection(
    expose,
    {
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
/** Read the storage facts of a definition; undefined means a storage definer did not make it. */
export const readStorageDefinition = (plugin: object) => storageDefinitions.get(plugin)
