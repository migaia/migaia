/** Public topology fixtures own rejection policy, hostile getter counts and cycle observations. */
import { expect } from 'vitest'
import {
  buildCapabilityTopology,
  TopologyInvalidReason,
  type ITopologyDependency,
  type ITopologyNode
} from '../../src/graph/topology.ts'

/** Missing required providers retain the original fixture diagnostic. */
export function throwUnknownTopologyProvider(): never {
  throw new Error('unknown provider')
}
/** Unexpected cycles retain the original fixture diagnostic. */
export function throwTopologyCycle(): never {
  throw new Error('cycle')
}
/** Invalid topology fixtures preserve their original stable diagnostic. */
export function throwInvalidTopology(): never {
  throw new Error('invalid topology')
}
/** Cycle-path assertions retain their original joined path diagnostic. */
export function throwTopologyPath(path: readonly string[]): never {
  throw new Error(path.join('>'))
}
/** Structural-reason assertions preserve the exact reason text. */
export function throwTopologyReason(reason: string): never {
  throw new Error(reason)
}
/** Hostile-input assertions retain both structural reason and optional node identity. */
function throwDetailedTopologyReason(reason: string, nodeId?: string): never {
  throw new Error(`${reason}:${nodeId ?? ''}`)
}
/** Run the original hostile-input assertion only when its named test owner requests it. */
export function expectInvalidTopology(input: unknown): void {
  expect(() =>
    buildCapabilityTopology(
      input as readonly ITopologyNode[],
      throwUnknownTopologyProvider,
      throwTopologyCycle,
      throwDetailedTopologyReason
    )
  ).toThrow(TopologyInvalidReason.invalidNode)
}

/** Counter state shared by one generated node array and its unchanged expected-count assertion. */
export type ITopologyReadCounts = {
  id: number
  ordinal: number
  dependencies: number
  provider: number
  required: number
}

/** One input node owns the same three hostile getters without nesting them inside Array.from. */
export class CountedTopologyNode implements ITopologyNode {
  /** Test-owned counters observe the topology owner's public getter reads. */
  readonly #counts: ITopologyReadCounts
  /** Stable registration position determines this node's identity and provider. */
  readonly #index: number
  /** Edge membership is captured once before the node object is returned to the case. */
  readonly #dependencies: readonly ITopologyDependency[]
  /** Build exactly the original dependency membership before public getter admission begins. */
  constructor(counts: ITopologyReadCounts, index: number) {
    this.#counts = counts
    this.#index = index
    this.#dependencies = index === 0 ? [] : [new CountedTopologyDependency(counts, index)]
  }
  /** Observe the original ID getter invocation. */
  get id(): string {
    this.#counts.id++
    return `node-${this.#index}`
  }
  /** Observe the original ordinal getter invocation. */
  get ordinal(): number {
    this.#counts.ordinal++
    return this.#index
  }
  /** Observe the original edge-list getter invocation. */
  get dependencies(): readonly ITopologyDependency[] {
    this.#counts.dependencies++
    return this.#dependencies
  }
}

/** One provider edge owns the two original counted property reads. */
class CountedTopologyDependency implements ITopologyDependency {
  /** Shared test-owned counters distinguish node and edge admission reads. */
  readonly #counts: ITopologyReadCounts
  /** Consumer position determines the immediately preceding provider. */
  readonly #index: number
  /** Retain scalar fixture state without executing public getters during setup. */
  constructor(counts: ITopologyReadCounts, index: number) {
    this.#counts = counts
    this.#index = index
  }
  /** Count one provider read and return its original stable identity. */
  get provider(): string {
    this.#counts.provider++
    return `node-${this.#index - 1}`
  }
  /** Count one requiredness read and preserve the literal true contract. */
  get required(): true {
    this.#counts.required++
    return true
  }
}

/** Cycle failure fixture retains the exact native error while recording its path at callback time. */
export class TopologyCycleFailure {
  /** Native caller-selected shell remains the thrown error instance. */
  readonly #failure: Error & { path: readonly string[] }
  /** Capture the error without publishing a cycle before the tested build call. */
  constructor(failure: Error & { path: readonly string[] }) {
    this.#failure = failure
  }
  /** Record the supplied path and throw the exact original adapter error. */
  readonly onCycle = (path: readonly string[]): never => {
    this.#failure.path = path
    throw this.#failure
  }
}
