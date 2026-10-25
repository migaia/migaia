import assert from 'node:assert/strict'
import { Client } from 'pg'

/** Fixture messages identify configuration mistakes before any cleanup reaches a server. */
const PgReplicationFixtureText = {
  required: 'MIGAIA_PG_REPLICATION_URL must select the dedicated logical-decoding test service',
  separate: 'Logical-decoding tests must not use the ordinary PostgreSQL service'
} as const

/** One session lock serializes the three logical-decoding files, including the cache consumer. */
const replicationTestLock = 'migaia-storage-logical-tests'
/** Only slot names created by these three files belong to the disposable replication fixture. */
const testSlotPattern =
  '^(pg_pub_|pg_reset_|pg_block_|pg_case_|pg_startup_|pg_contract_|cache_reset_)'

/** Owns only fixture scheduling and inactive test slots on the separate PostgreSQL cluster. */
export class PgReplicationTestService {
  /**
   * Tests pass this dedicated address directly to their native clients without changing other
   * files.
   */
  readonly connectionString: string
  /** This idle session holds the advisory lock without opening a transaction or pinning a snapshot. */
  #client: Client

  /** Refuses the ordinary service before constructing the cleanup connection. */
  constructor() {
    /** The launcher resolves this address from the same compose file as the service definition. */
    const connectionString = process.env.MIGAIA_PG_REPLICATION_URL
    assert.ok(connectionString, PgReplicationFixtureText.required)
    assert.notEqual(
      new URL(connectionString).host,
      process.env.MIGAIA_PG_URL ? new URL(process.env.MIGAIA_PG_URL).host : undefined,
      PgReplicationFixtureText.separate
    )
    this.connectionString = connectionString
    this.#client = new Client({ connectionString })
  }

  /** Waits for the preceding file, then removes only inactive slots with fixture-owned prefixes. */
  async acquire(): Promise<void> {
    await this.#client.connect()
    await this.#client.query('SELECT pg_advisory_lock(hashtext($1))', [replicationTestLock])
    await this.#client.query(
      'SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE NOT active AND slot_name ~ $1',
      [testSlotPattern]
    )
  }

  /**
   * File afterAll runs after per-case host, pool and slot cleanup; closing releases the session
   * lock.
   */
  async release(): Promise<void> {
    await this.#client.end()
  }
}
