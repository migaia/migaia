// In-memory backend plugin. Kept out of the root entry so a host without it bundles no memory code.
export { memoryBackendKind, memoryBackendPlugin } from '../backends/memory-plugin.ts'
export type { IMemoryOptions, IMemoryBackendStore } from '../backends/memory.ts'
