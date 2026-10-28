import type { acquireIndexedDbCoordination } from './indexed-db-coordination.js'
import type { IBackendKeyLockPort } from '@migaia/storage-host/sdk'
/** Physical identity, independent of notification layout, owns one logical key-lock port. */
type IIndexedDbLockEntry = { readonly keyPort: IBackendKeyLockPort; members: number }
/** Factory identities isolate native universes; database names share their original lock domain. */
const registries = new WeakMap<object, Map<string, IIndexedDbLockEntry>>()

/** One member releases only its own borrow; the last member closes the original key-lock port. */
class IndexedDbLockMember {
  /** Original native identity and its port remain fixed until disposal. */
  readonly #entry: IIndexedDbLockEntry
  /** Registry and database name remove only the member's original physical row. */
  readonly #registry: Map<string, IIndexedDbLockEntry>
  /** Database identity is opaque native configuration, never serialized. */
  readonly #dbName: string
  /** Repeated disposal waits for one original release. */
  #disposal: Promise<void> | undefined
  readonly admitted = false
  readonly keyPort: IBackendKeyLockPort
  /** Borrow the already-selected physical lock port without opening transport or database handles. */
  constructor(
    entry: IIndexedDbLockEntry,
    registry: Map<string, IIndexedDbLockEntry>,
    dbName: string
  ) {
    this.#entry = entry
    this.#registry = registry
    this.#dbName = dbName
    this.keyPort = entry.keyPort
    entry.members += 1
  }
  /**
   * Basic stores publish no notifications; public subscription entry points reject missing
   * assembly.
   */
  publish(): void {}
  /** Close only after all baseline and notification-enabled borrowers release the physical port. */
  dispose(): Promise<void> {
    if (this.#disposal !== undefined) return this.#disposal
    this.#entry.members -= 1
    if (this.#entry.members > 0) return (this.#disposal = Promise.resolve())
    this.#registry.delete(this.#dbName)
    return (this.#disposal = this.keyPort.dispose())
  }
}

/** Acquire canonical native lock admission without importing event channels or BroadcastChannel. */
export function acquireIndexedDbLocks(
  options: Parameters<typeof acquireIndexedDbCoordination>[0]
): ReturnType<typeof acquireIndexedDbCoordination> {
  let registry = registries.get(options.factory)
  if (registry === undefined) {
    registry = new Map()
    registries.set(options.factory, registry)
  }
  let entry = registry.get(options.dbName)
  if (entry === undefined) {
    entry = { keyPort: options.createKeyLockPort(), members: 0 }
    registry.set(options.dbName, entry)
  }
  return new IndexedDbLockMember(entry, registry, options.dbName)
}
