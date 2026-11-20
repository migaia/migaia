import {
  splitDescriptorId,
  tagSegmentName,
  type ICapabilityManifest,
  type ICatalogView,
  type IDescriptor,
  type IKindSchema,
  type IRuleDefinition
} from '@migaia/part-contract'
import { orderEnhancers } from './enhance.ts'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type {
  ICatalog,
  IDefinition,
  IEffectDefinition,
  IEnhancerDefinition,
  IPartImplementation,
  IResourceDefinition
} from './types.ts'
import type { IResourceRuntime } from './resources.ts'

/** Everything one plugin generation contributes; `token` identifies the generation. */
export type IContribution = {
  readonly plugin: string
  readonly token: object
  readonly override: ReadonlySet<string>
  readonly definitions: readonly IDefinition[]
  readonly implementations: readonly IPartImplementation[]
  readonly rules: readonly IRuleDefinition<unknown>[]
  readonly kinds: Readonly<Record<string, IKindSchema>>
  readonly effectFeatures: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  /** Resolved dependency outputs per resource id of this generation. */
  readonly resourceFeatures: ReadonlyMap<string, Readonly<Record<string, unknown>>>
}

/** One stored entry with its owning generation and availability. */
type IEntry<TValue> = {
  readonly value: TValue
  readonly plugin: string
  readonly token: object
  available: boolean
}

/**
 * Listener told which part names a catalog change affects: enhancers changed for those tags, or a
 * fragment of that name changed.
 */
export type ICatalogListener = (tags: ReadonlySet<string>) => void

/** Listener told which resource ids changed generation (registered, replaced, withdrawn, suspended). */
export type IResourceListener = (ids: ReadonlySet<string>) => void

/** Composite key of a renderer implementation. */
function implementationKey(renderer: string, partId: string): string {
  return `${renderer}\u0000${partId}`
}

/**
 * Host-owned catalog. Generations of the same plugin name replace each other; another plugin name
 * conflicts unless it lists the id in `override`. Suspended plugins' entries are unavailable.
 */
export class PartCatalog implements ICatalog {
  /** Definitions by `id@major`. */
  readonly #definitions = new Map<string, IEntry<IDefinition>>()
  /** Renderer implementations by renderer and part id. */
  readonly #implementations = new Map<string, IEntry<unknown>>()
  /** Contributions by plugin name, for withdrawal and suspension. */
  readonly #contributions = new Map<string, IContribution>()
  /**
   * Registered, not yet withdrawn generations per plugin name, oldest first. While a replacement
   * installs, the old generation is still live; if the new one is withdrawn (its install rolled
   * back) the newest remaining generation is put back.
   */
  readonly #live = new Map<string, IContribution[]>()
  /** Change listeners. */
  readonly #listeners = new Set<ICatalogListener>()
  /** Resource generation listeners. */
  readonly #resourceListeners = new Set<IResourceListener>()
  /** Listeners told which derive ids changed generation. */
  readonly #deriveListeners = new Set<IResourceListener>()
  /** Definition ids by targeted part name, so tag lookups do not scan the catalog. */
  readonly #byTarget = new Map<string, Set<string>>()
  /** Definition ids by name without major, so major lookups do not scan the catalog. */
  readonly #byName = new Map<string, Set<string>>()

