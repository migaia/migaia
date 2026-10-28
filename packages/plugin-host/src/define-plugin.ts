/**
 * Owns trusted definition identity and immutable hook/metadata admission; per-registration
 * factories run only under the install owner.
 */
import { PluginActivation } from './state-constants.ts'
import { PluginDefinitionKey, PluginDefinitionText } from './definition-constants.ts'
import type { IPipelineDefinitions } from './pipeline-spec.ts'
import { snapshotPipelineDefinitions } from './pipeline-declarations.ts'
import { copyConfig } from './config.ts'
import { snapshotDisposer } from './disposal.ts'
import { invokeCaptured } from './invocation.ts'
import ERROR_TEXT, {
  createPluginDefinitionTypeError,
  createPluginHostTypeError,
  PluginHostError,
  PluginHostInternalText
} from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { createFeatureReference, snapshotFeatureRecord } from './define-feature.ts'
import type { IPluginDefinition, IPluginDescriptor } from './registry.ts'
import type {
  IFeatureOutputs,
  IFeatureRecord,
  IFeatureRecordRequiredExpose
} from './feature-types.ts'
import type {
  IDefinedPluginConstraint,
  IPlugin,
  IPluginCommon,
  IPluginConstraint,
  IPluginSetupHooks
} from './plugin-definition-types.ts'
import type { IPluginConfig } from './plugin-lifecycle-types.ts'

/** Trusted identity stores one captured definition and never a live Host registration. */
type IStoredDefinition = IPluginDefinition<any>

/** Module-private identity authority for functional definitions. It never stores Host state. */
const definitions = new WeakMap<object, IStoredDefinition>()

/**
 * Fixed admission keys remain excluded from metadata; user getFeature metadata keeps its old
 * treatment.
 */
const knownKeys = new Set<PropertyKey>([
  PluginDefinitionKey.name,
  PluginDefinitionKey.config,
  PluginDefinitionKey.install,
  PluginDefinitionKey.setup,
  PluginDefinitionKey.update,
  PluginDefinitionKey.onEnable,
  PluginDefinitionKey.onDisable,
  PluginDefinitionKey.dispose,
  PluginDefinitionKey.beforeRelease,
  PluginDefinitionKey.shared,
  PluginDefinitionKey.features,
  PluginDefinitionKey.pipelines,
  PluginDefinitionKey.featureExpose,
  PluginDefinitionKey.activation,
  PluginDefinitionKey.onDependencyReplaced,
  Symbol.dispose,
  Symbol.asyncDispose
])

/** Read one descriptor field once and reject getters that could change admission semantics. */
const readData = (source: object, key: PropertyKey): unknown => {
  /** Own-property descriptors are inspected without invoking getter values during admission. */
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor))
    throw createPluginHostTypeError(PluginHostInternalText.PLUGIN_PROPERTY_DATA(key))
  return descriptor.value
}

/** Shares the existing own-data admission rule with the raw-object release hook snapshot. */
export { readData as readPluginDefinitionData }

/** Own-data fields of one definition, read exactly once before any validation. */
type IDefinitionFields = Readonly<{
  name: unknown
  rawConfig: unknown
  install: unknown
  setup: unknown
  update: unknown
  onEnable: unknown
  onDisable: unknown
  onDependencyReplaced: unknown
  activation: unknown
  retiredShared: unknown
  dispose: unknown
  beforeRelease: unknown
  features: unknown
  pipelines: unknown
  featureExpose: unknown
  asyncDisposer: unknown
  syncDisposer: unknown
}>

