/**
 * Publishes the batch flow factory and creates its complete per-installation RpcBatchFlow. Native
 * setup provides the cancellation lifetime and negotiated extension declarations; the entry does
 * not allocate semantic task identities or provider groups.
 */
import { defineFlowPlugin } from '../../sdk/define.js'
import type { IRpcFlowPlugin } from '../../sdk/types.js'
import { RpcBatchFlow } from './flow.js'
import { RpcBatchPluginName } from './constants.js'
import type { IRpcBatchOptions } from './types.js'

export type { IRpcBatchOptions } from './types.js'

/** Install the actual optional physical queue; absent installation allocates no batching state. */
export function batch(options: IRpcBatchOptions = {}): IRpcFlowPlugin {
  /** Only existing native scope declarations are captured; no host configuration switch is added. */
  const captured = { ...options }
  return defineFlowPlugin({
    name: RpcBatchPluginName,
    namespaces: captured.namespaces,
    setup: (context) => new RpcBatchFlow(context.signal, captured.required ?? false).value
  })
}

export default batch
