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
      Reflect.apply(thenFn, thenable, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
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
  Reflect.apply(callbackfn, thisArg, args);
}
