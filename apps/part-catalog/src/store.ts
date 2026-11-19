import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { bunSqliteDriver } from '@migaia/storage-plugin-sqlite/bun'

/** Key-value surface shared by the backend and its transactions. */
export type ICatalogKv = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  getBytes(key: string): Promise<Uint8Array | null>
  setBytes(key: string, value: Uint8Array): Promise<void>
}

/** Backend surface: key-value plus transactions. */
type ITransactionalKv = ICatalogKv & {
  transaction<T>(run: (tx: ICatalogKv) => Promise<T>): Promise<T>
}

/** Storage of the catalog: the sqlite backend plus transactions; owned by the server process. */
export class CatalogStore {
  /** Storage host owning the backend. */
  readonly #host: { dispose(): Promise<unknown> }
  /** Backend store. */
  readonly #store: ITransactionalKv

  /** Wraps an opened host and backend. */
  private constructor(host: { dispose(): Promise<unknown> }, store: unknown) {
    this.#host = host
    this.#store = store as ITransactionalKv
  }

  /** Opens `<dir>/catalog.sqlite`. */
  static async open(file: string): Promise<CatalogStore> {
    /** Storage host with the Bun sqlite backend. */
    const host = await createStorageHost({
      plugins: [sqliteBackendPlugin({ driver: bunSqliteDriver(file) })] as const
    })
    return new CatalogStore(host, host.backend('sqlite'))
  }

  /** Reads a JSON value, or `fallback` when absent. */
  async json<T>(key: string, fallback: T, kv: ICatalogKv = this.#store): Promise<T> {
    /** Stored text. */
    const text = await kv.get(key)
    return text === null ? fallback : (JSON.parse(text) as T)
  }

  /** Writes a JSON value. */
  async putJson(key: string, value: unknown, kv: ICatalogKv = this.#store): Promise<void> {
    await kv.set(key, JSON.stringify(value))
  }

  /** Reads bytes. */
  bytes(key: string): Promise<Uint8Array | null> {
    return this.#store.getBytes(key)
  }

  /** Writes bytes. */
  putBytes(key: string, value: Uint8Array, kv: ICatalogKv = this.#store): Promise<void> {
    return kv.setBytes(key, value)
  }

  /** Runs work in one storage transaction. */
  transaction<T>(run: (tx: ICatalogKv) => Promise<T>): Promise<T> {
    return this.#store.transaction(run)
  }

  /** Closes the database. */
  async close(): Promise<void> {
    await this.#host.dispose()
  }
}
