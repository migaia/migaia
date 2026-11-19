import { createAddressIndex, type IAddressIndex } from '../address.ts'
import type { IBlueprint, IPartFacets, IPartNode, IPartTemplate } from '../types.ts'

/**
 * Configuration groups compared per address. The array is a fixed compile-time list (8 entries);
 * loops over it are bounded by that constant, not by blueprint size.
 */
export const NODE_GROUPS = [
  'tag',
  'attrs',
  'props',
  'aria',
  'data',
  'style',
  'events',
  'template'
] as const

/** One configuration group compared by merge and audit. */
export type INodeGroup = (typeof NODE_GROUPS)[number]

/** Child-list group key: `children`, `slots.<name>` or `template.node`. */
export type IChildGroup = string

/** Child-list group of the children array. */
export const CHILDREN_GROUP = 'children'

/** Child-list group of the template node. */
export const TEMPLATE_NODE_GROUP = 'template.node'

/** Prefix of a slot child-list group. */
export const SLOT_GROUP_PREFIX = 'slots.'

/**
 * Address index plus, for each address, its child-list groups in document order. Built once per
 * blueprint in one pass over the index.
 */
export type IIndexedSide = {
  readonly index: IAddressIndex
  readonly lists: ReadonlyMap<string, ReadonlyMap<IChildGroup, readonly string[]>>
}

/** Child-list group of a child, from its pointer relative to its parent's pointer. */
function childGroup(parentPointer: string, childPointer: string): IChildGroup {
  /** Pointer text after the parent's pointer. */
  const rest = childPointer.slice(parentPointer.length)
  if (rest.startsWith('/children/')) return CHILDREN_GROUP
  if (rest === '/template/node') return TEMPLATE_NODE_GROUP
  /** `/facets/slots/<name>/<i>` split into segments. */
  const segments = rest.split('/')
  return `${SLOT_GROUP_PREFIX}${segments[3] ?? ''}`
}

/** Indexes one blueprint and groups child addresses by parent and child-list group. */
export function indexSide(blueprint: IBlueprint): IIndexedSide {
  /** Address index of the blueprint. */
  const index = createAddressIndex(blueprint)
  /** Child lists by parent address. */
  const lists = new Map<string, Map<IChildGroup, string[]>>()
  for (const entry of index.entries()) {
    if (entry.parent === undefined) continue
    /** Parent pointer, for the group key. */
    const parentPointer = index.get(entry.parent)?.pointer ?? ''
    /** Groups of this parent. */
    let groups = lists.get(entry.parent)
    if (groups === undefined) {
      groups = new Map()
      lists.set(entry.parent, groups)
    }
    /** Group key of this child. */
    const key = childGroup(parentPointer, entry.pointer)
    /** Addresses in this group. */
    const members = groups.get(key)
    if (members === undefined) groups.set(key, [entry.address])
    else members.push(entry.address)
  }
  return { index, lists }
}

/** Template configuration without its node, compared as the `template` group. */
function templateConfig(template: IPartTemplate | undefined): unknown {
  return template === undefined ? undefined : { rowKey: template.rowKey, rows: template.rows }
}

/** Value of one configuration group of a node. */
export function groupValue(node: IPartNode, group: INodeGroup): unknown {
  if (group === 'tag') return node.tag
  if (group === 'template') return templateConfig(node.template)
  return node.facets?.[group]
}

/** JSON text of a value for equality checks; `undefined` maps to a fixed marker. */
export function jsonOf(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined'
}

/** Child-list group keys present on either node of an address, in first-seen order. */
export function childGroupKeys(
  first: ReadonlyMap<IChildGroup, readonly string[]> | undefined,
  second: ReadonlyMap<IChildGroup, readonly string[]> | undefined
): IChildGroup[] {
  /** Keys in first-seen order. */
  const keys = new Set<IChildGroup>(first?.keys() ?? [])
  for (const key of second?.keys() ?? []) keys.add(key)
  return [...keys]
}

/** One merge conflict: the address, the group (or `node` for delete-versus-modify) and its pointer. */
export type IMergeConflict = {
  readonly address: string
  readonly facet: string
  readonly path: string
}

/** Result of `mergeBlueprint`: the merged document and every conflict, in document order. */
export type IMergeResult = {
  readonly merged: IBlueprint
  readonly conflicts: readonly IMergeConflict[]
}

/** Merge state: the three indexed sides and the conflicts found so far. */
type IMergeState = {
  readonly base: IIndexedSide
  readonly ours: IIndexedSide
  readonly theirs: IIndexedSide
  readonly conflicts: IMergeConflict[]
}

/** True when two address lists are equal element by element. */
function sameList(first: readonly string[], second: readonly string[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1)
    if (first[index] !== second[index]) return false
  return true
}

/** True when the subtree at `address` on `side` differs from the base subtree. */
function subtreeChanged(state: IMergeState, side: IIndexedSide, address: string): boolean {
  return jsonOf(state.base.index.get(address)?.node) !== jsonOf(side.index.get(address)?.node)
}

/** Pointer of an address on ours, falling back to theirs, for conflict reports. */
function pointerOf(state: IMergeState, address: string): string {
  return state.ours.index.get(address)?.pointer ?? state.theirs.index.get(address)?.pointer ?? ''
}

/**
 * Three-way choice of one group value; records a conflict and keeps ours when both changed
 * differently.
 */
