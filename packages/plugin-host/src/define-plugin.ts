import { copyConfig } from './config.js'
import { snapshotDisposer } from './disposal.js'
import { invokeCaptured } from './invocation.js'
import ERROR_TEXT, {
  createPluginDefinitionTypeError,
  createPluginHostTypeError,
  PluginHostError
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { createFeatureReference, snapshotFeatureRecord } from './define-feature.js'
import type { IPluginDefinition, IPluginDescriptor } from './registry.js'
import type {
  IFeatureOutputs,
  IFeatureRecord,
  IFeatureRecordRequiredExpose
} from './feature-types.js'
import type {
  IDefinedPluginConstraint,
  IPlugin,
  IPluginConfig,
  IPluginConstraint
} from './typing.js'

type IStoredDefinition = IPluginDefinition<any>

/** Module-private identity authority for functional definitions. It never stores Host state. */
const definitions = new WeakMap<object, IStoredDefinition>()

const knownKeys = new Set<PropertyKey>([
  'name',
  'config',
  'install',
  'update',
  'onEnable',
  'onDisable',
  'dispose',
  'shared',
  'features',
  'featureExpose',
  'activation',
  'onDependencyReplaced',
  Symbol.dispose,
  Symbol.asyncDispose
])

/** Read one descriptor field once and reject getters that could change admission semantics. */
const readData = (source: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor))
    throw createPluginHostTypeError(`plugin ${String(key)} must be a data property`)
  return descriptor.value
}