  /** Adds a change listener; returns its removal. */
  subscribe(listener: ICatalogListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Adds a resource generation listener; returns its removal. */
  subscribeResources(listener: IResourceListener): () => void {
    this.#resourceListeners.add(listener)
    return () => this.#resourceListeners.delete(listener)
  }

  /** Adds a listener for derive ids whose definition was registered, replaced or withdrawn. */
  subscribeDerives(listener: IResourceListener): () => void {
    this.#deriveListeners.add(listener)
    return () => this.#deriveListeners.delete(listener)
  }

  /** Available resource definition with its generation's dependency outputs and token. */
  resource(id: string): IResourceRuntime | undefined {
    /** Stored entry. */
    const entry = this.#definitions.get(id)
    if (entry?.available !== true || entry.value.descriptor.kind !== 'resource') return undefined
    /** Contribution that registered the resource. */
    const contribution = this.#contributions.get(entry.plugin)
    return {
      definition: entry.value as IResourceDefinition,
      features: contribution?.resourceFeatures.get(id) ?? {},
      token: entry.token
    }
  }

  /** Registers one plugin generation atomically: all conflicts are checked before any write. */
  register(contribution: IContribution): void {
    for (const definition of contribution.definitions)
      this.#checkConflict(this.#definitions, definition.descriptor.id, contribution)
    for (const implementation of contribution.implementations)
      this.#checkConflict(
        this.#implementations,
        implementationKey(implementation.renderer, implementation.partId),
        contribution
      )
    /** Previous generation of the same plugin, replaced by this one. */
    const previous = this.#contributions.get(contribution.plugin)
    if (previous !== undefined) this.#remove(previous)
    this.#put(contribution)
    try {
      this.#checkOrder(contribution)
    } catch (error) {
      this.#remove(contribution)
      this.#contributions.delete(contribution.plugin)
      if (previous !== undefined) this.register(previous)
      throw error
    }
    /** Live generations of the plugin. */
    const live = this.#live.get(contribution.plugin) ?? []
    if (live.at(-1) !== contribution) live.push(contribution)
    this.#live.set(contribution.plugin, live)
    this.#notify(contribution, previous)
  }

