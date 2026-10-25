/** Native admission marks exact local failures; diagnostics and physical IO policy stay owned. */

/** Only an actual native admission branch can lend this non-wire failure identity to Session. */
const admissionFailures = new WeakSet<Error>()

/** Preserve the same Error from native capacity or terminal policy that rejects future handoff. */
export function markRpcCarrierAdmissionFailure<T extends Error>(error: T): T {
  admissionFailures.add(error)
  return error
}

/** Public error codes, prototypes and serialized fields cannot forge native admission provenance. */
export function isRpcCarrierAdmissionFailure(value: unknown): boolean {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    admissionFailures.has(value as Error)
  )
}
