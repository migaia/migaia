import { createRuntime } from './runtime.class.js'
import type { IRuntime } from './types.js'

/** Sole owner of the shared convenience runtime; importing this provider does not construct it. */
let sharedRuntime: IRuntime | undefined

/**
 * Returns the canonical default, constructing it only on explicit first use and preserving
 * identity.
 */
export function getDefaultRuntime(): IRuntime {
  return (sharedRuntime ??= createRuntime())
}
