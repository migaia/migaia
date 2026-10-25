/** The original internal uint64 boundary seam recognizes only this exact installed owner identity. */
const counters = new WeakMap<object, (counter: bigint) => void>()
/** Register the actual installation's allocator; copied public values cannot acquire that authority. */
export function registerAuthenticationCounterSetter(
  owner: object,
  setter: (counter: bigint) => void
): void {
  counters.set(owner, setter)
}
/** Preserve the existing bounded internal oracle without exposing a production counter option. */
export function setAuthenticationReplayCounter(owner: object, counter: bigint): boolean {
  /** Only a real original owner identity can set its existing uint64 allocation state. */
  const setter = counters.get(owner)
  if (!setter) return false
  setter(counter)
  return true
}
