import type { IAtomStore, IWritableAtomDefinition } from '@migaia/store-keyed'
import { persistUnit } from '../core/persist-unit.ts'
import type { ICodec } from '@migaia/storage-contract'
import type {
  IPersistHandle,
  IPersistStorage,
  IPersistUnit,
  IPersistUnitOptions
} from '../core/types.ts'
import { snapshotPersistOptions, assertPersistString } from '../core/options.ts'
import { createStorePersistTypeError } from '../errors.ts'
import { StorePersistErrorCode } from '../error-code.ts'
import { StorePersistErrorText } from '../error-text.ts'

/** Per-definition archive options; keyed persistence has no migrate callback option. */
export type IPersistKeyedOptions<T> = Pick<
  IPersistUnitOptions<T>,
  'debounceMs' | 'maxWaitMs' | 'scheduler' | 'codecStages' | 'transactionStages'
> & {
  /**
   * Required storage key prefix. Keys use `${namespace}:${id}`, and `clearFamily()` filters by the
   * prefix.
   */
  namespace: string
  /** Borrowed storage; all keys use the namespace/id string supplied by this attachment. */
  storage: IPersistStorage
  /** Complete envelope codec, default defaultJsonCodec. */
  codec?: ICodec
  /** Nonnegative safe archive version, default 0; mismatches fail without keyed migration support. */
  version?: number
  /** Synchronous write projection, default identity; does not change the AtomStore value. */
  partialize?: (value: T) => Partial<T>
  /** Synchronous reconciliation; default plain-object baseline merge, otherwise archive replacement. */
  merge?: (persisted: Partial<T>, current: T) => T
}

/** Core persistence controls plus the value observed before asynchronous hydration starts. */
export type IPersistKeyedHandle<T> = IPersistHandle & {
  /** Initial value/reference, not a live getter; use AtomStore get/peek for the current value. */
  readonly value: T
}

function storageKey(namespace: string, id: string): string {
  return `${namespace}:${id}`
}

function toPersistUnit<T>(atomStore: IAtomStore, def: IWritableAtomDefinition<T>): IPersistUnit<T> {
  return {
    snapshot: () => atomStore.peek(def),
    restore: (state) => {
      atomStore.set(def, state as never)
    },
    subscribe: (onChange) => atomStore.sub(def, onChange)
  }
}

/**
 * Persists one keyed definition in an `AtomStore`. `AtomStore` and `familyDef` do not inventory
 * currently existing keys, so the persistence unit is one key rather than a whole family. Each call
 * creates an independent `persistUnit()` instance under `${namespace}:${id}`; both components must
 * be strings. Returns the initial value alongside the original live handle controls, before
 * hydration completes. Copies options once and borrows the AtomStore Runtime; use ready/flush for
 * hydration/write outcomes. Disposal stops this attachment without deleting the archive or
 * disposing the definition, AtomStore or storage. Configuration errors throw synchronously.
 */
export function persistKeyed<T>(
  atomStore: IAtomStore,
  def: IWritableAtomDefinition<T>,
  id: string,
  options: IPersistKeyedOptions<T>
): IPersistKeyedHandle<T> {
  const snapshot = snapshotPersistOptions(options)
  assertPersistString(snapshot.namespace, 'namespace')
  assertPersistString(id, 'id')
  const value = atomStore.get(def)
  const handle = persistUnit(toPersistUnit(atomStore, def), {
    key: storageKey(snapshot.namespace, id),
    runtime: atomStore.runtime,
    storage: snapshot.storage,
    codec: snapshot.codec,
    codecStages: snapshot.codecStages,
    transactionStages: snapshot.transactionStages,
    version: snapshot.version,
    partialize: snapshot.partialize,
    merge: snapshot.merge,
    debounceMs: snapshot.debounceMs,
    maxWaitMs: snapshot.maxWaitMs,
    scheduler: snapshot.scheduler
  })
  // Extend the actual engine handle so live getters retain their original descriptors and owner.
  return Object.assign(handle, { value })
}

/**
 * Removes all persisted records whose keys start with `${namespace}:`. `AtomStore` does not
 * inventory live keyed instances or clear their memory state here.
 *
 * Enumerates keys once, removes matching keys sequentially and resolves their matched count. It is
 * not an atomic family transaction: a removal failure rejects after any earlier removals. Existing
 * handles keep their in-memory values; this function does not notify or pause them, so an already
 * scheduled or later write can recreate an archive. Invalid namespace/storage shape rejects with
 * INVALID_OPTION; adapter failures otherwise follow the adapter's boundary.
 */
export async function clearFamily(storage: IPersistStorage, namespace: string): Promise<number> {
  assertPersistString(namespace, 'namespace')
  try {
    if (
      storage === null ||
      typeof storage !== 'object' ||
      typeof storage.keys !== 'function' ||
      typeof storage.remove !== 'function'
    ) {
      throw new Error(StorePersistErrorText.storageInvalid(namespace))
    }
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.storageInvalid(namespace),
      { cause: error }
    )
  }
  const prefix = `${namespace}:`
  const allKeys = await storage.keys()
  const matching = allKeys.filter((k) => k.startsWith(prefix))
  for (const key of matching) await storage.remove(key)
  return matching.length
}
