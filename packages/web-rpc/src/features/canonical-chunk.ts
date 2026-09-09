import { defineEndpointModule, EndpointModuleKey } from '../internal/endpoint-modules.js'
import { WebRpcCanonicalChunkAttachment } from '../internal/canonical-chunk-attachment.js'
import type { IWebRpcCoreConfig, IWebRpcKernelSurface } from '../core.js'

/** Chunk contributes canonical framing behavior without adding a public method. */
export type ICanonicalChunkSurface = IWebRpcKernelSurface

/** Canonical chunk feature token used by migrated WebRPC readers. */
const canonicalChunkModule = defineEndpointModule<IWebRpcCoreConfig, ICanonicalChunkSurface>(
  EndpointModuleKey.chunk,
  async ({ kernel, prepared }) => {
    const attachment = new WebRpcCanonicalChunkAttachment(
      kernel,
      prepared.options.components?.framer
    )
    return Object.freeze({ dispose: () => attachment.dispose() }) as ICanonicalChunkSurface
  },
  [],
  [],
  {
    provides: ['selected-framer-bridge']
  }
)

/** Returns the migrated chunk feature module. */
export function canonicalChunk() {
  return canonicalChunkModule
}
