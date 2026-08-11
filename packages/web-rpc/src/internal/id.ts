import { WebRpcError, WebRpcErrorCode } from '../errors';
import type { IWebRpcUuidConfig, IWebRpcUuidContext } from '../typing';

/** Allocates collision-checked wire identifiers for one endpoint. */
export function allocateRpcId(
  config: IWebRpcUuidConfig,
  variation: IWebRpcUuidContext['variation'],
  senderId: string,
  targetId: string,
  isUsed: (id: string) => boolean
): string {
  const generated = config.generate?.({ variation, senderId, targetId }) ?? defaultRpcId();
  if (typeof generated !== 'string' || generated.length === 0)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'UUID generator must return a non-empty string'
    );
  const id = `${variation.toUpperCase()}:${senderId}:${generated}`;
  if (isUsed(id)) throw new WebRpcError(WebRpcErrorCode.invalidConfig, `UUID conflict: ${id}`);
  return id;
}

/** Generates a cryptographically random fallback identifier. */
function defaultRpcId(): string {
  const cryptoApi = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array }
    | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'UUID unavailable');
}
