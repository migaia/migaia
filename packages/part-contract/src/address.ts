import { PartContractErrorCode } from './error-code.ts'
import { PartContractErrorText } from './error-text.ts'
import { createPartContractError } from './errors.ts'
import type { IBlueprint, IPartAddress, IPartNode } from './types.ts'

/** Alphabet of node ids, slot names and generated segment names. */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/
/** One address segment: `name`, `name#index` or `slot.name`. */
const SEGMENT_PATTERN = /^(?:slot\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]+(?:#\d+)?)$/
/** Characters outside the name alphabet, replaced when a tag becomes a segment name. */
const INVALID_NAME_CHAR = /[^A-Za-z0-9_-]/g
/** Separator between the static address and the template row key. */
const ROW_MARKER = '@row:'
/** Prefix that marks a slot segment. */
const SLOT_PREFIX = 'slot.'

/** Parsed form of an address: static segments plus an optional template row key. */
export type IParsedAddress = { readonly segments: readonly string[]; readonly rowKey?: string }

/** One node in an address index with its address and its JSON Pointer inside the blueprint. */
export type IIndexedNode = {
  readonly address: IPartAddress
  readonly node: IPartNode
  readonly parent?: IPartAddress
  readonly pointer: string
}

/** Address index of the static nodes of one blueprint; insertion order is document order. */
export type IAddressIndex = {
  readonly blueprint: IBlueprint
  get(address: IPartAddress): IIndexedNode | undefined
  entries(): IterableIterator<IIndexedNode>
}

/** True when a node id or slot name stays inside the address alphabet. */
export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name)
}

/** Segment name a tag produces: the part name without `@major`, with foreign characters as `-`. */
export function tagSegmentName(tag: string): string {
  /** Position of the major separator; tags without one keep their full text. */
  const at = tag.lastIndexOf('@')
  return (at > 0 ? tag.slice(0, at) : tag).replace(INVALID_NAME_CHAR, '-')
}

