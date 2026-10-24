import { defineFeature } from '../contracts.js'
import { memoryBackendKind } from '../backends/memory-plugin.js'
import { registerMemoryAssembly } from '../backends/memory-assembly.js'
import { createBackendChangeIterator } from '../core/change-iterator.js'

/** Explicitly select memory's iterator owner before native backend construction. */
export function memoryChangeFeedFeature() {
  return registerMemoryAssembly(
    defineFeature(memoryBackendKind, () => ({
      capabilities: [] as const,
      chain: {},
      api: { store: {}, transaction: {} }
    })),
    { iterator: createBackendChangeIterator }
  )
}
