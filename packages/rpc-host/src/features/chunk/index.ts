/**
 * Publishes the complete chunk flow factory and its supported assembly option types. Each native
 * installation receives its own RpcChunkFlow; the entry declares extension participation without
 * implementing a second codec, Session or fragment store.
 */
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.js'
import type { IRpcFlowFeature } from '../../sdk/types.js'
import { RpcChunkPluginName } from './constants.js'
import { RpcChunkFlow } from './flow.js'
import type { IRpcChunkOptions } from './types.js'

/** Required negotiation remains separate from transport-selected feature placement. */
export type IRpcChunkFeatureOptions = Omit<IRpcChunkOptions, 'errorMetadata'> &
  Readonly<{
    required?: boolean
  }>

/** Install actual optional chunk@1 hooks; no chunk resources exist when this factory is absent. */
export function chunk(options: IRpcChunkFeatureOptions = {}): IRpcFlowFeature {
  /** Limits are captured now and validated by the actual setup owner before any frame is emitted. */
  const captured = { ...options }
  return defineBuiltinFlowFeature('chunk', {
    name: RpcChunkPluginName,
    setup: (context) => new RpcChunkFlow(captured, context.signal, captured.required ?? false).value
  })
}

export default chunk
