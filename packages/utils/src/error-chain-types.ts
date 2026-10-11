import type { ErrorChainViolation } from './error-chain-constants.js'

/** Plain, finite JSON data accepted by the generic error boundary and structured clone. */
export type IErrorChainData =
  | null
  | boolean
  | number
  | string
  | readonly IErrorChainData[]
  | Readonly<{ [key: string]: IErrorChainData }>

/** Frozen error tree; extension fields are admitted only by the caller's strategy whitelist. */
export type ISerializedErrorChain = Readonly<{
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: ISerializedErrorChain
  errors?: readonly ISerializedErrorChain[]
  data?: IErrorChainData
  truncated?: true
}>

/** Limits count occurrences on the serialized tree and identities on the reachability walk. */
export type IErrorChainLimits = {
  readonly maxNesting: number
  readonly maxNodes: number
  readonly maxBytes: number
  readonly maxStringBytes: number
  readonly maxObjects: number
}

/** Presentation used when the thrown value lacks valid diagnostic identity or error fields. */
export type IErrorChainFallback = {
  readonly source: string
  readonly code: string
  readonly name: string
  readonly nonErrorMessage: string
}

/** One scalar-safe UTF-8 projection, with changes surfaced through the serialized truncation flag. */
export type IErrorChainText = { value: string; bytes: number; changed: boolean }

/** Exact-object policy may hide secret-bearing descendants while replacing only public code/text. */
export type IErrorChainPresentation = {
  readonly code: string
  readonly message: string
  readonly preserveSerializedError?: boolean
}

/** Caught input failures retain the exact thrown value and its original property location. */
export type IErrorChainReport = {
  readonly pointer: string
  readonly field: string
  readonly error: unknown
}

/** Caller owns reporting; without a reporter, caught input failures are rethrown as violations. */
export type ISerializeErrorChainOptions = { readonly report?: (event: IErrorChainReport) => void }

/** Strict receive validation rejects unknown fields unless the boundary explicitly ignores them. */
export type INormalizeErrorChainOptions = {
  readonly unknownFields?: 'reject' | 'ignore'
  readonly onUnknownField?: (pointer: string, field: string) => void
}

/** Extension grammar and restoration belong to the consuming boundary, not the generic walker. */
export type IErrorChainExtension = {
  readonly field: string
  readonly read?: (input: object) => unknown
  readonly normalize: (
    input: unknown,
    pointer: string
  ) => { readonly value: IErrorChainData; readonly bytes: number }
  readonly restore?: (error: Error, value: IErrorChainData) => void
}

/**
 * Small policy surface for fields, privacy, budgets, portable data, and native restoration.
 * Defaults admit only finite plain JSON data, reject unknown receive fields, preserve native
 * classes and remote stacks, and attach diagnostic source/code without creating any local control
 * identity. Trusted strategies own extension validation and byte accounting; no runtime or protocol
 * policy enters this module. Redaction runs through `sanitizeText` for every text unit, including
 * data keys.
 */
export type IErrorChainStrategy = {
  /**
   * Ordered receive whitelist, beginning with source/code/name/message/stack. The same whitelist
   * gates optional send getters and output; cleanupErrors is read only when errors is admitted.
   * Trusted consumer strategies retain those five required fields in canonical receive order.
   */
  readonly fields?: readonly string[]
  readonly limits?: Partial<IErrorChainLimits>
  readonly fallback?: Partial<IErrorChainFallback>
  readonly presentation?: (input: unknown) => IErrorChainPresentation | undefined
  readonly normalizeData?: (input: unknown, depth: number) => IErrorChainData
  readonly dataTextLeaf?: (
    value: Readonly<Record<string, IErrorChainData>>
  ) => { readonly text: string; readonly key: string } | undefined
  readonly extensions?: readonly IErrorChainExtension[]
  readonly createViolation?: (
    cause: unknown,
    pointer: string,
    violation: ErrorChainViolation
  ) => Error
  readonly sanitizeText?: (value: string, truncate: boolean) => IErrorChainText
  readonly createError?: (value: ISerializedErrorChain, children: readonly Error[]) => Error
  readonly attachIdentity?: (error: Error, value: ISerializedErrorChain) => void
}
