import type { IResolvedChanges, IResolvedNode, IResolvedTree } from '@migaia/part-host'

/** Collects nodes by address in one walk. */
function collect(node: IResolvedNode, into: Map<string, IResolvedNode>): void {
  into.set(node.address, node)
  for (const child of node.children) collect(child, into)
  for (const members of Object.values(node.slots))
    for (const member of members) collect(member, into)
}

/**
 * Per-mount store of resolved nodes with one listener set per address, so an update notifies only
 * the nodes it changed.
 */
export class NodeStore {
  /** Nodes by address. */
  readonly #nodes = new Map<string, IResolvedNode>()
  /** Listeners by address. */
  readonly #listeners = new Map<string, Set<() => void>>()
  /** Root address. */
  readonly rootAddress: string

  /** Seeds the store from a tree. */
  constructor(tree: IResolvedTree) {
    collect(tree.root, this.#nodes)
    this.rootAddress = tree.root.address
  }

  /** Node at an address. */
  get(address: string): IResolvedNode | undefined {
    return this.#nodes.get(address)
  }

  /** Subscribes to one address; returns the removal. */
  subscribe(address: string, listener: () => void): () => void {
    /** Listener set of the address. */
    const set = this.#listeners.get(address) ?? new Set()
    set.add(listener)
    this.#listeners.set(address, set)
    return () => set.delete(listener)
  }

  /**
   * Replaces changed nodes, adds their new descendants, removes gone addresses, notifies changed
   * ones.
   */
  update(changes: IResolvedChanges): void {
    for (const address of changes.removed) this.#nodes.delete(address)
    for (const node of changes.changed) collect(node, this.#nodes)
    for (const node of changes.changed)
      for (const listener of this.#listeners.get(node.address) ?? []) listener()
  }
}
