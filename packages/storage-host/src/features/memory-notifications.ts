import { defineMemoryFeature } from '../backends/memory-plugin.ts'
import { registerMemoryAssembly } from '../backends/memory-assembly.ts'
import { createBackendChangeController } from '../core/change-controller.ts'

/** Explicitly select memory's controller owner before native backend construction. */
export function memoryNotificationsFeature() {
  return registerMemoryAssembly(
    defineMemoryFeature(() => ({
      capabilities: [] as const,
      chain: {},
      api: { store: {}, transaction: {} }
    })),
    { controller: createBackendChangeController }
  )
}
