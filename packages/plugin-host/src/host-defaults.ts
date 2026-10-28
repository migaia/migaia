/** Owns stable Host defaults; assembly and diagnostic ports depend inward on this policy module. */

/** Default runtime-neutral diagnostic sink; domains retain their own reporter when omitted. */
export const defaultDiagnostic = (_message: string): void => {}
/** Defaults are finite policies already supported by the public Host options. */
export const DEFAULT_MUTATION_TIMEOUT_MS = 5000
/** Original lease-drain default in milliseconds. */
export const DEFAULT_PIPELINE_DRAIN_TIMEOUT_MS = 5000
/** Original per-disposer budget in milliseconds. */
export const DEFAULT_DISPOSE_STEP_TIMEOUT_MS = 5000
/** Original diagnostic-only queue threshold in milliseconds. */
export const DEFAULT_QUEUE_ADMISSION_DIAGNOSTIC_MS = 1000
