/**
 * Publishes the batch flow factory and creates its complete per-installation RpcBatchFlow. Native
 * setup provides the cancellation lifetime and negotiated extension declarations; the entry does
 * not allocate semantic task identities or provider groups.
 */
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.ts'
import type { IRpcFlowFeature } from '../../sdk/types.ts'
import { RpcBatchFlow } from './flow.ts'
import { RpcBatchPluginName } from './constants.ts'
import type { IRpcBatchOptions } from './types.ts'

export type { IRpcBatchOptions } from './types.ts'

/** Install the actual optional physical queue; absent installation allocates no batching state. */
export function batchFeature(options: IRpcBatchOptions = {}): IRpcFlowFeature {
  /** Only existing native scope declarations are captured; no host configuration switch is added. */
  const captured = { ...options }
  return defineBuiltinFlowFeature('batch', {
    name: RpcBatchPluginName,
    setup: (context) => new RpcBatchFlow(context.signal, captured.required ?? false).value
  })
}

export default batchFeature
