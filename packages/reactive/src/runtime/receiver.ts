import {
  assimilateCapturedThen,
  inspectThenable,
  observeThenableRejection,
  type IThenableInspection
} from '@migaia/utils/function'

export { assimilateCapturedThen, inspectThenable, observeThenableRejection }
export type { IThenableInspection }

/**
 * Reflective receiver-binding boundary for `@migaia/reactive`.
 *
 * The repository forbids `Function.prototype.call`/`apply`/`bind`, and an arrow function captures
 * lexical context rather than supplying an arbitrary receiver — yet two legitimate cases need an
 * explicit `this`:
 *
 * - The read-only collection views must forward the caller-supplied `thisArg` while substituting the
 *   read-only view (never the mutable backing collection) as the third argument.
 *
 * `Reflect.apply` for collection callbacks is kept in this module; thenable mechanics are owned by
 * the runtime-neutral Utils function boundary.
 */

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
