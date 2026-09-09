import { createDescriptor } from '../protocol.js'
import type { IRpcProtocol } from '../types.js'
import { normalizeRpcEnvelope } from './normalize.js'
import type { IRpcEnvelope } from './types.js'

/** Canonical V1 semantic protocol descriptor and hostile-safe normalizer. */
export const rpcProtocol: IRpcProtocol<IRpcEnvelope, 'migaia.rpc', 1> = Object.freeze({
  ...createDescriptor('migaia.rpc', 1),
  normalize: normalizeRpcEnvelope
})