/** Reads an optional symbol-keyed disposer; accessor descriptors are ignored as before. */
const readSymbolDisposer = (source: object, key: symbol): unknown => {
  /** Own-property descriptors are inspected without invoking getter values during admission. */
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

/** Reads every supported definition field once, as own data. */
const readDefinitionFields = (source: object): IDefinitionFields => ({
  name: readData(source, PluginDefinitionKey.name),
  rawConfig: readData(source, PluginDefinitionKey.config),
  install: readData(source, PluginDefinitionKey.install),
  setup: readData(source, PluginDefinitionKey.setup),
  update: readData(source, PluginDefinitionKey.update),
  onEnable: readData(source, PluginDefinitionKey.onEnable),
  onDisable: readData(source, PluginDefinitionKey.onDisable),
  onDependencyReplaced: readData(source, PluginDefinitionKey.onDependencyReplaced),
  activation: readData(source, PluginDefinitionKey.activation) ?? PluginActivation.eager,
  retiredShared: readData(source, PluginDefinitionKey.shared),
  dispose: readData(source, PluginDefinitionKey.dispose),
  beforeRelease: readData(source, PluginDefinitionKey.beforeRelease),
  features: readData(source, PluginDefinitionKey.features),
  pipelines: readData(source, PluginDefinitionKey.pipelines),
  featureExpose: readData(source, PluginDefinitionKey.featureExpose),
  asyncDisposer: readSymbolDisposer(source, Symbol.asyncDispose),
  syncDisposer: readSymbolDisposer(source, Symbol.dispose)
})

/** Optional lifecycle fields shared by functional and raw-object plugin definitions. */
export type IDefinitionLifecycleFields = Readonly<{
  install: unknown
  setup: unknown
  beforeRelease: unknown
  update: unknown
  onEnable: unknown
  onDisable: unknown
  onDependencyReplaced: unknown
  dispose: unknown
  activation: unknown
  retiredShared: unknown
}>

/**
 * Rejects a non-function install or hook, an unknown activation, or the retired shared field. The
 * functional and raw-object admission paths share this one rule; each checks its own name rule and
 * disposer form separately.
 */
export const assertDefinitionLifecycle = (fields: IDefinitionLifecycleFields): void => {
  if (typeof fields.install !== 'function')
    throw createPluginHostTypeError(PluginHostInternalText.PLUGIN_INSTALL_FUNCTION)
  if (fields.setup !== undefined && typeof fields.setup !== 'function')
    throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_SETUP_FUNCTION)
  if (fields.beforeRelease !== undefined && typeof fields.beforeRelease !== 'function')
    throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_BEFORE_RELEASE_FUNCTION)
  // Fixed five optional hooks; the bound comes from the definition contract, not from input.
  for (const [key, value] of [
    [PluginDefinitionKey.update, fields.update],
    [PluginDefinitionKey.onEnable, fields.onEnable],
    [PluginDefinitionKey.onDisable, fields.onDisable],
    [PluginDefinitionKey.onDependencyReplaced, fields.onDependencyReplaced],
    [PluginDefinitionKey.dispose, fields.dispose]
  ] as const)
    if (value !== undefined && typeof value !== 'function')
      throw createPluginHostTypeError(PluginHostInternalText.PLUGIN_HOOK_FUNCTION(key))
}

/** Rejects an unknown activation or the retired shared field, after hook-shape checks. */
export const assertDefinitionPolicy = (fields: IDefinitionLifecycleFields): void => {
  if (fields.activation !== PluginActivation.eager && fields.activation !== PluginActivation.lazy)
    throw createPluginDefinitionTypeError()
  if (fields.retiredShared !== undefined) throw createPluginDefinitionTypeError()
}

/** Rejects a malformed name, hook, activation, retired field or Feature expose value. */
const assertDefinitionFields = (fields: IDefinitionFields): void => {
  const { name, featureExpose } = fields
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.includes(PluginDefinitionText.nameSeparator)
  )
    throw createPluginHostTypeError(PluginHostInternalText.PLUGIN_NAME_STRICT)
  assertDefinitionLifecycle(fields)
  // Two symbol disposers; checked after the named hooks, as before.
  for (const [key, value] of [
    [String(Symbol.asyncDispose), fields.asyncDisposer],
    [String(Symbol.dispose), fields.syncDisposer]
  ] as const)
    if (value !== undefined && typeof value !== 'function')
      throw createPluginHostTypeError(PluginHostInternalText.PLUGIN_HOOK_FUNCTION(key))
  assertDefinitionPolicy(fields)
  if (
    featureExpose !== undefined &&
    typeof featureExpose !== 'object' &&
    typeof featureExpose !== 'function'
  )
    throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE)
}

/** Copies unknown own keys as frozen, enumerable metadata; accessors and hidden keys are rejected. */
const snapshotDefinitionMetadata = (source: object): Record<PropertyKey, unknown> => {
  /** Only unknown enumerable own-data keys become immutable public definition metadata. */
  const metadata: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(source)) {
    if (knownKeys.has(key)) continue
    /** Own-property descriptors are inspected without invoking getter values during admission. */
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw createPluginHostTypeError(PluginHostInternalText.PLUGIN_METADATA_DATA)
    /** Array metadata is copied once so later source mutation cannot change the trusted definition. */
    const value = Array.isArray(descriptor.value)
      ? Object.freeze([...descriptor.value])
      : descriptor.value
    Object.defineProperty(metadata, key, {
      value,
      enumerable: true,
      configurable: false,
      writable: false
    })
  }
  return metadata
}

