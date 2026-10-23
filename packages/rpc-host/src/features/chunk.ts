import { createCanonicalChunkFeature } from '../core/features/canonical-chunk.js'
import { defineFeaturePlugin } from '../plugin/define.js'
import type { IRpcFeaturePlugin } from '../plugin/types.js'
import { RpcFeatureName } from './text.js'

/** Select the canonical framing root as the host's single outbound/reassembly owner. */
export const chunkFeature: () => IRpcFeaturePlugin = /* @__PURE__ */ defineFeaturePlugin(
  (_options: void) => ({
    name: RpcFeatureName.chunk,
    contribution: { chunk: createCanonicalChunkFeature() }
  })
)

export default chunkFeature
