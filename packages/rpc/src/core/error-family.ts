/** Stable Error.name values identify the existing Core classes across runtime realms. */
export const RpcErrorFamily = {
  /** Base coded Core failure used by generic caller admission. */
  rpc: 'RpcError',
  /** Schema admission failure retains its original data and cause. */
  schema: 'RpcSchemaValidationError',
  /** Invalid endpoint configuration remains a Core error family. */
  configuration: 'RpcConfigurationError',
  /** Partial construction failure preserves cleanup and the original cause. */
  construction: 'RpcConstructionError',
  /** Endpoint lifecycle failure preserves its cleanup details. */
  lifecycle: 'RpcLifecycleError',
  /** Encoding and portable payload failures belong to this native family. */
  serialization: 'RpcSerializationError',
  /** Protocol validation keeps its Core family identity. */
  protocol: 'RpcProtocolError',
  /** Method contract failures retain their original Core identity. */
  contract: 'RpcContractError',
  /** Physical transport failure remains distinguishable from a remote rejection. */
  transport: 'RpcTransportError',
  /** Authentication failures preserve the original coded Core class. */
  authentication: 'RpcAuthenticationError',
  /** Chunk and reassembly failures retain their Core native family. */
  chunk: 'RpcChunkError',
  /** Received remote failures keep arbitrary remote codes and their own family. */
  remote: 'RpcRemoteError',
  /** Cancellation uses the standard AbortError name for cross-realm restoration. */
  abort: 'AbortError',
  /** Deadline failure uses the standard TimeoutError name for cross-realm restoration. */
  timeout: 'TimeoutError'
} as const
