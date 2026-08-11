/** Creates an idempotent settlement gate with exactly-once cleanup. */
export function createSettlement<T>(options: {
  readonly cleanup: () => void;
  readonly reportCleanupError?: (error: unknown) => void;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}): {
  readonly isSettled: () => boolean;
  readonly resolve: (value: T) => boolean;
  readonly reject: (error: unknown) => boolean;
} {
  let settled = false;
  const win = (finish: () => void): boolean => {
    if (settled) return false;
    settled = true;
    try {
      options.cleanup();
    } catch (error) {
      // Cleanup is best effort; primary promise must still settle exactly once.
      try {
        options.reportCleanupError?.(error);
      } catch {}
    }
    finish();
    return true;
  };
  return {
    isSettled: () => settled,
    resolve: (value) => win(() => options.resolve(value)),
    reject: (error) => win(() => options.reject(error))
  };
}
