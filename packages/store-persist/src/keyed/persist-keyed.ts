import type { IAtomStore, IWritableAtomDefinition } from '@migaia/store-keyed'
import { persistUnit } from '../core/persist-unit.js'
import type { ICodec } from '@migaia/storage-contract'
import type {
  IPersistHandle,
  IPersistStorage,
  IPersistUnit,
  IPersistUnitOptions
} from '../core/types.js'
import { snapshotPersistOptions, assertPersistString } from '../core/options.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorCode } from '../error-code.js'
import { StorePersistErrorText } from '../error-text.js'

export type IPersistKeyedOptions<T> = Pick<
  IPersistUnitOptions<T>,
  'debounceMs' | 'maxWaitMs' | 'scheduler'
> & {
  /**
   * Required storage key prefix. Keys use `${namespace}:${id}`, and `clearFamily()` filters by the
   * prefix.
   */
  namespace: string
  storage: IPersistStorage
  codec?: ICodec
  version?: number
  partialize?: (value: T) => Partial<T>
  merge?: (persisted: Partial<T>, current: T) => T
}

export type IPersistKeyedHandle<T> = IPersistHandle & {
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
 * currently existing keys, so the persistence unit is one key rather than a whole family (SDD
 * §3.4). Each call creates an independent `persistUnit()` instance. Disposal affects only that
 * key.
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
 * Existing `persistKeyed()` handles keep their in-memory values after removal. Removing records
 * does not trigger a write. Their next change notification writes a new record.
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
