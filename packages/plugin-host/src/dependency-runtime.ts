import { buildCapabilityTopology } from '@migaia/capability/graph/topology'
import type { ICapabilityTopology, ITopologyNode } from '@migaia/capability/graph/topology'
import { isFeatureReference, readDefinedFeature } from './define-feature.js'
import { PluginHostErrorCode } from './error-code.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import type { IFeatureReference } from './feature-types.js'
import type { IInstallEntry, IPluginDefinition, IRegistration } from './registry.js'
import type { IPluginDependencyPlan } from './typing.js'

/**
 * Graph ownership note: every dependency fact here is derived through capability's
 * `buildCapabilityTopology`, so edge validation, cycle detection and ordering stay owned by
 * `@migaia/capability`. Plugin-host keeps only the registration lifecycle that acts on those
 * facts.
 */

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

/**
 * Builds one capability topology from plugin definitions. Required wins over optional when one
 * consumer references several Features of the same provider.
 */
const buildTopology = (
  definitions: readonly Readonly<{
    readonly name: string
    readonly plugin: IPluginDefinition<any>
  }>[],
  includes: (reference: IFeatureReference<object, boolean>) => boolean = () => true
): ICapabilityTopology => {
  /** First Feature reference per consumer/provider pair, used to name an unknown provider. */
  const referencedFeature = new Map<string, string>()
  const nodes: ITopologyNode[] = definitions.map(({ name, plugin }, ordinal) => {
    /** Dependency strength per provider for this consumer. */
    const strength = new Map<string, boolean>()
    for (const { reference } of collectPluginFeatureDependencies(plugin)) {
      if (!includes(reference)) continue
      strength.set(
        reference.plugin,
        (strength.get(reference.plugin) ?? false) || !reference.optional
      )
      if (!referencedFeature.has(`${name}\0${reference.plugin}`))
        referencedFeature.set(`${name}\0${reference.plugin}`, reference.feature)
    }
    return Object.freeze({
      id: name,
      ordinal,
      dependencies: Object.freeze(
        [...strength].map(([provider, required]) => Object.freeze({ provider, required }))
      )
    })
  })
  return buildCapabilityTopology(
    nodes,
    (consumer, provider) => {
      throw new PluginHostError(
        PluginHostErrorCode.prerequisiteMissing,
        ERROR_TEXT.PREREQUISITE_MISSING(
          provider,
          referencedFeature.get(`${consumer}\0${provider}`) ?? ''
        )
      )
    },
    () => {
      throw new PluginHostError(PluginHostErrorCode.dependencyCycle, ERROR_TEXT.DEPENDENCY_CYCLE)
    },
    () => {
      throw new PluginHostError(
        PluginHostErrorCode.pluginDefinitionInvalid,
        ERROR_TEXT.PLUGIN_DEFINITION_INVALID
      )
    }
  )
}

/**
 * Validates and orders one batch before any hook runs. Out-of-batch required providers must be
 * committed, enabled, and — unless the caller activates them first — activated; every failure is
 * thrown as its own dependency code, never wrapped as an install failure.
 */
