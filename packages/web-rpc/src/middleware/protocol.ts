import type {
  IWebRpcMiddleware,
  IWebRpcProtocolCapability,
  IWebRpcProtocolConfig
} from '../typing';
import { WebRpcCapabilityKey } from '../internal/runtime';
import { WebRpcError, WebRpcErrorCode } from '../errors';
export const protocol = (config: IWebRpcProtocolConfig = {}): IWebRpcMiddleware => ({
  name: 'protocol',
  install: ({ capabilities }) => {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol descriptor is invalid');
    let encode: IWebRpcProtocolConfig['encode'];
    let decode: IWebRpcProtocolConfig['decode'];
    let encodedType: IWebRpcProtocolConfig['encodedType'];
    try {
      encode = config.encode;
      decode = config.decode;
      encodedType = config.encodedType;
    } catch (error) {
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'protocol descriptor is unreadable',
        error
      );
    }
    if (encode !== undefined && typeof encode !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.encode must be a function');
    if (decode !== undefined && typeof decode !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.decode must be a function');
    if (encodedType !== undefined && !['any', 'string', 'uint8array'].includes(encodedType))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.encodedType is invalid');
    const capability: IWebRpcProtocolCapability = {
      encode: encode ?? ((value: unknown): unknown => value),
      decode: decode ?? ((value: unknown): unknown => value),
      encodedType: encodedType ?? 'any',
      identity: !encode && !decode
    };
    capabilities.set(WebRpcCapabilityKey.protocol, capability);
    capabilities.set(WebRpcCapabilityKey.protocolCapability, capability);
  }
});
