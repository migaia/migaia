/** Native plugin identity belongs to the optional chunk owner and its installation. */
export const RpcChunkPluginName = 'rpc-chunk'
/** Installed chunk flow alone advertises and handles this optional physical extension. */
export const RpcChunkExtension = 'chunk@1'
/** The extension discriminator selects one actual existing byte/string assembly algorithm. */
export const RpcChunkEncoding = { string: 'string', binary: 'binary' } as const
/** Source-qualified message identities belong only to this installed physical framing owner. */
export const RpcChunkMessagePrefix = 'chunk:'
/** Existing bounded assembly defaults belong to the plugin, never a host-core config switch. */
export const RpcChunkLimit = {
  /** Outbound UTF-16 units or bytes in each fragment. */
  chunkBytes: 16 * 1024,
  /** Complete message units admitted before allocation. */
  maxMessageBytes: 16 * 1024 * 1024,
  /** Maximum ordered fragments declared by one message. */
  maxChunks: 4096,
  /** Aggregate retained assembly units across physical sources. */
  maxBufferedBytes: 64 * 1024 * 1024,
  /** Incomplete source/message assemblies allowed at once. */
  maxConcurrentMessages: 256,
  /** One physical source may reserve only one quarter of the default global message slots. */
  maxConcurrentMessagesPerSource: 64,
  /** Complete declared lengths reserve this per-source allowance before retaining first fragments. */
  maxBufferedBytesPerSource: 16 * 1024 * 1024,
  /** Original retention timer for incomplete assemblies. */
  assemblyTimeoutMs: 30_000
} as const
