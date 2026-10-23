import { defineFeaturePlugin } from '../plugin/define.js'
import type { IRpcFeaturePlugin } from '../plugin/types.js'
import { RpcFeatureName } from './text.js'

/** Select the canonical request retry policy using the host's actual generation and deadline owner. */
export const retryFeature: () => IRpcFeaturePlugin = /* @__PURE__ */ defineFeaturePlugin(
  (_options: void) => ({
    name: RpcFeatureName.retry,
    contribution: { retry: true as const }
  })
)

export default retryFeature
