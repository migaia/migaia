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

/** Native metadata retains the caller's collector; each installed emitter has its own lifetime. */
export type IDevtoolsPlugin = IRpcFlowPlugin &
  Readonly<{ collector: IRpcDevtools }> &
  Pick<IRpcDevtools, 'query' | 'watch' | 'stats' | 'describe' | 'close'>

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

/** Construct one original collector and publish its methods on the actual frozen native definition. */
export function devtoolsPlugin(options?: IRpcDevtoolsOptions): IDevtoolsPlugin {
  /** This caller-owned collector can aggregate several hosts without borrowing their lifetimes. */
  const collector = createRpcDevtools(options)
  return defineFlowPlugin(
    {
      name: CollectorText.pluginName,
      setup: (context) => setupDevtools(collector, context)
    },
    {
      collector,
      query: collector.query,
      watch: collector.watch,
      stats: collector.stats,
      describe: collector.describe,
      close: collector.close
    }
  )
}
