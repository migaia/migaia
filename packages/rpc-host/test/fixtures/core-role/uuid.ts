import { registerJsonObjectMiddleware } from '../../../dist/core/internal/json-object-port.js'
import { RpcFirstPartyRoleSchema } from '../../../dist/core/internal/plugin-contract.js'
import { RpcPortName } from '../../../dist/core/internal/plugin-shared-keys.js'
import type { IRpcPlugin, IRpcUuidConfig } from '../../../dist/core/typing.js'

/** Supplies a generator port to the retained Core ID/retry and installation transaction oracles. */
export function uuid(config: IRpcUuidConfig = {}): IRpcPlugin {
  return registerJsonObjectMiddleware(
    Object.freeze({
      name: 'middleware:uuid',
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        },
        ...RpcFirstPartyRoleSchema.uuid
      },
      install: () => ({
        extension: {},
        ports: { [RpcPortName.uuid]: Object.freeze({ generate: config.generate }) }
      })
    })
  )
}
