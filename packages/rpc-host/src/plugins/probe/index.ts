/**
 * Publishes probe definitions and installs an emitter against the native flow observation port.
 * Host identity and clock are borrowed from setup; genuine compiled handles retain their existing
 * stage subscriptions while the emitter owns cleanup and callback isolation.
 */
import { systemScheduler } from '@migaia/utils/scheduler'
import { defineFlowPlugin } from '../../sdk/define.ts'
import type { IRpcFlowPlugin, IRpcFlowSetupContext, IRpcFlowInstallation } from '../../sdk/types.ts'
import { defineProbe } from './define.ts'
import { createProbeEmitter } from './emitter.ts'
import { readProbeState } from './internal.ts'
import { RpcProbePluginName } from './text.ts'
import type { IRpcProbe, IRpcProbeDefinition } from './types.ts'

export * from './constants.ts'
export type * from './types.ts'
export { defineProbe } from './define.ts'
/** Collector plugins consume the same observer owner without copying dispatch or view projection. */
export { createProbeEmitter } from './emitter.ts'
export { rpcProbeSampleKey } from './sample.ts'
export { readProbeStages, subscribeProbeStages } from './internal.ts'

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
  return { observe: emitter.observe, dispose: () => emitter.dispose() }
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
