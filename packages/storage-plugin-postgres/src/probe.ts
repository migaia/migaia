import type { IPgConfiguration } from './schema.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { PostgresErrorText } from './error-text.js'
import { PgNames } from './constants.js'
/** Installation records the actual server limits and transaction isolation without guessing by URL. */
export type IPgProbe = {
  readonly version: string
  readonly isolationLevel: string
  readonly maxIdentifierBytes: number
}
/** Only read-only environment facts precede native table creation. */
export async function probePostgres(options: IPgConfiguration): Promise<IPgProbe> {
  const row = (
    await options.driver.query(
      "SELECT version() AS version,current_setting('transaction_isolation') AS isolation,current_setting('max_identifier_length') AS identifier_limit,current_setting('standard_conforming_strings') AS strings",
      []
    )
  ).rows[0]
  const version = row?.version
  const isolationLevel = row?.isolation
  const limit = Number(row?.identifier_limit)
  const actual =
    typeof version === 'string' && version.includes('CockroachDB')
      ? 'cockroach'
      : typeof version === 'string' && /Yugabyte|YB-/i.test(version)
        ? 'yugabyte'
        : 'postgres'
  if (
    typeof version !== 'string' ||
    typeof isolationLevel !== 'string' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    row?.strings !== 'on' ||
    actual !== options.server
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend,
      cause: new TypeError(PostgresErrorText.invalidServer)
    })
  return { version, isolationLevel, maxIdentifierBytes: limit }
}
