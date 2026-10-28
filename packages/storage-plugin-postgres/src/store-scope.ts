// Transaction scope class for the PostgreSQL store (see ./store.ts).
import {
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  useTransactionCapability,
  createRecordQuery,
  snapshotStorageCounterIncrement
} from '@migaia/storage-host/sdk'
import { readTransactionConflictPolicy, assertStorageTtlDuration } from '@migaia/storage-contract'
import {
  readPg,
  writePg,
  removePg,
  pgLockKey,
  getManyPg,
  setManyPg,
  removeManyPg,
  removePrefixPg,
  type IPgState
} from './native.ts'
import { encodePgRecord, decodePgRecord } from './codec.ts'
import { PgNames, PgOperation } from './constants.ts'
import { invalidArgument } from './errors.ts'
import {
  createPgRecordIterator,
  pgOrgDeadline,
  createPgRecordSource,
  createPgOrgSql
} from './store-records.ts'
import {
  runPgScopeOperation,
  textKey,
  textValue,
  textEntries,
  ttlScope,
  pgOrgTtlTarget,
  counterScope,
  recordsScope
} from './store-state.ts'
import type { IPgScope, IPgOrganizationContext } from './store-state.ts'

/** One PostgreSQL transaction scope bound to its organization and native transaction. */
class PgScope<T> implements IPgScope<T> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #organization: IPgOrganizationContext<T>

  /** Installed by a spread in the constructor; declared so the class carries the store type. */
  declare readonly sql: IPgScope<T>['sql']

  use: IPgScope<T>['use'] = (capability) => useTransactionCapability(this, capability)

  get: IPgScope<T>['get'] = (key) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.get,
      () => textKey(key),
      (state, _current, input) =>
        readPg(state, this.#organization.environment.tables, 'text', input) as Promise<
          string | null
        >
    )

  set: IPgScope<T>['set'] = (key, value, options) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.set,
      () => ({
        key: textKey(key),
        value: textValue(value),
        policy: readTransactionConflictPolicy(options, PgNames.backend)
      }),
      (state, _current, input) =>
        writePg(
          state,
          this.#organization.environment.tables,
          'text',
          input.key,
          input.value,
          input.policy
        )
    )

  remove: IPgScope<T>['remove'] = (key) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.remove,
      () => textKey(key),
      async (state, _current, input) => {
        await removePg(state, this.#organization.environment.tables, 'text', input)
      }
    )

  has: IPgScope<T>['has'] = (key) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.has,
      () => textKey(key),
      async (state, _current, input) =>
        (await readPg(state, this.#organization.environment.tables, 'text', input)) !== null
    )

  getMany: IPgScope<T>['getMany'] = (keys) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.getMany,
      () =>
        /** Batch membership must stay fixed while native locks and revision checks await. */
        snapshotStorageBatchKeys(keys, PgNames.backend),
      (state, _current, input) => getManyPg(state, this.#organization.environment.tables, input),
      { when: (input) => input.length === 0, value: [] }
    )

  setMany: IPgScope<T>['setMany'] = (entries) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.setMany,
      () => textEntries(entries),
      (state, _current, input) => setManyPg(state, this.#organization.environment.tables, input),
      { when: (input) => input.length === 0, value: undefined }
    )

  removeMany: IPgScope<T>['removeMany'] = (keys) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.removeMany,
      () =>
        /** Batch membership must stay fixed while native locks and revision checks await. */
        snapshotStorageBatchKeys(keys, PgNames.backend),
      (state, _current, input) => removeManyPg(state, this.#organization.environment.tables, input),
      { when: (input) => input.length === 0, value: 0 }
    )

  removeByPrefix: IPgScope<T>['removeByPrefix'] = (prefix) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.removeByPrefix,
      () =>
        /** Prefix bounds must not change between awaited native scan and deletion. */
        snapshotStorageKey(prefix, PgNames.backend),
      (state, _current, input) =>
        removePrefixPg(state, this.#organization.environment.tables, 'text', input)
    )

  getBytes: IPgScope<T>['getBytes'] = (key) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.getBytes,
      () => textKey(key),
      (state, _current, input) =>
        readPg(
          state,
          this.#organization.environment.tables,
          'bytes',
          input
        ) as Promise<Uint8Array | null>
    )

  setBytes: IPgScope<T>['setBytes'] = (key, value, options) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.setBytes,
      () => {
        textKey(key)
        if (!(value instanceof Uint8Array)) throw invalidArgument()
        return {
          key,
          /** Native transaction admission and query queues may await before consuming bytes. */
          value: value.slice(),
          policy: readTransactionConflictPolicy(options, PgNames.backend)
        }
      },
      (state, _current, input) =>
        writePg(
          state,
          this.#organization.environment.tables,
          'bytes',
          input.key,
          input.value,
          input.policy
        )
    )

  removeBytes: IPgScope<T>['removeBytes'] = (key) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.removeBytes,
      () => textKey(key),
      async (state, _current, input) => {
        await removePg(state, this.#organization.environment.tables, 'bytes', input)
      }
    )

  getRecord: IPgScope<T>['getRecord'] = (key) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.getRecord,
      () =>
        /** Compound keys must stay fixed through awaited revision and native row operations. */
        snapshotStorageKey(key, PgNames.backend),
      (state, _current, input) =>
        readPg(state, this.#organization.environment.tables, 'record', input) as Promise<
          T | undefined
        >
    )

  putRecord: IPgScope<T>['putRecord'] = (value, key, options) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.putRecord,
      () => ({
        /** A supplied compound key must survive awaited native operation admission unchanged. */
        key: key === undefined ? undefined : snapshotStorageKey(key, PgNames.backend),
        value: decodePgRecord<T>(encodePgRecord(value)),
        policy: readTransactionConflictPolicy(options, PgNames.backend)
      }),
      async (state, _current, input) => {
        const key =
          input.key ??
          String(
            (await state.client.query('SELECT gen_random_uuid()::text AS key', [], state.ctx))
              .rows[0]?.key
          )
        await writePg(
          state,
          this.#organization.environment.tables,
          'record',
          key,
          input.value,
          input.policy
        )
        return key
      }
    )

  deleteRecord: IPgScope<T>['deleteRecord'] = (key) =>
    runPgScopeOperation(
      this.#organization,
      this,
      PgOperation.deleteRecord,
      () =>
        /** Compound keys must stay fixed through awaited revision and native row operations. */
        snapshotStorageKey(key, PgNames.backend),
      async (state, _current, input) => {
        await removePg(state, this.#organization.environment.tables, 'record', input)
      }
    )

  iterateRecords: IPgScope<T>['iterateRecords'] = (range) =>
    createPgRecordIterator(this.#organization, range, undefined, this);

  [ttlScope]: IPgScope<T>[typeof ttlScope] = {
    expire: (target, ms) =>
      runPgScopeOperation(
        this.#organization,
        this,
        PgOperation.ttlExpire,
        () => {
          const captured = pgOrgTtlTarget(this.#organization, target)
          assertStorageTtlDuration(ms, PgNames.backend)
          return { target: captured, ms }
        },
        async (state, _current, input) =>
          (await pgOrgDeadline(this.#organization, state, input.target, input.ms)) as boolean
      ),
    remaining: (target) =>
      runPgScopeOperation(
        this.#organization,
        this,
        PgOperation.ttlRemaining,
        () => pgOrgTtlTarget(this.#organization, target),
        async (state, _current, input) =>
          (await pgOrgDeadline(this.#organization, state, input)) as number | undefined
      ),
    persist: (target) =>
      runPgScopeOperation(
        this.#organization,
        this,
        PgOperation.ttlPersist,
        () => pgOrgTtlTarget(this.#organization, target),
        async (state, _current, input) =>
          (await pgOrgDeadline(this.#organization, state, input, undefined, true)) as boolean
      )
  };

  [counterScope]: IPgScope<T>[typeof counterScope] = {
    increment: (key, by) =>
      runPgScopeOperation(
        this.#organization,
        this,
        PgOperation.counterIncrement,
        () => ({
          key: textKey(key),
          increment: snapshotStorageCounterIncrement(by, PgNames.backend)
        }),
        async (state, _current, input) => {
          await state.guardKeys([
            pgLockKey('text', input.key),
            pgLockKey('bytes', input.key),
            pgLockKey('record', input.key)
          ])
          const result = input.increment(
            (await readPg(state, this.#organization.environment.tables, 'text', input.key)) as
              | string
              | null
          )
          await writePg(
            state,
            this.#organization.environment.tables,
            'text',
            input.key,
            String(result),
            'conflict'
          )
          return result
        }
      )
  };

  [recordsScope]: IPgScope<T>[typeof recordsScope] = {
    query: <R = T>() =>
      createRecordQuery<R, undefined>(
        createPgRecordSource(this.#organization, this),
        this.#organization.environment.core.getChainMethods('query')
      ),
    removeByPrefix: (prefix) =>
      runPgScopeOperation(
        this.#organization,
        this,
        PgOperation.removeByPrefix,
        () =>
          /** Prefix bounds must not change between awaited native scan and deletion. */
          snapshotStorageKey(prefix, PgNames.backend),
        (state, _current, input) =>
          removePrefixPg(state, this.#organization.environment.tables, 'record', input)
      )
  }

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(organization: IPgOrganizationContext<T>) {
    this.#organization = organization
    Object.assign(
      this,
      createPgOrgSql(this.#organization, () => this)
    )
  }
}

/** Complete original views are built for the user, every accepted operation and commit checks. */
export function createPgOrgScope<T>(
  organization: IPgOrganizationContext<T>,
  _state: IPgState
): IPgScope<T> {
  const scope: IPgScope<T> = new PgScope<T>(organization)
  const api = organization.orgView
    ? organization.runtime.createTransactionApi(scope)
    : organization.environment.core.createTransactionApi(scope)
  if (api !== undefined) Object.defineProperty(scope, 'api', { value: api, enumerable: true })
  return scope
}
