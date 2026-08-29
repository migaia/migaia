import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { createLifecycleError } from './errors.js'

/**
 * Explicit owner-disposal capability delivered only to callbacks driven by a LifecycleScope.
 * Generic DisposeTransaction callers omit it because they do not own a scope whose disposal can be
 * joined; `join()` is intentionally a fail-fast operation rather than a Promise-producing API.
 */
export type IDisposerContext = {
  /** Rejects an attempt to join the disposal currently waiting for this callback. */
  readonly join: () => never
}

/**
 * Creates the immutable capability supplied to a scope-owned release callback. The capability
 * carries no mutable lifecycle state or Promise; every invocation rejects immediately, including
 * after callback suspension or after the originating scope reaches terminal state.
 */
export function createDisposerContext(): IDisposerContext {
  /** Rejects owner-disposal self-joins without touching the canonical external Promise. */
  const join = (): never => {
    throw createLifecycleError(
      LifecycleErrorCode.scopeReentrantDispose,
      LifecycleErrorText.scopeReentrantDispose
    )
  }
  return Object.freeze({ join })
}
