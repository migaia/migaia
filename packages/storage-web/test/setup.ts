import { afterEach, beforeEach, vi } from 'vitest'

/** Restores the console warning boundary after each isolated test. */
let restoreWarningReporter: (() => void) | undefined

beforeEach(() => {
  /** Unknown warnings remain visible; only the package's expected entity fallback diagnostics mute. */
  const originalWarning = console.warn
  /** Per-test spy avoids changing the production default diagnostic contract. */
  const warning = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[storage-web] entity ')) return
    originalWarning(...args)
  })
  restoreWarningReporter = () => warning.mockRestore()
})

afterEach(() => {
  restoreWarningReporter?.()
  restoreWarningReporter = undefined
})
