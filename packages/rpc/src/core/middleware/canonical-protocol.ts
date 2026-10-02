import { registerJsonObjectDescriptorMiddleware } from '../internal/json-object-port.js'
import { rpcProtocolV1, type IRpcEnvelope, type IRpcProtocol } from '../../contract/index.js'
import type {
  IRpcPlugin,
  IRpcPluginClaims,
  IRpcPluginInstallResult,
  IRpcPluginMetadata
} from '../typing.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'

const protocolClaims: IRpcPluginClaims = {
  routes: [],
  provides: [],
  consumes: [],
  publicKeys: [],
  exposedKeys: [],
  activator: false
}

const protocolMetadata: IRpcPluginMetadata = Object.freeze({
  claims: protocolClaims,
  sharedProvides: Object.freeze([RpcPortName.protocol])
})

/** Creates the canonical default protocol plugin without permitting a forged generic identity. */
export function canonicalProtocol(): IRpcPlugin<{ readonly protocol: typeof rpcProtocolV1 }>
/** Creates a protocol plugin backed by the supplied canonical component descriptor. */
export function canonicalProtocol<TDescriptor extends IRpcProtocol<IRpcEnvelope, string, number>>(
  descriptor: TDescriptor
): IRpcPlugin<{ readonly protocol: TDescriptor }>
/** Implements both protocol entry points while preserving the supplied descriptor reference. */
export function canonicalProtocol(
  descriptor: IRpcProtocol<IRpcEnvelope, string, number> = rpcProtocolV1
): IRpcPlugin<{ readonly protocol: IRpcProtocol<IRpcEnvelope, string, number> }> {
  if (
    !descriptor ||
    typeof descriptor !== 'object' ||
    typeof readProtocolNormalize(descriptor) !== 'function'
  )
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.codecDescriptorInvalid)
  return registerJsonObjectDescriptorMiddleware(
    Object.freeze({
      name: 'protocol',
      protocol: descriptor,
      metadata: protocolMetadata,
      install: (): IRpcPluginInstallResult => {
        return {
          extension: Object.freeze({}),
          ports: Object.freeze({ [RpcPortName.protocol]: descriptor })
        }
      }
    }),
    descriptor
  )
}

/** Reads the terminal normalizer once and preserves hostile descriptor failures as coded causes. */
function readProtocolNormalize(descriptor: object): unknown {
  try {
    return (descriptor as { readonly normalize?: unknown }).normalize
  } catch (cause) {
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.codecDescriptorInvalid,
      cause
    )
  }
}
