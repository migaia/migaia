import { rpcProtocolV1, type IRpcEnvelope, type IRpcProtocol } from '@migaia/rpc-contract'
import { registerJsonObjectDescriptorMiddleware } from '../../../dist/core/internal/json-object-port.js'
import { RpcPortName } from '../../../dist/core/internal/plugin-shared-keys.js'
import type { IRpcPlugin } from '../../../dist/core/typing.js'

/** Publishes an actual protocol descriptor for Core selection, validation, and lifetime oracles. */
export function canonicalProtocol(
  descriptor: IRpcProtocol<IRpcEnvelope, string, number> = rpcProtocolV1
): IRpcPlugin {
  return registerJsonObjectDescriptorMiddleware(
    Object.freeze({
      name: 'protocol',
      protocol: descriptor,
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        },
        sharedProvides: [RpcPortName.protocol]
      },
      install: () => ({ extension: {}, ports: { [RpcPortName.protocol]: descriptor } })
    }),
    descriptor
  )
}
