import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCapabilityTopology, type ITopologyNode } from '../../src/graph/topology.js'

type ITopologyGoldenExpected = Readonly<{
  readonly ordered: readonly string[]
  readonly level: Readonly<Record<string, number>>
  readonly indegree: Readonly<Record<string, number>>
  readonly providers: readonly string[]
}>

type ITopologyGoldenFixture = Readonly<{
  readonly name: string
  readonly nodes: readonly ITopologyNode[]
  readonly expected: ITopologyGoldenExpected
}>

type ITopologyGoldenDocument = Readonly<{
  readonly baseCommit: string
  readonly fixtures: readonly ITopologyGoldenFixture[]
}>

/** Immutable behavior snapshot generated from the pre-implementation topology owner. */
const golden = JSON.parse(
  readFileSync(new URL('./fixtures/topology-golden.json', import.meta.url), 'utf8')
) as ITopologyGoldenDocument

/** Fails when a supposedly valid golden fixture reaches an error callback. */
function unexpectedTopologyFailure(message: string): never {
  throw new Error(message)
}

describe('topology golden compatibility', () => {
  for (const fixture of golden.fixtures) {
    it(`A6 preserves ${fixture.name} topology facts from ${golden.baseCommit}`, () => {
      /** Topology projection produced by the implementation under test. */
      const topology = buildCapabilityTopology(
        fixture.nodes,
        (nodeId, provider) =>
          unexpectedTopologyFailure(`unknown provider ${provider} for ${nodeId}`),
        (path) => unexpectedTopologyFailure(`cycle ${path.join(' -> ')}`),
        (reason, nodeId) =>
          unexpectedTopologyFailure(`invalid ${reason}${nodeId ? ` for ${nodeId}` : ''}`)
      )

      expect(topology.ordered.map((node) => node.id)).toEqual(fixture.expected.ordered)
      expect(Object.fromEntries(topology.level)).toEqual(fixture.expected.level)
      expect(Object.fromEntries(topology.indegree)).toEqual(fixture.expected.indegree)
      expect([...topology.providers.keys()]).toEqual(fixture.expected.providers)
    })
  }
})
