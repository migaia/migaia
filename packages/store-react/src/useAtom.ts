import { useCallback, useContext, useSyncExternalStore } from 'react'
import type { IReadableAtom, IWritableAtom } from '@migaia/store-keyed/reactive/atom'
import type { Resource } from '@migaia/resource'
import type { IWritableAtomDefinition } from '@migaia/store-keyed/atom/definition'
import { useResource } from './useStore.ts'
import { useNodeValue } from './useNode.ts'
import { StoreRegistryContext } from './provider-context.ts'

/** Resource-bearing atom shape accepted by the async value hook; ownership stays with its caller. */
type IAsyncAtom<T> = {
  /** Resource whose data or pending/error outcome is read during rendering. */
  readonly resource: Resource<T>
}

/**
 * Read a synchronous atom and subscribe to its selected source. With a Provider and atomDefinition,
 * use that registry's atom store; otherwise observe the atom in its own Runtime. The unused direct
 * subscription stays disabled so one atom has one source. Atom/registry ownership remains
 * external.
 */
export function useAtomValue<T>(atom: IReadableAtom<T>): T {
  const registry = useContext(StoreRegistryContext)
  const definition = atom.atomDefinition
  const scopedStore = registry?.atomStore
  // Keep hook order stable, but disable the direct subscription whenever a
  // Provider store is selected. A scoped atom must have exactly one source.
  const directValue = useNodeValue(atom, atom.runtime, !scopedStore || !definition)
  const scopedValue = useSyncExternalStore(
    useCallback(
      (listener) => (scopedStore && definition ? scopedStore.sub(definition, listener) : () => {}),
      [scopedStore, definition]
    ),
    useCallback(
      () => (scopedStore && definition ? scopedStore.peek(definition) : directValue),
      [scopedStore, definition, directValue]
    ),
    useCallback(
      () => (scopedStore && definition ? scopedStore.peek(definition) : directValue),
      [scopedStore, definition, directValue]
    )
  )
  return scopedStore && definition ? scopedValue : directValue
}

/**
 * Return a writer stable while atom/definition/registry identities remain unchanged.
 * Provider-backed definitions write through the scoped atom store; otherwise delegate exact
 * args/result to atom.write. This hook does not subscribe or take ownership; write batching and
 * failures belong to the atom.
 */
export function useSetAtom<T, Args extends readonly unknown[], Result>(
  atom: IWritableAtom<T, Args, Result>
): (...args: Args) => Result {
  const registry = useContext(StoreRegistryContext)
  const definition = atom.atomDefinition as IWritableAtomDefinition<T, Args, Result> | undefined
  return useCallback(
    (...args: Args) =>
      registry?.atomStore && definition
        ? registry.atomStore.set(definition, ...args)
        : atom.write(...args),
    [atom, definition, registry]
  )
}

/** Combine the current writable-atom value with useSetAtom's stable writer, using the same scope. */
export function useAtom<T, Args extends readonly unknown[], Result>(
  atom: IWritableAtom<T, Args, Result>
): readonly [T, (...args: Args) => Result] {
  return [useAtomValue(atom), useSetAtom(atom)] as const
}

/**
 * Read successful Resource data using React Suspense/Error Boundary semantics. Idle/pending throws
 * resource.promise; error/cancelled throws the state's error. The subscription observes only state,
 * so the Promise/error is thrown from render. The Resource remains borrowed and is not disposed.
 */
export function useResourceValue<T>(resource: Resource<T>): T {
  const state = useResource(resource)
  switch (state.status) {
    case 'success':
      return state.data
    case 'error':
    case 'cancelled':
      throw state.error
    case 'pending':
    case 'idle':
      throw resource.promise
  }
}

/**
 * Read an async atom's Resource with the same render-time Suspense/error behavior as
 * useResourceValue.
 */
export function useAsyncAtomValue<T>(atom: IAsyncAtom<T>): T {
  return useResourceValue(atom.resource)
}
