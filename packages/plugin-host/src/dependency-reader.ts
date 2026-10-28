import { snapshotPluginDefinitions } from './admission-runtime.js'
import { readAdmissionDefinition } from './composition.js'
import { isFeatureReference, readDefinedFeature } from './define-feature.js'
import { readDefinedPluginDefinition } from './define-plugin.js'
import type { IFeatureReference } from './feature-types.js'
import type { IPluginDefinition } from './registry.js'
import type { IPluginConstraint } from './plugin-definition-types.js'

/** Provider edge derived from a plugin's complete local Feature closure. */
export type IPluginDependency = Readonly<{
  /** Name of one cross-plugin provider found in the selected local Feature closure. */
  readonly provider: string
  /** True if any reference to this provider is required; required wins over optional duplicates. */
  readonly required: boolean
}>

/** Cross-plugin reference retains the consuming plugin for canonical dependency diagnostics. */
type IPluginFeatureDependency = Readonly<{
  readonly consumer: string
  readonly reference: IFeatureReference<object, boolean>
}>

/** Collects trusted cross-plugin references from one plugin's complete local Feature closure. */
export const collectPluginFeatureDependencies = (
  plugin: IPluginDefinition<any>
): readonly IPluginFeatureDependency[] => {
  /** First-reference traversal order remains the Host's existing dependency order. */
  const found: IPluginFeatureDependency[] = []
  /** Local Feature dependencies extend the same queue as declared plugin roots. */
  const pending = Object.values(plugin.features)
  /** Shared local Features contribute their dependencies only once. */
  const visited = new Set<object>()
  for (const feature of pending) {
    if (visited.has(feature)) continue
    visited.add(feature)
    /** Only trusted definitions carry dependency metadata. */
    const definition = readDefinedFeature(feature)
    if (!definition) continue
    for (const dependency of Object.values(definition.dependencies)) {
      if (isFeatureReference(dependency)) {
        found.push(Object.freeze({ consumer: plugin.name, reference: dependency }))
      } else pending.push(dependency)
    }
  }
  return Object.freeze(found)
}

/** Projects the same captured definition into public edges and the Host's capability index. */
export const readDefinitionDependencies = (
  plugin: IPluginDefinition<any>
): readonly IPluginDependency[] => {
  /** Required wins when several local Features reference the same provider. */
  const strength = new Map<string, boolean>()
  for (const { reference } of collectPluginFeatureDependencies(plugin))
    strength.set(reference.plugin, (strength.get(reference.plugin) ?? false) || !reference.optional)
  return Object.freeze(
    [...strength].map(([provider, required]) => Object.freeze({ provider, required }))
  )
}

/**
 * Lists providers in first-reference order, including local Feature closures; required wins. An
 * admission uses its captured definition without calling getters. Other inputs are captured once
 * through canonical admission. No lifecycle hook or Feature factory runs; admission errors pass
 * through unchanged.
 */
export const readPluginDependencies = (plugin: unknown): readonly IPluginDependency[] => {
  /** Opaque admission identity takes precedence over raw descriptor capture. */
  const definition =
    readAdmissionDefinition<IPluginDefinition<any>>(plugin as object) ??
    snapshotPluginDefinitions([plugin as IPluginConstraint<any>], readDefinedPluginDefinition)[0]
  return readDefinitionDependencies(definition)
}
