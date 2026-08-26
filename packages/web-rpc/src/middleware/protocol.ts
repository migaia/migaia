import type {
  IWebRpcPlugin,
  IWebRpcPluginClaims,
  IWebRpcPluginInstallResult,
  IWebRpcPluginMetadata,
  IWebRpcProtocolCapability,
  IWebRpcProtocolConfig
} from '../typing.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'

const protocolClaims: IWebRpcPluginClaims = {
  routes: [],
  provides: [],
  consumes: [],
  publicKeys: [],
  exposedKeys: [],
  activator: false
}

/** Normalizes one protocol config without touching the legacy capability registry. */
function createProtocolCapability(config: IWebRpcProtocolConfig): IWebRpcProtocolCapability {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol descriptor is invalid')
  let encode: IWebRpcProtocolConfig['encode']
  let decode: IWebRpcProtocolConfig['decode']
  let encodedType: IWebRpcProtocolConfig['encodedType']
  try {
    encode = config.encode
    decode = config.decode
    encodedType = config.encodedType
  } catch (error) {
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol descriptor is unreadable', error)
  }
  if (encode !== undefined && typeof encode !== 'function')
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.encode must be a function')
  if (decode !== undefined && typeof decode !== 'function')
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.decode must be a function')
  if (encodedType !== undefined && !['any', 'string', 'uint8array'].includes(encodedType))
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.encodedType is invalid')
  return {
    encode: encode ?? ((value: unknown): unknown => value),
    decode: decode ?? ((value: unknown): unknown => value),
    encodedType: encodedType ?? 'any',
    identity: !encode && !decode
  }
}

const protocolMetadata: IWebRpcPluginMetadata = Object.freeze({
  claims: protocolClaims,
  sharedProvides: Object.freeze([WebRpcSharedKey.protocol])
})

/** Creates the admitted protocol plugin and publishes only its typed shared capability. */
export const protocol = (config: IWebRpcProtocolConfig = {}): IWebRpcPlugin =>
  Object.freeze({
    name: 'protocol',
    metadata: protocolMetadata,
    install: (): IWebRpcPluginInstallResult => {
      const capability = createProtocolCapability(config)
      return {
        extension: Object.freeze({}),
        shared: Object.freeze({ [WebRpcSharedKey.protocol]: capability })
      }
    }
  })
