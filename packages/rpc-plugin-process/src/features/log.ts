import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'
import type { IIpcLogRecord, IRpcFeaturePlugin } from '@migaia/rpc-host/plugin'
import { registerProcessFeatureConfiguration } from './metadata.js'
import { ProcessFeatureName } from './text.js'

/** The original IPC log owner handles synchronous throws and asynchronous sink rejections. */
export type IIpcLogFeatureOptions = Readonly<{
  report(record: IIpcLogRecord): void | Promise<void>
}>

/** The shared definition token rejects repeated configured instances on one Host before I/O. */
const defineIpcLog = /* @__PURE__ */ defineFeaturePlugin((_options: IIpcLogFeatureOptions) => ({
  name: ProcessFeatureName.log
}))

/** Route diagnostics to the existing connection log instead of adding a feature subscription. */
export function ipcLogFeature(options: IIpcLogFeatureOptions): IRpcFeaturePlugin {
  /** Capture the exact sink once while retaining its original native error behavior. */
  const captured = Object.freeze({ report: options.report })
  /** Private options follow this exact registered object through ordinary and RPC Hosts. */
  const feature = defineIpcLog(captured)
  registerProcessFeatureConfiguration(feature, Object.freeze({ log: captured }))
  return feature
}

export default ipcLogFeature
