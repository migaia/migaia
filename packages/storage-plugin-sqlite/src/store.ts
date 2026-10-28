import {
  createBackendChangeController,
  snapshotStorageKey,
  createTransactionOwner,
  snapshotConcurrencyLockRange,
  provideCapabilities,
  createRecordQuery,
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStorageKey,
  implement,
  kv,
  records,
  sql,
  ttl,
  counter,
  type IStorageKey,
  type ITransactionRecordsApi
} from '@migaia/storage-contract'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { createConcurrencyLimiter } from '@migaia/utils/promise'
import {
  SqliteNames,
  SqliteControl,
  SqliteLimits,
  SqliteOperation,
  quoteSqliteIdentifier
} from './constants.ts'
import { sqliteError, normalizeTransactionFailure, normalizeSqliteFailure } from './errors.ts'
import { SqliteErrorCode } from '@migaia/storage-contract/error-code'
import { SqliteErrorText } from './error-text.ts'
import { createSqliteStatements } from './sql.ts'
import type {
  ISqliteOptions,
  ISqliteNativeStore,
  ISqliteDriver,
  ISqliteTransactionScope
} from './types.ts'
import {
  createSqliteKeyValue,
  createSqliteRecordApi,
  createSqliteTtlApi,
  createSqliteCounterApi
} from './store-apis.ts'
import { createSqliteJournal } from './store-journal.ts'
import { sqliteRemovePrefix, sqliteClear } from './store-mutation.ts'
import { sqliteScoped, sqliteRootWrite } from './store-operation.ts'
import { SqliteOrgBase } from './store-org-base.ts'
import { sqliteTransactionIterator } from './store-scope.ts'
import {
  claimedDrivers,
  physicalGroups,
  ttlOperations,
  counterOperations,
  sqliteStatement,
  sqliteNativeFor
} from './store-state.ts'
import type {
  ISqliteOrganizationContext,
  ISqliteRuntime,
  ISqlitePhysicalState,
  ISqliteConstruction,
  ISqliteInternalScope
} from './store-state.ts'

/** Assemble the original base port table from explicit organization state. */
function createSqliteBase<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): ISqliteNativeStore<TValue> {
  return new SqliteOrgBase<TValue>(organization)
}
/** Release only this organization references after the original controller drains. */
async function disposeSqliteOrganization<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): Promise<void> {
  if (organization.shared === undefined) await organization.physicalAdmission.dispose()
  for (const dispose of organization.snapshots) await dispose()
  organization.statements.clear()
  if (organization.shared === undefined) claimedDrivers.delete(organization.driver)
  if (organization.group && --organization.group.references === 0) {
    physicalGroups.get(organization.physical)?.delete(organization.groupId)
    if (physicalGroups.get(organization.physical)?.size === 0)
      physicalGroups.delete(organization.physical)
    await organization.group.locks.dispose()
  }
}
/** Native layout probing mutates only installation facts before the organization is published. */
type ISqlitePhysicalLayout = Pick<
  ISqliteOrganizationContext<unknown>,
  | 'driver'
  | 'statements'
  | 'tables'
  | 'table'
  | 'shared'
  | 'core'
  | 'groupId'
  | 'physical'
  | 'wal'
  | 'group'
> & { readonly requestedWal: boolean | undefined }
/**
 * Probe actual physical identity and WAL, initialize fixed tables, then join the original local
 * group.
 */
