import { CacheKey } from './text.ts'

/** Byte channel of a storage-host backend the cache uses (memory in tests, IndexedDB in browsers). */
export type ICacheBackend = {
  getBytes(key: string): Promise<Uint8Array | null>
  setBytes(key: string, value: Uint8Array): Promise<void>
  removeBytes(key: string): Promise<void>
}

/** Snapshot and module byte cache of one project environment. */
export class SnapshotCache {
  /** Backend holding the bytes. */
  readonly #backend: ICacheBackend
  /** Snapshot key of this project environment. */
  readonly #key: string

  /** Binds the cache to a backend and a project environment. */
  constructor(backend: ICacheBackend, project: string, env: string) {
    this.#backend = backend
    this.#key = CacheKey.snapshot(project, env)
  }

  /** Last good snapshot bytes, or null. */
  snapshot(): Promise<Uint8Array | null> {
    return this.#backend.getBytes(this.#key)
  }

  /** Cached module bytes, or null. */
  module(id: string): Promise<Uint8Array | null> {
    return this.#backend.getBytes(CacheKey.module(id))
  }

  /**
   * Stores a good version: its snapshot bytes and new module bytes, and drops module keys the
   * previous version used that the new one does not.
   */
  async store(
    bytes: Uint8Array,
    modules: ReadonlyMap<string, Uint8Array>,
    dropped: Iterable<string>
  ): Promise<void> {
    for (const [id, value] of modules) await this.#backend.setBytes(CacheKey.module(id), value)
    await this.#backend.setBytes(this.#key, bytes)
    for (const id of dropped) await this.#backend.removeBytes(CacheKey.module(id))
  }
}
