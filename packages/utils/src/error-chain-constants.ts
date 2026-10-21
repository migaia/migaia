/** Default receive whitelist and canonical required-field order for generic error trees. */
export const ErrorChainField = [
  'source',
  'code',
  'name',
  'message',
  'stack',
  'cause',
  'errors',
  'data',
  'truncated'
] as const

/** Fixed send getter order preserves one-read snapshots before traversing descendants. */
export const ErrorChainReadField = [
  'name',
  'message',
  'stack',
  'source',
  'code',
  'data',
  'truncated',
  'cause',
  'errors',
  'cleanupErrors'
] as const

/** Conservative occurrence, graph, and UTF-8 budgets for the default generic strategy. */
export const ErrorChainLimit = {
  maxNesting: 32,
  maxNodes: 128,
  maxBytes: 65_536,
  maxStringBytes: 4096,
  maxObjects: 10_000
} as const

/** Stable presentation for unclassified thrown values; no package control authority is implied. */
export const ErrorChainFallback = {
  source: 'unknown',
  code: 'UNKNOWN',
  name: 'Error',
  nonErrorMessage: 'non-error value thrown'
} as const

/** Generic validation reasons; boundary strategies attach their own semantic error identity. */
export const ErrorChainViolation = {
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
  totalBytes: 'totalBytes'
} as const

/** Key union of `ErrorChainViolation`, naming why an error tree failed validation. */
export type ErrorChainViolation = keyof typeof ErrorChainViolation

/** Native constructor names interpreted by default restoration without evaluating received text. */
export const ErrorChainNativeName = {
  aggregate: 'AggregateError',
  abort: 'AbortError',
  type: 'TypeError',
  range: 'RangeError',
  syntax: 'SyntaxError',
  reference: 'ReferenceError',
  uri: 'URIError',
  eval: 'EvalError'
} as const

/** Receive policy values shared by generic normalization and caller-owned boundary strategies. */
export const ErrorChainUnknownFields = { reject: 'reject', ignore: 'ignore' } as const
