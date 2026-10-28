import { defineFeature } from '../contracts.ts'
import { memoryBackendKind } from '../backends/memory-plugin.ts'
import { registerMemoryAssembly } from '../backends/memory-assembly.ts'
import { createBackendChangeIterator } from '../core/change-iterator.ts'

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
