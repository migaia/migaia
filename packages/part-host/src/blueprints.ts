import {
  affectedAddresses,
  applyPatch,
  auditTargets,
  createAddressIndex,
  createRuleEngine,
  eventEntries,
  expandFragments,
  modifierArgs,
  modifierId,
  parseBlueprint,
  PartContractErrorCode,
  tagSegmentName,
  validateArgs,
  type IFragmentUsage,
  type IIndexedNode,
  type IModifierRef,
  type IStandardSchemaInput,
  type IAddressIndex,
  type IBehavior,
  type IBlueprint,
  type IIssue,
  type IJsonPatchOperation,
  type IPartFacets,
  type IPartNode
} from '@migaia/part-contract'
import { builtinRules } from '@migaia/part-contract/doctor'
import type { PartCatalog } from './catalog.ts'
import { applyEnhancers, orderEnhancers } from './enhance.ts'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import { HostIssueRule } from './issue-rules.ts'
import { isStateBinding, type ScopeState } from './state.ts'
import type { ITraceSink } from './trace/sink.ts'
import type {
  IEnhancerDefinition,
  IFragmentDefinition,
  ILoadResult,
  IModifierDefinition,
  IPartDefinition,
  IResolvedChanges,
  IResolvedNode,
  IResolvedTree,
  IStyleRule
} from './types.ts'

/**
 * State kept per loaded blueprint. `parsed` and `index` describe the blueprint after fragment
 * expansion; `authoredIndex` describes the document as written, which patches and tag refreshes
 * address.
 */
type ILoaded = {
  readonly raw: unknown
  readonly parsed: IBlueprint
  readonly authoredIndex: IAddressIndex
  readonly index: IAddressIndex
  /** Argument issues of this version, kept so an incremental pass revalidates only what changed. */
  readonly argumentIssues: readonly IIssue[]
  readonly enhanced: ReadonlyMap<string, IPartFacets>
  readonly tree: IResolvedTree | undefined
}

/**
 * Inputs of one processing pass. `keepOnError` leaves the previous version loaded when the new
 * version has an error (used by `update`, so a rejected version never replaces a working one).
 */
type IPass = {
  readonly raw: unknown
  readonly previous: ILoaded | undefined
  readonly affected: ReadonlySet<string> | undefined
  readonly keepOnError?: boolean
}

/** Receives the change set of a reprocessed blueprint. */
export type IChangeSink = (changes: IResolvedChanges) => void

/**
 * Loads and patches blueprints: parse, authored rules, enhancement, resolved rules, resolved tree.
 * Unchanged nodes reuse their cached enhanced configuration.
 */
export class BlueprintStore {
  /** Catalog consulted for definitions, enhancers and rules. */
  readonly #catalog: PartCatalog
  /** Host state, seeded with open-state defaults. */
  readonly #state: ScopeState
  /** Loaded blueprints by id. */
  readonly #loaded = new Map<string, ILoaded>()
  /** Sink notified after a patch or a re-enhancement. */
  readonly #sink: IChangeSink
  /** Trace sink receiving enhancement steps. */
  readonly #trace: ITraceSink

  /** Binds the store to its catalog, state, change sink and trace sink. */
  constructor(catalog: PartCatalog, state: ScopeState, sink: IChangeSink, trace: ITraceSink) {
    this.#catalog = catalog
    this.#state = state
    this.#sink = sink
    this.#trace = trace
  }