/**
 * Wraps one user hook so it always runs with the definition object as receiver and exactly the
 * hook's declared number of arguments.
 */
const captureHook = (hook: Function, receiver: object, arity: 0 | 1 | 2): Function => {
  if (arity === 0) return () => invokeCaptured(hook, receiver, [])
  if (arity === 1) return (first?: unknown) => invokeCaptured(hook, receiver, [first])
  return (first: unknown, second: unknown) => invokeCaptured(hook, receiver, [first, second])
}

/** Defines one optional captured hook on the frozen plugin, keeping the original key order. */
const defineCapturedHook = (
  plugin: object,
  key: PropertyKey,
  hook: unknown,
  source: object,
  arity: 0 | 1 | 2,
  enumerable = true
): void => {
  if (hook !== undefined)
    Object.defineProperty(plugin, key, {
      value: captureHook(hook as Function, source, arity),
      enumerable
    })
}

/** Builds the frozen trusted plugin object whose hooks call the original definition hooks. */
const createFrozenPlugin = (
  source: object,
  fields: IDefinitionFields,
  featureRecord: object,
  ownedConfig: IPluginConfig,
  metadata: Record<PropertyKey, unknown>
): Record<PropertyKey, unknown> => {
  /** The captured immutable name owns Feature references and the frozen public identity. */
  const name = fields.name as string
  /** Capture installation before wrapping it so the original definition remains its receiver. */
  const install = fields.install as Function
  /** Own property creation order preserves the existing frozen definition surface. */
  const plugin: Record<PropertyKey, unknown> = {}
  Object.defineProperty(plugin, PluginDefinitionKey.name, { value: name, enumerable: true })
  Object.defineProperty(plugin, PluginDefinitionKey.config, {
    value: fields.rawConfig === undefined ? undefined : ownedConfig,
    enumerable: true
  })
  if (fields.pipelines !== undefined)
    Object.defineProperty(plugin, PluginDefinitionKey.pipelines, {
      value: fields.pipelines,
      enumerable: true
    })
  Object.defineProperty(plugin, PluginDefinitionKey.install, {
    value: (...args: unknown[]) => invokeCaptured(install, source, args),
    enumerable: true
  })
  defineCapturedHook(plugin, PluginDefinitionKey.setup, fields.setup, source, 1)
  Object.defineProperty(plugin, PluginDefinitionKey.activation, {
    value: fields.activation,
    enumerable: true
  })
  Object.defineProperty(plugin, PluginDefinitionKey.getFeature, {
    enumerable: false,
    value: (feature: string, options?: Readonly<{ readonly optional?: boolean }>) => {
      if (!Object.hasOwn(featureRecord, feature))
        throw new PluginHostError(
          PluginHostErrorCode.featureNotDeclared,
          ERROR_TEXT.FEATURE_NOT_DECLARED(name, feature)
        )
      return createFeatureReference(name, feature, options?.optional === true)
    }
  })
  defineCapturedHook(plugin, PluginDefinitionKey.update, fields.update, source, 2)
  defineCapturedHook(plugin, PluginDefinitionKey.onEnable, fields.onEnable, source, 1)
  defineCapturedHook(plugin, PluginDefinitionKey.onDisable, fields.onDisable, source, 1)
  defineCapturedHook(
    plugin,
    PluginDefinitionKey.onDependencyReplaced,
    fields.onDependencyReplaced,
    source,
    2
  )
  defineCapturedHook(plugin, PluginDefinitionKey.dispose, fields.dispose, source, 1)
  defineCapturedHook(plugin, PluginDefinitionKey.beforeRelease, fields.beforeRelease, source, 1)
  defineCapturedHook(plugin, Symbol.asyncDispose, fields.asyncDisposer, source, 0, false)
  defineCapturedHook(plugin, Symbol.dispose, fields.syncDisposer, source, 0, false)
  for (const key of Reflect.ownKeys(metadata)) {
    /** Own-property descriptors are inspected without invoking getter values during admission. */
    const descriptor = Object.getOwnPropertyDescriptor(metadata, key)
    if (descriptor) Object.defineProperty(plugin, key, descriptor)
  }
  return Object.freeze(plugin)
}

