import { getLoggerRuntimeManager, setLoggerRuntimeManager } from '../../src/runtime-manager.js'

/**
 * Installs a test-only reporter that preserves host capabilities while containing diagnostics
 * already asserted through `onFailure`.
 */
export function installSilentLoggerReporter(): () => void {
  /** Current capabilities remain available to tests that exercise process, fetch, or scheduling. */
  const current = getLoggerRuntimeManager()
  /** Only the terminal error reporter is replaced; nested test runtimes restore back to this layer. */
  const silentConsole = current.console
    ? { log: () => undefined, warn: () => undefined, error: () => undefined }
    : current.console
  return setLoggerRuntimeManager({ ...current, console: silentConsole })
}
