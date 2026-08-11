import { WebRpcAuthenticationError, WebRpcError, WebRpcErrorCode } from '../errors';
import { WebRpcCapabilityKey } from '../internal/runtime';
import type {
  IWebRpcAuthenticationCapability,
  IWebRpcAuthenticationConfig,
  IWebRpcAuthenticationTransform,
  IWebRpcMiddleware
} from '../typing';

/** Installs optional per-frame encryption and signing transforms. */
export const authentication = (config: IWebRpcAuthenticationConfig): IWebRpcMiddleware => ({
  name: 'authentication',
  install: ({ capabilities }) => {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'authentication descriptor is invalid');
    let encrypt: IWebRpcAuthenticationTransform | undefined;
    let decrypt: IWebRpcAuthenticationTransform | undefined;
    let sign: IWebRpcAuthenticationTransform | undefined;
    let verify: IWebRpcAuthenticationTransform | undefined;
    let encodedType: IWebRpcAuthenticationConfig['encodedType'];
    try {
      ({ encrypt, decrypt, sign, verify, encodedType } = config);
    } catch (error) {
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'authentication descriptor is unreadable',
        error
      );
    }
    for (const [name, transform] of Object.entries({ encrypt, decrypt, sign, verify }))
      if (transform !== undefined && typeof transform !== 'function')
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          `authentication.${name} must be a function`
        );
    if (!!encrypt !== !!decrypt)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'authentication encrypt/decrypt must be configured together'
      );
    if (!!sign !== !!verify)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'authentication sign/verify must be configured together'
      );
    if (!encrypt && !sign)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'authentication requires encryption or signing transforms'
      );
    if (encodedType !== undefined && !['any', 'string', 'uint8array'].includes(encodedType))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'authentication.encodedType is invalid');

    /** Runs outbound encryption before signing. */
    const protect: IWebRpcAuthenticationTransform = async (value, context) => {
      try {
        const encrypted = encrypt ? await encrypt(value, context) : value;
        return sign ? await sign(encrypted, context) : encrypted;
      } catch (error) {
        if (error instanceof WebRpcAuthenticationError) throw error;
        throw new WebRpcAuthenticationError('Outbound frame authentication failed', error);
      }
    };
    /** Runs inbound verification before decryption. */
    const unprotect: IWebRpcAuthenticationTransform = async (value, context) => {
      try {
        const verified = verify ? await verify(value, context) : value;
        return decrypt ? await decrypt(verified, context) : verified;
      } catch (error) {
        if (error instanceof WebRpcAuthenticationError) throw error;
        throw new WebRpcAuthenticationError('Inbound frame authentication failed', error);
      }
    };
    const capability: IWebRpcAuthenticationCapability = {
      enabled: true,
      encodedType: encodedType ?? 'any',
      protect,
      unprotect
    };
    capabilities.set(WebRpcCapabilityKey.authentication, capability);
    capabilities.set(WebRpcCapabilityKey.authenticationCapability, capability);
  }
});
