import {
  resolveInstallSet,
  type DependencyPolicy,
  type IDependencyPlan
} from '@migaia/capability/graph/dependency'
import type { ITopologyIndexNode } from '@migaia/capability/graph/topology'
import { isFeatureReference, readDefinedFeature } from './define-feature.js'
import { PluginHostErrorCode } from './error-code.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import type { IFeatureReference } from './feature-types.js'
import type { PluginHostState } from './host-state.js'
import type { IInstallEntry, IPluginDefinition, IRegistration } from './registry.js'
import type { IPluginDependencyPlan } from './typing.js'

/** Graph ownership stays in capability; this module only adapts plugin definitions and errors. */

/** Cross-plugin reference plus the local feature that consumes it. */
export type IPluginFeatureDependency = Readonly<{
  readonly consumer: string
  readonly reference: IFeatureReference<object, boolean>
}>

/** One immutable provider-consumer edge exposed by dependency dry-runs. */
export type IPluginDependencyEdge = IPluginDependencyPlan['edges'][number]

/** Controls how a committed but not yet activated lazy provider is treated during validation. */
export const PluginInactiveProviderPolicy = {
  /** The caller activates such providers before installation, so validation admits them. */
  admit: 'admit',
  /** No activation step follows, so an inactive required provider rejects the batch. */
  reject: 'reject'
} as const

export type PluginInactiveProviderPolicy = keyof typeof PluginInactiveProviderPolicy

/** Collects trusted cross-plugin references from one plugin's complete local feature closure. */
export const collectPluginFeatureDependencies = (
  plugin: IPluginDefinition<any>
): readonly IPluginFeatureDependency[] => {
  const found: IPluginFeatureDependency[] = []
  const pending = Object.values(plugin.features)
  const visited = new Set<object>()
  for (const feature of pending) {
    if (visited.has(feature)) continue
    visited.add(feature)
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

/** Creates the prerequisite error for one required provider that is absent from the host. */
const createAbsentProviderError = (
  reference: IFeatureReference<object, boolean>,
  removedNames: ReadonlySet<string>
): PluginHostError =>
  removedNames.has(reference.plugin)
    ? new PluginHostError(
        PluginHostErrorCode.prerequisiteRemoved,
        ERROR_TEXT.PREREQUISITE_REMOVED(reference.feature, reference.plugin)
      )
    : new PluginHostError(
        PluginHostErrorCode.prerequisiteMissing,
        ERROR_TEXT.PREREQUISITE_MISSING(reference.plugin, reference.feature)
      )

/** Converts one plugin definition into the capability index's canonical node shape. */
export const toIndexNode = (name: string, plugin: IPluginDefinition<any>): ITopologyIndexNode => {
  /** Required wins when several local Features reference the same provider. */
  const strength = new Map<string, boolean>()
  for (const { reference } of collectPluginFeatureDependencies(plugin))
    strength.set(reference.plugin, (strength.get(reference.plugin) ?? false) || !reference.optional)
  return Object.freeze({
    id: name,
    dependencies: Object.freeze(
      [...strength].map(([provider, required]) => Object.freeze({ provider, required }))
    )
  })
}

/**
 * Validates one install batch in an isolated index transaction and returns its canonical order. The
 * transaction always rolls back: committed installation publishes the same nodes separately.
 */
export const validateInstallBatch = <TDomainCore extends object, TValue>(
  entries: readonly IInstallEntry<TDomainCore, TValue>[],
  state: PluginHostState<TDomainCore, TValue>,
  inactive: PluginInactiveProviderPolicy = PluginInactiveProviderPolicy.reject
): Readonly<{
  readonly order: readonly IInstallEntry<TDomainCore, TValue>[]
  readonly installSet: ReadonlySet<string>
}> => {
  /** Batch entries by stable plugin name. */
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  /** Isolated projected topology used only for validation and planning. */
  const transaction = state.dependencyIndex().begin()
  try {
    for (const entry of entries) {
      /** Candidate node projected into the transaction without disturbing the base index. */
      const node = toIndexNode(entry.name, entry.plugin)
      if (transaction.has(entry.name)) transaction.setDependencies(entry.name, node.dependencies)
      else transaction.add(node)
    }
    /** Batch member names used to bound lazy-install traversal. */
    const members = entries.map((entry) => entry.name)
    /** Members whose install hooks execute in this transaction. */
    const installSet = resolveInstallSet(
      transaction,
      members,
      (name) => byName.get(name)!.plugin.activation === 'lazy'
    )
    for (const entry of entries) {
      /** First Feature reference per provider retains the public diagnostic Feature name. */
      const references = new Map(
        collectPluginFeatureDependencies(entry.plugin).map(({ reference }) => [
          reference.plugin,
          reference
        ])
      )
      for (const dependency of transaction.missing(entry.name)) {
        if (!dependency.required) continue
        throw createAbsentProviderError(references.get(dependency.provider)!, state.removedNames)
      }
      for (const dependency of transaction.dependencies(entry.name)) {
        if (!dependency.required || byName.has(dependency.provider)) continue
        /** Committed provider already represented by the base index. */
        const registration = state.registrations.get(dependency.provider)!
        /** Reference naming the Feature used by the public prerequisite diagnostic. */
        const reference = references.get(dependency.provider)!
        if (!registration.enabled)
          throw new PluginHostError(
            PluginHostErrorCode.prerequisiteDisabled,
            ERROR_TEXT.PREREQUISITE_DISABLED(reference.feature, reference.plugin)
          )
        if (
          !registration.activated &&
          inactive === PluginInactiveProviderPolicy.reject &&
          installSet.has(entry.name)
        )
          throw new PluginHostError(
            PluginHostErrorCode.pluginNotActivated,
            ERROR_TEXT.PLUGIN_NOT_ACTIVATED(reference.plugin)
          )
      }
    }
    return Object.freeze({
      order: Object.freeze(transaction.order(members).map((name) => byName.get(name)!)),
      installSet
    })
  } finally {
    transaction.rollback()
  }
}

/** Projects a capability-owned plan into the public PluginHost dependency plan shape. */
export const toPluginPlan = (
  plan: IDependencyPlan,
  policy: DependencyPolicy
): IPluginDependencyPlan =>
  Object.freeze({
    policy,
    order: plan.order,
    steps: Object.freeze(
      plan.steps.map((step) => Object.freeze({ name: step.id, action: step.action }))
    ),
    edges: plan.edges
  }) as IPluginDependencyPlan

/**
 * Required providers of `consumer` that are currently unusable, as the first prerequisite error.
 * Used when a dependent is re-enabled: it may not serve while a required provider is disabled.
 * `enabling` names providers re-enabled in the same atomic step, which count as available.
 */
export const findUnavailableProvider = <TDomainCore extends object, TValue>(
  consumer: IRegistration<TDomainCore, TValue>,
  registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>,
  removedNames: ReadonlySet<string>,
  enabling: ReadonlySet<string> = new Set()
): PluginHostError | undefined => {
  for (const { reference } of collectPluginFeatureDependencies(consumer.plugin)) {
    if (reference.optional) continue
    const provider = registrations.get(reference.plugin)
    if (!provider) return createAbsentProviderError(reference, removedNames)
    if (!provider.enabled && !enabling.has(reference.plugin))
      return new PluginHostError(
        PluginHostErrorCode.prerequisiteDisabled,
        ERROR_TEXT.PREREQUISITE_DISABLED(reference.feature, reference.plugin)
      )
  }
  return undefined
}
