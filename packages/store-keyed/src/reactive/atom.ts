import type { IDisposable, IRuntime } from '@migaia/reactive'
import type { IAtomDefinition } from '../atom/definition.js'
import { createStoreKeyedError, StoreKeyedErrorCode } from '../errors.js'
import { StoreKeyedErrorText } from '../error-text.js'

/**
 * Defines the atom protocol and cross-runtime validation without an atom implementation.
 *
 * `PrimitiveAtom` and `DerivedAtom` live in `atom/legacy.ts` as facades over definitions and
 * `AtomStore`. Async, family, and React extensions use this protocol without depending on the
 * instantiation layer.
 */

export type IReadableAtom<T> = IDisposable & {
  readonly runtime: IRuntime
  /** Pure definition bridge used by the Provider-scoped React adapter. */
  readonly atomDefinition?: IAtomDefinition<any>
  readonly value: T
  readonly observed: boolean
  read(): T
  /**
   * Reads without tracking dependencies.
   *
   * React can call `getSnapshot` while another component captures dependencies. Reading `.value`
   * would add the atom to that component's dependencies, so this path creates no graph edge.
   */
  peek(): T
}

export type IWritableAtom<T, Args extends readonly unknown[], Result> = IReadableAtom<T> & {
  write(...args: Args): Result
}

export type IAtomGetter = <T>(atom: IReadableAtom<T>) => T

export type IAtomSetter = <T, Args extends readonly unknown[], Result>(
  atom: IWritableAtom<T, Args, Result>,
  ...args: Args
) => Result

export type IAtomRead<T> = (get: IAtomGetter) => T

export type IAtomWrite<Args extends readonly unknown[], Result> = (
  get: IAtomGetter,
  set: IAtomSetter,
  ...args: Args
) => Result

export type IAtomUpdate<T> = T | ((previous: T) => T)

function assertSameRuntime(runtime: IRuntime, atom: IReadableAtom<unknown>): void {
  if (atom.runtime !== runtime) {
    throw createStoreKeyedError(StoreKeyedErrorCode.crossRuntime, StoreKeyedErrorText.crossRuntime)
  }
}

/**
 * Creates a getter bound to the specified `Runtime`.
 *
 * Async and family extensions reuse the atom protocol's cross-runtime validation instead of
 * implementing their own.
 */
export function atomGetter(runtime: IRuntime): IAtomGetter {
  return <T>(atom: IReadableAtom<T>): T => {
    assertSameRuntime(runtime, atom)
    return atom.value
  }
}

export function atomSetter(runtime: IRuntime): IAtomSetter {
  return <T, Args extends readonly unknown[], Result>(
    atom: IWritableAtom<T, Args, Result>,
    ...args: Args
  ): Result => {
    assertSameRuntime(runtime, atom)
    return atom.write(...args)
  }
}
