/** Reports a secondary failure without allowing the diagnostic callback to change control flow. */
export const reportDiagnostic = (
  report: ((error: unknown) => void) | undefined,
  error: unknown
): void => {
  try {
    report?.(error)
  } catch {}
}
