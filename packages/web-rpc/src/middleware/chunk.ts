import type {
  IWebRpcChunkCapability,
  IWebRpcChunkConfig,
  IWebRpcPlugin,
  IWebRpcPluginInstallResult
} from '../typing.js'
import { splitUtf8, utf8ByteLength } from '../internal/utf8.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcFirstPartyRoleSchema } from '../internal/plugin-contract.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'

const emptyClaims = Object.freeze({
  routes: Object.freeze([]),
  provides: Object.freeze([]),
  consumes: Object.freeze([]),
  publicKeys: Object.freeze([]),
  exposedKeys: Object.freeze([]),
  activator: false
})

/** Reads every chunk option once in the canonical production snapshot order. */
function snapshotChunk(config: IWebRpcChunkConfig): IWebRpcChunkConfig {
  return {
    chunkSize: config.chunkSize,
    maxMessageBytes: config.maxMessageBytes,
    maxConcurrentMessages: config.maxConcurrentMessages,
    maxConcurrentMessagesPerPeer: config.maxConcurrentMessagesPerPeer,
    maxBufferedBytes: config.maxBufferedBytes,
    maxChunksPerMessage: config.maxChunksPerMessage,
    maxChunkBytes: config.maxChunkBytes,
    assemblyTimeoutMs: config.assemblyTimeoutMs,
    byteLength: config.byteLength,
    split: config.split
  }
}

/** Validates one chunk snapshot and creates the immutable native chunk port. */
function createChunkPlugin(config: IWebRpcChunkConfig): IWebRpcPlugin {
  return Object.freeze({
    name: 'middleware:chunk',
    metadata: Object.freeze({
      claims: emptyClaims,
      sharedProvides: WebRpcFirstPartyRoleSchema.chunk.sharedProvides,
      sharedConsumes: WebRpcFirstPartyRoleSchema.chunk.sharedConsumes,
      sharedOptionalConsumes: WebRpcFirstPartyRoleSchema.chunk.sharedOptionalConsumes
    }),
    install: (): IWebRpcPluginInstallResult => {
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk descriptor is invalid')
      let snapshot: IWebRpcChunkConfig
      try {
        Reflect.ownKeys(config)
        snapshot = snapshotChunk(config)
      } catch (error) {
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'chunk descriptor is unreadable',
          error
        )
      }
      if (
        snapshot.chunkSize !== undefined &&
        (!Number.isSafeInteger(snapshot.chunkSize) || snapshot.chunkSize <= 0)
      )
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'chunkSize must be a positive safe integer'
        )
      if (snapshot.chunkSize !== undefined && snapshot.chunkSize < 4)
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'chunkSize must be at least 4 bytes for UTF-8 code points'
        )
      if (
        snapshot.maxMessageBytes !== undefined &&
        (!Number.isSafeInteger(snapshot.maxMessageBytes) || snapshot.maxMessageBytes <= 0)
      )
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'maxMessageBytes must be a positive safe integer'
        )
      if (snapshot.byteLength !== undefined && typeof snapshot.byteLength !== 'function')
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk.byteLength must be a function')
      if (snapshot.split !== undefined && typeof snapshot.split !== 'function')
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk.split must be a function')
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
          )
      }
      const capability: IWebRpcChunkCapability = Object.freeze({
        ...snapshot,
        byteLength: snapshot.byteLength ?? utf8ByteLength,
        split: snapshot.split ?? splitUtf8
      })
      return {
        extension: Object.freeze({}),
        shared: Object.freeze({ [WebRpcSharedKey.chunk]: capability })
      }
    }
  })
}

/** Creates a chunk middleware whose ten-field snapshot is taken during Host installation. */
export const chunk = (config: IWebRpcChunkConfig = {}): IWebRpcPlugin =>
  freezePlugin(createChunkPlugin(config))
