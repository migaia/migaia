import type { IDisposable, IRuntime } from '@migaia/reactive'
import type { IAtomDefinition } from '../atom/definition.ts'
import { createStoreKeyedError, StoreKeyedErrorCode } from '../errors.ts'
import { StoreKeyedErrorText } from '../error-text.ts'

/**
 * Defines the atom protocol and cross-runtime validation without an atom implementation.
 *
 * Concrete state is instantiated from definitions by `AtomStore`. React and other adapters use this
 * protocol without depending on private instance classes or a legacy facade module.
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

/** A readable instance-style atom that can also be written through `write(...args)`. */
export type IWritableAtom<T, Args extends readonly unknown[], Result> = IReadableAtom<T> & {
  write(...args: Args): Result
}

/** Reads an instance-style atom inside read callbacks. */
export type IAtomGetter = <T>(atom: IReadableAtom<T>) => T

/** Writes an instance-style atom inside write callbacks. */
export type IAtomSetter = <T, Args extends readonly unknown[], Result>(
  atom: IWritableAtom<T, Args, Result>,
  ...args: Args
) => Result

/** Read callback of an instance-style atom. */
export type IAtomRead<T> = (get: IAtomGetter) => T

/** Write callback of an instance-style atom. */
export type IAtomWrite<Args extends readonly unknown[], Result> = (
  get: IAtomGetter,
  set: IAtomSetter,
  ...args: Args
) => Result

export type { IAtomUpdate } from '../atom/definition.ts'

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

/** Returns a setter bound to `runtime`; writing an atom from another Runtime throws `CROSS_RUNTIME`. */
export function atomSetter(runtime: IRuntime): IAtomSetter {
  return <T, Args extends readonly unknown[], Result>(
    atom: IWritableAtom<T, Args, Result>,
    ...args: Args
  ): Result => {
    assertSameRuntime(runtime, atom)
    return atom.write(...args)
  }
}
