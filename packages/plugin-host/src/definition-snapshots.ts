import { PLUGIN_HOST_SOURCE } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import { snapshotModuleClaims } from './module-claims.ts'
/**
 * Captures immutable plugin definitions and batch-name admission; installation and lifecycle work
 * stay with their runtime owners.
 */
import { PluginActivation } from './state-constants.ts'
import { PluginDefinitionKey, PluginDefinitionText } from './definition-constants.ts'
import { snapshotPipelineDefinitions } from './pipeline-declarations.ts'
import { copyConfig } from './config.ts'
import { snapshotDisposer } from './disposal.ts'
import { snapshotFeatureRecord } from './feature-definition-snapshots.ts'

import ERROR_TEXT, { PluginHostInternalText } from './error-text.ts'
import { PluginHostError } from './errors.ts'
import { PluginHostErrorCode } from './error-code.ts'
import type { IPluginDefinition } from './registry.ts'
import type { IPluginConfig, IPluginResource } from './plugin-lifecycle-types.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginHostCore } from './plugin-core-types.ts'

/** Package-local trusted-definition lookup injected by functional entries only. */
export type ITrustedDefinitionReader = (value: unknown) => IPluginDefinition<any> | undefined

/** Captures hostile plugin getters once and validates one immutable admission definition batch. */
export const snapshotPluginDefinitions = <TDomainCore extends object, TValue>(
  plugins: readonly IPluginConstraint<any>[],
  trustedReader?: ITrustedDefinitionReader
): IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[] => {
  /** Duplicate names belong only to this captured batch, including trusted definitions. */
  const context: IDefinitionAdmissionContext = { names: new Set<string>(), trustedReader }
  return plugins.map((plugin) => snapshotPluginDefinition<TDomainCore, TValue>(plugin, context))
}

/** One batch supplies only duplicate-name ownership and its optional trusted identity authority. */
type IDefinitionAdmissionContext = Readonly<{
  readonly names: Set<string>
  readonly trustedReader: ITrustedDefinitionReader | undefined
}>

