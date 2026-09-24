import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as dependency from '../../src/graph/dependency.js'
import * as topology from '../../src/graph/topology.js'
import type { IGraphDependents as IDynamicGraphDependents } from '../../src/graph/dynamic.js'
import type { IGraphDependents as ITopologyGraphDependents } from '../../src/graph/topology.js'

describe('dependency planner public contract', () => {
  it('A13 exposes the dependency planner and incremental topology entry points', () => {
    /** Runtime dependency-planner surface promised by SDD section 4.3. */
    const dependencyExports = Object.keys(dependency).sort()
    expect(dependencyExports).toEqual([
      'DependencyAction',
      'DependencyEdgeStatus',
      'DependencyMutationKind',
      'DependencyNodeStatus',
      'DependencyPolicy',
      'collectPlanEdges',
      'planActivation',
      'planDependencyMutation',
      'planReplacement',
      'planRestart',
      'planResume',
      'planTeardown',
      'resolveInstallSet'
    ])
    expect(topology.createTopologyIndex).toBeTypeOf('function')
  })

  it('A13 declares the dependency planner package subpath', () => {
    /** Package manifest governing built consumer resolution. */
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
    ) as { exports?: Record<string, unknown> }
    expect(manifest.exports?.['./graph/dependency']).toEqual({
      types: './dist/graph/dependency.d.ts',
      default: './dist/graph/dependency.js'
    })
  })

  it('A13 keeps dynamic and topology dependent views mutually assignable', () => {
    /** Compile-time witness from the dynamic public entry point. */
    const dynamicView: IDynamicGraphDependents = { required: ['a'], optional: ['b'] }
    /** Topology view must accept the dynamic entry-point declaration. */
    const topologyView: ITopologyGraphDependents = dynamicView
    /** Reverse witness prevents either entry point from narrowing independently. */
    const roundTrip: IDynamicGraphDependents = topologyView
    expect(roundTrip).toEqual(dynamicView)
  })
})
