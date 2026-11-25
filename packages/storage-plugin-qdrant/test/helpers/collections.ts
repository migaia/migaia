import { QdrantText } from '../../src/constants.ts'
import { fetchHttp } from '../../src/http.ts'
import { nativeId } from '../../src/id.ts'
import type { IQdrantHttp } from '../../src/types.ts'

/**
 * Test-owned Qdrant collections and managed prefixes. Every prefix or collection name allocated by
 * a live test is recorded before any network I/O and swept after each test and after each file, so
 * failed, timed-out, or interrupted tests never leave collections behind on the shared Qdrant
 * service.
 */
export class QdrantTestCollections {
  /** Unique per-run stem shared by every prefix and direct collection name from this instance. */
  readonly #runPrefix: string
  /** Logical `collectionPrefix` values allocated for managed `qdrantBackendPlugin` instances. */
  readonly #prefixes = new Set<string>()
  /** Direct physical collection names allocated or explicitly tracked by tests. */
  readonly #names = new Set<string>()

  /** Creates a collection registry with a unique per-run prefix. */
  constructor(runPrefix = 'qtest_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12) + '_') {
    this.#runPrefix = runPrefix
  }

  /** Unique per-run prefix used by every allocation on this registry. */
  get runPrefix(): string {
    return this.#runPrefix
  }

  /** Allocates a fresh `collectionPrefix` and registers it for automatic cleanup. */
  prefix(label = ''): string {
    /** Unique logical prefix for one backend plugin instance. */
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    /** Full logical collection prefix combining the per-run stem and optional label. */
    const value = label ? `${this.#runPrefix}${label}_${suffix}` : `${this.#runPrefix}${suffix}`
    this.#prefixes.add(value)
    return value
  }

  /** Allocates a fresh standalone physical collection name and registers it for cleanup. */
  collection(label = 'col'): string {
    /** Unique standalone physical collection name under this run's prefix. */
    const name = `${this.#runPrefix}${label}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    this.#names.add(name)
    return name
  }

  /** Tracks an already-chosen physical collection name for cleanup on release. */
  track(name: string): string {
    this.#names.add(name)
    return name
  }

  /**
   * Lists collections on the live Qdrant service and deletes every collection belonging to prefixes
   * or names allocated since the previous release. Continues deleting remaining owned collections
   * even if one deletion fails.
   */
  async release(url = process.env.MIGAIA_QDRANT_URL, http?: IQdrantHttp): Promise<void> {
    if (this.#prefixes.size === 0 && this.#names.size === 0) return
    /** Snapshot of logical prefixes allocated so far. */
    const prefixes = [...this.#prefixes]
    /** Snapshot of explicit physical collection names allocated so far. */
    const names = new Set(this.#names)
    this.#prefixes.clear()
    this.#names.clear()
    if (!url && !http) return
    /** Direct HTTP adapter used solely for listing and deleting test-owned collections. */
    const port = http ?? fetchHttp(url!)
    /** Physical managed prefixes matching `migaia_<nativeId([collectionPrefix])>_`. */
    const physicalPrefixes: string[] = [this.#runPrefix]
    for (const value of prefixes)
      physicalPrefixes.push(QdrantText.prefix + (await nativeId([value])) + '_')
    /** Current collections present on the target Qdrant service. */
    const listed = await port.getCollections()
    /** Subset of live server collections owned by this registry. */
    const owned: string[] = []
    for (const entry of listed.collections) {
      if (isOwnedCollection(entry.name, names, physicalPrefixes)) owned.push(entry.name)
    }
    /** Deletion failures collected so one error cannot prevent cleaning up the rest. */
    const failures: unknown[] = []
    for (const name of owned) {
      try {
        await port.deleteCollection(name)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw new AggregateError(failures, 'failed to delete one or more Qdrant test collections')
  }
}

/** Checks whether a physical collection name matches any tracked exact name or managed prefix. */
function isOwnedCollection(
  name: string,
  names: ReadonlySet<string>,
  prefixes: readonly string[]
): boolean {
  if (names.has(name)) return true
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) return true
  }
  return false
}

/** One registry per Vitest worker/file; Vitest isolates modules per test file. */
export const collections = new QdrantTestCollections()
