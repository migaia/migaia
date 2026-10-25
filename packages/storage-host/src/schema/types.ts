import type { IOperationContext } from '@migaia/storage-contract'

/**
 * Defines an optional schema contract without depending on a validation library. `encode` and
 * `decode` convert domain representations, such as dates to ISO strings or removal of internal
 * fields. Codecs handle storage formats, such as objects to strings or bytes. Writes run
 * `validate`, optional `normalize`, `encode`, then `codec.encode`. Reads run `codec.decode`,
 * `decode`, then `validate` when read validation is enabled.
 */
export type ISchemaAdapter<TDomain, TStored = TDomain> = {
  /** Stable adapter label used to identify the schema conversion boundary. */
  readonly name: string
  /**
   * Supports asynchronous refinement and remote validation. Wrappers for synchronous schema
   * libraries return resolved promises.
   */
  validate(value: unknown, ctx?: IOperationContext): Promise<TDomain>
  /**
   * Converts a domain object to its stored representation. Without this method, the value passes
   * through unchanged.
   */
  encode?(value: TDomain, ctx?: IOperationContext): Promise<TStored>
  /**
   * Converts a stored representation to its domain object. Without this method, the value passes
   * through unchanged.
   */
  decode?(raw: TStored, ctx?: IOperationContext): Promise<TDomain>
  /**
   * Optionally normalizes before writing. Without this method, the validated value passes through
   * unchanged.
   */
  normalize?(value: TDomain, ctx?: IOperationContext): Promise<TDomain>
}
