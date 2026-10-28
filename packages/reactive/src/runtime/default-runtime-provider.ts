/**
 * Owns lazy default Runtime identity shared by explicit extension use and the eager convenience
 * entry.
 */
import { createRuntime } from './runtime.class.ts'
import type { IRuntime } from './types.ts'

/** Sole owner of the shared convenience runtime; importing this provider does not construct it. */
let sharedRuntime: IRuntime | undefined

/**
 * Returns the canonical default, constructing it only on explicit first use and preserving
 * identity.
 */
export function getDefaultRuntime(): IRuntime {
  return (sharedRuntime ??= createRuntime())
}
