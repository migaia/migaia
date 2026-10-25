/**
 * Publishes the complete chunk flow factory and its supported assembly option types. Each native
 * installation receives its own RpcChunkFlow; the entry declares extension participation without
 * implementing a second codec, Session or fragment store.
 */
import { defineFlowPlugin } from '../../sdk/define.js'
import type { IRpcFlowPlugin } from '../../sdk/types.js'
import { RpcChunkPluginName } from './constants.js'
import { RpcChunkFlow } from './flow.js'
import type { IRpcChunkOptions } from './types.js'

/** Scope and required negotiation are existing host declarations rather than plugin-side routing. */
export type IRpcChunkFeatureOptions = Omit<IRpcChunkOptions, 'errorMetadata'> &
  Readonly<{
    namespaces?: readonly string[]
    required?: boolean
  }>

/** Install actual optional chunk@1 hooks; no chunk resources exist when this factory is absent. */
export function chunk(options: IRpcChunkFeatureOptions = {}): IRpcFlowPlugin {
  /** Limits are captured now and validated by the actual setup owner before any frame is emitted. */
  const captured = { ...options }
  return defineFlowPlugin({
    name: RpcChunkPluginName,
    namespaces: captured.namespaces,
    setup: (context) => new RpcChunkFlow(captured, context.signal, captured.required ?? false).value
  })
}

export default chunk
