import { useCallback, useContext, useSyncExternalStore } from 'react'
import type { IReadableAtom, IWritableAtom } from '@migaia/store-keyed/reactive/atom'
import type { Resource } from '@migaia/resource'
import type { IWritableAtomDefinition } from '@migaia/store-keyed/atom/definition'
import { useResource } from './useStore.js'
import { useNodeValue } from './useNode.js'
import { StoreRegistryContext } from './provider-context.js'

type IAsyncAtom<T> = {
  readonly resource: Resource<T>
}

/** Subscribe to any synchronous atom with Runtime-safe dependency tracking. */
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

/** Stable writer callback; writes remain batched by writable derived atoms. */
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

export function useAtom<T, Args extends readonly unknown[], Result>(
  atom: IWritableAtom<T, Args, Result>
): readonly [T, (...args: Args) => Result] {
  return [useAtomValue(atom), useSetAtom(atom)] as const
}

/**
 * Suspense-safe Resource read. The subscription observes only the state machine; the Promise/error
 * is thrown from render, never from the scheduler's Effect callback.
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

export function useAsyncAtomValue<T>(atom: IAsyncAtom<T>): T {
  return useResourceValue(atom.resource)
}
