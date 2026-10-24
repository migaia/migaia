import type { IPgDriver, IPgServer, IPostgresOptions } from './types.js'
import { PgNames } from './constants.js'
import { quotePgIdentifier } from './copy-command.js'
import { capture, invalidArgument } from './errors.js'
import { PostgresErrorText } from './error-text.js'
/** Captured configuration contains no mutable caller getters after the plugin factory returns. */
export type IPgConfiguration = {
  readonly driver: IPgDriver
  readonly server: IPgServer
  readonly schema: string
  readonly prefix: string
  readonly concurrency: IPostgresOptions['concurrency']
  readonly label: string | undefined
  readonly maxLockMs: number
}
/** Capture public configuration before any native connection or DDL is allowed. */
export function snapshotPostgresOptions(input: IPostgresOptions<IPgServer>): IPgConfiguration {
  return capture(() => {
    const {
      driver,
      server = PgNames.backend,
      schema = PgNames.schema,
      prefix = PgNames.prefix,
      concurrency,
      owner,
      maxLockMs = 60000
    } = input
    const label = owner?.label
    if (
      driver === null ||
      typeof driver !== 'object' ||
      typeof driver.query !== 'function' ||
      typeof driver.connect !== 'function' ||
      (server !== 'postgres' && server !== 'cockroach' && server !== 'yugabyte') ||
      typeof schema !== 'string' ||
      typeof prefix !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      prefix.includes('\0') ||
      !schema.isWellFormed() ||
      !prefix.isWellFormed() ||
      (label !== undefined && typeof label !== 'string') ||
      !Number.isSafeInteger(maxLockMs) ||
      maxLockMs < 1
    )
      throw invalidArgument(new TypeError(PostgresErrorText.invalidOptions))
    return Object.freeze({ driver, server, schema, prefix, concurrency, label, maxLockMs })
  })
}
/** These finite physical table names are quoted once, after native identifier-limit admission. */
export function postgresTables(options: IPgConfiguration, maxIdentifierBytes: number) {
  const names = {
    text: PgNames.text,
    bytes: PgNames.bytes,
    record: PgNames.record,
    metadata: PgNames.metadata,
    revisions: PgNames.revisions,
    locks: PgNames.locks,
    journal: PgNames.journal,
    markers: PgNames.markers,
    vectorConfiguration: PgNames.vectorConfiguration
  }
  const result = Object.create(null) as { [K in keyof typeof names]: string }
  if (new TextEncoder().encode(options.schema).length > maxIdentifierBytes)
    throw invalidArgument(new TypeError(PostgresErrorText.invalidIdentifier))
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    const name = options.prefix + '_' + names[key]
    if (new TextEncoder().encode(name).length > maxIdentifierBytes)
      throw invalidArgument(new TypeError(PostgresErrorText.invalidIdentifier))
    result[key] = quotePgIdentifier(options.schema) + '.' + quotePgIdentifier(name)
  }
  return Object.freeze(result)
}
/** One admitted physical layout is reused by every bound organization and transaction. */
export type IPgTables = ReturnType<typeof postgresTables>
/** All native storage tables share one fixed layout, with org_id leading every key and index. */
export async function ensurePostgresTables(
  options: IPgConfiguration,
  tables: ReturnType<typeof postgresTables>
): Promise<void> {
  const driver = options.driver
  for (const [name, keyType, valueType, expiry] of [
    [tables.text, 'text', 'text', true],
    [tables.bytes, 'text', 'bytea', true],
    [tables.record, 'bytea', 'text', true],
    [tables.metadata, 'text', 'text', false],
    [tables.journal, 'text', 'text', false],
    [tables.markers, 'text', 'text', false],
    [tables.vectorConfiguration, 'text', 'text', false]
  ] as const) {
    await driver.query(
      'CREATE TABLE IF NOT EXISTS ' +
        name +
        ' (org_id TEXT NOT NULL,key ' +
        keyType +
        (keyType === 'text' ? ' COLLATE "C"' : '') +
        ' NOT NULL,value ' +
        valueType +
        ' NOT NULL' +
        (expiry ? ',expires_at timestamptz' : '') +
        ',PRIMARY KEY(org_id,key))',
      []
    )
  }
  await driver.query(
    'CREATE TABLE IF NOT EXISTS ' +
      tables.revisions +
      ' (org_id TEXT NOT NULL,key TEXT COLLATE "C" NOT NULL,version bigint NOT NULL,birth uuid NOT NULL DEFAULT gen_random_uuid(),PRIMARY KEY(org_id,key))',
    []
  )
  // Existing private revision rows acquire their own immutable birth without changing user data.
  await driver.query(
    'ALTER TABLE ' +
      tables.revisions +
      ' ADD COLUMN IF NOT EXISTS birth uuid NOT NULL DEFAULT gen_random_uuid()',
    []
  )
  await driver.query(
    'CREATE TABLE IF NOT EXISTS ' +
      tables.locks +
      ' (org_id TEXT NOT NULL,key TEXT COLLATE "C" NOT NULL,owner TEXT NOT NULL,attempt_token TEXT NOT NULL,label TEXT,pid integer NOT NULL,since double precision NOT NULL,expires_at double precision NOT NULL,PRIMARY KEY(org_id,key))',
    []
  )
  for (const [suffix, table] of [
    [PgNames.text, tables.text],
    [PgNames.bytes, tables.bytes],
    [PgNames.record, tables.record]
  ] as const) {
    const index = quotePgIdentifier(options.prefix + '_' + suffix + '_expiry')
    await driver.query(
      'CREATE INDEX IF NOT EXISTS ' + index + ' ON ' + table + ' (org_id,expires_at)',
      []
    )
  }
}
