/** Stable error domain owned by this code table; it names the part contract, not a package path. */
export const ERROR_SOURCE = 'part.contract'

/**
 * The single declaration site for `part.contract` error codes. The pair `(source, code)` identifies
 * an error; throw sites use these constants. Code values are public API.
 */
export const PartContractErrorCode = {
  /**
   * `parseBlueprint` received input that is not a blueprint document, or a node id or slot name
   * contains characters outside the address alphabet. Fix the document; the first structural
   * problem is on `cause`.
   */
  blueprintInvalid: 'BLUEPRINT_INVALID',
  /** An address string does not follow the address grammar. Correct the address text. */
  addressInvalid: 'ADDRESS_INVALID',
  /**
   * Two nodes of one blueprint produce the same address, through a repeated `id` or an `id` equal
   * to a sibling's generated segment. Give one of the nodes a unique `id`.
   */
  addressDuplicate: 'ADDRESS_DUPLICATE',
  /**
   * A descriptor field is invalid: an id without `@major`, a meta key without a namespace, or a
   * kind that is neither built in nor supplied by the caller's kind table. Fix the definition.
   */
  descriptorInvalid: 'DESCRIPTOR_INVALID',
  /**
   * No JSON Schema can be produced for a schema: it has no `~standard.jsonSchema`, its `input()`
   * conversion throws, and no explicit JSON Schema was supplied. Supply one or use a supporting
   * library.
   */
  schemaNotSerializable: 'SCHEMA_NOT_SERIALIZABLE',
  /**
   * A schema transforms its value: input and output JSON Schemas differ or `output()` throws.
   * Remote arguments must validate without transformation; remove transform or coerce steps.
   */
  schemaTransforms: 'SCHEMA_TRANSFORMS',
  /** Argument validation failed; the validator's issue list is on `cause`. Correct the arguments. */
  argsInvalid: 'ARGS_INVALID',
  /**
   * A rule's `check` threw. Reported as an issue, never thrown, so other rules still run; the
   * original error is on the issue's `cause`. Fix the rule.
   */
  ruleFailed: 'RULE_FAILED',
  /**
   * `expandFragments` met a fragment id again on its own expansion path. Remove the self reference
   * from the fragment definitions; the expansion path is on `cause`.
   */
  fragmentCycle: 'FRAGMENT_CYCLE',
  /** Fragment expansion nested deeper than the fixed limit of 16 levels. Reduce nesting. */
  fragmentTooDeep: 'FRAGMENT_TOO_DEEP',
  /**
   * Fragment expansion produced more than the fixed limit of 10000 nodes; expansion stops as soon
   * as the limit is passed, so its cost stays bounded. Reduce nesting or repetition.
   */
  fragmentTooLarge: 'FRAGMENT_TOO_LARGE'
} as const

/** Value union of every `part.contract` error code. */
export type IPartContractErrorCode =
  (typeof PartContractErrorCode)[keyof typeof PartContractErrorCode]
