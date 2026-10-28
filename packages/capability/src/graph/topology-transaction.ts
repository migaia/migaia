/**
 * Owns the lifetime of an isolated topology transaction view. Delegates graph operations while
 * enforcing settlement; storage publication stays index-owned.
 */
import type {
  ITopologyIndex,
  ITopologyIndexNode,
  ITopologyTransaction,
  IGraphDependents
} from './topology-index.ts'
import type { ICapabilityTopology, ITopologyDependency } from './topology.ts'

/** Transaction facade that invalidates every operation after settlement. */
export class TopologyTransaction implements ITopologyTransaction {
  /** Overlay index used by transaction reads and writes. */
  readonly #working: ITopologyIndex

  /** Parent-owned commit: applies the overlay and releases the parent's writer. */
  readonly #commit: () => void

  /** Parent-owned rollback: releases the parent's writer and drops the overlay. */
  readonly #rollback: () => void

  /** Parent-owned rejection for any use after settlement. */
  readonly #rejectClosed: () => never

  /** Whether commit or rollback has permanently settled this transaction. */
  #closed = false

  /**
   * Creates a transaction over one overlay view. The parent passes its authority as closures, so no
   * commit or rollback entry point exists on the index object itself.
   */
  constructor(
    working: ITopologyIndex,
    commit: () => void,
    rollback: () => void,
    rejectClosed: () => never
  ) {
    this.#working = working
    this.#commit = commit
    this.#rollback = rollback
    this.#rejectClosed = rejectClosed
  }

  /** Number of nodes in the transaction view. */
  get size(): number {
    this.#assertOpen()
    return this.#working.size
  }

  /** Delegates membership reads to the transaction view. */
  has(id: string): boolean {
    this.#assertOpen()
    return this.#working.has(id)
  }

  /** Reads the transaction's canonical ordinal while enforcing its existing closed guard. */
  registrationOrdinal(id: string): number {
    this.#assertOpen()
    return this.#working.registrationOrdinal(id)
  }

  /** Delegates dependency reads to the transaction view. */
  dependencies(id: string): readonly ITopologyDependency[] {
    this.#assertOpen()
    return this.#working.dependencies(id)
  }

  /** Delegates dependent reads to the transaction view. */
  dependents(id: string): IGraphDependents {
    this.#assertOpen()
    return this.#working.dependents(id)
  }

  /** Delegates dangling-edge reads to the transaction view. */
  missing(id: string): readonly ITopologyDependency[] {
    this.#assertOpen()
    return this.#working.missing(id)
  }

  /** Delegates closure reads to the transaction view. */
  closure(roots: readonly string[]): readonly string[] {
    this.#assertOpen()
    return this.#working.closure(roots)
  }

  /** Delegates ordering reads to the transaction view. */
  order(ids?: Iterable<string>): readonly string[] {
    this.#assertOpen()
    return this.#working.order(ids)
  }

  /** Delegates snapshot reads to the transaction view. */
  snapshot(): ICapabilityTopology {
    this.#assertOpen()
    return this.#working.snapshot()
  }

  /** Adds a node only to the transaction view. */
  add(node: ITopologyIndexNode): void {
    this.#assertOpen()
    this.#working.add(node)
  }

  /** Removes a node only from the transaction view. */
  remove(id: string): void {
    this.#assertOpen()
    this.#working.remove(id)
  }

  /** Replaces dependencies only in the transaction view. */
  setDependencies(id: string, dependencies: readonly ITopologyDependency[]): void {
    this.#assertOpen()
    this.#working.setDependencies(id, dependencies)
  }

  /** Publishes all isolated changes atomically and closes the transaction. */
  commit(): void {
    this.#assertOpen()
    this.#commit()
    this.#closed = true
  }

  /** Discards all isolated changes and closes the transaction. */
  rollback(): void {
    this.#assertOpen()
    this.#rollback()
    this.#closed = true
  }

  /** Rejects every operation after transaction settlement. */
  #assertOpen(): void {
    if (this.#closed) this.#rejectClosed()
  }
}
