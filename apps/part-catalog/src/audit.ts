import { createLogHost } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'
import type { IAuditRecord } from '@migaia/part-contract'
import type { CatalogStore } from './store.ts'
import { StoreKey } from './text.ts'

/** Log message tag of audit records. */
const AUDIT_MESSAGE = 'audit'

/**
 * Audit trail: records go through log-host and an output plugin appends them to the store, so audit
 * delivery shares the log host's queue and shutdown. Records never carry tokens, config values or
 * source text (callers build them from targets only).
 */
export class AuditTrail {
  /** Log host with the store output. */
  readonly #log: ReturnType<typeof createLogHost>
  /** Store holding the audit lists. */
  readonly #store: CatalogStore

  /** Creates the log host and its store output. */
  constructor(store: CatalogStore) {
    this.#store = store
    this.#log = createLogHost({
      plugins: [
        defineOutputPlugin({
          name: 'catalog-audit',
          batchable: false,
          defaultFormat: 'plain',
          deliver: (records) =>
            this.#append(records.map((record) => record.entry.args[0] as IAuditRecord))
        })
      ]
    })
  }

  /** Appends delivered records to their project lists, one read-modify-write per record. */
  async #append(records: readonly IAuditRecord[]): Promise<void> {
    for (const record of records) {
      /** Current list of the project. */
      const list = await this.#store.json<IAuditRecord[]>(StoreKey.audit(record.project), [])
      list.push(record)
      await this.#store.putJson(StoreKey.audit(record.project), list)
    }
  }

  /** Writes one record and waits until it is stored. */
  async write(record: IAuditRecord): Promise<void> {
    this.#log.log('info', AUDIT_MESSAGE, record)
    await this.#log.flush()
  }

  /** Records of a project at or after `since`, oldest first. */
  async since(project: string, since: string | undefined): Promise<IAuditRecord[]> {
    /** Every record of the project. */
    const list = await this.#store.json<IAuditRecord[]>(StoreKey.audit(project), [])
    return since === undefined ? list : list.filter((record) => record.at >= since)
  }

  /** Delivers queued records and releases the log host. */
  async close(): Promise<void> {
    await this.#log.shutdown('manual')
  }
}
