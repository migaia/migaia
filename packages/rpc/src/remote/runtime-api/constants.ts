/** New application descriptions are isolated from the unchanged v1 remote contract schema. */
export const RUNTIME_API_SCHEMA_VERSION = 2

/** Automatic provide descriptor errors are stable, non-reflecting configuration diagnostics. */
export const RuntimeApiErrorText = {
  /** Descriptor compilation cannot read accessors or accept non-own/reserved callable paths. */
  provideInvalid: 'Runtime provide must contain valid own data methods or groups',
  /** A Peer chooses one explicit source, or the platform's verified automatic bootstrap. */
  sourceInvalid: 'Runtime Peer requires exactly one connection source',
  /** Safe identity is projected from explicit configuration or the verified platform bootstrap. */
  identityInvalid: 'Runtime Peer identity is invalid',
  /** A remote directory must satisfy the negotiated versioned application schema. */
  descriptionInvalid: 'Runtime method description is invalid',
  /** Whitelist admission refuses unknown methods without reflecting arbitrary input text. */
  methodUnavailable: 'Runtime method is not provided by this peer',
  /** Only scalar result normalization, never handler failures, opts in to this payload summary. */
  resultInvalid: 'Runtime request result must be portable'
} as const

/** Routes describe actual installed call capabilities, never inferred handler return shapes. */
export const RuntimeApiMode = {
  request: 'request',
  notify: 'notify',
  stream: 'stream'
} as const
export type RuntimeApiMode = (typeof RuntimeApiMode)[keyof typeof RuntimeApiMode]

/** Advanced declarations narrow registration; automatic methods describe installed routes. */
export const RuntimeApiModeSource = {
  declared: 'declared',
  generatedRoutes: 'generated-routes'
} as const
export type RuntimeApiModeSource = (typeof RuntimeApiModeSource)[keyof typeof RuntimeApiModeSource]