/** Captures and admits one definition in the original getter, validation and snapshot order. */
export function snapshotPluginDefinition<TDomainCore extends object, TValue>(
  plugin: IPluginConstraint<any>,
  context?: IDefinitionAdmissionContext
): IPluginDefinition<TDomainCore & IPluginHostCore<TValue>> {
  /** Trusted readers keep their original receiverless call and precede every user-property read. */
  const trustedReader = context?.trustedReader
  /** A trusted identity bypasses raw getters while still sharing this batch's duplicate-name set. */
  const trusted = trustedReader?.(plugin)
  if (trusted) {
    if (context?.names.has(trusted.name))
      throw new PluginHostError(
        PluginHostErrorCode.pluginDuplicate,
        ERROR_TEXT.PLUGIN_DUPLICATE(trusted.name)
      )
    context?.names.add(trusted.name)
    return trusted as IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
  }
  /** Trusted lookup already failed; the supported fallback is the captured raw descriptor. */
  const raw = plugin as import('./plugin-definition-types.ts').IRawPluginConstraint<any>
  /** One raw snapshot preserves getter order and retains every value for validation without rereads. */
  let captured: {
    readonly name: unknown
    readonly config: unknown
    readonly install: unknown
    readonly setup: unknown
    readonly update: unknown
    readonly onEnable: unknown
    readonly onDisable: unknown
    readonly onDependencyReplaced: unknown
    readonly activation: unknown
    readonly dispose: unknown
    readonly beforeRelease: unknown
    readonly retiredShared: unknown
    readonly pipelines: unknown
    readonly features: unknown
    readonly featureExpose: unknown
    readonly disposer: ReturnType<typeof snapshotDisposer>
  }
  try {
    captured = {
      name: raw?.[PluginDefinitionKey.name],
      config: raw?.[PluginDefinitionKey.config],
      install: raw?.[PluginDefinitionKey.install],
      setup: (raw as { readonly setup?: unknown })?.[PluginDefinitionKey.setup],
      update: raw?.[PluginDefinitionKey.update],
      onEnable: raw?.[PluginDefinitionKey.onEnable],
      onDisable: raw?.[PluginDefinitionKey.onDisable],
      onDependencyReplaced: raw?.[PluginDefinitionKey.onDependencyReplaced],
      activation: raw?.[PluginDefinitionKey.activation] ?? PluginActivation.eager,
      dispose: raw?.[PluginDefinitionKey.dispose],
      beforeRelease: readPluginDefinitionData(raw, PluginDefinitionKey.beforeRelease),
      retiredShared: (raw as { readonly shared?: unknown })?.[PluginDefinitionKey.shared],
      pipelines: readPluginDefinitionData(raw, PluginDefinitionKey.pipelines),
      features: raw?.[PluginDefinitionKey.features],
      featureExpose: raw?.[PluginDefinitionKey.featureExpose],
      disposer: snapshotDisposer(raw as IPluginResource)
    }
  } catch (cause) {
    throw attachErrorIdentity(
      new TypeError(ERROR_TEXT.INVALID_OPTION, cause !== undefined ? { cause: cause } : undefined),
      { source: PLUGIN_HOST_SOURCE, code: PluginHostErrorCode.invalidOption }
    )
  }
  const {
    name,
    config: rawConfig,
    install,
    setup,
    update,
    onEnable,
    onDisable,
    onDependencyReplaced,
    activation,
    dispose,
    beforeRelease,
    features,
    pipelines,
    featureExpose,
    disposer
  } = captured
  if (typeof name !== 'string' || name.length === 0)
    throw attachErrorIdentity(new TypeError(PluginHostInternalText.PLUGIN_NAME_REQUIRED), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  if (name.includes(PluginDefinitionText.nameSeparator))
    throw attachErrorIdentity(new TypeError(PluginHostInternalText.PLUGIN_NAME_DOT), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  assertDefinitionLifecycle(captured)
  assertDefinitionPolicy(captured)
  if (
    featureExpose !== undefined &&
    typeof featureExpose !== 'object' &&
    typeof featureExpose !== 'function'
  )
    throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  // symbols.ts fixes this bound at at most two asynchronous keys and one synchronous key.
  for (const candidate of [...disposer.asyncCandidates, ...disposer.disposeCandidates])
    if (candidate.value !== undefined && typeof candidate.value !== 'function')
      throw attachErrorIdentity(
        new TypeError(PluginHostInternalText.PLUGIN_DISPOSER_FUNCTION(candidate.key)),
        { source: PLUGIN_HOST_SOURCE, code: PluginHostErrorCode.invalidOption }
      )
  if (context?.names.has(name))
    throw new PluginHostError(
      PluginHostErrorCode.pluginDuplicate,
      ERROR_TEXT.PLUGIN_DUPLICATE(name)
    )
  context?.names.add(name)
  /** Snapshot order matches raw baseline admission before deriving module claims. */
  const config =
    rawConfig === undefined
      ? (Object.freeze(Object.create(null)) as IPluginConfig)
      : copyConfig(rawConfig as IPluginConfig, PluginDefinitionText.configRecord)
  /** Native root identity is validated before dependency metadata can be inspected. */
  const featureRecord = snapshotFeatureRecord(features)
  /** Declaration normalization retains its original position after feature admission. */
  const pipelineRecord = snapshotPipelineDefinitions(pipelines)
  return {
    claimed: snapshotModuleClaims(captured, featureRecord),
    owner: plugin,
    name,
    config,
    install: install as import('./plugin-definition-types.ts').IRawPluginConstraint<any>['install'],
    setup: setup as IPluginDefinition<any>['setup'],
    update: update as import('./plugin-definition-types.ts').IRawPluginConstraint<any>['update'],
    onEnable:
      onEnable as import('./plugin-definition-types.ts').IRawPluginConstraint<any>['onEnable'],
    onDisable:
      onDisable as import('./plugin-definition-types.ts').IRawPluginConstraint<any>['onDisable'],
    onDependencyReplaced:
      onDependencyReplaced as import('./plugin-definition-types.ts').IRawPluginConstraint<any>['onDependencyReplaced'],
    activation: activation as 'eager' | 'lazy',
    dispose: dispose as import('./plugin-definition-types.ts').IRawPluginConstraint<any>['dispose'],
    beforeRelease:
      beforeRelease as import('./plugin-definition-types.ts').IRawPluginConstraint<any>['beforeRelease'],
    disposer: disposer.disposer,
    features: featureRecord,
    pipelines: pipelineRecord,
    featureExpose: featureExpose as IPluginDefinition<any>['featureExpose']
  }
}

/** Rejects conflicts against the committed registry and creates install transaction entries. */
export const preflightPluginDefinitions = <TDefinition extends { readonly name: string }>(
  plugins: readonly TDefinition[],
  hasRegistration: (name: string) => boolean
): Array<{ readonly plugin: TDefinition; readonly name: string }> => {
  for (const plugin of plugins)
    if (hasRegistration(plugin.name))
      throw new PluginHostError(
        PluginHostErrorCode.pluginDuplicate,
        ERROR_TEXT.PLUGIN_DUPLICATE(plugin.name)
      )
  return plugins.map((plugin) => ({ plugin, name: plugin.name }))
}

/** Read one descriptor field once and reject getters that could change admission semantics. */
const readPluginDefinitionData = (source: object, key: PropertyKey): unknown => {
  /** Own-property descriptors are inspected without invoking getter values during admission. */
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor))
    throw attachErrorIdentity(new TypeError(PluginHostInternalText.PLUGIN_PROPERTY_DATA(key)), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  return descriptor.value
}

/** Shares the existing own-data admission rule with the raw-object release hook snapshot. */

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
    throw attachErrorIdentity(new TypeError(PluginHostInternalText.PLUGIN_INSTALL_FUNCTION), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  if (fields.setup !== undefined && typeof fields.setup !== 'function')
    throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_SETUP_FUNCTION), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  if (fields.beforeRelease !== undefined && typeof fields.beforeRelease !== 'function')
    throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_BEFORE_RELEASE_FUNCTION), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  // Fixed five optional hooks; the bound comes from the definition contract, not from input.
  for (const [key, value] of [
    [PluginDefinitionKey.update, fields.update],
    [PluginDefinitionKey.onEnable, fields.onEnable],
    [PluginDefinitionKey.onDisable, fields.onDisable],
    [PluginDefinitionKey.onDependencyReplaced, fields.onDependencyReplaced],
    [PluginDefinitionKey.dispose, fields.dispose]
  ] as const)
    if (value !== undefined && typeof value !== 'function')
      throw attachErrorIdentity(new TypeError(PluginHostInternalText.PLUGIN_HOOK_FUNCTION(key)), {
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.invalidOption
      })
}

/** Rejects an unknown activation or the retired shared field, after hook-shape checks. */
export const assertDefinitionPolicy = (fields: IDefinitionLifecycleFields): void => {
  if (fields.activation !== PluginActivation.eager && fields.activation !== PluginActivation.lazy)
    throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_DEFINITION_INVALID), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.pluginDefinitionInvalid
    })
  if (fields.retiredShared !== undefined)
    throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_DEFINITION_INVALID), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.pluginDefinitionInvalid
    })
}
