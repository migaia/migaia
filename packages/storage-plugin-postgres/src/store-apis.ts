// TTL, counter, record, vector, durable and journal APIs for the PostgreSQL store (see ./store.ts).
import {
  createBackendChangeIterator,
  snapshotStorageKey,
  assertTransactionOwner,
  createRecordQuery,
  snapshotStorageCounterIncrement,
  reportCleanupError
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStorageTtlDuration,
  type IRecordsApi,
  type ITtlApi,
  type ICounterApi
} from '@migaia/storage-contract'
import { createPgJournalImages, createPgJournalBinding } from './journal.js'
import { createPgVectors } from './vector.js'
import { createPgDurableApi } from './logical-replication.js'
import { readPg, writePg, pgLockKey, removePrefixPg } from './native.js'
import { PgNames, PgOperation } from './constants.js'
import { invalidArgument } from './errors.js'
import { PostgresErrorText } from './error-text.js'
import { pgOrgDeadline, createPgRecordSource } from './store-records.js'
import {
  runPgRootOperation,
  pgOrgTtlTarget,
  textKey,
  pointLocks,
  observePgOrgOperation
} from './store-state.js'
import type { IPgOrganizationContext } from './store-state.js'

/** Organization construction uses the explicit PostgreSQL organization context. */
export function createPgOrgTtlApi<T>(organization: IPgOrganizationContext<T>): ITtlApi {
  return {
    expire: (target, ms, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.ttlExpire,
        ctx,
        () => {
          const captured = pgOrgTtlTarget(organization, target)
          assertStorageTtlDuration(ms, PgNames.backend)
          return { target: captured, ms }
        },
        async (state, input) =>
          (await pgOrgDeadline(organization, state, input.target, input.ms)) as boolean
      ),
    remaining: (target, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.ttlRemaining,
        ctx,
        () => pgOrgTtlTarget(organization, target),
        async (state, input) =>
          (await pgOrgDeadline(organization, state, input)) as number | undefined
      ),
    persist: (target, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.ttlPersist,
        ctx,
        () => pgOrgTtlTarget(organization, target),
        async (state, input) =>
          (await pgOrgDeadline(organization, state, input, undefined, true)) as boolean
      )
  }
}

/** Organization construction uses the explicit PostgreSQL organization context. */
export function createPgOrgCounterApi<T>(organization: IPgOrganizationContext<T>): ICounterApi {
  return {
    increment: (key, by, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.counterIncrement,
        ctx,
        () => ({
          key: textKey(key),
          increment: snapshotStorageCounterIncrement(by, PgNames.backend)
        }),
        async (state, input) => {
          await state.guardKeys([
            pgLockKey('text', input.key),
            pgLockKey('bytes', input.key),
            pgLockKey('record', input.key)
          ])
          const result = input.increment(
            (await readPg(state, organization.environment.tables, 'text', input.key)) as
              | string
              | null
          )
          await writePg(
            state,
            organization.environment.tables,
            'text',
            input.key,
            String(result),
            'conflict'
          )
          return result
        },
        (input) => pointLocks(input.key)
      )
  }
}

/** Organization construction uses the explicit PostgreSQL organization context. */
export function createPgOrgRecordsApi<T>(organization: IPgOrganizationContext<T>): IRecordsApi<T> {
  return {
    query: <R = T>() =>
      createRecordQuery<R>(
        createPgRecordSource(organization),
        organization.environment.core.getChainMethods('query')
      ),
    removeByPrefix: (prefix, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.removeByPrefix,
        ctx,
        () =>
          /** Prefix bounds must not change between awaited native scan and deletion. */
          snapshotStorageKey(prefix, PgNames.backend),
        (state, input) => removePrefixPg(state, organization.environment.tables, 'record', input)
      )
  }
}

