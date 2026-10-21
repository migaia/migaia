/** Policy for fields a newer peer may add to a wire error node. */
export const RpcWireErrorUnknownFieldMode = {
  /** Default strict validation rejects unrecognized error-node fields. */
  reject: 'reject',
  /** Omit unrecognized error-node fields and optionally notify the supplied hook. */
  ignore: 'ignore'
} as const
export type RpcWireErrorUnknownFieldMode = keyof typeof RpcWireErrorUnknownFieldMode

/** Language neutral limits shared by the serializer, validator, and schema vectors. */
export const RpcWireErrorLimit = {
  /** Maximum accepted nesting of the serialized error graph. */
  maxNesting: 48,
  /** Portable embedding depth reserved for error nodes before their data is walked. */
  maxEmbeddingDepth: 16,
  /** Maximum serialized error-node count. */
  maxNodes: 1024,
  /** UTF-8 ceiling for each bounded error text field. */
  maxStringBytes: 65_536,
  /** Total bounded wire-error representation ceiling. */
  maxBytes: 1_048_576
} as const

/** Bound for the JavaScript graph walk API, separate from the wire limits. */
export const RpcErrorReachLimit = {
  /** Maximum original graph objects inspected by the JavaScript reach walker. */
  maxObjects: 4096
} as const

/** Stable identity and message for thrown values without a semantic error identity. */
export const RpcWireErrorFallback = {
  /** Diagnostic source for values without a valid semantic identity. */
  source: 'unknown',
  /** Diagnostic code for values without a valid semantic identity. */
  code: 'UNKNOWN',
  /** Native-style fallback name when no usable error name exists. */
  name: 'Error',
  /** Safe message for a thrown value that is not an error. */
  nonErrorMessage: 'non-error value thrown'
} as const

/** Stable violation reasons carried by INVALID_WIRE_ERROR diagnostics and vectors. */
export const RpcWireErrorViolation = {
  /** A required getter or reflection operation failed. */
  read: 'read',
  /** A field is outside its admitted scalar or container domain. */
  type: 'type',
  /** A mandatory serialized-error field is absent. */
  required: 'required',
  /** Strict mode encountered an unrecognized error-node field. */
  unknownField: 'unknownField',
  /** Aggregate entries were present as an empty list. */
  emptyErrors: 'emptyErrors',
  /** The truncation marker was present with a value other than true. */
  truncatedValue: 'truncatedValue',
  /** Diagnostic data failed the portable value grammar. */
  dataPortable: 'dataPortable',
  /** The serialized graph exceeds its nesting allowance. */
  depth: 'depth',
  /** The serialized graph exceeds its node allowance. */
  nodes: 'nodes',
  /** Text contains an unpaired UTF-16 surrogate. */
  surrogate: 'surrogate',
  /** An individual text field exceeds its UTF-8 allowance. */
  stringBytes: 'stringBytes',
  /** Diagnostic data exceeds its available byte budget. */
  dataBytes: 'dataBytes',
  /** The whole serialized-error tree exceeds its byte budget. */
  totalBytes: 'totalBytes',
  /** A foreign JSON-RPC error lacks its required integer-code/message shape. */
  jsonRpcShape: 'jsonRpcShape',
  /** The requested JSON-RPC code is not a safe integer. */
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
  /** Canonical JSON-RPC data extension containing the complete RPC wire-error tree. */
  dataKey: 'migaiaWireError',
  /** Synthetic diagnostic source for foreign JSON-RPC errors without that extension. */
  foreignSource: 'jsonrpc-2.0'
} as const