  /** Stores a contribution's entries and makes it the plugin's current one. */
  #put(contribution: IContribution): void {
    for (const definition of contribution.definitions) {
      this.#definitions.set(definition.descriptor.id, {
        value: definition,
        plugin: contribution.plugin,
        token: contribution.token,
        available: true
      })
      this.#index(definition, true)
    }
    for (const implementation of contribution.implementations)
      this.#implementations.set(implementationKey(implementation.renderer, implementation.partId), {
        value: implementation.value,
        plugin: contribution.plugin,
        token: contribution.token,
        available: true
      })
    this.#contributions.set(contribution.plugin, contribution)
  }

  /** Orders the enhancers of every tag the contribution targets, so a cycle fails at install. */
  #checkOrder(contribution: IContribution): void {
    for (const definition of contribution.definitions)
      if (definition.descriptor.kind === 'enhancer')
        for (const target of definition.descriptor.targets ?? [])
          orderEnhancers(target, this.enhancersFor(target))
  }

  /**
   * Withdraws a generation; a newer generation of the same plugin is left untouched. Withdrawing
   * the current generation while an older one is still live (a rolled-back replacement) puts the
   * older one back.
   */
  withdraw(plugin: string, token: object): void {
    /** Live generations of the plugin. */
    const live = this.#live.get(plugin)
    if (live !== undefined) {
      /** Position of the withdrawn generation. */
      const index = live.findIndex((contribution) => contribution.token === token)
      if (index >= 0) live.splice(index, 1)
      if (live.length === 0) this.#live.delete(plugin)
    }
    /** Current contribution of the plugin. */
    const current = this.#contributions.get(plugin)
    if (current === undefined || current.token !== token) return
    this.#remove(current)
    this.#contributions.delete(plugin)
    /** Older live generation to put back, if any. */
    const restored = live?.at(-1)
    if (restored === undefined) {
      this.#notify(current, undefined)
      return
    }
    this.#put(restored)
    this.#notify(restored, current)
  }

  /** Marks the entries of the named plugins unavailable or available again. */
  setAvailable(plugins: Iterable<string>, available: boolean): void {
    for (const plugin of plugins) {
      /** Contribution whose entries change availability. */
      const contribution = this.#contributions.get(plugin)
      if (contribution === undefined) continue
      for (const definition of contribution.definitions) {
        /** Entry of the definition, when still owned by this generation. */
        const entry = this.#definitions.get(definition.descriptor.id)
        if (entry?.token === contribution.token) entry.available = available
      }
      for (const implementation of contribution.implementations) {
        /** Entry of the implementation, when still owned by this generation. */
        const entry = this.#implementations.get(
          implementationKey(implementation.renderer, implementation.partId)
        )
        if (entry?.token === contribution.token) entry.available = available
      }
      this.#notify(contribution, undefined)
    }
  }

  /** Available definition by id. */
  get(id: string): IDefinition | undefined {
    /** Stored entry. */
    const entry = this.#definitions.get(id)
    return entry?.available === true ? entry.value : undefined
  }

  /** Available definitions whose `targets` include the part name of a tag. */
  byTag(tag: string): readonly IDefinition[] {
    /** Part name of the tag. */
    const name = tagSegmentName(tag)
    /** Matching definitions in registration order. */
    const matches: IDefinition[] = []
    for (const id of this.#byTarget.get(name) ?? []) {
      /** Entry of the targeting definition. */
      const entry = this.#definitions.get(id)
      if (entry?.available === true) matches.push(entry.value)
    }
    return matches
  }

  /** Enhancers targeting a tag, in registration order. */
  enhancersFor(tag: string): readonly IEnhancerDefinition<unknown>[] {
    return this.byTag(tag).filter(
      (definition) => definition.descriptor.kind === 'enhancer'
    ) as IEnhancerDefinition<unknown>[]
  }

  /** Renderer implementation, or undefined when absent or unavailable. */
  implementation(renderer: string, partId: string): unknown {
    /** Stored entry. */
    const entry = this.#implementations.get(implementationKey(renderer, partId))
    return entry?.available === true ? entry.value : undefined
  }

  /**
   * Capability manifest of this catalog for client build `build`: every available definition id in
   * registration order, and the renderer names of available implementations, each once. Entries of
   * suspended plugins are unavailable and not listed.
   */
  manifest(build: string): ICapabilityManifest {
    /** Available ids in registration order. */
    const definitions: string[] = []
    for (const [id, entry] of this.#definitions) if (entry.available) definitions.push(id)
    /** Renderer names in first-seen order. */
    const renderers = new Set<string>()
    for (const [key, entry] of this.#implementations)
      if (entry.available) renderers.add(key.slice(0, key.indexOf('\u0000')))
    return { format: 1, build, definitions, renderers: [...renderers] }
  }

  /** Rules contributed by every registered plugin. */
  rules(): readonly IRuleDefinition<unknown>[] {
    /** Rules in plugin registration order. */
    const rules: IRuleDefinition<unknown>[] = []
    for (const contribution of this.#contributions.values()) rules.push(...contribution.rules)
    return rules
  }

  /** Extension kinds contributed by every registered plugin. */
  kinds(): ReadonlyMap<string, IKindSchema> {
    /** Merged kind table. */
    const kinds = new Map<string, IKindSchema>()
    for (const contribution of this.#contributions.values())
      for (const [kind, schema] of Object.entries(contribution.kinds)) kinds.set(kind, schema)
    return kinds
  }

  /** Effect definition and its resolved Feature outputs. */
  effect(id: string):
    | {
        readonly definition: IEffectDefinition
        readonly features: Readonly<Record<string, unknown>>
      }
    | undefined {
    /** Stored entry. */
    const entry = this.#definitions.get(id)
    if (entry?.available !== true || entry.value.descriptor.kind !== 'effect') return undefined
    /** Contribution that registered the effect. */
    const contribution = this.#contributions.get(entry.plugin)
    return {
      definition: entry.value as IEffectDefinition,
      features: contribution?.effectFeatures.get(id) ?? {}
    }
  }

  /** Read-only view for the rule engine. */
  view(): ICatalogView {
    return {
      get: (id) => this.get(id)?.descriptor,
      majors: (name) => this.#majors(name),
      writesFor: (tag) => this.#writesFor(tag),
      all: () => this.#allDescriptors()
    }
  }

  /** Descriptors of every available definition, in registration order. */
  *#allDescriptors(): Iterable<IDescriptor> {
    for (const entry of this.#definitions.values())
      if (entry.available) yield entry.value.descriptor
  }

  /** Available majors of a name. */
  #majors(name: string): readonly number[] {
    /** Majors found. */
    const majors: number[] = []
    for (const id of this.#byName.get(name) ?? [])
      if (this.#definitions.get(id)?.available === true) majors.push(splitDescriptorId(id).major)
    return majors
  }

  /** Fields enhancers declare they write for a tag. */
  #writesFor(tag: string): readonly string[] {
    return this.enhancersFor(tag).flatMap((definition) => definition.descriptor.writes ?? [])
  }

  /** Throws CATALOG_CONFLICT when another plugin holds the key and the id is not overridden. */
  #checkConflict(
    store: ReadonlyMap<string, IEntry<unknown>>,
    key: string,
    contribution: IContribution
  ): void {
    /** Existing entry under the key. */
    const existing = store.get(key)
    if (existing === undefined || existing.plugin === contribution.plugin) return
    /** Part id part of an implementation key, or the definition id itself. */
    const id = key.includes('\u0000') ? key.slice(key.indexOf('\u0000') + 1) : key
    if (contribution.override.has(id)) return
    throw createPartHostError(
      PartHostErrorCode.catalogConflict,
      PartHostErrorText.catalogConflict(id, existing.plugin)
    )
  }

  /** Removes the entries a contribution still owns. */
  #remove(contribution: IContribution): void {
    for (const definition of contribution.definitions)
      if (this.#definitions.get(definition.descriptor.id)?.token === contribution.token) {
        this.#definitions.delete(definition.descriptor.id)
        this.#index(definition, false)
      }
    for (const implementation of contribution.implementations) {
      /** Key of the implementation. */
      const key = implementationKey(implementation.renderer, implementation.partId)
      if (this.#implementations.get(key)?.token === contribution.token)
        this.#implementations.delete(key)
    }
  }

  /** Adds or removes a definition from the target and name indexes. */
  #index(definition: IDefinition, add: boolean): void {
    /** Id of the definition. */
    const id = definition.descriptor.id
    /** Index keys: every targeted part name plus the definition's own name. */
    const keys: [Map<string, Set<string>>, string][] = (definition.descriptor.targets ?? []).map(
      (target) => [this.#byTarget, target]
    )
    keys.push([this.#byName, splitDescriptorId(id).name])
    for (const [map, key] of keys) {
      /** Id set under the key. */
      const ids = map.get(key) ?? new Set<string>()
      if (add) ids.add(id)
      else ids.delete(id)
      map.set(key, ids)
    }
  }

  /** Tells listeners which tags lost or gained enhancers. */
  #notify(current: IContribution, previous: IContribution | undefined): void {
    /** Part names whose enhancers changed. */
    const tags = new Set<string>()
    for (const contribution of previous === undefined ? [current] : [current, previous])
      for (const definition of contribution.definitions)
        if (definition.descriptor.kind === 'enhancer')
          for (const target of definition.descriptor.targets ?? []) tags.add(target)
        else if (definition.descriptor.kind === 'fragment')
          tags.add(splitDescriptorId(definition.descriptor.id).name)
    for (const listener of this.#listeners) listener(tags)
    /** Resource ids of both generations. */
    const resources = new Set<string>()
    for (const contribution of previous === undefined ? [current] : [current, previous])
      for (const definition of contribution.definitions)
        if (definition.descriptor.kind === 'resource') resources.add(definition.descriptor.id)
    if (resources.size > 0) for (const listener of this.#resourceListeners) listener(resources)
    /** Derive ids of both generations. */
    const derives = new Set<string>()
    for (const contribution of previous === undefined ? [current] : [current, previous])
      for (const definition of contribution.definitions)
        if (definition.descriptor.kind === 'derive') derives.add(definition.descriptor.id)
    if (derives.size > 0) for (const listener of this.#deriveListeners) listener(derives)
  }
}
