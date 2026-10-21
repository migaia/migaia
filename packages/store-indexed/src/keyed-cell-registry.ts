import type { IRuntime } from '@migaia/reactive'
import { deferRuntimeCleanup } from '@migaia/reactive/extension'

/** Small keyed container shared by collection-like reactive nodes. */
export class KeyedCellRegistry<K, C> {
  #cells = new Map<K, C>()

  get(key: K): C | undefined {
    return this.#cells.get(key)
  }
  set(key: K, cell: C): void {
    this.#cells.set(key, cell)
  }
  delete(key: K): boolean {
    return this.#cells.delete(key)
  }
  get size(): number {
    return this.#cells.size
  }
  entries(): IterableIterator<[K, C]> {
    return this.#cells.entries()
  }
  keys(): IterableIterator<K> {
    return this.#cells.keys()
  }
  clear(): void {
    this.#cells.clear()
  }
}

type ICellRegistry<K, C> = {
  get(key: K): C | undefined
  set(key: K, cell: C): void
  delete(key: K): boolean
}

/**
 * Reclaim a speculative keyed cell after the current turn. Keeping this in one place prevents
 * collection implementations from drifting on abandoned render cleanup semantics.
 */
export function scheduleLazyCellRelease<K, C>(
  runtime: IRuntime,
  registry: ICellRegistry<K, C>,
  key: K,
  cell: C,
  release: () => boolean
): void {
  deferRuntimeCleanup(runtime, () => {
    if (registry.get(key) === cell && release()) registry.delete(key)
  })
}