function initializeSqliteLayout(layout: ISqlitePhysicalLayout): void {
  try {
    if (layout.shared === undefined) {
      /** PRAGMA database_list returns an empty main filename for an in-memory connection. */
      const main = layout.statements
        .get(SqliteControl.databases)
        .all()
        .find((row) => row.name === 'main')
      if (typeof main?.file === 'string' && main.file !== '') layout.physical = main.file
      layout.wal = layout.requestedWal ?? typeof layout.physical === 'string'
      /** OFF cannot support the package's rollback guarantee, even when WAL was disabled explicitly. */
      const current = layout.statements.get(SqliteControl.journal).get()
      if (String(current?.journal_mode).toLowerCase() === 'off')
        throw new Error(SqliteErrorText.walUnavailable)
      if (layout.wal) {
        const actual = layout.statements.get(SqliteControl.wal).get()
        if (String(actual?.journal_mode).toLowerCase() !== 'wal')
          throw new Error(SqliteErrorText.walUnavailable)
      }
      layout.driver.exec(SqliteControl.busy)
      for (const channel of [
        SqliteNames.text,
        SqliteNames.bytes,
        'record',
        SqliteNames.metadata
      ] as const) {
        /** Metadata is isolated from public-channel expiry and conflict checks. */
        const metadata = channel === SqliteNames.metadata
        layout.driver.exec(
          `CREATE TABLE IF NOT EXISTS ${layout.tables[channel]}(org_id TEXT NOT NULL,key ${channel === 'record' ? 'BLOB' : 'TEXT'} NOT NULL,value ${channel === SqliteNames.bytes ? 'BLOB' : 'TEXT'} NOT NULL${metadata ? '' : ',expires_at INTEGER'},PRIMARY KEY(org_id,key))`
        )
        if (!metadata)
          layout.driver.exec(
            `CREATE INDEX IF NOT EXISTS ${quoteSqliteIdentifier(`${layout.table}_${channel}_expiry`)} ON ${layout.tables[channel]}(org_id,expires_at,key)`
          )
      }
      layout.driver.exec(
        `CREATE TABLE IF NOT EXISTS ${layout.tables.journal}(org_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(org_id,key));CREATE TABLE IF NOT EXISTS ${layout.tables.markers}(org_id TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(org_id,key))`
      )
      if (layout.wal)
        layout.driver.exec(
          `CREATE TABLE IF NOT EXISTS ${layout.tables.locks}(org_id TEXT NOT NULL,key TEXT NOT NULL,owner TEXT NOT NULL,attempt_token TEXT NOT NULL,label TEXT,pid INTEGER,since INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(org_id,key));CREATE TABLE IF NOT EXISTS ${layout.tables.revisions}(org_id TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,birth TEXT NOT NULL DEFAULT(lower(hex(randomblob(16)))),PRIMARY KEY(org_id,key))`
        )
    }
    if (layout.shared === undefined && layout.wal) {
      /** The private row gains immutable native identity without changing prior user values. */
      const columns = layout.driver
        .prepare('PRAGMA table_info(' + layout.tables.revisions + ')')
        .all()
      if (!columns.some((column) => column.name === 'birth')) {
        layout.driver.exec(
          'ALTER TABLE ' + layout.tables.revisions + " ADD COLUMN birth TEXT NOT NULL DEFAULT ''"
        )
        layout.driver.exec(
          'UPDATE ' +
            layout.tables.revisions +
            " SET birth=lower(hex(randomblob(16))) WHERE birth=''"
        )
      }
    }
    if (!layout.wal) {
      /** Different handles to one file share logical locks; memory connections stay independent. */
      let groups = physicalGroups.get(layout.physical)
      if (!groups) {
        groups = new Map()
        physicalGroups.set(layout.physical, groups)
      }
      layout.group = groups.get(layout.groupId)
      if (!layout.group) {
        layout.group = {
          locks: layout.core.createKeyLockPort(),
          revisions: layout.core.createRevisionPort(),
          birth: crypto.randomUUID(),
          references: 0
        }
        groups.set(layout.groupId, layout.group)
      }
      layout.group.references++
    }
  } catch (cause) {
    layout.statements.clear()
    if (layout.shared === undefined) claimedDrivers.delete(layout.driver)
    throw normalizeSqliteFailure(cause)
  }
}
/** Capture deployment metadata and initialize the original native physical layout once. */
function createSqliteContext<TValue>(
  input: ISqliteOptions,
  runtime: ISqliteRuntime,
  shared?: ISqlitePhysicalState
): ISqliteOrganizationContext<TValue> {
  const {
    driver,
    table = SqliteNames.table,
    concurrency,
    owner,
    maxLockMs = SqliteLimits.maxLockMs,
    wal: requestedWal
  } = input
  const label = owner?.label
  if (
    !driver ||
    typeof driver.exec !== 'function' ||
    typeof driver.prepare !== 'function' ||
    typeof table !== 'string' ||
    !table ||
    typeof maxLockMs !== 'number' ||
    !Number.isSafeInteger(maxLockMs) ||
    maxLockMs < 1 ||
    (requestedWal !== undefined && typeof requestedWal !== 'boolean') ||
    (label !== undefined && typeof label !== 'string')
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend,
      cause: new TypeError(SqliteErrorText.invalidOptions)
    })
  if (shared === undefined && claimedDrivers.has(driver))
    throw sqliteError(SqliteErrorCode.sqliteFailed, new Error(SqliteErrorText.connectionClaimed))
  if (shared === undefined) claimedDrivers.add(driver)
  const { core } = runtime
  const journalGeneration = runtime.journalGeneration ?? { value: {} }
  const scheduler = core.featureExpose.getScheduler()
  const report = createStorageOperationReporter()
  const statements = createSqliteStatements(driver)
  const client: ISqliteDriver = shared?.client ?? {
    exec: (text: string) => driver.exec(text),
    prepare: (text: string) => driver.prepare(text)
  }
  const tables = {
    text: quoteSqliteIdentifier(`${table}_${SqliteNames.text}`),
    bytes: quoteSqliteIdentifier(`${table}_${SqliteNames.bytes}`),
    record: quoteSqliteIdentifier(`${table}_${SqliteNames.record}`),
    metadata: quoteSqliteIdentifier(`${table}_${SqliteNames.metadata}`),
    locks: quoteSqliteIdentifier(`${table}_${SqliteNames.locks}`),
    revisions: quoteSqliteIdentifier(`${table}_${SqliteNames.revisions}`),
    journal: quoteSqliteIdentifier(`${table}_${SqliteNames.journal}`),
    markers: quoteSqliteIdentifier(`${table}_${SqliteNames.markers}`)
  }
  const channelRanges = (['text', 'bytes', 'record'] as const).map((channel) => ({
    channel,
    ...snapshotConcurrencyLockRange({ channel }, SqliteNames.backend)
  }))

  const groupId = JSON.stringify([table, runtime.orgId])
  const layout: ISqlitePhysicalLayout = {
    driver,
    statements,
    tables,
    table,
    requestedWal,
    shared,
    core,
    groupId,
    physical: shared?.physical ?? driver,
    wal: shared?.wal ?? false,
    group: undefined
  }

  initializeSqliteLayout(layout)
  const { physical, wal, group } = layout
  const physicalState: ISqlitePhysicalState = shared ?? {
    admission: createConcurrencyLimiter({ concurrency: 1 }),
    client,
    physical,
    wal,
    active: undefined
  }
  const physicalAdmission = physicalState.admission
  const snapshots = new Set<() => Promise<void>>()
  const organization: ISqliteOrganizationContext<TValue> = {
    driver: driver,
    table: table,
    concurrency: concurrency,
    maxLockMs: maxLockMs,
    label: label,
    core: core,
    journalGeneration: journalGeneration,
    scheduler: scheduler,
    report: report,
    statements: statements,
    client: client,
    tables: tables,
    channelRanges: channelRanges,
    physical: physical,
    wal: wal,
    group: group,
    groupId: groupId,
    physicalState: physicalState,
    physicalAdmission: physicalAdmission,
    snapshots: snapshots,
    controller: undefined!,
    textCodec: undefined!,
    recordCodec: undefined!,
    store: undefined!,
    installer: undefined!,
    transactionOwner: undefined!,
    stages: undefined!,
    operationStages: undefined!,
    sqlStages: undefined!,
    codecStages: undefined!,
    concurrencyStages: undefined!,
    transactionStages: undefined!,
    symbolic: undefined,
    expectedToken: undefined,
    runtime: runtime,
    shared: shared
  }
  organization.controller = core.createChangeController(
    {
      backend: SqliteNames.backend,
      platform: driver,
      options: input,
      finalize: () => disposeSqliteOrganization(organization)
    },
    createBackendChangeController
  )
  organization.textCodec = defineJsonCodec({ version: 1 })
  organization.recordCodec = defineCollectionsJsonCodec({ version: 1 })
  return organization
}
/** Bind record query and prefix terminals to one canonical transaction operation view. */
function createSqliteTransactionRecordApi<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  scope: object
): ITransactionRecordsApi<TValue> {
  return {
    query: <R = TValue>() =>
      createRecordQuery<R, undefined>(
        {
          asyncDisposeKey,
          pushdown: {
            operators: [],
            operations: [],
            source: SqliteNames.backend,
            index: `${organization.table}_${SqliteNames.record}`
          },
          execute: () =>
            sqliteTransactionIterator(
              organization,
              scope as ISqliteTransactionScope<TValue>,
              undefined
            )
        },
        organization.core.getChainMethods('query')
      ),
    removeByPrefix: (prefix) =>
      sqliteScoped(
        organization,
        scope,
        SqliteOperation.removeByPrefix,
        // Operation middleware may await; retain the caller's original prefix until terminal use.
        () => ({ prefix: snapshotStorageKey(prefix, SqliteNames.backend) }),
        (state, _current, input) => {
          /** The admitted native segment has no await, so validation does not copy the key again. */
          const prefix = (input as { prefix: IStorageKey }).prefix
          assertStorageKey(prefix, SqliteNames.backend)
          return sqliteRemovePrefix(organization, 'record', prefix, state)
        }
      )
  }
}
/** Install one organization using named native jobs and the original physical state. */
export function createSqliteStore<TValue>(
  input: ISqliteOptions,
  runtime: ISqliteRuntime,
  shared?: ISqlitePhysicalState
): ISqliteConstruction<TValue> {
  const organization = createSqliteContext<TValue>(input, runtime, shared)
  const base = createSqliteBase(organization)
  const keyValue = createSqliteKeyValue(organization, base)
  const kvImplementation = implement(kv, keyValue, { forTransaction: (scope) => scope })
  const recordApi = createSqliteRecordApi(organization)
  const recordImplementation = implement(records, recordApi, {
    forTransaction: (scope) => createSqliteTransactionRecordApi(organization, scope)
  })
  const sqlImplementation = implement(
    sql,
    { sql: base.sql },
    {
      forTransaction: (scope) => ({ sql: (scope as ISqliteTransactionScope<TValue>).sql })
    }
  )
  const timeToLive = createSqliteTtlApi(organization)
  const counters = createSqliteCounterApi(organization)
  const ttlImplementation = implement(ttl, timeToLive, {
    forTransaction: (scope) => (scope as ISqliteInternalScope<TValue>)[ttlOperations]
  })
  const counterImplementation = implement(counter, counters, {
    forTransaction: (scope) => (scope as ISqliteInternalScope<TValue>)[counterOperations]
  })
  try {
    organization.store = provideCapabilities(
      base,
      [
        kvImplementation,
        recordImplementation,
        sqlImplementation,
        ttlImplementation,
        counterImplementation
      ] as const,
      {
        onInstaller: (value) => {
          organization.installer = value
        }
      }
    )
    organization.stages = organization.core.stageBindings
    organization.operationStages = organization.stages.operationStages(organization.store)
    organization.sqlStages = organization.stages.sqlStages(organization.store)
    organization.codecStages = organization.stages.codecStages(organization.store)
    organization.concurrencyStages = organization.stages.concurrencyStages(organization.store)
    organization.transactionStages = organization.stages.transactionStages(organization.store)
    organization.transactionOwner = createTransactionOwner<TValue, ISqliteTransactionScope<TValue>>(
      organization.store,
      normalizeTransactionFailure,
      {
        activityMode: 'managed',
        asyncDisposeKey,
        defaultPolicy: organization.concurrency,
        concurrencyStages: organization.concurrencyStages
      }
    )
    const journal = createSqliteJournal(organization)
    return {
      store: organization.store,
      client: organization.client,
      controller: organization.controller,
      installer: organization.installer,
      journal,
      createOrg: (orgId, orgCore) =>
        createSqliteStore<TValue>(
          {
            driver: organization.driver,
            table: organization.table,
            concurrency: organization.concurrency,
            owner: { label: organization.label },
            maxLockMs: organization.maxLockMs,
            wal: organization.wal
          },
          {
            core: orgCore,
            orgId,
            ...(orgId === organization.runtime.orgId
              ? { journalGeneration: organization.journalGeneration }
              : {})
          },
          organization.physicalState
        ),
      dropOrg: () =>
        sqliteRootWrite(organization, SqliteOperation.dropOrg, undefined, undefined, () => ({
          keys: [],
          committed: () => {
            organization.journalGeneration.value = {}
          },
          guard: { channels: ['text', 'bytes', 'record'] },
          run: (state) => {
            sqliteClear(organization, ['text', 'bytes', 'record'], state)
            for (const name of [
              'metadata',
              'journal',
              'markers',
              ...(organization.wal ? (['locks', 'revisions'] as const) : [])
            ] as const)
              sqliteStatement(
                organization,
                'DELETE FROM ' + organization.tables[name] + ' WHERE org_id=?',
                [state.orgId],
                'run',
                state
              )
          }
        })),
      getTransactionClient: (scope) => {
        sqliteNativeFor(organization, scope)
        return organization.client
      }
    }
  } catch (error) {
    void organization.controller
      .dispose()
      .catch((cleanup) => reportCleanupError(organization.report, cleanup))
    throw normalizeSqliteFailure(error)
  }
}
export type { ISqliteRuntime, ISqliteConstruction } from './store-state.ts'
