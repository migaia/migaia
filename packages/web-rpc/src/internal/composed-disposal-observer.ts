/** Private promise identities retained for package-owned lifecycle evidence only. */
type IComposedDisposalPromises = {
  readonly host: Promise<void>
  readonly endpoint: Promise<void>
}

/** The observer authority is module-local and cannot be reached through endpoint snapshots. */
const composedDisposalPromises = new WeakMap<object, IComposedDisposalPromises>()

/** Records the already-created Host and endpoint promises for one canonical endpoint. */
export function registerComposedDisposalPromises(
  endpoint: object,
  promises: IComposedDisposalPromises
): void {
  composedDisposalPromises.set(endpoint, promises)
}

/** Reads only the promise pair registered for this exact canonical endpoint object. */
export function readComposedDisposalPromises(
  endpoint: object
): IComposedDisposalPromises | undefined {
  return composedDisposalPromises.get(endpoint)
}
