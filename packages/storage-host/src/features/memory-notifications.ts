import { defineFeature } from '../contracts.js'
import { memoryBackendKind } from '../backends/memory-plugin.js'
import { registerMemoryAssembly } from '../backends/memory-assembly.js'
import { createBackendChangeController } from '../core/change-controller.js'

/** Explicitly select memory's controller owner before native backend construction. */
export function memoryNotificationsFeature() {
  return registerMemoryAssembly(
    defineFeature(memoryBackendKind, () => ({
      capabilities: [] as const,
      chain: {},
      api: { store: {}, transaction: {} }
    })),
    { controller: createBackendChangeController }
  )
}