/** Percent-encodes the row-key characters that carry meaning in the address grammar. */
function encodeRowKey(rowKey: string): string {
  return rowKey.replace(/[%/#@.]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Formats a parsed address; the exact inverse of `parseAddress`. */
export function formatAddress(parsed: IParsedAddress): IPartAddress {
  /** Static part joined by slashes. */
  const base = parsed.segments.join('/')
  return parsed.rowKey === undefined ? base : `${base}${ROW_MARKER}${encodeRowKey(parsed.rowKey)}`
}

/** Parses an address string; throws `ADDRESS_INVALID` when it breaks the grammar. */
export function parseAddress(address: IPartAddress): IParsedAddress {
  /** Position of the row marker, or -1 for a static address. */
  const marker = address.indexOf(ROW_MARKER)
  /** Static part of the address. */
  const base = marker === -1 ? address : address.slice(0, marker)
  /** Raw encoded row key, if present. */
  const encoded = marker === -1 ? undefined : address.slice(marker + ROW_MARKER.length)
  /** Static segments in order. */
  const segments = base.split('/')
  for (const segment of segments)
    if (!SEGMENT_PATTERN.test(segment))
      throw createPartContractError(
        PartContractErrorCode.addressInvalid,
        PartContractErrorText.addressInvalid(address)
      )
  if (encoded === undefined) return { segments }
  if (encoded === '')
    throw createPartContractError(
      PartContractErrorCode.addressInvalid,
      PartContractErrorText.addressInvalid(address)
    )
  try {
    return { segments, rowKey: decodeURIComponent(encoded) }
  } catch (cause) {
    throw createPartContractError(
      PartContractErrorCode.addressInvalid,
      PartContractErrorText.addressInvalid(address),
      cause
    )
  }
}

/** Index under construction: address map plus the blueprint it describes. */
class AddressIndex implements IAddressIndex {
  /** Blueprint whose static nodes this index covers. */
  readonly blueprint: IBlueprint
  /** Address to indexed node, in document order. */
  readonly #byAddress = new Map<IPartAddress, IIndexedNode>()

  /** Captures the blueprint; nodes are added by `add` during the single construction walk. */
  constructor(blueprint: IBlueprint) {
    this.blueprint = blueprint
  }

  /** Adds one node; a repeated address throws `ADDRESS_DUPLICATE` naming both pointers. */
  add(entry: IIndexedNode): void {
    /** Earlier node holding the same address, if any. */
    const existing = this.#byAddress.get(entry.address)
    if (existing)
      throw createPartContractError(
        PartContractErrorCode.addressDuplicate,
        PartContractErrorText.addressDuplicate(entry.address),
        { first: existing.pointer, second: entry.pointer }
      )
    this.#byAddress.set(entry.address, entry)
  }

  /** Looks up a static address in constant time. */
  get(address: IPartAddress): IIndexedNode | undefined {
    return this.#byAddress.get(address)
  }

  /** Iterates indexed nodes in document order. */
  entries(): IterableIterator<IIndexedNode> {
    return this.#byAddress.values()
  }
}

/**
 * Name generated for a node without `id`. An expanded fragment root takes the name of the fragment
 * usage it replaced, so the usage's address does not change with the fragment's body.
 */
function generatedName(node: IPartNode): string {
  return tagSegmentName(node.$fragment ?? node.tag)
}

/** Counts id-less siblings per segment name so repeated tags receive `#n` suffixes. */
function countTagNames(nodes: readonly IPartNode[]): Map<string, number> {
  /** Segment name to number of id-less siblings producing it. */
  const counts = new Map<string, number>()
  for (const node of nodes)
    if (node.id === undefined) {
      /** Name generated from this node's tag. */
      const name = generatedName(node)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  return counts
}

/** One addressing group of siblings: its address prefix and members with their positions. */
type ISiblingGroup = { readonly prefix: string; readonly members: [IPartNode, number][] }

/**
 * Splits siblings into addressing groups. Ordinary siblings share `prefix`; nodes `expandFragments`
 * inserted for a slot keep their authored prefix `<fragment root>/slot.<name>`, so each slot forms
 * its own group. One pass; at most one group per slot name.
 */
function siblingGroups(
  nodes: readonly IPartNode[],
  prefix: string,
  fragmentRoot: IPartAddress | undefined
): readonly ISiblingGroup[] {
  /** Groups by slot name; the empty name holds ordinary siblings. */
  const groups = new Map<string, ISiblingGroup>()
  nodes.forEach((node, position) => {
    /** Slot the node was inserted for, or the ordinary group. */
    const slot = fragmentRoot === undefined ? '' : (node.$slotOf ?? '')
    /** Existing or new group of the node. */
    const group = groups.get(slot) ?? {
      prefix: slot === '' ? prefix : `${fragmentRoot}/${SLOT_PREFIX}${slot}`,
      members: []
    }
    group.members.push([node, position])
    groups.set(slot, group)
  })
  return [...groups.values()]
}

/** Indexes one sibling group under a parent address prefix, then descends into each node. */
function indexGroup(
  index: AddressIndex,
  nodes: readonly IPartNode[],
  prefix: string,
  parent: IPartAddress | undefined,
  pointerBase: string,
  fragmentRoot?: IPartAddress
): void {
  for (const group of siblingGroups(nodes, prefix, fragmentRoot))
    indexMembers(index, group, parent, pointerBase, fragmentRoot)
}

/** Indexes the members of one addressing group with `#n` ordinals among same-name members. */
function indexMembers(
  index: AddressIndex,
  group: ISiblingGroup,
  parent: IPartAddress | undefined,
  pointerBase: string,
  fragmentRoot: IPartAddress | undefined
): void {
  /** Member nodes of the group. */
  const nodes = group.members.map(([node]) => node)
  /** Prefix of the group's addresses. */
  const prefix = group.prefix
  /** Sibling counts decide whether generated names need an ordinal. */
  const counts = countTagNames(nodes)
  /** Next ordinal per repeated generated name. */
  const ordinals = new Map<string, number>()
  for (const [node, position] of group.members) {
    /** Generated name when the node has no id. */
    const name = node.id ?? generatedName(node)
    /** Segment, with ordinal when several id-less siblings share the name. */
    let segment = name
    if (node.id === undefined && (counts.get(name) ?? 0) > 1) {
      /** Ordinal of this node among same-name siblings. */
      const ordinal = ordinals.get(name) ?? 0
      ordinals.set(name, ordinal + 1)
      segment = `${name}#${ordinal}`
    }
    indexNode(
      index,
      node,
      prefix === '' ? segment : `${prefix}/${segment}`,
      parent,
      `${pointerBase}/${position}`,
      fragmentRoot
    )
  }
}

/**
 * Indexes one node and its children, slots and template subtree. Recursion is bounded by depth.
 * `fragmentRoot` is the address of the nearest expanded fragment root above, for slot insertions.
 */
function indexNode(
  index: AddressIndex,
  node: IPartNode,
  address: IPartAddress,
  parent: IPartAddress | undefined,
  pointer: string,
  inheritedRoot?: IPartAddress
): void {
  index.add(parent === undefined ? { address, node, pointer } : { address, node, parent, pointer })
  /** Fragment root seen by descendants: this node when it replaced a fragment usage. */
  const fragmentRoot = node.$fragment === undefined ? inheritedRoot : address
  if (node.children)
    indexGroup(index, node.children, address, address, `${pointer}/children`, fragmentRoot)
  if (node.facets?.slots)
    for (const [slot, members] of Object.entries(node.facets.slots))
      indexGroup(
        index,
        members,
        `${address}/${SLOT_PREFIX}${slot}`,
        address,
        `${pointer}/facets/slots/${slot}`,
        fragmentRoot
      )
  if (node.template) {
    /** The single template node is its own sibling group, so it never needs an ordinal. */
    const templateNode = node.template.node
    indexNode(
      index,
      templateNode,
      `${address}/${templateNode.id ?? generatedName(templateNode)}`,
      address,
      `${pointer}/template/node`,
      fragmentRoot
    )
  }
}

/** Builds the address index of a parsed blueprint in one walk; lookups are O(1). */
export function createAddressIndex(blueprint: IBlueprint): IAddressIndex {
  /** Index receiving every static node. */
  const index = new AddressIndex(blueprint)
  /** Root segment generated the same way as any other node. */
  const rootSegment = blueprint.root.id ?? generatedName(blueprint.root)
  indexNode(index, blueprint.root, rootSegment, undefined, '/root')
  return index
}

/** Resolves a static or template-instance address to its static node and row key. */
export function resolveAddress(
  index: IAddressIndex,
  address: IPartAddress
): { readonly node: IPartNode; readonly rowKey?: string } | undefined {
  /** Parsed address separating the row key. */
  const parsed = parseAddress(address)
  /** Static entry of the address. */
  const entry = index.get(parsed.segments.join('/'))
  if (!entry) return undefined
  return parsed.rowKey === undefined
    ? { node: entry.node }
    : { node: entry.node, rowKey: parsed.rowKey }
}
