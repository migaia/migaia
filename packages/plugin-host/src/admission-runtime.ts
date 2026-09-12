import { copyConfig } from './config.js'
import { snapshotDisposer } from './disposal.js'
import { snapshotFeatureRecord } from './define-feature.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IPluginDefinition } from './registry.js'
import type {
  IPluginConfig,
  IPluginConstraint,
  IPluginHostCore,
  IPluginResource
} from './typing.js'

/** Package-local trusted-definition lookup injected by functional entries only. */
export type ITrustedDefinitionReader = (value: unknown) => IPluginDefinition<any> | undefined

/** Captures hostile plugin getters once and validates one immutable admission definition batch. */
export const snapshotPluginDefinitions = <TDomainCore extends object, TValue>(
  plugins: readonly IPluginConstraint<any>[],
  trustedReader?: ITrustedDefinitionReader
): IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[] => {
  const names = new Set<string>()
  return plugins.map((plugin) => {
    const trusted = trustedReader?.(plugin)
    if (trusted) {
      if (names.has(trusted.name))
        throw new PluginHostError(
          PluginHostErrorCode.pluginDuplicate,
          ERROR_TEXT.PLUGIN_DUPLICATE(trusted.name)
        )
      names.add(trusted.name)
      return trusted as IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
    }
    let captured: {
      readonly name: unknown
      readonly config: unknown
      readonly install: unknown
      readonly update: unknown
      readonly dispose: unknown
      readonly shared: unknown
      readonly features: unknown
      readonly featureExpose: unknown
      readonly disposer: ReturnType<typeof snapshotDisposer>
    }
    try {
      captured = {
        name: plugin?.name,
        config: plugin?.config,
        install: plugin?.install,
        update: plugin?.update,
        dispose: plugin?.dispose,
        shared: plugin?.shared,
        features: plugin?.features,
        featureExpose: plugin?.featureExpose,
        disposer: snapshotDisposer(plugin as IPluginResource)
      }
    } catch (cause) {
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
    }
    const {
      name,
      config: rawConfig,
      install,
      update,
      dispose,
      shared,
      features,
      featureExpose,
      disposer
    } = captured
    if (typeof name !== 'string' || name.length === 0)
      throw createPluginHostTypeError('plugin name must be a non-empty string')
    if (name.includes('.')) throw createPluginHostTypeError('plugin name must not contain "."')
    if (typeof install !== 'function')
      throw createPluginHostTypeError('plugin install must be a function')
    for (const [key, hook] of [
      ['update', update],
      ['dispose', dispose],
      ['shared', shared]
    ] as const)
      if (hook !== undefined && typeof hook !== 'function')
        throw createPluginHostTypeError(`plugin ${key} must be a function`)
    for (const candidate of [...disposer.asyncCandidates, ...disposer.disposeCandidates])
      if (candidate.value !== undefined && typeof candidate.value !== 'function')
        throw createPluginHostTypeError(
          `plugin disposer ${String(candidate.key)} must be a function`
        )
    if (names.has(name))
      throw new PluginHostError(
        PluginHostErrorCode.pluginDuplicate,
        ERROR_TEXT.PLUGIN_DUPLICATE(name)
      )
    names.add(name)
    return {
      owner: plugin,
      name,
      config: copyConfig((rawConfig ?? {}) as IPluginConfig, 'plugin config'),
      install: install as IPluginConstraint<any>['install'],
      update: update as IPluginConstraint<any>['update'],
      dispose: dispose as IPluginConstraint<any>['dispose'],
      shared: shared as IPluginConstraint<any>['shared'],
      disposer: disposer.disposer,
      features: snapshotFeatureRecord(features),
      featureExpose: featureExpose as IPluginDefinition<any>['featureExpose']
    }
  })
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
