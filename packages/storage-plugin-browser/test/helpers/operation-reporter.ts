/** The stable prefix emitted by Storage-Web's default cleanup reporter. */
const operationCleanupPrefix = '[storage-web] operation cleanup failed'

/**
 * Captures expected cleanup diagnostics without hiding unrelated console failures. Hostile cleanup
 * tests use this to prove both result containment and observability.
 */
export const captureOperationCleanup = async <T>(
  operation: () => Promise<T>
): Promise<{ readonly result: T; readonly reports: readonly unknown[] }> => {
  /** Preserves the process diagnostic boundary for messages outside this test contract. */
  const originalConsoleError = console.error
  /** Stores the cleanup causes reported by the operation under test. */
  const reports: unknown[] = []
  console.error = (...args: unknown[]): void => {
    if (args[0] === operationCleanupPrefix) {
      reports.push(args[1])
      return
    }
    originalConsoleError(...args)
  }
  try {
    return { result: await operation(), reports }
  } finally {
    console.error = originalConsoleError
  }
}