  /** Every expanded address of the loaded blueprints, in load order then document order. */
  addresses(): readonly string[] {
    /** Collected addresses. */
    const addresses: string[] = []
    for (const loaded of this.#loaded.values())
      for (const entry of loaded.index.entries()) addresses.push(entry.address)
    return addresses
  }

  /** Enhanced configuration of an address in any loaded blueprint. */
  resolved(address: string): IPartFacets | undefined {
    for (const loaded of this.#loaded.values()) {
      /** Enhanced facets, when this blueprint has the address. */
      const facets = loaded.enhanced.get(address)
      if (facets !== undefined) return facets
    }
    return undefined
  }

  /** Loads a blueprint from scratch. */
  load(input: unknown): Promise<ILoadResult> {
    return this.#process({ raw: input, previous: undefined, affected: undefined })
  }

  /** Applies a JSON Patch to a loaded blueprint and reprocesses only affected nodes. */
  patch(blueprintId: string, operations: readonly IJsonPatchOperation[]): Promise<ILoadResult> {
    /** Current state of the blueprint. */
    const previous = this.#require(blueprintId)
    return this.#process({
      raw: applyPatch(previous.raw, operations),
      previous,
      affected: affectedAddresses(previous.authoredIndex.entries(), operations)
    })
  }

  /**
   * Loads a new version of a blueprint. Only addresses whose configuration groups or child lists
   * changed, plus the parents of added and removed nodes, are reprocessed; a changed root tag
   * reprocesses everything. An unknown id is a plain `load`. A version with an error leaves the
   * current version in place.
   */
  update(input: unknown): Promise<ILoadResult> {
    /** New authored version. */
    const next = parseBlueprint(input)
    /** Current version, if loaded. */
    const previous = this.#loaded.get(next.id)
    if (previous === undefined) return this.load(input)
    /** Current authored version. */
    const before = previous.authoredIndex.blueprint
    return this.#process({
      raw: input,
      previous,
      affected: before.root.tag === next.root.tag ? changedAddresses(previous, next) : undefined,
      keepOnError: true
    })
  }

  /**
   * Reprocesses nodes whose part names lost or gained enhancers, and fragment usages whose fragment
   * changed. Blueprints are reprocessed one after another.
   */
  async refreshTags(tags: ReadonlySet<string>): Promise<void> {
    if (tags.size === 0) return
    for (const loaded of this.#loaded.values()) {
      /** Authored and expanded addresses whose tag is affected. */
      const affected = new Set<string>()
      for (const index of [loaded.authoredIndex, loaded.index])
        for (const entry of index.entries())
          if (tags.has(tagSegmentName(entry.node.tag))) affected.add(entry.address)
      if (affected.size > 0) await this.#process({ raw: loaded.raw, previous: loaded, affected })
    }
  }

  /** Latest resolved tree of a blueprint. */
  tree(blueprintId: string): IResolvedTree | undefined {
    return this.#require(blueprintId).tree
  }

  /** Node subscription lookup across loaded blueprints. */
  node(address: string): IPartNode | undefined {
    for (const loaded of this.#loaded.values()) {
      /** Indexed node, if this blueprint has the address. */
      const entry = loaded.index.get(address)
      if (entry !== undefined) return entry.node
    }
    return undefined
  }

  /** Id of the loaded blueprint holding a static address, or undefined. */
  blueprintOf(address: string): string | undefined {
    for (const [id, loaded] of this.#loaded) if (loaded.index.get(address) !== undefined) return id
    return undefined
  }

  /** Loaded entry or BLUEPRINT_UNKNOWN. */
  #require(blueprintId: string): ILoaded {
    /** Loaded state. */
    const loaded = this.#loaded.get(blueprintId)
    if (loaded === undefined)
      throw createPartHostError(
        PartHostErrorCode.blueprintUnknown,
        PartHostErrorText.blueprintUnknown(blueprintId)
      )
    return loaded
  }

  /**
   * Runs one full or incremental pass: parse, expand fragments, validate fragment and modifier
   * arguments, authored rules, enhancement, resolved rules, resolved tree. Parse and expansion
   * errors are thrown.
   */
  async #process(pass: IPass): Promise<ILoadResult> {
    /** Authored document, parsed and frozen. */
    const authoredDocument = parseBlueprint(pass.raw)
    /** Index of the authored document, for patches and tag refreshes. */
    const authoredIndex = createAddressIndex(authoredDocument)
    /** Fragment expansion of the authored document. */
    const expansion = expandFragments(authoredDocument, this.#catalog.view())
    /** Expanded blueprint, frozen in place so the index keeps pointing at its nodes. */
    const parsed = parseBlueprint(expansion.blueprint)
    /** Address index of the expanded blueprint. */
    const index = expansion.index
    /** Affected addresses widened to whole expanded usages. */
    const affectedAll =
      pass.affected === undefined
        ? undefined
        : widenAffected(pass.affected, index, expansion.usages)
    /** Pass seen by enhancement with the widened affected set. */
    const widened: IPass = { ...pass, affected: affectedAll }
    /** Fragment parameter and modifier argument issues. */
    const argumentIssues = await this.#argumentIssues(expansion.usages, index, affectedAll, pass)
    /** Engine over built-in and plugin rules. */
    const engine = createRuleEngine({
      rules: [...builtinRules, ...this.#catalog.rules()],
      catalog: this.#catalog.view(),
      kinds: this.#catalog.kinds()
    })
    /** Changed addresses for part-scope rules, when incremental. */
    const changed = affectedAll === undefined ? undefined : [...affectedAll]
    /** Authored-phase issues. */
    const authored = engine.run('authored', parsed, changed === undefined ? undefined : { changed })
    /** Enhanced configuration per address. */
    const enhanced = this.#enhance(index, widened)
    /** Node-to-address map shared by the rebuild and the resolve walk. */
    const addresses = addressMap(index)
    /** Blueprint rebuilt with enhanced facets, for resolved-phase rules. */
    const enhancedBlueprint: IBlueprint = {
      ...parsed,
      root: rebuild(parsed.root, addresses, enhanced)
    }
    /** All issues of the pass; a rule that fires in both phases is reported once. */
    const issues: IIssue[] = mergeIssues(
      [...expansion.issues, ...argumentIssues, ...authored],
      engine.run(
        'resolved',
        parseBlueprint(enhancedBlueprint),
        changed === undefined ? undefined : { changed }
      )
    )
    /** Whether the pass found an error. */
    const failed = issues.some((issue) => issue.severity === 'error')
    if (failed && pass.keepOnError === true)
      return { blueprintId: parsed.id, tree: undefined, issues }
    /** Resolved tree, only when no error was found. */
    const tree = failed
      ? undefined
      : { blueprintId: parsed.id, root: this.#resolve(parsed.root, addresses, enhanced) }
    this.#loaded.set(parsed.id, {
      raw: pass.raw,
      parsed,
      authoredIndex,
      index,
      argumentIssues,
      enhanced,
      tree
    })
    if (pass.previous !== undefined && tree !== undefined)
      this.#sink(changeSet(tree, pass.previous, index, affectedAll))
    return { blueprintId: parsed.id, tree, issues }
  }

  /**
   * Validates fragment parameters and modifier arguments against their Standard Schemas. A string
   * modifier reference is validated with `undefined`, so a schema that requires arguments reports
   * it. An incremental pass keeps the previous issues of unaffected addresses that still exist and
   * validates only affected addresses. Validations run concurrently.
   */
  async #argumentIssues(
    usages: readonly IFragmentUsage[],
    index: IAddressIndex,
    affected: ReadonlySet<string> | undefined,
    pass: IPass
  ): Promise<readonly IIssue[]> {
    /** Issues carried over from the previous version. */
    const kept =
      affected === undefined || pass.previous === undefined
        ? []
        : pass.previous.argumentIssues.filter(
            (issue) => !affected.has(issue.address) && index.get(issue.address) !== undefined
          )
    /** Pending validations. */
    const checks: Promise<IIssue | undefined>[] = []
    for (const usage of usages)
      if (affected === undefined || affected.has(usage.address)) this.#checkUsage(usage, checks)
    /** Entries whose modifier references are validated. */
    const entries =
      affected === undefined ? index.entries() : [...affected].map((address) => index.get(address))
    for (const entry of entries) if (entry !== undefined) this.#checkModifiers(entry, checks)
    /** Settled results. */
    const results = await Promise.all(checks)
    return [...kept, ...results.filter((issue): issue is IIssue => issue !== undefined)]
  }

  /** Queues the parameter validation of one fragment usage, when its fragment declares a schema. */
  #checkUsage(usage: IFragmentUsage, checks: Promise<IIssue | undefined>[]): void {
    /** Schema of the fragment, if it declares one. */
    const schema = (this.#catalog.get(usage.fragmentId) as IFragmentDefinition<unknown>)?.argsSchema
    if (schema !== undefined)
      checks.push(
        argumentIssue(schema, usage.props, usage.address, 'props', '', HostIssueRule.fragmentArgs)
      )
  }

  /** Queues the argument validation of every modifier reference of one node. */
  #checkModifiers(entry: IIndexedNode, checks: Promise<IIssue | undefined>[]): void {
    for (const event of eventEntries(entry.node.facets?.events)) {
      /** References of the subscription. */
      const refs = event.subscription.modifiers ?? []
      for (let position = 0; position < refs.length; position += 1) {
        /** Reference at the position. */
        const ref = refs[position] as IModifierRef
        /** Modifier definition, when available. */
        const definition = this.#catalog.get(modifierId(ref)) as IModifierDefinition<unknown>
        if (definition?.argsSchema === undefined) continue
        checks.push(
          argumentIssue(
            definition.argsSchema,
            modifierArgs(ref),
            entry.address,
            'events',
            `${event.key}/modifiers/${position}`,
            HostIssueRule.modifierArgs
          )
        )
      }
    }
  }

  /** Enhances every node, reusing cached results for unaffected addresses. */
  #enhance(index: IAddressIndex, pass: IPass): ReadonlyMap<string, IPartFacets> {
    /** Ordered enhancers per tag, computed once per pass. */
    const ordered = new Map<string, readonly IEnhancerDefinition<unknown>[]>()
    /** Result map. */
    const enhanced = new Map<string, IPartFacets>()
    for (const entry of index.entries()) {
      /** Cached configuration from the previous version. */
      const cached = pass.previous?.enhanced.get(entry.address)
      if (
        cached !== undefined &&
        pass.affected !== undefined &&
        !pass.affected.has(entry.address)
      ) {
        enhanced.set(entry.address, cached)
        continue
      }
      /** Ordered enhancers of the node's tag. */
      let list = ordered.get(entry.node.tag)
      if (list === undefined) {
        list = orderEnhancers(entry.node.tag, this.#catalog.enhancersFor(entry.node.tag))
        ordered.set(entry.node.tag, list)
      }
      enhanced.set(entry.address, applyEnhancers(list, entry.node, entry.address, this.#trace))
    }
    return enhanced
  }

  /** Builds the resolved node of an indexed node and its subtree. */
  #resolve(
    node: IPartNode,
    index: IAddressMap,
    enhanced: ReadonlyMap<string, IPartFacets>
  ): IResolvedNode {
    /** Address of the node, found through the identity map. */
    const address = index.get(node) ?? ''
    /** Enhanced configuration. */
    const enhancedConfig = enhanced.get(address) ?? {}
    /** Part definition; the tree exists only when every reference resolved. */
    const definition = this.#catalog.get(node.tag) as IPartDefinition<unknown>
    /** Behavior groups of the part. */
    const behavior = definition.descriptor.behavior ?? {}
    /** Open-state prop name, when the part declares one. */
    const openState = behavior.states?.openState
    /** Open-state path, when the part declares one. */
    const openStatePath =
      openState === undefined ? undefined : this.#statePath(address, openState, enhancedConfig)
    /**
     * Configuration with the open-state prop bound to its path, so renderers read and write one
     * place.
     */
    const config =
      openState === undefined || openStatePath === undefined
        ? enhancedConfig
        : {
            ...enhancedConfig,
            props: { ...enhancedConfig.props, [openState]: { $state: openStatePath } }
          }
    /** Slot members resolved per slot name. */
    const slots: Record<string, IResolvedNode[]> = {}
    for (const [name, members] of Object.entries(node.facets?.slots ?? {}))
      slots[name] = members.map((member) => this.#resolve(member, index, enhanced))
    return {
      address,
      definition,
      behavior,
      config,
      derivedAria: derivedAria(behavior.aria),
      ariaStates: this.#ariaStates(address, behavior, enhancedConfig),
      ...tabIndexOf(config),
      ...(openStatePath === undefined ? {} : { openStatePath }),
      styleRules: styleRules(address, config, definition),
      children: (node.children ?? []).map((child) => this.#resolve(child, index, enhanced)),
      slots,
      ...(node.template === undefined
        ? {}
        : {
            template: {
              rowKey: node.template.rowKey,
              rows: node.template.rows,
              node: this.#resolve(node.template.node, index, enhanced),
              ...(node.template.virtual === undefined ? {} : { virtual: node.template.virtual })
            }
          })
    }
  }

  /**
   * State path of one declared state of a node. A `$state` binding on the prop of the same name
   * wins; otherwise the state lives at `part.<address>.<name>`, seeded from the authored literal
   * (or `false`) so renderers and aria read one place.
   */
  #statePath(address: string, name: string, config: IPartFacets): string {
    /** Authored value of the state prop. */
    const value = config.props?.[name]
    if (isStateBinding(value)) return value.$state
    /** Part-scope path for literal or absent values. */
    const path = `part.${address}.${name}`
    this.#state.seed(path, value ?? false)
    return path
  }

  /** State-derived aria of a node: attribute name to the state path whose value it mirrors. */
  #ariaStates(
    address: string,
    behavior: IBehavior,
    config: IPartFacets
  ): Readonly<Record<string, string>> {
    /** Collected attribute paths. */
    const result: Record<string, string> = {}
    for (const [name, derivation] of Object.entries(behavior.aria ?? {}))
      if ('fromState' in derivation)
        result[name] = this.#statePath(address, derivation.fromState, config)
    return result
  }
}

