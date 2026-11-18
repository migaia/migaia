import { createAddressIndex, type IAddressIndex } from './address.ts'
import { isRecord } from './record.ts'
import { PartContractErrorCode } from './error-code.ts'
import { PartContractErrorText } from './error-text.ts'
import { createPartContractError } from './errors.ts'
import type {
  IBlueprint,
  ICatalogView,
  IDescriptor,
  IFragmentBody,
  IIssue,
  IPartAddress,
  IPartFacets,
  IPartNode
} from './types.ts'

/** Deepest allowed nesting of fragment usages inside fragment bodies. */
export const FRAGMENT_MAX_DEPTH = 16
/** Largest number of nodes one expansion may produce; expansion stops as soon as it is passed. */
export const FRAGMENT_MAX_NODES = 10000
/** Rule id of the missing-parameter check run during expansion. */
const PARAM_MISSING = 'fragment.param-missing'
/** Rule id of the undeclared-slot check run during expansion. */
const SLOT_UNKNOWN = 'fragment.slot-unknown'
/**
 * Facet keys a usage may carry: parameters and slot fills. Fixed size two, so the membership check
 * is constant time.
 */
const USAGE_FACETS: ReadonlySet<string> = new Set(['props', 'slots'])

/** One fragment usage met during expansion, nested usages included. */
export type IFragmentUsage = {
  readonly address: IPartAddress
  readonly fragmentId: string
  readonly props: Readonly<Record<string, unknown>>
}

/**
 * Result of `expandFragments`: the expanded blueprint, its address index, every usage met (for
 * argument validation by the host) and the issues of the two expansion checks.
 */
export type IFragmentExpansion = {
  readonly blueprint: IBlueprint
  readonly index: IAddressIndex
  readonly usages: readonly IFragmentUsage[]
  readonly issues: readonly IIssue[]
}

/** A usage recorded before addresses are known: the expanded root stands for its address. */
type IPendingUsage = {
  readonly root: IPartNode
  readonly descriptor: IDescriptor
  readonly props: Readonly<Record<string, unknown>>
  readonly filled: readonly string[]
}

/** Replaces `{ $param }` placeholders in a facet value with the usage's parameters. */
function substitute(value: unknown, props: Readonly<Record<string, unknown>>): unknown {
  if (Array.isArray(value)) return value.map((item) => substitute(item, props))
  if (!isRecord(value)) return value
  if (typeof value.$param === 'string') return props[value.$param]
  /** Object with substituted members. */
  const result: Record<string, unknown> = {}
  for (const [key, member] of Object.entries(value)) result[key] = substitute(member, props)
  return result
}

/** Facets of a body node with parameters substituted; slot members are instantiated as nodes. */
function instantiateFacets(
  facets: IPartFacets | undefined,
  props: Readonly<Record<string, unknown>>,
  fills: Readonly<Record<string, readonly IPartNode[]>>
): IPartFacets | undefined {
  if (facets === undefined) return undefined
  /** Facets other than slots, substituted as plain values. */
  const { slots, ...rest } = facets
  /** Substituted facet values. */
  const result = substitute(rest, props) as Record<string, unknown>
  if (slots !== undefined) {
    /** Instantiated slot groups. */
    const groups: Record<string, IPartNode[]> = {}
    for (const [name, members] of Object.entries(slots))
      groups[name] = members.map((member) => instantiate(member, props, fills))
    result.slots = groups
  }
  return result as IPartFacets
}

/**
 * Copies a fragment body node with parameters substituted and each `{ $slot }` child replaced by
 * the usage's fill for that slot, marked with `$slotOf`. Recursion depth equals the body depth.
 */
