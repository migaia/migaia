// Journal namespaces and the journal port for the SQLite store (see ./store.ts).
import {
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix,
  runTransactionOperation,
  runWithConcurrency,
  ConcurrencyPolicy,
  lockKey,
  createBackendJournalNamespace,
  type IBackendJournalTransaction,
  reportCleanupError
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionScope
} from '@migaia/storage-contract'
import { base64ToBytes } from '@migaia/utils/bytes'
import type {
  IStorageJournalBackendBinding,
  IStorageJournalNamespaceView
} from '@migaia/storage-host'
import { SqliteNames } from './constants.ts'
import { sqliteError } from './errors.ts'
import { SqliteErrorCode } from '@migaia/storage-contract/error-code'
import { decodeHexKey, keyHex } from './key-codec.ts'
import type { ISqliteRow, ISqliteValue } from './types.ts'
import { sqliteRemove } from './store-io.ts'
import { sqliteTargetKey, sqliteJournalChanges, sqliteMarker } from './store-mutation.ts'
import {
  sqliteRevisionKey,
  sqliteJournalImage,
  sqliteRevision,
  sqliteCurrentRevision,
  sqliteRevisionIdentity,
  sqliteEncoded,
  sqliteChanged
} from './store-revision.ts'
import { sqliteJournalScope, sqliteStatement, sqliteLocalGroup } from './store-state.ts'
import type { ISqliteOrganizationContext, INativeState } from './store-state.ts'
import { sqliteTransact } from './store-transaction.ts'

