import { rpcProtocolV1, type IRpcEnvelope, type IRpcProtocol } from '@migaia/rpc-contract'
import type {
  IWebRpcPlugin,
  IWebRpcPluginClaims,
  IWebRpcPluginInstallResult,
  IWebRpcPluginMetadata
} from '../typing.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import { WebRpcPortName } from '../internal/plugin-shared-keys.js'

const protocolClaims: IWebRpcPluginClaims = {
  routes: [],
  provides: [],
  consumes: [],
  publicKeys: [],
  exposedKeys: [],
  activator: false
}

const protocolMetadata: IWebRpcPluginMetadata = Object.freeze({
  claims: protocolClaims,
  sharedProvides: Object.freeze([WebRpcPortName.protocol])
})

/** Creates the canonical default protocol plugin without permitting a forged generic identity. */
export function canonicalProtocol(): IWebRpcPlugin<{ readonly protocol: typeof rpcProtocolV1 }>
/** Creates a protocol plugin backed by the supplied canonical component descriptor. */
export function canonicalProtocol<TDescriptor extends IRpcProtocol<IRpcEnvelope, string, number>>(
  descriptor: TDescriptor
): IWebRpcPlugin<{ readonly protocol: TDescriptor }>
/** Implements both protocol entry points while preserving the supplied descriptor reference. */
export function canonicalProtocol(
  descriptor: IRpcProtocol<IRpcEnvelope, string, number> = rpcProtocolV1
): IWebRpcPlugin<{ readonly protocol: IRpcProtocol<IRpcEnvelope, string, number> }> {
  if (
    !descriptor ||
    typeof descriptor !== 'object' ||
    typeof readProtocolNormalize(descriptor) !== 'function'
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.codecDescriptorInvalid)
  return Object.freeze({
    name: 'protocol',
    protocol: descriptor,
    metadata: protocolMetadata,
    install: (): IWebRpcPluginInstallResult => {
      return {
        extension: Object.freeze({}),
        ports: Object.freeze({ [WebRpcPortName.protocol]: descriptor })
      }
    }
  })
}

/** Reads the terminal normalizer once and preserves hostile descriptor failures as coded causes. */
function readProtocolNormalize(descriptor: object): unknown {
  try {
    return (descriptor as { readonly normalize?: unknown }).normalize
  } catch (cause) {
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      WebRpcErrorText.codecDescriptorInvalid,
      cause
    )
  }
}