function instantiate(
  node: IPartNode,
  props: Readonly<Record<string, unknown>>,
  fills: Readonly<Record<string, readonly IPartNode[]>>
): IPartNode {
  /** Children with slot placeholders replaced. */
  const children: IPartNode[] = []
  for (const child of node.children ?? []) {
    /** Slot name when the child is a placeholder. */
    const slot = (child as { readonly $slot?: unknown }).$slot
    if (typeof slot !== 'string') {
      children.push(instantiate(child, props, fills))
      continue
    }
    for (const member of fills[slot] ?? []) children.push({ ...member, $slotOf: slot })
  }
  /** Substituted facets. */
  const facets = instantiateFacets(node.facets, props, fills)
  return {
    ...node,
    ...(facets === undefined ? {} : { facets }),
    ...(node.children === undefined ? {} : { children }),
    ...(node.template === undefined
      ? {}
      : {
          template: {
            ...node.template,
            rows: substitute(node.template.rows, props),
            node: instantiate(node.template.node, props, fills)
          }
        })
  }
}

/** Throws `BLUEPRINT_INVALID` when a usage carries anything besides id, props and slots. */
function checkUsage(usage: IPartNode): void {
  /** Facet keys the usage writes. */
  const facetKeys = Object.keys(usage.facets ?? {})
  if (
    usage.children !== undefined ||
    usage.template !== undefined ||
    facetKeys.some((key) => !USAGE_FACETS.has(key))
  )
    throw createPartContractError(
      PartContractErrorCode.blueprintInvalid,
      PartContractErrorText.fragmentUsage(usage.id ?? usage.tag)
    )
}

/** Expands fragment usages of one blueprint; one instance per `expandFragments` call. */
class FragmentExpander {
  /** Catalog consulted for fragment descriptors. */
  readonly #catalog: ICatalogView
  /** Usages met, in expansion order. */
  readonly pending: IPendingUsage[] = []
  /** Nodes produced so far; checked against the node limit on every node. */
  #count = 0

  /** Binds the expander to a catalog view. */
  constructor(catalog: ICatalogView) {
    this.#catalog = catalog
  }

  /**
   * Returns a copy of `node` with every fragment usage in its subtree expanded. `stack` holds the
   * fragment ids on the current expansion path (at most sixteen), so the cycle check is bounded.
   */
  expand(node: IPartNode, stack: readonly string[]): IPartNode {
    this.#count += 1
    if (this.#count > FRAGMENT_MAX_NODES)
      throw createPartContractError(
        PartContractErrorCode.fragmentTooLarge,
        PartContractErrorText.fragmentTooLarge(FRAGMENT_MAX_NODES)
      )
    /** Descriptor under the node's tag. */
    const descriptor = this.#catalog.get(node.tag)
    if (descriptor?.kind === 'fragment' && descriptor.fragment !== undefined)
      return this.#expandUsage(node, descriptor, descriptor.fragment, stack)
    return this.#expandInside(node, stack)
  }

  /** Copies a non-usage node, expanding its children, slot members and template node. */
  #expandInside(node: IPartNode, stack: readonly string[]): IPartNode {
    /** Expanded slot groups. */
    let slots: Record<string, IPartNode[]> | undefined
    for (const [name, members] of Object.entries(node.facets?.slots ?? {})) {
      slots ??= {}
      slots[name] = members.map((member) => this.expand(member, stack))
    }
    return {
      ...node,
      ...(slots === undefined ? {} : { facets: { ...node.facets, slots } }),
      ...(node.children === undefined
        ? {}
        : { children: node.children.map((child) => this.expand(child, stack)) }),
      ...(node.template === undefined
        ? {}
        : { template: { ...node.template, node: this.expand(node.template.node, stack) } })
    }
  }