/**
 * Validates one argument value; resolves to an `ARGS_INVALID` issue (the rejection on `cause`) or
 * to `undefined` when the value is valid.
 */
function argumentIssue(
  schema: IStandardSchemaInput,
  value: unknown,
  address: string,
  facet: string,
  path: string,
  rule: string
): Promise<IIssue | undefined> {
  return validateArgs(schema, value).then(
    () => undefined,
    (cause: unknown) => ({
      address,
      facet,
      path,
      code: PartContractErrorCode.argsInvalid,
      rule,
      messageKey: rule,
      severity: 'error' as const,
      cause
    })
  )
}

/**
 * Adds the expanded subtree of every affected fragment usage to the affected set, so a patch on a
 * usage reprocesses the nodes its fragment produced. Each entry walks its parent chain once.
 */
function widenAffected(
  affected: ReadonlySet<string>,
  index: IAddressIndex,
  usages: readonly IFragmentUsage[]
): ReadonlySet<string> {
  /** Affected usage addresses. */
  const roots = new Set(
    usages.map((usage) => usage.address).filter((address) => affected.has(address))
  )
  if (roots.size === 0) return affected
  /** Widened set. */
  const widened = new Set(affected)
  for (const entry of index.entries()) {
    /** Ancestor on the walk up. */
    let parent = entry.parent
    while (parent !== undefined && !roots.has(parent)) parent = index.get(parent)?.parent
    if (parent !== undefined) widened.add(entry.address)
  }
  return widened
}

