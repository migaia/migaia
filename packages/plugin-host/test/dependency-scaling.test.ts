import { describe, expect, it, vi } from 'vitest'
import type { ITopologyIndex, ITopologyIndexMetrics } from '@migaia/capability/graph/topology'

/** A11 captures each host-owned index to compare work across graph sizes and failed batches. */
const captured = vi.hoisted(() => [] as ITopologyIndex[])

vi.mock('@migaia/capability/graph/topology', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@migaia/capability/graph/topology')>()
  return {
    ...actual,
    createTopologyIndex: (...args: Parameters<typeof actual.createTopologyIndex>) => {
      const index = actual.createTopologyIndex(...args)
      captured.push(index)
      return index
    }
  }
})

import { defineFeature, definePlugin, PluginHost } from '../src/index.js'

/** Returns the index work performed between two cumulative metric snapshots. */
const delta = (before: ITopologyIndexMetrics, after: ITopologyIndexMetrics) => ({
  visitedNodes: after.visitedNodes - before.visitedNodes,
  visitedEdges: after.visitedEdges - before.visitedEdges
})

/** Builds a host with a long required chain and measures one leaf-only mutation sequence. */
const measure = async (size: number) => {
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const plugins: any[] = []
  let previous: any
  for (let position = 0; position < size; position += 1) {
    const feature = previous
      ? defineFeature((_core, dependencies: any) => ({ value: dependencies.previous.value + 1 }), {
          previous: previous.getFeature('value')
        })
      : defineFeature(() => ({ value: 0 }))
    previous = definePlugin({
      name: `node-${position}`,
      features: { value: feature },
      install: () => ({})
    })
    plugins.push(previous)
  }
  await host.use(...(plugins as never))
  const index = captured.at(-1)!
  const leaf = definePlugin({
    name: `leaf-${size}`,
    features: {
      value: defineFeature((_core, dependencies: any) => ({ value: dependencies.previous.value }), {
        previous: previous.getFeature('value')
      })
    },
    install: () => ({})
  })
  const beforeUse = index.metrics()
  await host.use(leaf)
  const afterUse = index.metrics()
  await host.unUse(leaf.name, { policy: 'cascade', dryRun: true })
  const afterDryRun = index.metrics()
  await host.unUse(leaf.name)
  const afterRemoval = index.metrics()
  return {
    host,
    index,
    deltas: [
      delta(beforeUse, afterUse),
      delta(afterUse, afterDryRun),
      delta(afterDryRun, afterRemoval)
    ]
  }
}

describe('dependency index scaling', () => {
  it('keeps leaf work independent of unrelated host size and rolls back failed batches', async () => {
    captured.length = 0
    const small = await measure(100)
    const smallBeforeLarge = small.index.metrics()
    const large = await measure(2000)
    expect(large.deltas).toEqual(small.deltas)
    expect(small.index.metrics()).toEqual(smallBeforeLarge)

    const sizeBeforeFailure = large.index.size
    const failed = definePlugin({
      name: 'failed-leaf',
      install: () => {
        throw new Error('install failed')
      }
    })
    await expect(large.host.use(failed)).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(large.index.size).toBe(sizeBeforeFailure)
    await small.host.dispose()
    await large.host.dispose()
  })
})