function pickGroup(
  state: IMergeState,
  address: string,
  group: INodeGroup,
  nodes: readonly [IPartNode, IPartNode, IPartNode]
): unknown {
  /** Base, ours and theirs values. */
  const [baseValue, oursValue, theirsValue] = nodes.map((node) => groupValue(node, group))
  /** JSON of each value. */
  const [baseJson, oursJson, theirsJson] = [
    jsonOf(baseValue),
    jsonOf(oursValue),
    jsonOf(theirsValue)
  ]
  if (oursJson === theirsJson || theirsJson === baseJson) return oursValue
  if (oursJson === baseJson) return theirsValue
  state.conflicts.push({ address, facet: group, path: pointerOf(state, address) })
  return oursValue
}

/**
 * Three-way choice of one child list. Takes the changed side's order; both changed differently is a
 * conflict keeping ours. A child one side deleted while the other changed its subtree is a
 * delete-versus-modify conflict; ours is kept, so a child ours kept stays in the list.
 */
function pickList(state: IMergeState, address: string, key: IChildGroup): readonly string[] {
  /** Lists of the three sides; a missing group is empty. */
  const baseList = state.base.lists.get(address)?.get(key) ?? []
  const oursList = state.ours.lists.get(address)?.get(key) ?? []
  const theirsList = state.theirs.lists.get(address)?.get(key) ?? []
  /** Chosen order. */
  let chosen = oursList
  if (!sameList(oursList, theirsList) && !sameList(theirsList, baseList)) {
    if (sameList(oursList, baseList)) chosen = theirsList
    else state.conflicts.push({ address, facet: key, path: pointerOf(state, address) })
  }
  /** Members of ours and theirs, for delete detection. */
  const inOurs = new Set(oursList)
  const inTheirs = new Set(theirsList)
  for (const child of baseList) {
    /** Delete-versus-modify: one side removed the child, the other changed its subtree. */
    const oursDeleted =
      !inOurs.has(child) && inTheirs.has(child) && subtreeChanged(state, state.theirs, child)
    const theirsDeleted =
      !inTheirs.has(child) && inOurs.has(child) && subtreeChanged(state, state.ours, child)
    if (!oursDeleted && !theirsDeleted) continue
    state.conflicts.push({ address: child, facet: 'node', path: pointerOf(state, child) })
    if (theirsDeleted) chosen = oursList
  }
  return chosen
}

/** Builds the merged facets of a node present on all three sides. */
function mergeFacets(
  state: IMergeState,
  address: string,
  nodes: readonly [IPartNode, IPartNode, IPartNode]
): IPartFacets {
  /** Merged facets under construction. */
  const facets: Record<string, unknown> = {}
  for (const group of ['attrs', 'props', 'aria', 'data', 'style', 'events'] as const) {
    /** Chosen value of the group. */
    const value = pickGroup(state, address, group, nodes)
    if (value !== undefined) facets[group] = value
  }
  return facets as IPartFacets
}

/** Merged node at an address, recursing into its chosen child lists. */
function mergeNode(state: IMergeState, address: string): IPartNode {
  /** Node on each side. */
  const baseNode = state.base.index.get(address)?.node
  const oursNode = state.ours.index.get(address)?.node
  const theirsNode = state.theirs.index.get(address)?.node
  if (oursNode !== undefined && theirsNode === undefined) return oursNode
  if (oursNode === undefined) return theirsNode as IPartNode
  if (baseNode === undefined) {
    if (jsonOf(oursNode) !== jsonOf(theirsNode))
      state.conflicts.push({ address, facet: 'node', path: pointerOf(state, address) })
    return oursNode
  }
  /** The three nodes in base, ours, theirs order. */
  const nodes = [baseNode, oursNode, theirsNode as IPartNode] as const
  /** Merged facets without slots. */
  const facets: Record<string, unknown> = { ...mergeFacets(state, address, nodes) }
  /** Merged node fields. */
  const merged: Record<string, unknown> = { tag: pickGroup(state, address, 'tag', nodes) }
  if (oursNode.id !== undefined) merged.id = oursNode.id
  /** Slots under construction. */
  const slots: Record<string, IPartNode[]> = {}
  for (const key of childGroupKeys(
    state.ours.lists.get(address),
    state.theirs.lists.get(address)
  )) {
    /** Merged members of this child list. */
    const members = pickList(state, address, key).map((child) => mergeNode(state, child))
    if (key === CHILDREN_GROUP) merged.children = members
    else if (key === TEMPLATE_NODE_GROUP) {
      /** Template configuration chosen three-way. */
      const config = pickGroup(state, address, 'template', nodes) as
        | { rowKey: string; rows?: unknown }
        | undefined
      if (config !== undefined && members[0] !== undefined)
        merged.template = { ...config, node: members[0] }
    } else slots[key.slice(SLOT_GROUP_PREFIX.length)] = members
  }
  if (Object.keys(slots).length > 0) facets.slots = slots
  if (Object.keys(facets).length > 0) merged.facets = facets
  return merged as IPartNode
}

/**
 * Three-way merge of a blueprint by address and configuration group. A group changed on one side
 * takes that side; changed identically on both is taken; changed differently is a conflict keeping
 * ours. Child order is merged per parent and child-list group, with a conflict keyed by the parent
 * address. Deleting a node one side changed is a conflict. Each node is visited once; nothing is
 * sorted.
 */
export function mergeBlueprint(
  base: IBlueprint,
  ours: IBlueprint,
  theirs: IBlueprint
): IMergeResult {
  /** Merge state shared by the helpers. */
  const state: IMergeState = {
    base: indexSide(base),
    ours: indexSide(ours),
    theirs: indexSide(theirs),
    conflicts: []
  }
  /** Root address of ours. */
  const root = state.ours.index.entries().next().value?.address as string
  return {
    merged: { id: ours.id, version: ours.version, root: mergeNode(state, root) },
    conflicts: state.conflicts
  }
}