/** One fixed namespace holds its native interval and the original memory-index generation. */
type ISqliteNamespaceContext<TValue> = {
  readonly organization: ISqliteOrganizationContext<TValue>
  readonly prefix: string
  readonly lower: string
  readonly upper: string
  readonly openedGeneration: object
  readonly exclusive: boolean
}
/** Encode one validated private journal key with the canonical key owner. */
function sqliteNamespaceKey<TValue>(
  namespace: ISqliteNamespaceContext<TValue>,
  input: unknown
): string {
  if (typeof input !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return keyHex(encodeOrderedStorageKey([namespace.prefix, input], SqliteNames.backend))
}
/** One native view retains its authentic scope and fixed namespace without shared lexical state. */
class SqliteJournalNamespaceView<TValue> implements IStorageJournalNamespaceView {
  /** Native interval and original resource validity belong to the namespace context. */
  readonly #namespace: ISqliteNamespaceContext<TValue>
  /** All I/O authenticates this original transaction scope at the existing owner. */
  readonly #scope: Omit<ITransactionScope, 'use'>
  /** Bind one private view without opening another transaction or resource owner. */
  constructor(namespace: ISqliteNamespaceContext<TValue>, scope: Omit<ITransactionScope, 'use'>) {
    this.#namespace = namespace
    this.#scope = scope
  }
  /** Admit one private native operation through the original transaction scope. */
  #execute<R>(invoke: (state: INativeState) => R): Promise<Awaited<R>> {
    return runTransactionOperation(this.#scope, () =>
      invoke(sqliteJournalScope(this.#namespace.organization, this.#scope).state)
    )
  }
  /** Clear only this namespace's original ordered key interval. */
  #clear() {
    return this.#execute((state) => {
      sqliteStatement(
        this.#namespace.organization,
        'DELETE FROM ' +
          this.#namespace.organization.tables.journal +
          ' WHERE org_id=? AND key>=? AND key<?',
        [state.orgId, this.#namespace.lower, this.#namespace.upper],
        'run',
        state
      )
    })
  }
  /** Native get retains the existing codec, scope admission and row semantics. */
  readonly get: IStorageJournalNamespaceView['get'] = (key: string) =>
    this.#execute((state) => {
      const row = sqliteStatement<TValue, ISqliteRow | undefined>(
        this.#namespace.organization,
        'SELECT value FROM ' +
          this.#namespace.organization.tables.journal +
          ' WHERE org_id=? AND key=?',
        [state.orgId, this.#key(key)],
        'get',
        state
      )
      if (row === undefined) return null
      try {
        const value = this.#namespace.organization.textCodec.decode(row.value as string)
        if (typeof value !== 'string') throw sqliteError(SqliteErrorCode.decodeFailed)
        return value
      } catch (cause) {
        throw sqliteError(SqliteErrorCode.decodeFailed, cause)
      }
    })
  /** Native has retains the existing codec, scope admission and row semantics. */
  readonly has: IStorageJournalNamespaceView['has'] = (key: string) =>
    this.#execute(
      (state) =>
        sqliteStatement<TValue, ISqliteRow | undefined>(
          this.#namespace.organization,
          'SELECT key FROM ' +
            this.#namespace.organization.tables.journal +
            ' WHERE org_id=? AND key=?',
          [state.orgId, this.#key(key)],
          'get',
          state
        ) !== undefined
    )
  /** Native set retains the existing codec, scope admission and row semantics. */
  readonly set: IStorageJournalNamespaceView['set'] = (key: string, value: string) =>
    this.#execute((state) => {
      if (typeof value !== 'string')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      sqliteStatement(
        this.#namespace.organization,
        'INSERT INTO ' +
          this.#namespace.organization.tables.journal +
          '(org_id,key,value) VALUES(?,?,?) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value',
        [state.orgId, this.#key(key), this.#namespace.organization.textCodec.encode(value)],
        'run',
        state
      )
    })
  /** Native remove retains the existing codec, scope admission and row semantics. */
  readonly remove: IStorageJournalNamespaceView['remove'] = (key: string) =>
    this.#execute((state) => {
      sqliteStatement(
        this.#namespace.organization,
        'DELETE FROM ' + this.#namespace.organization.tables.journal + ' WHERE org_id=? AND key=?',
        [state.orgId, this.#key(key)],
        'run',
        state
      )
    })
  /** Native keys retains the existing codec, scope admission and row semantics. */
  readonly keys: IStorageJournalNamespaceView['keys'] = () =>
    this.#execute((state) =>
      sqliteStatement<TValue, readonly ISqliteRow[]>(
        this.#namespace.organization,
        'SELECT key FROM ' +
          this.#namespace.organization.tables.journal +
          ' WHERE org_id=? AND key>=? AND key<? ORDER BY key',
        [state.orgId, this.#namespace.lower, this.#namespace.upper],
        'all',
        state
      ).map((row) => {
        const key = decodeHexKey(row.key as string)
        if (
          !Array.isArray(key) ||
          key.length !== 2 ||
          key[0] !== this.#namespace.prefix ||
          typeof key[1] !== 'string'
        )
          throw sqliteError(SqliteErrorCode.decodeFailed)
        return key[1]
      })
    )
  /** Both clear ports retain the original same native callback. */
  readonly clearValues: IStorageJournalNamespaceView['clearValues'] = () => this.#clear()
  /** Keep the original clear callback identity. */
  readonly clearAll = this.clearValues
  /** Bound key encoding never reads mutable native or host state. */
  #key(input: unknown): string {
    return sqliteNamespaceKey(this.#namespace, input)
  }
}
/** Project only the original native terminal sets and authentic short-lived view. */
function sqliteNamespaceProject<TValue>(
  namespace: ISqliteNamespaceContext<TValue>,
  scope: Omit<ITransactionScope, 'use'>
): IBackendJournalTransaction {
  const terminal = sqliteJournalScope(namespace.organization, scope).terminal
  const listen = (effects: Set<() => void>, effect: () => void) => {
    effects.add(effect)
    return () => {
      effects.delete(effect)
    }
  }
  return {
    run: (work) => work(new SqliteJournalNamespaceView(namespace, scope)),
    onCommit: (effect) => listen(terminal.committed, effect),
    onRollback: (effect) => listen(terminal.rolledBack, effect),
    onEnd: (effect) => listen(terminal.ended, effect)
  }
}
/** Open one native namespace through the existing canonical journal resource owner. */
async function sqliteOpenJournalNamespace<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  prefix: string
): Promise<import('@migaia/storage-host').IStorageJournalNamespace> {
  organization.controller.assertLive()
  if (typeof prefix !== 'string' || prefix.length === 0)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  const bounds = snapshotStorageKeyPrefix([prefix], SqliteNames.backend)
  const namespace: ISqliteNamespaceContext<TValue> = {
    organization,
    prefix,
    lower: keyHex(bounds.lower),
    upper: keyHex(bounds.upper),
    openedGeneration: organization.journalGeneration.value,
    exclusive: !organization.wal && typeof organization.physical !== 'string'
  }
  return createBackendJournalNamespace({
    assertLive: () => {
      organization.controller.assertLive()
      if (
        !organization.wal &&
        typeof organization.physical !== 'string' &&
        namespace.openedGeneration !== organization.journalGeneration.value
      )
        throw new StorageContractError(StorageContractErrorCode.disposed, {
          backend: SqliteNames.backend
        })
    },
    closingSignal: organization.controller.closingSignal,
    report: (error) => reportCleanupError(organization.report, error),
    /** Only this caller-owned memory connection has reliable lifetime exclusivity. */
    nativeAtomic: true,
    ...(namespace.exclusive ? {} : { indexExclusive: false as const }),
    backend: SqliteNames.backend,
    reserve: (hold) =>
      !namespace.exclusive
        ? hold()
        : runWithConcurrency(
            {
              store: organization.store,
              options: { lock: [lockKey.record([SqliteNames.journalOwner, namespace.prefix])] },
              policy: ConcurrencyPolicy.fail()
            },
            {
              attempt: (context) =>
                sqliteLocalGroup(organization, organization.runtime.orgId).locks.attemptMetadata(
                  context,
                  {
                    owner: organization.controller.origin,
                    since: Date.now(),
                    status: 'held',
                    scope: 'local'
                  },
                  {
                    attempt: async () => {
                      await hold()
                      return { status: 'committed', value: undefined }
                    }
                  },
                  organization.concurrencyStages,
                  organization.controller.closingSignal
                )
            }
          ),
    authenticate: (scope) => ({
      info: sqliteJournalScope(organization, scope).info,
      port: sqliteNamespaceProject(namespace, scope)
    }),
    transaction: (work) =>
      sqliteTransact(
        organization,
        (scope) => work(sqliteNamespaceProject(namespace, scope)),
        {},
        false
      )
  })
}
/** Private journal I/O borrows original organization scopes and native rows. */
export function createSqliteJournal<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): Omit<IStorageJournalBackendBinding, 'forOrg'> {
  return {
    externalWal: true,
    lockTarget: (target) => {
      const { channel, key } = sqliteTargetKey(organization, target)
      return sqliteRevisionKey(organization, channel, key)
    },
    changes: (scope) =>
      sqliteJournalChanges(organization, sqliteJournalScope(organization, scope).state),
    readImage: (scope, target) =>
      runTransactionOperation(scope, () => {
        const state = sqliteJournalScope(organization, scope).state
        const { channel, key } = sqliteTargetKey(organization, target)
        return Promise.resolve(sqliteJournalImage(organization, state, channel, key))
      }),
    readRevision: (scope, target) =>
      runTransactionOperation(scope, () => {
        const state = sqliteJournalScope(organization, scope).state
        const { channel, key } = sqliteTargetKey(organization, target)
        sqliteRevision(organization, state, channel, key)
        const current = sqliteCurrentRevision(
          organization,
          state,
          channel,
          sqliteRevisionIdentity(organization, channel, key)
        )
        return Promise.resolve({ birth: current.birth ?? null, version: current.version })
      }),
    writeImage: (scope, target, image) =>
      runTransactionOperation(scope, () => {
        const state = sqliteJournalScope(organization, scope).state
        const { channel, key } = sqliteTargetKey(organization, target)
        sqliteRevision(organization, state, channel, key)
        if (!image.present) {
          sqliteRemove(organization, channel, key, state)
          return Promise.resolve()
        }
        const payload = organization.recordCodec.decode(image.value)
        if (
          payload === null ||
          typeof payload !== 'object' ||
          Array.isArray(payload) ||
          !('value' in payload) ||
          !('deadline' in payload) ||
          !('version' in payload) ||
          payload.version !== 1 ||
          !('channel' in payload) ||
          payload.channel !== channel
        )
          throw sqliteError(SqliteErrorCode.decodeFailed)
        const { value, deadline } = payload
        if (
          typeof value !== 'string' ||
          (deadline !== null && (typeof deadline !== 'number' || !Number.isFinite(deadline))) ||
          (channel === 'metadata' && deadline !== null)
        )
          throw sqliteError(SqliteErrorCode.decodeFailed)
        sqliteStatement(
          organization,
          'INSERT INTO ' +
            organization.tables[channel] +
            '(org_id,key,value' +
            (channel === 'metadata' ? '' : ',expires_at') +
            ') VALUES(?,?,?' +
            (channel === 'metadata' ? '' : ',?') +
            ') ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value' +
            (channel === 'metadata' ? '' : ',expires_at=excluded.expires_at'),
          [
            state.orgId,
            sqliteEncoded(organization, channel, key),
            channel === 'bytes' ? base64ToBytes(value) : value,
            ...(channel === 'metadata' ? [] : [deadline as ISqliteValue])
          ],
          'run',
          state
        )
        sqliteChanged(organization, state, channel, key)
        return Promise.resolve()
      }),
    writeCommitMarker: (scope, txId) =>
      runTransactionOperation(scope, () => {
        const current = sqliteJournalScope(organization, scope)
        if (current.info.id !== txId)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        sqliteStatement(
          organization,
          'INSERT INTO ' +
            organization.tables.markers +
            '(org_id,key) VALUES(?,?) ON CONFLICT(org_id,key) DO NOTHING',
          [current.state.orgId, txId],
          'run',
          current.state
        )
        return Promise.resolve()
      }),
    hasCommitMarker: (txId) =>
      sqliteMarker(
        organization,
        txId,
        (state) =>
          sqliteStatement<TValue, ISqliteRow | undefined>(
            organization,
            'SELECT key FROM ' + organization.tables.markers + ' WHERE org_id=? AND key=?',
            [state.orgId, txId],
            'get',
            state
          ) !== undefined
      ),
    removeCommitMarker: (txId) =>
      sqliteMarker(organization, txId, (state) => {
        sqliteStatement(
          organization,
          'DELETE FROM ' + organization.tables.markers + ' WHERE org_id=? AND key=?',
          [state.orgId, txId],
          'run',
          state
        )
      }),
    openNamespace: async (prefix) => sqliteOpenJournalNamespace(organization, prefix)
  }
}