/** Validate and snapshot one public functional definition without running user hooks. */
const createDefinition = <TPlugin extends IPluginConstraint<any>>(
  source: TPlugin & object
): IStoredDefinition & { readonly plugin: TPlugin } => {
  /** Read every supported source field once before validation or derived snapshots run. */
  const captured = readDefinitionFields(source)
  /** Pipeline declarations are normalized at their original point before field-shape checks. */
  const fields = { ...captured, pipelines: snapshotPipelineDefinitions(captured.pipelines) }
  assertDefinitionFields(fields)
  /** Feature root identity is captured before metadata and configuration admission. */
  const featureRecord = snapshotFeatureRecord(fields.features)
  /** Only unknown enumerable own-data keys become immutable public definition metadata. */
  const metadata = snapshotDefinitionMetadata(source)
  /**
   * Only explicitly supplied config creates the frozen configuration snapshot exposed by the
   * definition.
   */
  const ownedConfig =
    fields.rawConfig === undefined
      ? {}
      : copyConfig(fields.rawConfig as IPluginConfig, PluginDefinitionText.configRecord)
  /** Own property creation order preserves the existing frozen definition surface. */
  const plugin = createFrozenPlugin(source, fields, featureRecord, ownedConfig, metadata)
  /** Resolve symbol cleanup from the finished frozen plugin, keeping captured hook wrappers. */
  const disposer = snapshotDisposer(
    plugin as unknown as import('./plugin-lifecycle-types.ts').IPluginResource
  ).disposer
  /** The private WeakMap stores one immutable definition identity without Host state. */
  const definition: IStoredDefinition = {
    owner: plugin as unknown as IPluginConstraint<any>,
    name: fields.name as string,
    config: ownedConfig,
    install: plugin.install as IPluginConstraint<any>['install'],
    setup: plugin.setup as IPluginDefinition<any>['setup'],
    update: plugin.update as IPluginConstraint<any>['update'],
    onEnable: plugin.onEnable as IPluginConstraint<any>['onEnable'],
    onDisable: plugin.onDisable as IPluginConstraint<any>['onDisable'],
    onDependencyReplaced:
      plugin.onDependencyReplaced as IPluginConstraint<any>['onDependencyReplaced'],
    activation: fields.activation as 'eager' | 'lazy',
    dispose: plugin.dispose as IPluginConstraint<any>['dispose'],
    beforeRelease: plugin.beforeRelease as IPluginConstraint<any>['beforeRelease'],
    features: Object.freeze(featureRecord),
    pipelines: fields.pipelines,
    featureExpose: fields.featureExpose as IPluginDefinition<any>['featureExpose'],
    disposer
  }
  definitions.set(plugin, definition)
  return Object.assign(definition, {
    plugin: plugin as unknown as TPlugin
  }) as IStoredDefinition & {
    readonly plugin: TPlugin
  }
}

/**
 * Defines a trusted plugin from a name and a synchronous per-registration descriptor factory.
 * Calling definePlugin() captures definition identity without running that factory. The optional
 * Feature root record defaults to none; the factory runs during installation and cannot return a
 * Promise. Invalid names/fields fail admission; lifecycle failures roll back the install batch.
 */
export function definePlugin<
  TCore extends object = Record<string, never>,
  TExtension extends Record<string, unknown> = Record<never, never>,
  TValue = never,
  const TName extends string = string,
  const TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object & IFeatureRecordRequiredExpose<TFeatures> = object &
    IFeatureRecordRequiredExpose<TFeatures>,
  TPublic extends object = Record<never, never>,
  TShared extends object = Record<never, never>
>(
  name: TName,
  descriptorFactory: (
    core: TCore &
      import('./plugin-core-types.ts').IPluginHostCore<TValue> &
      Readonly<{ readonly features: IFeatureOutputs<TFeatures>; readonly featureExpose: TExpose }>
  ) => IPluginDescriptor<TExtension, TPublic, TExpose, TShared> &
    (keyof IFeatureRecordRequiredExpose<TFeatures> extends never
      ? unknown
      : { readonly featureExpose: () => TExpose }) &
    (keyof TExtension & keyof TPublic extends never
      ? unknown
      : { readonly duplicateHostProjectionKeys: never }),
  featureRecord?: TFeatures
): IDefinedPluginConstraint<
  TCore,
  TValue,
  TExtension & TPublic,
  IPluginConfig,
  TShared,
  TName,
  TFeatures,
  TExpose
>

/**
 * Captures an object definition with async-capable setup before Feature construction and install.
 * Configuration is copied/frozen, hooks retain their original receiver, and supported metadata is
 * snapshotted without running hooks. Omitted activation is eager. Use the async installation path
 * for eager setup; the exact setup output is passed to featureExpose/install as argument two.
 */
