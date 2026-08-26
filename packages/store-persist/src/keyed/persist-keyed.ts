import type { IAtomStore, IWritableAtomDefinition } from '@migaia/store-keyed'
import { persistUnit } from '../core/persist-unit.js'
import type { ICodec } from '@migaia/storage-web'
import type { IPersistStorage, IPersistUnit } from '../core/types.js'
import { snapshotPersistOptions, assertPersistString } from '../core/options.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorCode } from '../error-code.js'
import { StorePersistErrorText } from '../error-text.js'

export type IPersistKeyedOptions<T> = {
  /** Storage key 前缀，格式 `${namespace}:${id}`——必填，clearFamily() 靠它过滤。 */
  namespace: string
  storage: IPersistStorage
  codec?: ICodec
  version?: number
  debounceMs?: number
  partialize?: (value: T) => Partial<T>
  merge?: (persisted: Partial<T>, current: T) => T
}

export type IPersistKeyedHandle<T> = {
  readonly value: T
  dispose(): void
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
 * 给 `AtomStore` 里某一个 key 接上持久化。`AtomStore`/`familyDef` 本身不知道"当前存在哪些 key" （刻意的设计，见 SDD
 * §3.4），所以持久化单位是"这一个 key 自己"，不是整个 family——每次调用各自 创建一个独立的 `persistUnit()` 实例，`dispose()` 只影响这一个
 * key。
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
    debounceMs: snapshot.debounceMs
  })
  return {
    value,
    dispose: () => handle.dispose()
  }
}

/**
 * 批量清空某个 namespace 下的全部持久化记录。刻意绕开 `AtomStore`——它不知道"这些 key 现在是否还 有内存中的实例"，也不负责清理内存状态；只删 storage 里以
 * `${namespace}:` 为前缀的记录。 若调用方同时持有若干个还没 dispose 的 `persistKeyed()` handle，它们各自的内存值不受影响，也不会
 * 因为存档被删掉就重新触发一次写回（下一次它们自己的 subscribe 触发时才会覆盖写回一条新记录）。
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
