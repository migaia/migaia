import { describe, expect, it } from 'vitest';
import {
  isWebRpcError,
  WebRpcChunkError,
  WebRpcContractError,
  WebRpcErrorCode,
  WebRpcProtocolError,
  WebRpcSerializationError
} from '../src/errors';

describe('error boundary helpers', () => {
  it('does not let a hostile code getter escape', () => {
    const value = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter');
        }
      }
    );
    expect(isWebRpcError(value)).toBe(false);
  });

  it('keeps protocol-family error codes distinct', () => {
    expect(new WebRpcSerializationError('payload').code).toBe('PAYLOAD_INVALID');
    expect(new WebRpcProtocolError('protocol').code).toBe('PROTOCOL_INVALID');
    expect(new WebRpcContractError('contract').code).toBe('CONTRACT_INVALID');
    expect(new WebRpcChunkError('chunk').code).toBe('CHUNK_INVALID');
    expect(WebRpcErrorCode.middlewareMissing).toBe('MIDDLEWARE_MISSING');
  });
});
