import type { ILifecycleState } from './types.js'
import { LifecycleState } from './state-constants.js'

/**
 * Owns the `open → closing → terminal` axis (§4.2, axis 1). Ported near-verbatim from
 * `@migaia/reactive`'s `TerminalControllerImpl` — the state machine itself was already correct;
 * only the domain-specific naming is gone.
 */
export type ITerminalController = {
  readonly lifecycle: ILifecycleState
  /** Idempotent. Moves `open` → `closing`; does nothing once past `open`. */
  close(): void
  /** Idempotent. Moves straight to `terminal`, resolving `whenTerminal()`. */
  forceTerminal(): void
  /** Resolves exactly once, when `terminal` is reached. */
  whenTerminal(): Promise<void>
}

export function createTerminalController(): ITerminalController {
  let lifecycle: ILifecycleState = LifecycleState.open
  let resolveTerminal!: () => void
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })

  return {
    get lifecycle() {
      return lifecycle
    },
    close() {
      if (lifecycle === LifecycleState.open) lifecycle = LifecycleState.closing
    },
    forceTerminal() {
      if (lifecycle === LifecycleState.terminal) return
      lifecycle = LifecycleState.terminal
      resolveTerminal()
    },
    whenTerminal() {
      return terminal
    }
  }
}
