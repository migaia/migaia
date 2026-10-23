import type { IRpcAuthenticationConfig } from '../core/typing.js'
import { defineFeaturePlugin } from '../plugin/define.js'
import type { IRpcFeaturePlugin } from '../plugin/types.js'
import { RpcFeatureName } from './text.js'

/** Configure the existing authentication middleware, which retains transform validation and errors. */
export const authFeature: (config: IRpcAuthenticationConfig) => IRpcFeaturePlugin =
  /* @__PURE__ */ defineFeaturePlugin((config: IRpcAuthenticationConfig) => ({
    name: RpcFeatureName.auth,
    contribution: { authentication: config }
  }))

export default authFeature
