import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCapabilityTopology as graphBuildCapabilityTopology } from '../src/graph/index.js'
import {
  buildCapabilityTopology,
  TopologyInvalidReason,
  type ITopologyNode
} from '../src/graph/topology.js'

const id = (value: string): string => value

describe('public capability topology primitive', () => {
  it('WRC-C-T69 exposes the same pure builder used by CapabilityGraph', () => {
    const nodes: ITopologyNode[] = [
      {
        id: id('consumer'),
        dependencies: [{ provider: id('provider'), required: true }],
        ordinal: 0
      },
      { id: id('provider'), dependencies: [], ordinal: 1 }
    ]
    const unknown = (): never => {
      throw new Error('unknown provider')
    }
    const cycle = (path: readonly string[]): never => {
      throw new Error(path.join('>'))
    }

    expect(graphBuildCapabilityTopology).toBe(buildCapabilityTopology)
    const topology = buildCapabilityTopology(nodes, unknown, cycle, () => {
      throw new Error('invalid topology')
    })
    expect(topology.ordered.map((node) => node.id)).toEqual(['provider', 'consumer'])
    expect(topology.providers.get('provider')?.map((node) => node.id)).toEqual(['consumer'])
    expect(topology.consumers.get('consumer')).toEqual(nodes[0]?.dependencies)
    expect(topology.level.get('consumer')).toBe(1)
    expect(topology.ordinal.get('consumer')).toBe(0)
  })

  it('WRC-C-T70 rejects missing providers and cycles without lifecycle side effects', () => {
    let started = 0
    const nodes: ITopologyNode[] = [
      { id: id('a'), dependencies: [{ provider: id('b'), required: true }], ordinal: 0 },
      { id: id('b'), dependencies: [{ provider: id('a'), required: true }], ordinal: 1 }
    ]
    expect(() =>
      buildCapabilityTopology(
        [
          {
            id: id('missing'),
            dependencies: [{ provider: id('absent'), required: true }],
            ordinal: 0
          }
        ],
        () => {
          throw new Error('unknown provider')
        },
        () => {
          throw new Error('cycle')
        },
        () => {
          throw new Error('invalid topology')
        }
      )
    ).toThrow('unknown provider')
    expect(() =>
      buildCapabilityTopology(
        nodes,
        () => {
          throw new Error('unknown provider')
        },
        (path) => {
          throw new Error(path.join('>'))
        },
        () => {
          throw new Error('invalid topology')
        }
      )
    ).toThrow('a>b>a')
    expect(started).toBe(0)
  })

  it('WRC-C-T69 snapshots inputs, uses ordinal order, and rejects duplicate facts', () => {
    const dependencies: ITopologyNode['dependencies'] = [{ provider: 'provider', required: true }]
    const consumer: ITopologyNode = { id: 'consumer', dependencies, ordinal: 3 }
    const provider: ITopologyNode = { id: 'provider', dependencies: [], ordinal: 2 }
    const late: ITopologyNode = { id: 'late', dependencies: [], ordinal: 1 }
    const early: ITopologyNode = { id: 'early', dependencies: [], ordinal: 0 }
    const invalid = (reason: string): never => {
      throw new Error(reason)
    }
    const topology = buildCapabilityTopology(
      [consumer, early, provider, late],
      () => {
        throw new Error('unknown provider')
      },
      () => {
        throw new Error('cycle')
      },
      invalid
    )

    expect(topology.ordered.map((node) => node.id)).toEqual([
      'early',
      'late',
      'provider',
      'consumer'
    ])
    expect(Object.isFrozen(topology.ordered)).toBe(true)
    expect(Object.isFrozen(topology.ordered[0])).toBe(true)
    expect(Object.isFrozen(topology.ordered[1]?.dependencies)).toBe(true)
    expect(Object.isFrozen(topology.providers)).toBe(true)
    expect(Object.isFrozen(topology.consumers)).toBe(true)
    expect(() =>
      (topology.providers as Map<string, readonly ITopologyNode[]>).set('forged', [])
    ).toThrow()

    ;(dependencies as Array<{ provider: string; required: true }>)[0]!.provider = 'forged'
    expect(topology.consumers.get('consumer')).toEqual([{ provider: 'provider', required: true }])

    expect(() =>
      buildCapabilityTopology(
        [
          { id: 'duplicate', dependencies: [], ordinal: 0 },
          { id: 'duplicate', dependencies: [], ordinal: 1 }
        ],
        () => {
          throw new Error('unknown provider')
        },
        () => {
          throw new Error('cycle')
        },
        invalid
      )
    ).toThrow(TopologyInvalidReason.duplicateNode)
    expect(() =>
      buildCapabilityTopology(
        [
          { id: 'first', dependencies: [], ordinal: 0 },
          { id: 'second', dependencies: [], ordinal: 0 }
        ],
        () => {
          throw new Error('unknown provider')
        },
        () => {
          throw new Error('cycle')
        },
        invalid
      )
    ).toThrow(TopologyInvalidReason.duplicateOrdinal)
  })

  it('WRC-C-T69 routes hostile runtime facts through one invalid adapter read', () => {
    const invalid = (reason: string, nodeId?: string): never => {
      throw new Error(`${reason}:${nodeId ?? ''}`)
    }
    const unknown = (): never => {
      throw new Error('unknown provider')
    }
    const cycle = (): never => {
      throw new Error('cycle')
    }
    const expectInvalid = (input: unknown): void => {
      expect(() =>
        buildCapabilityTopology(input as readonly ITopologyNode[], unknown, cycle, invalid)
      ).toThrow(TopologyInvalidReason.invalidNode)
    }

    expectInvalid([null])
    expectInvalid([42])
    expectInvalid([{ id: 'edge', ordinal: 0, dependencies: [null] }])
    const sparse: unknown[] = []
    sparse.length = 1
    expectInvalid(sparse)

    let getterReads = 0
    const getterNode = {
      get id(): string {
        getterReads += 1
        return 'getter'
      },
      get ordinal(): number {
        getterReads += 1
        return 0
      },
      get dependencies(): readonly ITopologyNode['dependencies'][number][] {
        getterReads += 1
        return []
      }
    }
    buildCapabilityTopology([getterNode], unknown, cycle, invalid)
    expect(getterReads).toBe(3)

    const throwingIterable = {
      [Symbol.iterator](): Iterator<unknown> {
        throw new Error('iterator failure')
      }
    }
    expectInvalid([{ id: 'iterator', ordinal: 0, dependencies: throwingIterable }])

    let proxyReads = 0
    const proxiedNode = new Proxy(
      { id: 'proxy', ordinal: 0, dependencies: [] },
      {
        get(target, property, receiver) {
          proxyReads += 1
          return Reflect.get(target, property, receiver)
        }
      }
    )
    buildCapabilityTopology([proxiedNode], unknown, cycle, invalid)
    expect(proxyReads).toBe(3)
  })

  it('WRC-C-T69 uses linear ordinal placement with one read per node and edge', () => {
    const counts = { id: 0, ordinal: 0, dependencies: 0, provider: 0, required: 0 }
    const nodeCount = 64
    const nodes = Array.from({ length: nodeCount }, (_, index) => {
      const dependency =
        index === 0
          ? []
          : [
              {
                get provider(): string {
                  counts.provider += 1
                  return `node-${index - 1}`
                },
                get required(): true {
                  counts.required += 1
                  return true
                }
              }
            ]
      return {
        get id(): string {
          counts.id += 1
          return `node-${index}`
        },
        get ordinal(): number {
          counts.ordinal += 1
          return index
        },
        get dependencies() {
          counts.dependencies += 1
          return dependency
        }
      }
    })
    const topology = buildCapabilityTopology(
      nodes,
      () => {
        throw new Error('unknown provider')
      },
      () => {
        throw new Error('cycle')
      },
      () => {
        throw new Error('invalid topology')
      }
    )
    expect(topology.ordered).toHaveLength(nodeCount)
    expect(counts).toEqual({
      id: nodeCount,
      ordinal: nodeCount,
      dependencies: nodeCount,
      provider: nodeCount - 1,
      required: nodeCount - 1
    })
  })

  it('WRC-C-T69 declares the exact public topology export', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
    ) as { exports?: Record<string, unknown> }
    expect(manifest.exports?.['./graph/topology']).toEqual({
      types: './dist/graph/topology.d.ts',
      default: './dist/graph/topology.js'
    })
  })
})