export const orderPluginInstallBatch = <TDomainCore extends object, TValue>(
  entries: readonly IInstallEntry<TDomainCore, TValue>[],
  committed: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>,
  removedNames: ReadonlySet<string>,
  inactive: PluginInactiveProviderPolicy = PluginInactiveProviderPolicy.reject
): readonly IInstallEntry<TDomainCore, TValue>[] => {
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  /** Members whose install runs now; only they must see an already active lazy provider. */
  const installSet = resolveBatchInstallSet(entries)
  // Committed providers are validated here; only in-batch edges become topology edges.
  for (const entry of entries)
    for (const { reference } of collectPluginFeatureDependencies(entry.plugin)) {
      if (byName.has(reference.plugin)) continue
      if (reference.optional) continue
      const registration = committed.get(reference.plugin)
      if (!registration) throw createAbsentProviderError(reference, removedNames)
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
  const topology = buildTopology(entries, (reference) => byName.has(reference.plugin))
  // The post-install graph must stay acyclic too: a new member (or a replacement definition) can
  // close a cycle with committed registrations, including through their optional edges. Only edges
  // whose provider exists after the install participate.
  const after = [
    ...[...committed.values()]
      .filter((registration) => !byName.has(registration.name))
      .map((registration) => ({ name: registration.name, plugin: registration.plugin })),
    ...entries
  ]
  const present = new Set(after.map((definition) => definition.name))
  buildTopology(after, (reference) => present.has(reference.plugin))
  return Object.freeze(topology.ordered.map((node) => byName.get(node.id)!))
}

/**
 * Names of batch members whose install hook runs now: every eager member plus, transitively, every
 * in-batch provider one of those members requires. Lazy members required only by other lazy members
 * stay inactive.
 */
export const resolveBatchInstallSet = <TDomainCore extends object, TValue>(
  ordered: readonly IInstallEntry<TDomainCore, TValue>[]
): ReadonlySet<string> => {
  const byName = new Map(ordered.map((entry) => [entry.name, entry]))
  const install = new Set<string>()
  const pending = ordered
    .filter((entry) => entry.plugin.activation !== 'lazy')
    .map((entry) => entry.name)
  for (const name of pending) {
    if (install.has(name)) continue
    install.add(name)
    for (const { reference } of collectPluginFeatureDependencies(byName.get(name)!.plugin))
      if (!reference.optional && byName.has(reference.plugin)) pending.push(reference.plugin)
  }
  return install
}

/**
 * Committed lazy registrations that must activate before `roots` can install, providers first.
 * Traverses required edges through committed registrations only.
 */
export const collectLazyActivationOrder = <TDomainCore extends object, TValue>(
  roots: readonly IPluginDefinition<any>[],
  registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>
): readonly IRegistration<TDomainCore, TValue>[] => {
  const order: IRegistration<TDomainCore, TValue>[] = []
  const visited = new Set<string>()
  /** Depth-first post-order places each provider before the lazy consumer that needs it. */
  const visit = (plugin: IPluginDefinition<any>): void => {
    for (const { reference } of collectPluginFeatureDependencies(plugin)) {
      if (reference.optional || visited.has(reference.plugin)) continue
      visited.add(reference.plugin)
      const provider = registrations.get(reference.plugin)
      if (!provider || provider.activated) continue
      visit(provider.plugin)
      order.push(provider)
    }
  }
  for (const root of roots) visit(root)
  return Object.freeze(order)
}

/** Builds the canonical capability topology for current plugin registrations. */
const buildRegistrationTopology = <TDomainCore extends object, TValue>(
  registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>
): ICapabilityTopology =>
  buildTopology(
    [...registrations.values()].map((registration) => ({
      name: registration.name,
      plugin: registration.plugin
    }))
  )

/** Returns direct required and optional dependents for one installed provider. */
export const readPluginDependents = <TDomainCore extends object, TValue>(
  provider: string,
  registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>
): Readonly<{ readonly required: readonly string[]; readonly optional: readonly string[] }> => {
  const topology = buildRegistrationTopology(registrations)
  const required: string[] = []
  const optional: string[] = []
  for (const consumer of topology.providers.get(provider) ?? []) {
    const edge = consumer.dependencies.find((dependency) => dependency.provider === provider)
    ;(edge?.required ? required : optional).push(consumer.id)
  }
  return Object.freeze({ required: Object.freeze(required), optional: Object.freeze(optional) })
}

/**
 * Produces one reverse-topological plan for `roots` plus every transitive required dependent. Edges
 * cover required edges inside the affected set, optional edges into it, and optional edges from
 * affected consumers to providers that are absent (`status: 'optional-absent'`).
 */
export const planPluginDependencyMutation = <TDomainCore extends object, TValue>(
  roots: string | readonly string[],
  registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>
): IPluginDependencyPlan => {
  const topology = buildRegistrationTopology(registrations)
  const affected = new Set(typeof roots === 'string' ? [roots] : roots)
  const pending = [...affected]
  for (const current of pending)
    for (const consumer of topology.providers.get(current) ?? []) {
      const edge = consumer.dependencies.find((dependency) => dependency.provider === current)
      if (!edge?.required || affected.has(consumer.id)) continue
      affected.add(consumer.id)
      pending.push(consumer.id)
    }
  const order = topology.ordered
    .filter((node) => affected.has(node.id))
    .map((node) => node.id)
    .reverse()
  const edges: IPluginDependencyEdge[] = []
  for (const consumer of topology.ordered)
    for (const edge of consumer.dependencies) {
      const present = registrations.has(edge.provider)
      if (!present) {
        if (affected.has(consumer.id) && !edge.required)
          edges.push(
            Object.freeze({
              provider: edge.provider,
              consumer: consumer.id,
              optional: true,
              status: 'optional-absent' as const
            })
          )
        continue
      }
      if (affected.has(edge.provider) && (affected.has(consumer.id) || !edge.required))
        edges.push(
          Object.freeze({
            provider: edge.provider,
            consumer: consumer.id,
            optional: !edge.required
          })
        )
    }
  return Object.freeze({ order: Object.freeze(order), edges: Object.freeze(edges) })
}

/**
 * Every required dependent (transitively) that blocks a non-cascading mutation of `provider`, in
 * the same reverse-topological order the cascade would process them.
 */
export const readPluginBlockers = <TDomainCore extends object, TValue>(
  provider: string,
  registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>
): readonly string[] =>
  Object.freeze(
    planPluginDependencyMutation(provider, registrations).order.filter((name) => name !== provider)
  )

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