/** Validate and snapshot one public functional definition without running user hooks. */
const createDefinition = <TPlugin extends IPluginConstraint<any>>(
  source: TPlugin & object
): IStoredDefinition & { readonly plugin: TPlugin } => {
  const name = readData(source, 'name')
  const rawConfig = readData(source, 'config')
  const install = readData(source, 'install')
  const update = readData(source, 'update')
  const onEnable = readData(source, 'onEnable')
  const onDisable = readData(source, 'onDisable')
  const onDependencyReplaced = readData(source, 'onDependencyReplaced')
  const activation = readData(source, 'activation') ?? 'eager'
  const retiredShared = readData(source, 'shared')
  const dispose = readData(source, 'dispose')
  const features = readData(source, 'features')
  const featureExpose = readData(source, 'featureExpose')
  const asyncDispose = Object.getOwnPropertyDescriptor(source, Symbol.asyncDispose)
  const syncDispose = Object.getOwnPropertyDescriptor(source, Symbol.dispose)
  const asyncDisposer = asyncDispose && 'value' in asyncDispose ? asyncDispose.value : undefined
  const syncDisposer = syncDispose && 'value' in syncDispose ? syncDispose.value : undefined

  if (typeof name !== 'string' || name.length === 0 || name.includes('.'))
    throw createPluginHostTypeError('plugin name must be a non-empty string without "."')
  if (typeof install !== 'function')
    throw createPluginHostTypeError('plugin install must be a function')
  for (const [key, value] of [
    ['update', update],
    ['onEnable', onEnable],
    ['onDisable', onDisable],
    ['onDependencyReplaced', onDependencyReplaced],
    ['dispose', dispose],
    [String(Symbol.asyncDispose), asyncDisposer],
    [String(Symbol.dispose), syncDisposer]
  ] as const)
    if (value !== undefined && typeof value !== 'function')
      throw createPluginHostTypeError(`plugin ${key} must be a function`)
  if (activation !== 'eager' && activation !== 'lazy') throw createPluginDefinitionTypeError()
  if (retiredShared !== undefined) throw createPluginDefinitionTypeError()
  if (
    featureExpose !== undefined &&
    typeof featureExpose !== 'object' &&
    typeof featureExpose !== 'function'
  )
    throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE)
  const featureRecord = snapshotFeatureRecord(features)

  const metadata: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(source)) {
    if (knownKeys.has(key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw createPluginHostTypeError('plugin metadata must be enumerable data properties')
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

  const ownedConfig =
    rawConfig === undefined ? {} : copyConfig(rawConfig as IPluginConfig, 'plugin config')
  const plugin: Record<PropertyKey, unknown> = {}
  Object.defineProperty(plugin, 'name', { value: name, enumerable: true })
  Object.defineProperty(plugin, 'config', {
    value: rawConfig === undefined ? undefined : ownedConfig,
    enumerable: true
  })
  Object.defineProperty(plugin, 'install', {
    value: (core: unknown) => invokeCaptured(install as Function, source, [core]),
    enumerable: true
  })
  Object.defineProperty(plugin, 'activation', { value: activation, enumerable: true })
  Object.defineProperty(plugin, 'getFeature', {
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
  if (update !== undefined)
    Object.defineProperty(plugin, 'update', {
      value: (next: unknown, core: unknown) =>
        invokeCaptured(update as Function, source, [next, core]),
      enumerable: true
    })
  if (onEnable !== undefined)
    Object.defineProperty(plugin, 'onEnable', {
      value: (context: unknown) => invokeCaptured(onEnable as Function, source, [context]),
      enumerable: true
    })
  if (onDisable !== undefined)
    Object.defineProperty(plugin, 'onDisable', {
      value: (context: unknown) => invokeCaptured(onDisable as Function, source, [context]),
      enumerable: true
    })
  if (onDependencyReplaced !== undefined)
    Object.defineProperty(plugin, 'onDependencyReplaced', {
      value: (provider: string, outputs: Readonly<Record<string, object>>) =>
        invokeCaptured(onDependencyReplaced as Function, source, [provider, outputs]),
      enumerable: true
    })
  if (dispose !== undefined)
    Object.defineProperty(plugin, 'dispose', {
      value: (context?: unknown) => invokeCaptured(dispose as Function, source, [context]),
      enumerable: true
    })
  if (asyncDisposer !== undefined)
    Object.defineProperty(plugin, Symbol.asyncDispose, {
      value: () => invokeCaptured(asyncDisposer as Function, source, []),
      enumerable: false
    })
  if (syncDisposer !== undefined)
    Object.defineProperty(plugin, Symbol.dispose, {
      value: () => invokeCaptured(syncDisposer as Function, source, []),
      enumerable: false
    })
  for (const key of Reflect.ownKeys(metadata)) {
    const descriptor = Object.getOwnPropertyDescriptor(metadata, key)
    if (descriptor) Object.defineProperty(plugin, key, descriptor)
  }
  Object.freeze(plugin)

  const disposer = snapshotDisposer(
    plugin as unknown as import('./typing.js').IPluginResource
  ).disposer
  const definition: IStoredDefinition = {
    owner: plugin as unknown as IPluginConstraint<any>,
    name,
    config: ownedConfig,
    install: plugin.install as IPluginConstraint<any>['install'],
    update: plugin.update as IPluginConstraint<any>['update'],
    onEnable: plugin.onEnable as IPluginConstraint<any>['onEnable'],
    onDisable: plugin.onDisable as IPluginConstraint<any>['onDisable'],
    onDependencyReplaced:
      plugin.onDependencyReplaced as IPluginConstraint<any>['onDependencyReplaced'],
    activation: activation as 'eager' | 'lazy',
    dispose: plugin.dispose as IPluginConstraint<any>['dispose'],
    features: Object.freeze(featureRecord),
    featureExpose: featureExpose as IPluginDefinition<any>['featureExpose'],
    disposer
  }
  definitions.set(plugin, definition)
  return Object.assign(definition, {
    plugin: plugin as unknown as TPlugin
  }) as IStoredDefinition & {
    readonly plugin: TPlugin
  }
}

/** Canonical function form creates one synchronous descriptor for each registration. */
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
      import('./typing.js').IPluginHostCore<TValue> &
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

/** Functional full descriptor form retaining config and metadata shape. */
export function definePlugin<
  TCore extends object = Record<string, never>,
  TExtension extends Record<string, unknown> = Record<string, never>,
  TValue = never,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>,
  const TName extends string = string,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>,
  TDefinition extends object = object
>(
  definition: IPlugin<
    TCore & import('./typing.js').IPluginHostCore<TValue>,
    TExtension,
    TConfig,
    TShared,
    TFeatures,
    TExpose
  > &
    Readonly<{ name: TName }> &
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
  TExpose
> &
  Readonly<Omit<TDefinition, keyof IPlugin<any, any, any, any> | 'name'>>

export function definePlugin(
  ...args: readonly [unknown, unknown?, unknown?]
): IDefinedPluginConstraint {
  if (typeof args[0] === 'string') {
    if (typeof args[1] !== 'function')
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_HOOK_DATA)
    const definition = createDefinition({
      name: args[0],
      install: () => ({}),
      features: args[2]
    } as IPluginConstraint<any>)
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
