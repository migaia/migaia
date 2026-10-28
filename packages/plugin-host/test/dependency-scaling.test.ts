import { describe, expect, it, vi } from 'vitest'
import type { ITopologyIndex } from '@migaia/capability/graph/topology'

/** Captures each host-owned index to verify isolated facts across graph sizes and failed batches. */
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

import { defineFeature, definePlugin, PluginHost } from '../src/index.ts'

/** Builds a host with a long required chain and exercises one leaf-only mutation sequence. */
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
  const index = captured.at(-1)!
  await host.use(...(plugins as never))
  const leaf = definePlugin({
    name: `leaf-${size}`,
    features: {
      value: defineFeature((_core, dependencies: any) => ({ value: dependencies.previous.value }), {
        previous: previous.getFeature('value')
      })
    },
    install: () => ({})
  })
  await host.use(leaf)
  expect(index.has(leaf.name)).toBe(true)
  await host.unUse(leaf.name, { policy: 'cascade', dryRun: true })
  expect(index.has(leaf.name)).toBe(true)
  await host.unUse(leaf.name)
  expect(index.has(leaf.name)).toBe(false)
  expect(index.size).toBe(size)
  return { host, index }
}

describe('dependency index scaling', () => {
  it('keeps leaf facts isolated across host sizes and rolls back failed batches', async () => {
    captured.length = 0
    const small = await measure(100)
    const smallBeforeLarge = small.index.order()
    const large = await measure(2000)
    expect(small.index.order()).toEqual(smallBeforeLarge)

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