  /** Replaces one usage by its fragment body and expands the result. */
  #expandUsage(
    usage: IPartNode,
    descriptor: IDescriptor,
    body: IFragmentBody,
    stack: readonly string[]
  ): IPartNode {
    if (stack.includes(descriptor.id))
      throw createPartContractError(
        PartContractErrorCode.fragmentCycle,
        PartContractErrorText.fragmentCycle(descriptor.id),
        [...stack, descriptor.id]
      )
    if (stack.length >= FRAGMENT_MAX_DEPTH)
      throw createPartContractError(
        PartContractErrorCode.fragmentTooDeep,
        PartContractErrorText.fragmentTooDeep(FRAGMENT_MAX_DEPTH)
      )
    checkUsage(usage)
    /** Parameters of the usage. */
    const props = usage.facets?.props ?? {}
    /** Slot fills of the usage. */
    const fills = usage.facets?.slots ?? {}
    /** Body copy with parameters and slot fills in place. */
    const instance = instantiate(body.node, props, fills)
    /** Expanded body. */
    const expanded = this.expand(instance, [...stack, descriptor.id])
    /** Body root copy; its id is dropped so the root takes the usage's id or generated name. */
    const bare: { -readonly [K in keyof IPartNode]: IPartNode[K] } = { ...expanded }
    delete bare.id
    /** Root standing at the usage's address. */
    const root: IPartNode = {
      ...bare,
      ...(usage.id === undefined ? {} : { id: usage.id }),
      ...(usage.$slotOf === undefined ? {} : { $slotOf: usage.$slotOf }),
      $fragment: descriptor.id
    }
    this.#rehome(expanded, root)
    this.pending.push({ root, descriptor, props, filled: Object.keys(fills) })
    return root
  }

  /**
   * When a fragment body's root is itself a usage, the inner usage was recorded with the object the
   * outer usage now replaces; point that record at the outer root, which stands at the same
   * address.
   */
  #rehome(previous: IPartNode, root: IPartNode): void {
    /** Most recent record; an inner root usage is always the last one pushed. */
    const last = this.pending.at(-1)
    if (last?.root === previous) this.pending[this.pending.length - 1] = { ...last, root }
  }
}

/** Issues of the two expansion checks for one usage. */
function usageIssues(usage: IPendingUsage, address: IPartAddress): IIssue[] {
  /** Collected issues. */
  const issues: IIssue[] = []
  /** Required parameter names from the fragment's argument schema. */
  const required = usage.descriptor.args?.required
  for (const name of Array.isArray(required) ? required : [])
    if (usage.props[String(name)] === undefined)
      issues.push(expansionIssue(address, 'props', String(name), PARAM_MISSING))
  /** Declared slot names; a fragment declares only a handful. */
  const declared = new Set(usage.descriptor.fragment?.slots ?? [])
  for (const name of usage.filled)
    if (!declared.has(name)) issues.push(expansionIssue(address, 'slots', name, SLOT_UNKNOWN))
  return issues
}

/** Builds one expansion-check issue. */
function expansionIssue(address: IPartAddress, facet: string, path: string, rule: string): IIssue {
  return { address, facet, path, code: rule, rule, messageKey: rule, severity: 'error' }
}

/**
 * Expands every fragment usage of a blueprint. Pure: the input is not modified. Usages whose tag
 * has no available fragment descriptor stay as they are, so catalog rules report them. Throws
 * `FRAGMENT_CYCLE`, `FRAGMENT_TOO_DEEP`, `FRAGMENT_TOO_LARGE`, `BLUEPRINT_INVALID` (a usage with
 * other content) or `ADDRESS_DUPLICATE`.
 */
export function expandFragments(blueprint: IBlueprint, catalog: ICatalogView): IFragmentExpansion {
  /** Expander of this call. */
  const expander = new FragmentExpander(catalog)
  /** Expanded document. */
  const expanded: IBlueprint = { ...blueprint, root: expander.expand(blueprint.root, []) }
  /** Address index of the expanded document. */
  const index = createAddressIndex(expanded)
  if (expander.pending.length === 0) return { blueprint: expanded, index, usages: [], issues: [] }
  /** Address of each node, for the recorded usages. */
  const addresses = new Map<IPartNode, IPartAddress>()
  for (const entry of index.entries()) addresses.set(entry.node, entry.address)
  /** Usages with addresses. */
  const usages: IFragmentUsage[] = []
  /** Expansion-check issues. */
  const issues: IIssue[] = []
  for (const pending of expander.pending) {
    /** Address of the usage's expanded root. */
    const address = addresses.get(pending.root) ?? ''
    usages.push({ address, fragmentId: pending.descriptor.id, props: pending.props })
    issues.push(...usageIssues(pending, address))
  }
  return { blueprint: expanded, index, usages, issues }
}
