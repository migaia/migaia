import { defineFeaturePlugin } from '../plugin/define.js'
import type { IRpcFeaturePlugin } from '../plugin/types.js'
import { RpcFeatureName } from './text.js'

/** An inherited timeout budget yields to explicit host defaults and individual call options. */
export type ITimeoutFeatureOptions = Readonly<{ ms: number }>

/** Supply the host call default without installing a second canonical timeout middleware. */
export const timeoutFeature: (options: ITimeoutFeatureOptions) => IRpcFeaturePlugin =
  /* @__PURE__ */ defineFeaturePlugin((options: ITimeoutFeatureOptions) => ({
    name: RpcFeatureName.timeout,
    contribution: { defaultTimeoutMs: options.ms }
  }))

export default timeoutFeature
