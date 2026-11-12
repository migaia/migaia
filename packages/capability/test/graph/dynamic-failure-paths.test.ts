import { describe, expect, it } from 'vitest'
import {
  createDynamicCapabilityGraph,
  type IDynamicCapabilityGraphOptions,
  type IGraphReleaseEntry,
  type IGraphStartEntry
} from '../../src/graph/dynamic.ts'
import {
  CapabilityGraphErrorCode,
  type IGraphNodeDefinition,
  type IGraphNodeId,
  type IGraphNodeInstance
} from '../../src/graph/index.ts'
import { createTopologyIndex } from '../../src/graph/topology.ts'
import { releaseNothingAsync } from './nonstatic-fixtures.ts'

/** A node whose start is never called directly: the batch owner below supplies instances. */
function node(id: string, dependencies: readonly string[] = []): IGraphNodeDefinition<string> {
  return {
    id: id as IGraphNodeId,
    kind: 'test',
    dependencies: dependencies.map((provider) => ({
      provider: provider as IGraphNodeId,
      required: true as const
    })),
    start: async () => ({ value: id, release: releaseNothingAsync })
  }
}

/**
 * Batch owner whose next start can return a malformed instance at one position, and whose release
 * can fail. It records released ids and reported errors.
 */
class FaultyBatchOwner implements IDynamicCapabilityGraphOptions<undefined> {
  /** Position in the next batch to replace with a malformed instance; -1 for none. */
  malformedAt = -1
  /** Error the release right after a malformed batch rejects with; earlier releases succeed. */
  releaseFailure: Error | undefined
  /** Set by a malformed batch, so only the release of its unpublished instances fails. */
  #failNextRelease = false
  /** Ids handed to `releaseBatch`, in call order. */
  readonly released: string[] = []
  /** Errors passed to the graph's report option. */
  readonly reported: unknown[] = []

  /** Starts every entry, then swaps in a malformed instance where configured. */
  readonly startBatch = async (
    entries: readonly IGraphStartEntry<undefined>[]
  ): Promise<readonly IGraphNodeInstance<unknown>[]> => {
    const instances: IGraphNodeInstance<unknown>[] = entries.map((entry) => ({
      value: entry.id,
      release: releaseNothingAsync
    }))
    if (this.malformedAt >= 0) {
      instances[this.malformedAt] = null as never
      this.#failNextRelease = true
    }
    this.malformedAt = -1
    return instances
  }

  /** Records released ids and optionally fails. */
  readonly releaseBatch = async (
    entries: readonly IGraphReleaseEntry<undefined>[],
    fence: Promise<void>
  ): Promise<void> => {
    await fence
    for (const entry of entries) this.released.push(entry.id)
    if (!this.#failNextRelease || !this.releaseFailure) return
    this.#failNextRelease = false
    throw this.releaseFailure
  }

  /** Records reported errors. */
  readonly report = (error: unknown): void => {
    this.reported.push(error)
  }
}

describe('dynamic graph failure paths', () => {
  it('rejects a non-object options value and codes a throwing option getter', () => {
    expect(() => createDynamicCapabilityGraph(null as never)).toThrowError(
      expect.objectContaining({ code: CapabilityGraphErrorCode.invalidOption })
    )
    /** The getter failure stays reachable on the coded error. */
    const getterFailure = new Error('startBatch getter failed')
    const options = {
      get startBatch(): never {
        throw getterFailure
      }
    }
    /** The coded failure is the getter error itself or keeps it on `cause`. */
    let thrown: unknown
    try {
      createDynamicCapabilityGraph(options as never)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: CapabilityGraphErrorCode.invalidOption })
    expect([thrown, (thrown as Error).cause]).toContain(getterFailure)
  })

  it('fails a node whose started instance is malformed with GRAPH_INVALID_NODE', async () => {
    const owner = new FaultyBatchOwner()
    const graph = createDynamicCapabilityGraph(owner)
    owner.malformedAt = 0
    await expect(graph.register(node('broken'))).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.invalidNode
    })
    expect(graph.nodeState('broken' as IGraphNodeId).state).toBe('failed')
    await graph.dispose()
  })

  it('releases the valid instances of a batch with a malformed one and reports release failure', async () => {
    const owner = new FaultyBatchOwner()
    const graph = createDynamicCapabilityGraph(owner)
    await graph.register(node('provider'))
    await graph.register(node('consumer', ['provider']))
    // Replacing the provider restarts provider and consumer as one batch.
    owner.malformedAt = 1
    owner.releaseFailure = new Error('release failed')
    await expect(graph.replace(node('provider'))).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.invalidNode
    })
    expect(owner.reported).toContain(owner.releaseFailure)
    await graph.dispose()
  })

  it('republishes topology when a replacement changes its edges', async () => {
    const owner = new FaultyBatchOwner()
    const graph = createDynamicCapabilityGraph(owner)
    await graph.register(node('p'))
    await graph.register(node('q'))
    await graph.register(node('c', ['p']))
    const result = await graph.replace(node('c', ['q']))
    expect(result.topologyChanged).toBe(true)
    expect(result.affected).toContain('c')
    expect(graph.dependentsOf('q' as IGraphNodeId).required).toEqual(['c'])
    expect(graph.dependentsOf('p' as IGraphNodeId).required).toEqual([])
    await graph.dispose()
  })
})

describe('topology transaction dependency check', () => {
  it('validates edges against the working view without writing them', () => {
    const index = createTopologyIndex({
      onCycle: () => {
        throw new Error('cycle')
      },
      onInvalid: (reason) => {
        throw new Error(reason)
      }
    })
    index.add({ id: 'a', dependencies: [] })
    index.add({ id: 'b', dependencies: [{ provider: 'a', required: true }] })
    const transaction = index.begin()
    transaction.checkDependencies('a', [])
    expect(() => transaction.checkDependencies('a', [{ provider: 'b', required: true }])).toThrow(
      'cycle'
    )
    expect(transaction.dependents('a')).toEqual({ required: ['b'], optional: [] })
    transaction.rollback()
  })
})