export function definePlugin<
  TCore extends object = Record<string, never>,
  TExtension extends Record<string, unknown> = Record<string, never>,
  TValue = never,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>,
  const TName extends string = string,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>,
  TDefinition extends object = object,
  TSetup = unknown,
  const TPipelines extends IPipelineDefinitions = Record<never, never>
>(
  definition: IPluginCommon<
    TCore &
      import('./plugin-core-types.ts').IPluginHostCore<TValue> &
      import('./plugin-core-types.ts').IPluginPipelineCore<TPipelines, TFeatures>,
    TConfig,
    TFeatures,
    TExpose
  > &
    IPluginSetupHooks<
      TCore &
        import('./plugin-core-types.ts').IPluginHostCore<TValue> &
        import('./plugin-core-types.ts').IPluginPipelineCore<TPipelines, TFeatures>,
      TExtension,
      TConfig,
      TFeatures,
      TExpose,
      TSetup
    > &
    Readonly<{ name: TName; pipelines?: TPipelines }> &
    (TExpose extends IFeatureRecordRequiredExpose<TFeatures> ? unknown : never) &
    TDefinition
): IDefinedPluginConstraint<
  TCore,
  TValue,
  TExtension,
  TConfig,
  TShared,
  TName,
  TFeatures,
  TExpose,
  TSetup,
  TPipelines
> &
  Readonly<Omit<TDefinition, keyof IPlugin<any, any, any, any, any, any, any> | 'name'>>

/**
 * Captures an object definition without setup, preserving one-argument install/featureExpose hooks.
 * It returns a frozen trusted definition, not a live plugin handle. Invalid own-data fields or
 * configuration fail now; hooks and per-registration Feature factories run only when installed.
 */
export function definePlugin<
  TCore extends object = Record<string, never>,
  TExtension extends Record<string, unknown> = Record<string, never>,
  TValue = never,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>,
  const TName extends string = string,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>,
  TDefinition extends object = object,
  const TPipelines extends IPipelineDefinitions = Record<never, never>
>(
  definition: IPlugin<
    TCore &
      import('./plugin-core-types.ts').IPluginHostCore<TValue> &
      import('./plugin-core-types.ts').IPluginPipelineCore<TPipelines, TFeatures>,
    TExtension,
    TConfig,
    TShared,
    TFeatures,
    TExpose
  > &
    Readonly<{ name: TName; pipelines?: TPipelines }> &
    (TExpose extends IFeatureRecordRequiredExpose<TFeatures> ? unknown : never) &
    TDefinition
): IDefinedPluginConstraint<
  TCore,
  TValue,
  TExtension,
  TConfig,
  TShared,
  TName,
  TFeatures,
  TExpose,
  never,
  TPipelines
> &
  Readonly<Omit<TDefinition, keyof IPlugin<any, any, any, any> | 'name'>>

/** Dispatches by the first argument only; definition capture never runs a descriptor factory. */
export function definePlugin(
  ...args: readonly [unknown, unknown?, unknown?]
): IDefinedPluginConstraint {
  if (typeof args[0] === 'string') {
    if (typeof args[1] !== 'function')
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_HOOK_DATA)
    /** The private WeakMap stores one immutable definition identity without Host state. */
    const definition = createDefinition({
      name: args[0],
      install: () => ({}),
      features: args[2]
    } as IPluginConstraint<any>)
    /** Only the newly minted definition receives its original per-registration descriptor factory. */
    const stored = definitions.get(definition.plugin)!
    Object.assign(
      stored as {
        descriptorFactory?: (core: object) => IPluginDescriptor
      },
      {
        descriptorFactory: args[1] as (core: object) => IPluginDescriptor
      }
    )
    return definition.plugin as IDefinedPluginConstraint
  }
  if (!args[0] || typeof args[0] !== 'object')
    throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DEFINITION)
  return createDefinition(args[0] as IPluginConstraint<any>).plugin as IDefinedPluginConstraint
}

/** Internal trusted lookup used only by package-owned admission adapters. */
export const readDefinedPluginDefinition = (value: unknown): IStoredDefinition | undefined => {
  // WeakMap#get already returns undefined for primitives; avoiding a duplicate type branch keeps
  // the trusted admission probe on its canonical single lookup while preserving forged-value safety.
  return definitions.get(value as object)
}

/**
 * Reports whether this package instance created a plugin without reading user properties or running
 * hooks. Structural copies and definitions issued by another package instance return false;
 * canonical Host admission can still process supported raw object definitions separately.
 */
export const isDefinedPlugin = (value: unknown): value is IDefinedPluginConstraint =>
  readDefinedPluginDefinition(value) !== undefined
