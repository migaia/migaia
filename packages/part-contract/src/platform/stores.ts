import { isResourceBinding } from '../data.ts'
import type { IBlueprint, IPartNode } from '../types.ts'

/**
 * Namespaces served by every host's default store. They are always registered, never listed in a
 * capability manifest and never reported by `collectStores`.
 */
export const DEFAULT_STATE_NAMESPACES: readonly string[] = Object.freeze([
  'page',
  'section',
  'part'
])

/** Default namespaces as a set for O(1) membership checks. */
const DEFAULT_SET: ReadonlySet<string> = new Set(DEFAULT_STATE_NAMESPACES)

/** First `.`-separated segment of a state path. */
export function stateNamespaceOf(path: string): string {
  /** Position of the first separator, or -1. */
  const dot = path.indexOf('.')
  return dot < 0 ? path : path.slice(0, dot)
}

/** Walk state of `collectStores`: namespaces found in first-occurrence order and pending nodes. */
type IStoreWalk = { readonly found: Set<string>; readonly pending: IPartNode[] }

/** Records the namespace of a `{ $state }` binding that is not a default namespace. */
function addBinding(walk: IStoreWalk, value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  /** Path of a `{ $state }` binding. */
  const path = (value as { readonly $state?: unknown }).$state
  if (typeof path !== 'string') return
  /** Namespace of the path. */
  const namespace = stateNamespaceOf(path)
  if (!DEFAULT_SET.has(namespace)) walk.found.add(namespace)
}

/** Records one facet value: a `$state` binding, or the `$state` parameters of a resource binding. */
function addValue(walk: IStoreWalk, value: unknown): void {
  if (isResourceBinding(value)) {
    for (const parameter of Object.values(value.params ?? {})) addBinding(walk, parameter)
    return
  }
  addBinding(walk, value)
}

/** Records one node's bindings and queues its child nodes. */
function visitStoreNode(walk: IStoreWalk, node: IPartNode): void {
  /** Facets of the node. */
  const facets = node.facets ?? {}
  for (const group of [facets.props, facets.attrs, facets.aria, facets.data, facets.style])
    for (const value of Object.values(group ?? {})) addValue(walk, value)
  for (const nodes of Object.values(facets.slots ?? {})) walk.pending.push(...nodes)
  for (const child of node.children ?? []) walk.pending.push(child)
  if (node.template !== undefined) {
    addValue(walk, node.template.rows)
    walk.pending.push(node.template.node)
  }
}

/**
 * Every non-default state namespace the blueprints bind (`$state` paths, including resource
 * parameters and template rows), in first-occurrence order, each once. Registration is not checked:
 * delivery compares the result with a client's manifest. Each node is visited once.
 */
export function collectStores(blueprints: readonly IBlueprint[]): string[] {
  /** Walk state shared by the visit helpers. */
  const walk: IStoreWalk = { found: new Set(), pending: [] }
  for (const blueprint of blueprints) {
    walk.pending.push(blueprint.root)
    for (let cursor = 0; cursor < walk.pending.length; cursor += 1)
      visitStoreNode(walk, walk.pending[cursor] as IPartNode)
    walk.pending.length = 0
  }
  return [...walk.found]
}

/** True for a namespace every host serves without registration. */
export function isDefaultStateNamespace(namespace: string): boolean {
  return DEFAULT_SET.has(namespace)
}
