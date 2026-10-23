import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'
import type { IIpcSendQueueOptions, IRpcFeaturePlugin } from '@migaia/rpc-host/plugin'
import { registerProcessFeatureConfiguration } from './metadata.js'
import { ProcessFeatureName } from './text.js'

/** Only capacities are configurable; connection and session identity remain native-owner facts. */
export type ISendQueueFeatureOptions = Pick<
  IIpcSendQueueOptions,
  'maxPendingData' | 'maxPendingControl'
>

/** All configured instances share the SDK's one module-level feature definition identity. */
const defineSendQueue = /* @__PURE__ */ defineFeaturePlugin(
  (_options: ISendQueueFeatureOptions) => ({ name: ProcessFeatureName.sendQueue })
)

/** Supply cold capacity options to process normalization without installing another gate. */
export function sendQueueFeature(options: ISendQueueFeatureOptions = {}): IRpcFeaturePlugin {
  /** Snapshot each explicit field once so later caller mutation cannot reconfigure a connection. */
  const maxPendingData = options.maxPendingData
  /** Omitting one lane must preserve the source's original capacity for that lane. */
  const maxPendingControl = options.maxPendingControl
  /** Only actual configured fields override the native source's ordinary IPC options. */
  const captured = Object.freeze({
    ...(maxPendingData === undefined ? {} : { maxPendingData }),
    ...(maxPendingControl === undefined ? {} : { maxPendingControl })
  })
  /** This final native object is the same identity the Host passes to deployment preparation. */
  const feature = defineSendQueue(captured)
  registerProcessFeatureConfiguration(feature, Object.freeze({ sendQueue: captured }))
  return feature
}

export default sendQueueFeature
