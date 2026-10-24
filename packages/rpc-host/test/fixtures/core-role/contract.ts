import { registerJsonObjectMiddleware } from '../../../dist/core/internal/json-object-port.js'
import { validateContractData } from '../../../dist/core/internal/contract.js'
import { RpcPortName } from '../../../dist/core/internal/plugin-shared-keys.js'
import type { IRpcContractConfig, IRpcMethodSchema, IRpcPlugin } from '../../../dist/core/typing.js'

/**
 * Injects the actual Core validator and a valid schema snapshot into Core business/rollback
 * oracles.
 */
export function contract(config: IRpcContractConfig = {}): IRpcPlugin {
  return registerJsonObjectMiddleware(
    Object.freeze({
      name: 'contract',
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        },
        sharedProvides: [RpcPortName.contract]
      },
      install: () => {
        /**
         * Valid fixture descriptors are owned per installation, without a second configuration
         * parser.
         */
        /** Preserve the original fixture read order while supplying only valid Core role data. */
        const version = config.version
        /** Accepted versions belong to this one installation. */
        const acceptVersions = config.acceptVersions
        /** Identifier policy is supplied to the actual Core validation owner. */
        const maxIdentifierLength = config.maxIdentifierLength
        /** Method containers are copied once; schema parsers retain their original identity. */
        const schemas = config.schemas
        const snapshot: IRpcContractConfig = {
          version,
          acceptVersions: acceptVersions ? [...acceptVersions] : undefined,
          maxIdentifierLength,
          schemas:
            schemas &&
            Object.fromEntries(
              Object.entries(schemas).map(([method, value]): [string, IRpcMethodSchema] => [
                method,
                { ...value }
              ])
            )
        }

        return {
          extension: {},
          ports: {
            [RpcPortName.contract]: {
              ...snapshot,
              validateData: (method: string, side: 'params' | 'result', data: unknown) =>
                validateContractData(snapshot, method, side, data)
            }
          }
        }
      }
    })
  )
}
