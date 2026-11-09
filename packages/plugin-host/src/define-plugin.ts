import { PLUGIN_HOST_SOURCE } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
/** Owns native definition identity; every raw field rule lives in definition-snapshots.ts. */
import { PluginDefinitionKey } from './definition-constants.ts'
import { snapshotPluginDefinition } from './definition-snapshots.ts'
import ERROR_TEXT from './error-text.ts'
import { PluginHostError } from './errors.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { createFeatureReference } from './feature-definition-snapshots.ts'
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
import type { IPipelineDefinitions } from './pipeline-spec.ts'
import type { IPluginConfig } from './plugin-lifecycle-types.ts'
/** Canonical trusted snapshot type; it contains the original hook owner, never public wrappers. */
type IStoredDefinition = IPluginDefinition<any>
/** Native identity authority is unchanged and never holds a host registration. */
const definitions = new WeakMap<object, IStoredDefinition>()
/** One definition owns its reference factory without capturing a per-call function environment. */
class DefinedFeatureReferences {
  /** The same immutable snapshot supplies name and selected native feature roots. */
  readonly #definition: IStoredDefinition
  /** Retain declaration data only; no installation state is allocated at definition time. */
  constructor(definition: IStoredDefinition) {
    this.#definition = definition
  }
  /** Resolve one declared feature name while retaining the existing coded rejection. */
  readonly getFeature = (feature: string, options?: Readonly<{ readonly optional?: boolean }>) => {
    if (!Object.hasOwn(this.#definition.features, feature))
      throw new PluginHostError(
        PluginHostErrorCode.featureNotDeclared,
        ERROR_TEXT.FEATURE_NOT_DECLARED(this.#definition.name, feature)
      )
    return createFeatureReference(this.#definition.name, feature, options?.optional === true)
  }
}
/** Descriptor-form definitions use the same raw install field without a per-definition wrapper. */
function emptyDescriptorInstall(): Record<never, never> {
  return {}
}
/** Capture once through raw admission and publish only the four approved immutable fields. */
function createDefinition(
  source: IPluginConstraint<any> & object
): IStoredDefinition & { readonly plugin: IPluginConstraint<any> } {
  /** Canonical capture never uses trusted lookup on its own source. */
  const captured = snapshotPluginDefinition(source)
  /** Reference methods belong to a named declaration owner with no host lifetime. */
  const references = new DefinedFeatureReferences(captured)
  /**
   * Enumeration order matches the thin public definition contract; getFeature retains its existing
   * non-enumerable descriptor.
   */
  const plugin = Object.defineProperties(
    {},
    {
      [PluginDefinitionKey.name]: { value: captured.name, enumerable: true },
      [PluginDefinitionKey.config]: { value: captured.config, enumerable: true },
      [PluginDefinitionKey.activation]: { value: captured.activation, enumerable: true },
      [PluginDefinitionKey.getFeature]: { value: references.getFeature }
    }
  )
  Object.freeze(plugin)
  definitions.set(plugin, captured)
  return Object.assign(captured, { plugin: plugin as IPluginConstraint<any> })
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
>

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
>

/** Dispatches by the first argument only; definition capture never runs a descriptor factory. */
export function definePlugin(
  ...args: readonly [unknown, unknown?, unknown?]
): IDefinedPluginConstraint {
  if (typeof args[0] === 'string') {
    if (typeof args[1] !== 'function')
      throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_HOOK_DATA), {
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.invalidOption
      })
    /** The private WeakMap stores one immutable definition identity without Host state. */
    const definition = createDefinition({
      name: args[0],
      install: emptyDescriptorInstall,
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
    throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_DEFINITION), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
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