/**
 * Authored addresses a new version changes: every address with a changed group or child list, and
 * for an added or removed node its own address plus its parent's. One pass over both indexes.
 */
function changedAddresses(previous: ILoaded, next: IBlueprint): ReadonlySet<string> {
  /** Index of the new version, for parents of added nodes. */
  const nextIndex = createAddressIndex(next)
  /** Collected addresses. */
  const changed = new Set<string>()
  for (const target of auditTargets(previous.authoredIndex.blueprint, next)) {
    /** Changed address. */
    const address = target.address as string
    changed.add(address)
    if (target.facet !== 'node') continue
    /** Parent on whichever side holds the node. */
    const parent = (nextIndex.get(address) ?? previous.authoredIndex.get(address))?.parent
    if (parent !== undefined) changed.add(parent)
  }
  return changed
}

/** Address by node object, built once per pass; nodes of one parsed blueprint are unique objects. */
type IAddressMap = ReadonlyMap<IPartNode, string>

/** Builds the node-to-address map of an index in one walk. */
function addressMap(index: IAddressIndex): IAddressMap {
  /** Map under construction. */
  const map = new Map<IPartNode, string>()
  for (const entry of index.entries()) map.set(entry.node, entry.address)
  return map
}

/** Rebuilds a node tree with enhanced facets in place of authored facets. */
function rebuild(
  node: IPartNode,
  index: IAddressMap,
  enhanced: ReadonlyMap<string, IPartFacets>
): IPartNode {
  /** Enhanced facets of this node. */
  const facets = enhanced.get(index.get(node) ?? '')
  /** Rebuilt slot groups. */
  const slots: Record<string, IPartNode[]> = {}
  for (const [name, members] of Object.entries(node.facets?.slots ?? {}))
    slots[name] = members.map((member) => rebuild(member, index, enhanced))
  return {
    ...node,
    facets: { ...facets, ...(Object.keys(slots).length > 0 ? { slots } : {}) },
    ...(node.children === undefined
      ? {}
      : { children: node.children.map((child) => rebuild(child, index, enhanced)) }),
    ...(node.template === undefined
      ? {}
      : { template: { ...node.template, node: rebuild(node.template.node, index, enhanced) } })
  }
}

