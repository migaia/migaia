/** Stable texts of `partom import`: report reasons and fixed text of generated files. */

/**
 * Reasons of uncertain items in the import report. Contract text: tooling and tests match them to
 * tell the kinds of manual follow-up apart.
 */
export const ImportReason = {
  /** A `$ref` points outside the document. */
  externalRef: 'external-ref',
  /** A `$ref` points at a missing target or at a prototype member name. */
  missingRef: 'missing-ref',
  /** A `$ref` chain refers back to itself. */
  cyclicRef: 'cyclic-ref',
  /** A model's key was guessed from a field name ending in `Id` or `_id`. */
  keyGuessed: 'key-guessed',
  /** A schema object has no key candidate and was not turned into a model. */
  keyMissing: 'key-missing',
  /** A JSON Schema keyword has no zod translation and became `z.unknown()`. */
  keywordUnsupported: 'keyword-unsupported',
  /** A mutation has no `get` resource under its first tag and was skipped. */
  commandOrphan: 'command-orphan',
  /** Two names normalised to the same value; the later one got a numeric suffix. */
  nameCollision: 'name-collision',
  /** A generated file path would leave the output directory; the file was not written. */
  pathOutside: 'path-outside'
} as const

/** One import report reason. */
export type ImportReason = (typeof ImportReason)[keyof typeof ImportReason]

/** Fixed text written into generated files. */
export const GeneratedText = {
  /** Message of the error thrown by the generated HTTP client on a non-2xx response. */
  httpFailed: 'HTTP request failed',
  /** Plugin name of the generated HTTP Feature provider. */
  httpPlugin: 'api-http',
  /** Plugin name of the generated models and resources. */
  apiPlugin: 'api',
  /** Tag used for operations without tags. */
  defaultTag: 'default'
} as const
