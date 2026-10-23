/** Stable labels selected by entity schema and codec routes. */
export const EntityAdapterName = {
  /** No-validation schema label retained by the default entity adapter. */
  passthrough: 'passthrough',
  /** Validator vendor remains visible in diagnostics without owning its implementation. */
  standardSchema: (vendor: string) => `standard-schema:${vendor}`,
  /** Binary identity codec label, shared with route diagnostics. */
  binary: 'binary',
  /** Structured identity codec label delegates cloning to its backend. */
  structured: 'structured'
} as const

/** Canonical storage codec carrier values used during route selection. */
export const StorageCodecOutput = {
  /** Text backends store this codec output directly. */
  text: 'text',
  /** Binary output can be wrapped as base64 when the backend only accepts text. */
  binary: 'binary',
  /** Structured values require a backend that promises structured records. */
  structured: 'structured'
} as const