/** Identity of an issue for de-duplication across phases. */
function issueKey(issue: IIssue): string {
  return `${issue.rule}\u0000${issue.address}\u0000${issue.facet}\u0000${issue.path}`
}

/** Authored issues followed by resolved issues not already reported. */
function mergeIssues(authored: readonly IIssue[], resolved: readonly IIssue[]): IIssue[] {
  /** Keys already present. */
  const seen = new Set(authored.map(issueKey))
  return [...authored, ...resolved.filter((issue) => !seen.has(issueKey(issue)))]
}

/** Relation aria values: attribute to target address. */
function derivedAria(
  aria: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, string>> {
  /** Collected relations. */
  const result: Record<string, string> = {}
  for (const [name, derivation] of Object.entries(aria ?? {}))
    if (typeof derivation === 'object' && derivation !== null && 'relation' in derivation)
      result[name] = String((derivation as { relation: string }).relation)
  return result
}

/** Tab index from the authored attribute, only 0 or -1. */
function tabIndexOf(config: IPartFacets): { readonly tabIndex?: 0 | -1 } {
  /** Authored value. */
  const value = Number(config.attrs?.tabindex)
  return value === 0 || value === -1 ? { tabIndex: value } : {}
}

/** Blueprint-layer style rule from declared hooks only. */
function styleRules(
  address: string,
  config: IPartFacets,
  definition: IPartDefinition<unknown>
): readonly IStyleRule[] {
  /** Declared hooks of the part. */
  const hooks = definition.descriptor.styleHooks ?? {}
  /** Declarations for declared hooks. */
  const declarations: Record<string, string> = {}
  for (const [name, value] of Object.entries(config.style ?? {}))
    if (hooks[name] !== undefined) declarations[name] = String(value)
  return Object.keys(declarations).length === 0
    ? []
    : [{ address, layer: 'blueprint', declarations }]
}

/** Collects resolved nodes by address in one walk. */
function collect(node: IResolvedNode, into: Map<string, IResolvedNode>): void {
  into.set(node.address, node)
  for (const child of node.children) collect(child, into)
  for (const members of Object.values(node.slots))
    for (const member of members) collect(member, into)
}

/** Change set: affected nodes that still exist, and addresses that disappeared. */
function changeSet(
  tree: IResolvedTree,
  previous: ILoaded,
  index: IAddressIndex,
  affected: ReadonlySet<string> | undefined
): IResolvedChanges {
  /** Resolved nodes by address. */
  const nodes = new Map<string, IResolvedNode>()
  collect(tree.root, nodes)
  /** Changed nodes. */
  const changed: IResolvedNode[] = []
  for (const address of affected ?? nodes.keys()) {
    /** Node at the address. */
    const node = nodes.get(address)
    if (node !== undefined) changed.push(node)
  }
  /** Removed addresses. */
  const removed: string[] = []
  for (const entry of previous.index.entries())
    if (index.get(entry.address) === undefined) removed.push(entry.address)
  return { blueprintId: tree.blueprintId, tree, changed, removed }
}
