/** Policy for fields a newer peer may add to a wire error node. */
export const RpcWireErrorUnknownFieldMode = {
  reject: 'reject',
  ignore: 'ignore'
} as const
export type RpcWireErrorUnknownFieldMode = keyof typeof RpcWireErrorUnknownFieldMode

/** Language neutral limits shared by the serializer, validator, and schema vectors. */
export const RpcWireErrorLimit = {
  maxNesting: 48,
  maxEmbeddingDepth: 16,
  maxNodes: 1024,
  maxStringBytes: 65_536,
  maxBytes: 1_048_576
} as const

/** Bound for the JavaScript graph walk API, separate from the wire limits. */
export const RpcErrorReachLimit = { maxObjects: 4096 } as const

/** Stable identity and message for thrown values without a semantic error identity. */
export const RpcWireErrorFallback = {
  source: 'unknown',
  code: 'UNKNOWN',
  name: 'Error',
  nonErrorMessage: 'non-error value thrown'
} as const

/** Stable violation reasons carried by INVALID_WIRE_ERROR diagnostics and vectors. */
export const RpcWireErrorViolation = {
  read: 'read',
  type: 'type',
  required: 'required',
  unknownField: 'unknownField',
  emptyErrors: 'emptyErrors',
  truncatedValue: 'truncatedValue',
  dataPortable: 'dataPortable',
  depth: 'depth',
  nodes: 'nodes',
  surrogate: 'surrogate',
  stringBytes: 'stringBytes',
  dataBytes: 'dataBytes',
  totalBytes: 'totalBytes',
  jsonRpcShape: 'jsonRpcShape',
  jsonRpcCode: 'jsonRpcCode'
} as const
export type RpcWireErrorViolation = keyof typeof RpcWireErrorViolation

/** Canonical field order for first-error validation and unknown-field checks. */
export const RpcWireErrorField = [
  'source',
  'code',
  'name',
  'message',
  'stack',
  'cause',
  'errors',
  'data',
  'route',
  'truncated'
] as const

/** JSON-RPC extension field and source identity used by the bridge mapping. */
export const RpcJsonRpcWireError = {
  dataKey: 'migaiaWireError',
  foreignSource: 'jsonrpc-2.0'
} as const
