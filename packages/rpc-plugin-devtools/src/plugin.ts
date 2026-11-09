/** One genuine flow installation lends readonly probe events to the original caller-owned collector. */
import {
  defineFlowPlugin,
  type IRpcFlowPlugin,
  type IRpcFlowSetupContext,
  type IRpcFlowInstallation
} from '@migaia/rpc-host/sdk'
import { createProbeEmitter } from '@migaia/rpc-host/plugins/probe'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcDevtools } from './collector/devtools.ts'
import { CollectorText } from './collector/text.ts'
import type { IRpcDevtools, IRpcDevtoolsOptions } from './collector-types.ts'

/** Caller explicitly owns the collector; the thin native plugin carries only install identity. */
export type IDevtoolsBundle = Readonly<{ plugin: IRpcFlowPlugin; collector: IRpcDevtools }>

/** The actual receiving installation owns its emitter; the caller retains the collector lifetime. */
function setupDevtools(
  collector: IRpcDevtools,
  context: IRpcFlowSetupContext
): IRpcFlowInstallation {
  /** Reuse canonical sampling, capture, dynamic masks, reusable views and observer isolation. */
  const emitter = createProbeEmitter(
    [collector],
    systemScheduler.now,
    () => context.self!().instanceId,
    context.report
  )
  return { observe: emitter.observe, dispose: () => emitter.dispose() }
}

/** Construct separate explicit owners without attaching collector methods to a native definition. */
export function devtoolsPlugin(options?: IRpcDevtoolsOptions): IDevtoolsBundle {
  /** Collector can aggregate multiple hosts and retains its independent caller-owned lifetime. */
  const collector = createRpcDevtools(options)
  /** Each native installation creates its own actual observer/emitter state. */
  const plugin = defineFlowPlugin({
    name: CollectorText.pluginName,
    setup: (context) => setupDevtools(collector, context)
  })
  return Object.freeze({ plugin, collector })
}
