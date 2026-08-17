import type { IWebRpcChunkCapability, IWebRpcChunkConfig, IWebRpcMiddleware } from '../typing.js';
import { splitUtf8, utf8ByteLength } from '../internal/chunk.js';
import { WebRpcCapabilityKey } from '../internal/runtime.js';
import { WebRpcError, WebRpcErrorCode } from '../errors.js';

export const chunk = (config: IWebRpcChunkConfig = {}): IWebRpcMiddleware => ({
  name: 'chunk',
  install: ({ capabilities }) => {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk descriptor is invalid');
    let snapshot: IWebRpcChunkConfig;
    try {
      snapshot = { ...config };
    } catch (error) {
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk descriptor is unreadable', error);
    }
    if (
      snapshot.chunkSize !== undefined &&
      (!Number.isSafeInteger(snapshot.chunkSize) || snapshot.chunkSize <= 0)
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'chunkSize must be a positive safe integer'
      );
    if (snapshot.chunkSize !== undefined && snapshot.chunkSize < 4)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'chunkSize must be at least 4 bytes for UTF-8 code points'
      );
    if (
      snapshot.maxMessageBytes !== undefined &&
      (!Number.isSafeInteger(snapshot.maxMessageBytes) || snapshot.maxMessageBytes <= 0)
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'maxMessageBytes must be a positive safe integer'
      );
    if (snapshot.byteLength !== undefined && typeof snapshot.byteLength !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk.byteLength must be a function');
    if (snapshot.split !== undefined && typeof snapshot.split !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk.split must be a function');
    for (const [name, value] of [
      ['maxConcurrentMessages', snapshot.maxConcurrentMessages],
      ['maxConcurrentMessagesPerPeer', snapshot.maxConcurrentMessagesPerPeer],
      ['maxBufferedBytes', snapshot.maxBufferedBytes],
      ['maxChunksPerMessage', snapshot.maxChunksPerMessage],
      ['maxChunkBytes', snapshot.maxChunkBytes],
      ['assemblyTimeoutMs', snapshot.assemblyTimeoutMs]
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          `${name} must be a positive safe integer`
        );
    }
    const capability: IWebRpcChunkCapability = {
      ...snapshot,
      byteLength: snapshot.byteLength ?? utf8ByteLength,
      split: snapshot.split ?? splitUtf8
    };
    capabilities.set(WebRpcCapabilityKey.chunk, capability);
    capabilities.set(WebRpcCapabilityKey.chunkCapability, capability);
  }
});