/** Historical managed data remains owned here even when its Feature is not selected. */
export function pgOrgVectors<T>(organization: IPgOrganizationContext<T>) {
  organization.vectors ??= createPgVectors({
    configuration: organization.environment.configuration,
    tables: organization.environment.tables,
    quantization: organization.environment.quantizedSelected(),
    orgId: organization.runtime.orgId,
    assertLive: () => organization.environment.controller.assertLive(),
    beginOperation: () => organization.environment.controller.beginMutation(),
    run: (operation, ctx, work) =>
      runPgRootOperation(
        organization,
        operation,
        ctx,
        () => ({}),
        (state) => work(state)
      ),
    methods: () => organization.environment.core.getChainMethods('vector'),
    watch: (ctx) =>
      createBackendChangeIterator(organization.environment.controller, {
        orgId: organization.runtime.orgId,
        channel: 'all',
        ctx,
        execute: (advance, context) =>
          organization.runtime.execution.run(
            { operation: PgOperation.watch, input: {}, ctx: context },
            advance
          )
      })
  })
  return organization.vectors
}

/** Each selected organization publishes only its immutable child context's actual API. */
export function createPgOrgVectorApi<T>(organization: IPgOrganizationContext<T>) {
  organization.environment.controller.assertLive()
  if (organization.environment.configuration.server === 'cockroach')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  return pgOrgVectors(organization).standard
}

/** The selected peer and native route remain under the original capability/operation owners. */
export function createPgOrgDurableApi<T>(organization: IPgOrganizationContext<T>) {
  organization.environment.controller.assertLive()
  const selection = organization.environment.replicationSelected()
  if (organization.environment.configuration.server !== 'postgres' || selection === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  organization.durableApi ??= createPgDurableApi({
    driver: organization.environment.configuration.driver,
    route: {
      schema: organization.environment.configuration.schema,
      prefix: organization.environment.configuration.prefix,
      ...(organization.orgView ? { orgId: organization.runtime.orgId } : {})
    },
    selection,
    execute: async (operation, ctx, run) => {
      organization.environment.controller.assertLive()
      const release = organization.environment.controller.beginMutation()
      try {
        return await organization.runtime.execution.run({ operation, input: {}, ctx }, () =>
          observePgOrgOperation(organization, operation, undefined, run)
        )
      } finally {
        release()
      }
    }
  })
  return organization.durableApi
}

/** Organization construction uses the explicit PostgreSQL organization context. */
export function createPgOrgJournalImages<T>(
  organization: IPgOrganizationContext<T>
): ReturnType<typeof createPgJournalImages> {
  return createPgJournalImages(organization.environment.tables, () => {
    if (!organization.environment.vectorSelected()) return undefined
    createPgOrgVectorApi(organization)
    return organization.vectors!.journal
  })
}

/** Root and explicit-default views share only the same authenticated fixed-org native facts. */
function pgOrgJournalState<T>(organization: IPgOrganizationContext<T>, scope: object) {
  const binding = organization.environment.states.get(scope)
  assertTransactionOwner(binding?.store ?? organization.store, scope)
  if (binding === undefined || binding.state.orgId !== organization.runtime.orgId)
    throw invalidArgument()
  return binding.state
}

/** Organization construction uses the explicit PostgreSQL organization context. */
export function createPgOrgJournal<T>(organization: IPgOrganizationContext<T>) {
  return createPgJournalBinding({
    orgId: organization.runtime.orgId,
    tables: organization.environment.tables,
    configuration: organization.environment.configuration,
    controller: organization.environment.controller,
    stateFor: (scope: object) => pgOrgJournalState(organization, scope),
    infoFor: (scope) => {
      pgOrgJournalState(organization, scope)
      return assertTransactionOwner(organization.environment.states.get(scope)!.store, scope)
    },
    images: organization.journalImages,
    transaction: (work) =>
      organization.engine.run(work, undefined, 'journal', undefined, false, false)
  })
}

/** Report native WAL facts through existing nonfatal diagnostics and capability observation. */
export function reportPgReplication<T>(
  organization: IPgOrganizationContext<T>,
  facts: import('./types.js').IPgReplicationHealth
): void {
  if (facts.maxSlotWalKeepSize === '-1')
    reportCleanupError(organization.environment.report, PostgresErrorText.unlimitedSlotWal)
  organization.environment.core.emit('onCapabilityProbe', () => ({
    backend: PgNames.backend,
    backendId: organization.environment.core.getBackendId(),
    orgId: organization.runtime.orgId,
    version: organization.environment.probe.version,
    isolationLevel: organization.environment.probe.isolationLevel,
    capabilities: organization.store.capabilities,
    ...facts
  }))
}
