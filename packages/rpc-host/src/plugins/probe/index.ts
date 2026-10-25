/**
 * Publishes probe definitions and installs an emitter against the native flow observation port.
 * Host identity and clock are borrowed from setup; genuine compiled handles retain their existing
 * stage subscriptions while the emitter owns cleanup and callback isolation.
 */
import { systemScheduler } from '@migaia/utils/scheduler'
import { defineFlowPlugin } from '../../sdk/define.js'
import type { IRpcFlowPlugin, IRpcFlowSetupContext, IRpcFlowInstallation } from '../../sdk/types.js'
import { defineProbe } from './define.js'
import { createProbeEmitter } from './emitter.js'
import { readProbeState } from './internal.js'
import { RpcProbePluginName } from './text.js'
import type { IRpcProbe, IRpcProbeDefinition } from './types.js'

export * from './constants.js'
export type * from './types.js'
export { defineProbe } from './define.js'
/** Collector plugins consume the same observer owner without copying dispatch or view projection. */
export { createProbeEmitter } from './emitter.js'
export { rpcProbeSampleKey } from './sample.js'
export { readProbeStages, subscribeProbeStages } from './internal.js'

/** Each native installation constructs its emitter without capturing a mutable host facade. */
function setupProbe(
  handles: readonly IRpcProbe[],
  context: IRpcFlowSetupContext
): IRpcFlowInstallation {
  /** The real receiving host supplies this readonly dynamic native identity port. */
  const self = context.self!
  /** One actual emitter owns callback isolation and the native cleanup receipt. */
  const emitter = createProbeEmitter(
    handles,
    () => systemScheduler.now(),
    () => self().instanceId,
    context.report
  )
  return { hooks: { observe: emitter.observe }, dispose: () => emitter.dispose() }
}

/** Install real readonly observation; each receiving host owns an independent emitter. */
export function probe(...inputs: readonly (IRpcProbeDefinition | IRpcProbe)[]): IRpcFlowPlugin {
  /** Existing genuine handles keep setStages identity; definitions use the same actual compiler. */
  const handles = inputs.map((input) =>
    readProbeState(input as IRpcProbe)
      ? (input as IRpcProbe)
      : defineProbe(input as IRpcProbeDefinition)
  )
  return defineFlowPlugin({
    name: RpcProbePluginName,
    setup: (context) => setupProbe(handles, context)
  })
}

export default probe
