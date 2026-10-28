import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { createLifecycleError } from './errors.js'
import type { IReleaseContext } from './types.js'

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
 * The capability supplied to a scope-owned release callback. It also owns the scope's "a release
 * callback is running on this stack" marker, so the release loop marks each callback's synchronous
 * frame once instead of wrapping every callback in a guard closure. `join()` rejects immediately,
 * including after callback suspension or after the originating scope reaches terminal state.
 */
export class DisposerContext implements IDisposerContext {
  /**
   * True only during the synchronous frame of a release callback this context was handed to. The
   * owning scope reads it to reject reentrant `own()` and self-joining `dispose()` calls.
   */
  #active = false

  /** Rejects owner-disposal self-joins without touching the canonical external Promise. */
  join(): never {
    throw createLifecycleError(
      LifecycleErrorCode.scopeReentrantDispose,
      LifecycleErrorText.scopeReentrantDispose
    )
  }

  /** Whether a release callback driven by `disposer` is currently on the synchronous stack. */
  static isActive(disposer: DisposerContext): boolean {
    return disposer.#active
  }

  /**
   * Invokes one release callback, marking only its synchronous call frame as active. Contexts
   * without a scope-owned disposer call the callback directly.
   */
  static invoke(
    callback: (context: IReleaseContext) => void | PromiseLike<void>,
    context: IReleaseContext
  ): void | PromiseLike<void> {
    /** The scope-owned marker, absent for generic transactions and caller-built contexts. */
    const disposer = context.disposer
    if (!(disposer instanceof DisposerContext)) return callback(context)
    disposer.#active = true
    try {
      return callback(context)
    } finally {
      disposer.#active = false
    }
  }
}
