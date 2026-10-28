/**
 * Captures immutable plugin definitions and batch-name admission; installation and lifecycle work
 * stay with their runtime owners.
 */
import { PluginActivation } from './state-constants.js'
import { PluginDefinitionKey, PluginDefinitionText } from './definition-constants.js'
import { snapshotPipelineDefinitions } from './pipeline-declarations.js'
import { copyConfig } from './config.js'
import { snapshotDisposer } from './disposal.js'
import { snapshotFeatureRecord } from './define-feature.js'
import {
  assertDefinitionLifecycle,
  assertDefinitionPolicy,
  readPluginDefinitionData
} from './define-plugin.js'
import ERROR_TEXT, {
  PluginHostError,
  createPluginHostTypeError,
  PluginHostInternalText
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IPluginDefinition } from './registry.js'
import type { IPluginConfig, IPluginResource } from './plugin-lifecycle-types.js'
import type { IPluginConstraint } from './plugin-definition-types.js'
import type { IPluginHostCore } from './plugin-core-types.js'

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
function snapshotPluginDefinition<TDomainCore extends object, TValue>(
  plugin: IPluginConstraint<any>,
  context: IDefinitionAdmissionContext
): IPluginDefinition<TDomainCore & IPluginHostCore<TValue>> {
  /** Trusted readers keep their original receiverless call and precede every user-property read. */
  const trustedReader = context.trustedReader
  /** A trusted identity bypasses raw getters while still sharing this batch's duplicate-name set. */
  const trusted = trustedReader?.(plugin)
  if (trusted) {
    if (context.names.has(trusted.name))
      throw new PluginHostError(
        PluginHostErrorCode.pluginDuplicate,
        ERROR_TEXT.PLUGIN_DUPLICATE(trusted.name)
      )
    context.names.add(trusted.name)
    return trusted as IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
  }
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
      name: plugin?.[PluginDefinitionKey.name],
      config: plugin?.[PluginDefinitionKey.config],
      install: plugin?.[PluginDefinitionKey.install],
      setup: (plugin as { readonly setup?: unknown })?.[PluginDefinitionKey.setup],
      update: plugin?.[PluginDefinitionKey.update],
      onEnable: plugin?.[PluginDefinitionKey.onEnable],
      onDisable: plugin?.[PluginDefinitionKey.onDisable],
      onDependencyReplaced: plugin?.[PluginDefinitionKey.onDependencyReplaced],
      activation: plugin?.[PluginDefinitionKey.activation] ?? PluginActivation.eager,
      dispose: plugin?.[PluginDefinitionKey.dispose],
      beforeRelease: readPluginDefinitionData(plugin, PluginDefinitionKey.beforeRelease),
      retiredShared: (plugin as { readonly shared?: unknown })?.[PluginDefinitionKey.shared],
      pipelines: readPluginDefinitionData(plugin, PluginDefinitionKey.pipelines),
      features: plugin?.[PluginDefinitionKey.features],
      featureExpose: plugin?.[PluginDefinitionKey.featureExpose],
      disposer: snapshotDisposer(plugin as IPluginResource)
    }
  } catch (cause) {
    throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
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
    throw createPluginHostTypeError(PluginHostInternalText.PLUGIN_NAME_REQUIRED)
  if (name.includes(PluginDefinitionText.nameSeparator))
    throw createPluginHostTypeError(PluginHostInternalText.PLUGIN_NAME_DOT)
  assertDefinitionLifecycle(captured)
  assertDefinitionPolicy(captured)
  // symbols.ts fixes this bound at at most two asynchronous keys and one synchronous key.
  for (const candidate of [...disposer.asyncCandidates, ...disposer.disposeCandidates])
    if (candidate.value !== undefined && typeof candidate.value !== 'function')
      throw createPluginHostTypeError(
        PluginHostInternalText.PLUGIN_DISPOSER_FUNCTION(candidate.key)
      )
  if (context.names.has(name))
    throw new PluginHostError(
      PluginHostErrorCode.pluginDuplicate,
      ERROR_TEXT.PLUGIN_DUPLICATE(name)
    )
  context.names.add(name)
  return {
    owner: plugin,
    name,
    config: copyConfig((rawConfig ?? {}) as IPluginConfig, PluginDefinitionText.configRecord),
    install: install as IPluginConstraint<any>['install'],
    setup: setup as IPluginDefinition<any>['setup'],
    update: update as IPluginConstraint<any>['update'],
    onEnable: onEnable as IPluginConstraint<any>['onEnable'],
    onDisable: onDisable as IPluginConstraint<any>['onDisable'],
    onDependencyReplaced: onDependencyReplaced as IPluginConstraint<any>['onDependencyReplaced'],
    activation: activation as 'eager' | 'lazy',
    dispose: dispose as IPluginConstraint<any>['dispose'],
    beforeRelease: beforeRelease as IPluginConstraint<any>['beforeRelease'],
    disposer: disposer.disposer,
    features: snapshotFeatureRecord(features),
    pipelines: snapshotPipelineDefinitions(pipelines),
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
