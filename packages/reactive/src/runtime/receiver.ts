/* oxlint-disable unicorn/no-thenable -- runtime must inspect hostile PromiseLike callback results. */

/**
 * Reflective receiver-binding boundary for `@migaia/reactive`.
 *
 * The repository forbids `Function.prototype.call`/`apply`/`bind`, and an arrow function captures
 * lexical context rather than supplying an arbitrary receiver — yet two legitimate cases need an
 * explicit `this`:
 *
 * - Thenable assimilation must call the captured `.then` with `this === thenable` (Promise/A+) after
 *   a single `.then` read;
 * - The read-only collection views must forward the caller-supplied `thisArg` while substituting the
 *   read-only view (never the mutable backing collection) as the third argument.
 *
 * `Reflect.apply` (the `Reflect` static, distinct from `Function.prototype.apply`) appears only in
 * this module and nowhere else in the package.
 */

/**
 * Assimilates a thenable whose `.then` was already read, invoking it exactly once with the thenable
 * as receiver (Promise/A+) and no second `.then` read. A synchronous `then` throw becomes the
 * returned promise's rejection.
 */
export function assimilateThenable(
  thenFn: (resolve: unknown, reject: unknown) => void,
  thenable: unknown
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    try {
      Reflect.apply(thenFn, thenable, [resolve, reject])
    } catch (error) {
      reject(error)
    }
  })
}

export type IThenableInspection =
  | { readonly then: undefined }
  | { readonly then: (resolve: unknown, reject: unknown) => void }
  | { readonly error: unknown }

/**
 * Reads a callback result's then property once so synchronous contracts can reject thenables
 * safely.
 */
export function inspectThenable(value: unknown): IThenableInspection {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return { then: undefined }
  }
  try {
    const then = (value as { then?: unknown }).then
    return typeof then === 'function'
      ? { then: then as (resolve: unknown, reject: unknown) => void }
      : { then: undefined }
  } catch (error) {
    return { error }
  }
}

/** Observes a captured thenable rejection without introducing an unowned Promise rejection. */
export function observeThenableRejection(
  value: unknown,
  inspection: IThenableInspection,
  onRejected: (error: unknown) => void
): void {
  if ('then' in inspection && inspection.then !== undefined) {
    void assimilateThenable(inspection.then, value).then(undefined, onRejected)
  } else if ('error' in inspection) {
    onRejected(inspection.error)
  }
}

/**
 * Creates a stable callback that invokes a captured function with its admission-time receiver. The
 * returned function never re-reads a mutable property, so later option mutation cannot replace the
 * callback or change the receiver used by the runtime.
 */
export function createReceiverCallback<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  receiver: unknown
): (...args: TArgs) => TResult {
  return (...args) => Reflect.apply(fn, receiver, args)
}

/**
 * Forwards a collection callback with an explicit receiver (`thisArg`) and a caller-chosen argument
 * list.
 */
export function forwardCollectionCallback(
  callbackfn: (...args: unknown[]) => void,
  thisArg: unknown,
  args: unknown[]
): void {
  Reflect.apply(callbackfn, thisArg, args)
}
