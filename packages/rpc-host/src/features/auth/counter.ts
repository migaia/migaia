/** Associate the internal uint64 boundary setter with its installed owner. */
const counters = new WeakMap<object, (counter: bigint) => void>()
/** Register the allocator by owner identity so copied values cannot acquire setter authority. */
export function registerAuthenticationCounterSetter(
  owner: object,
  setter: (counter: bigint) => void
): void {
  counters.set(owner, setter)
}
/** Allow boundary checks without exposing a production counter option. */
export function setAuthenticationReplayCounter(owner: object, counter: bigint): boolean {
  /** Resolve the allocator through its registered owner identity. */
  counters.get(owner)!(counter)
  return true
}
