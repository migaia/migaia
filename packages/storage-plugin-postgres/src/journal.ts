import {
  StorageContractError,
  StorageContractErrorCode,
  runTransactionOperation,
  snapshotStorageKeyPrefix,
  type IStorageKey,
  type ITransactionScope,
  type ITransactionInfo
} from '@migaia/storage-contract'
import type {
  IStorageJournalNamespace,
  IStorageJournalNamespaceView,
  IStorageJournalImage,
  IStorageJournalTarget,
  IStorageJournalChange,
  IStorageJournalBackendBinding
} from '@migaia/storage-host'
import type { IBackendChangeController } from '@migaia/storage-host/authoring/backend'
import { pgResource } from './driver-resource.js'
import { pgKey, pgKeyHex, pgRecordKey, pgTextKey, encodePgRecord, decodePgRecord } from './codec.js'
import {
  pgIdentity,
  pgLockKey,
  observePgRevision,
  markPgChanged,
  type IPgState,
  type IPgMutationChannel
} from './native.js'
import type { IPgConfiguration, IPgTables } from './schema.js'
import { invalidArgument, postgresError } from './errors.js'
import { PostgresErrorCode } from './error-code.js'
import { PgNames } from './constants.js'
import { deferred } from '@migaia/utils/promise'
import { base64ToBytes, bytesToBase64 } from '@migaia/utils/bytes'
import {
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
/** The image keeps exact original native wire values and absolute PostgreSQL deadlines. */
export type IPgJournalWire = Readonly<{
  version: 1
  channel: IPgMutationChannel
  value: string | Uint8Array
  expiresAt: string | null
  payload?: string | null
  projection?: string | null
}>
/** Native vector columns remain owned by their original collection implementation. */
export type IPgJournalVectorPort = {
  read(
    state: IPgState,
    collection: string,
    ids: readonly string[]
  ): Promise<ReadonlyMap<string, IStorageJournalImage>>
  write(state: IPgState, collection: string, id: string, image: IStorageJournalImage): Promise<void>
}
/** The original attempt stores first images and its final physical changes, never history. */
export type IPgJournalCapture = {
  capture(channel: IPgMutationChannel, keys: readonly IStorageKey[]): Promise<void>
  finalize(): Promise<void>
  changes(): readonly IStorageJournalChange[]
}
/** One backend image uses the existing collections codec, including exact bytea values. */
export function encodePgJournalImage(wire: IPgJournalWire): IStorageJournalImage {
  return Object.freeze({
    present: true,
    value: encodePgRecord({
      ...wire,
      value: wire.value instanceof Uint8Array ? bytesToBase64(wire.value) : wire.value
    })
  })
}
/** Persisted image admission verifies the same native channel before restoration changes data. */
export function decodePgJournalImage(
  image: Extract<IStorageJournalImage, { present: true }>,
  channel: IPgMutationChannel
): IPgJournalWire {
  const wire = decodePgRecord(image.value)
  if (
    wire === null ||
    typeof wire !== 'object' ||
    !('version' in wire) ||
    wire.version !== 1 ||
    !('channel' in wire) ||
    wire.channel !== channel ||
    !('value' in wire) ||
    typeof wire.value !== 'string' ||
    !('expiresAt' in wire) ||
    !(wire.expiresAt === null || typeof wire.expiresAt === 'string')
  )
    throw postgresError(PostgresErrorCode.decodeFailed)
  if (channel === 'vector') {
    if (
      typeof wire.value !== 'string' ||
      !('payload' in wire) ||
      !(wire.payload === null || typeof wire.payload === 'string') ||
      !('projection' in wire) ||
      !(wire.projection === null || typeof wire.projection === 'string')
    )
      throw postgresError(PostgresErrorCode.decodeFailed)
    return {
      version: 1,
      channel,
      value: wire.value,
      expiresAt: wire.expiresAt,
      payload: wire.payload,
      projection: wire.projection
    }
  }
  try {
    return {
      version: 1,
      channel,
      value: channel === 'bytes' ? base64ToBytes(wire.value) : wire.value,
      expiresAt: wire.expiresAt
    }
  } catch (cause) {
    throw postgresError(PostgresErrorCode.decodeFailed, cause)
  }
}
/** Metadata has a separate private target domain; every business channel uses original lock keys. */
function targetFor(channel: IPgMutationChannel, key: IStorageKey): IStorageJournalTarget {
  if (channel === 'metadata') {
    if (typeof key !== 'string') throw invalidArgument()
    return { channel, key }
  }
  return pgLockKey(channel, key)
}
/** Original vector lock targets carry a tuple only inside native row helpers. */
function keyFor(target: IStorageJournalTarget): IStorageKey {
  if (target.channel === 'rdf')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  return target.channel === 'vector' ? [target.collection, target.id] : target.key
}
/** All fixed-table images are read in one native array query per channel. */
export function createPgJournalImages(
  tables: IPgTables,
  vectors: () => IPgJournalVectorPort | undefined
) {
  const read = async (
    state: IPgState,
    channel: IPgMutationChannel,
    keys: readonly IStorageKey[]
  ): Promise<ReadonlyMap<string, IStorageJournalImage>> => {
    const result = new Map<string, IStorageJournalImage>()
    for (const key of keys) result.set(pgKey(key).hex, { present: false })
    if (keys.length === 0) return result
    if (channel === 'vector') {
      const groups = new Map<string, string[]>()
      for (const key of keys) {
        const target = pgLockKey('vector', key)
        if (target.channel !== 'vector') throw invalidArgument()
        const ids = groups.get(target.collection) ?? []
        ids.push(target.id)
        groups.set(target.collection, ids)
      }
      const port = vectors()
      if (port === undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: PgNames.backend
        })
      for (const [collection, ids] of groups)
        for (const [id, image] of await port.read(state, collection, ids))
          result.set(pgKey([collection, id]).hex, image)
      return result
    }
    const rows = (
      await state.client.query(
        'SELECT key,value' +
          (channel === 'metadata' ? '' : ',expires_at::text AS deadline') +
          ' FROM ' +
          tables[channel] +
          ' WHERE org_id=$1 AND ' +
          (channel === 'record'
            ? "key=ANY(ARRAY(SELECT decode(item,'hex') FROM unnest($2::text[]) AS item))"
            : 'key=ANY($2::text[])'),
        [state.orgId, { arrayType: 'text', values: keys.map((key) => pgKey(key).hex) }],
        state.ctx
      )
    ).rows
    for (const row of rows) {
      const key = channel === 'record' ? pgKey(pgRecordKey(row.key)).hex : row.key
      if (
        typeof key !== 'string' ||
        !(typeof row.value === 'string' || row.value instanceof Uint8Array) ||
        (channel !== 'metadata' && row.deadline !== null && typeof row.deadline !== 'string')
      )
        throw postgresError(PostgresErrorCode.decodeFailed)
      result.set(
        key,
        encodePgJournalImage({
          version: 1,
          channel,
          value: row.value,
          expiresAt: channel === 'metadata' ? null : (row.deadline as string | null)
        })
      )
    }
    return result
  }
  return {
    read,
    capture(state: IPgState): IPgJournalCapture {
      const before = new Map<
        string,
        { target: IStorageJournalTarget; image: IStorageJournalImage }
      >()
      let changes: readonly IStorageJournalChange[] = []
      return {
        capture: async (channel, keys) => {
          const missing = keys.filter((key) => !before.has(channel + ':' + pgKey(key).hex))
          const images = await read(state, channel, missing)
          for (const key of missing)
            before.set(channel + ':' + pgKey(key).hex, {
              target: targetFor(channel, key),
              image: images.get(pgKey(key).hex)!
            })
        },
        finalize: async () => {
          const final: IStorageJournalChange[] = []
          for (const [channel, changed] of state.changed) {
            const images = await read(state, channel, [...changed.values()])
            for (const [id, key] of changed) {
              const initial = before.get(channel + ':' + id)
              if (initial === undefined) throw postgresError(PostgresErrorCode.decodeFailed)
              final.push({
                target: initial.target,
                before: initial.image,
                after: images.get(id)!,
                afterRevision:
                  channel === 'metadata'
                    ? null
                    : String((state.baseline.get(pgIdentity(channel, key)) ?? 0n) + 1n)
              })
            }
          }
          changes = Object.freeze(final)
        },
        changes: () => changes
      }
    },
    readImage: async (state: IPgState, target: IStorageJournalTarget) => {
      const key = keyFor(target)
      if (target.channel === 'rdf') throw invalidArgument()
      return (await read(state, target.channel, [key])).get(pgKey(key).hex)!
    },
    writeImage: async (
      state: IPgState,
      target: IStorageJournalTarget,
      image: IStorageJournalImage
    ) => {
      const key = keyFor(target)
      if (target.channel === 'rdf') throw invalidArgument()
      if (target.channel === 'vector') {
        const port = vectors()
        if (port === undefined)
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: PgNames.backend
          })
        return port.write(state, target.collection, target.id, image)
      }
      const channel = target.channel
      const wire = image.present ? decodePgJournalImage(image, channel) : undefined
      await observePgRevision(state, tables, channel, key)
      if (channel !== 'metadata') await state.guardKeys([pgLockKey(channel, key)])
      const nativeKey = channel === 'record' ? pgKey(key).bytes : pgKey(key).hex
      if (wire === undefined) {
        const removed = await state.client.query(
          'DELETE FROM ' + tables[channel] + ' WHERE org_id=$1 AND key=$2',
          [state.orgId, nativeKey],
          state.ctx
        )
        if (removed.rowCount === 0) return
      } else
        await state.client.query(
          'INSERT INTO ' +
            tables[channel] +
            ' (org_id,key,value' +
            (channel === 'metadata' ? '' : ',expires_at') +
            ') VALUES($1,$2,$3' +
            (channel === 'metadata' ? '' : ',$4::timestamptz') +
            ') ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value' +
            (channel === 'metadata' ? '' : ',expires_at=excluded.expires_at'),
          [state.orgId, nativeKey, wire.value, ...(channel === 'metadata' ? [] : [wire.expiresAt])],
          state.ctx
        )
      markPgChanged(state, channel, key)
    }
  }
}
/** Private journal I/O borrows only original native scopes and never recursively prepares a journal. */
export function createPgJournalBinding(options: {
  readonly orgId: string
  readonly tables: IPgTables
  readonly configuration: IPgConfiguration
  readonly controller: IBackendChangeController
  readonly stateFor: (scope: object) => IPgState
  readonly infoFor: (scope: object) => ITransactionInfo
  readonly transaction: <R>(
    work: (scope: Omit<ITransactionScope, 'use'>) => Promise<R>
  ) => Promise<R>
  readonly images: ReturnType<typeof createPgJournalImages>
}): Omit<IStorageJournalBackendBinding, 'forOrg'> {
  const { orgId, tables, controller, stateFor, images } = options
  const authenticate = (scope: Omit<ITransactionScope, 'use'>) => {
    return stateFor(scope)
  }
  return {
    externalWal: true,
    openNamespace: async (prefix): Promise<IStorageJournalNamespace> => {
      controller.assertLive()
      if (typeof prefix !== 'string' || prefix.length === 0) throw invalidArgument()
      const resource = pgResource(async () => {})
      /** The original key owner bounds this one private namespace in the existing primary key. */
      const range = snapshotStorageKeyPrefix([prefix], PgNames.backend)
      const params = [orgId, pgKeyHex(range.lower), pgKeyHex(range.upper)] as const
      /** Each authentic native terminal retains the original namespace resource once. */
      const attempts = new Set<string>()
      const scopeState = (scope: Omit<ITransactionScope, 'use'>) => {
        resource.assertLive()
        const state = authenticate(scope)
        const id = options.infoFor(scope).id
        if (!attempts.has(id)) {
          attempts.add(id)
          const ended = deferred<void>()
          const finish = () => {
            attempts.delete(id)
            ended.resolve()
          }
          state.terminal.ended.add(finish)
          void resource
            .run(() => ended.promise)
            .catch((error) => reportCleanupError(createStorageOperationReporter(), error))
        }
        return state
      }
      const run = <R>(
        work: (view: IStorageJournalNamespaceView) => Promise<R>,
        scope?: Omit<ITransactionScope, 'use'>
      ): Promise<R> =>
        resource.run(async () => {
          if (typeof work !== 'function') throw invalidArgument()
          const invoke = async (current: Omit<ITransactionScope, 'use'>) => {
            const execute = <R>(query: (state: IPgState) => Promise<R>) =>
              runTransactionOperation(current, () => query(scopeState(current)))
            const key = (input: unknown): string => {
              if (typeof input !== 'string') throw invalidArgument()
              return pgKey([prefix, input]).hex
            }
            const clear = () =>
              execute(async (state) => {
                await state.client.query(
                  'DELETE FROM ' + tables.journal + ' WHERE org_id=$1 AND key>=$2 AND key<$3',
                  params,
                  state.ctx
                )
              })
            return work(
              Object.freeze({
                get: (input) =>
                  execute(async (state) => {
                    const row = (
                      await state.client.query(
                        'SELECT value FROM ' + tables.journal + ' WHERE org_id=$1 AND key=$2',
                        [orgId, key(input)],
                        state.ctx
                      )
                    ).rows[0]
                    if (row === undefined) return null
                    const value = decodePgRecord(row.value)
                    if (typeof value !== 'string')
                      throw postgresError(PostgresErrorCode.decodeFailed)
                    return value
                  }),
                has: (input) =>
                  execute(
                    async (state) =>
                      (
                        await state.client.query(
                          'SELECT key FROM ' + tables.journal + ' WHERE org_id=$1 AND key=$2',
                          [orgId, key(input)],
                          state.ctx
                        )
                      ).rows.length !== 0
                  ),
                set: (input, value) =>
                  execute(async (state) => {
                    if (typeof value !== 'string') throw invalidArgument()
                    await state.client.query(
                      'INSERT INTO ' +
                        tables.journal +
                        ' (org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value',
                      [orgId, key(input), encodePgRecord(value)],
                      state.ctx
                    )
                  }),
                remove: (input) =>
                  execute(async (state) => {
                    await state.client.query(
                      'DELETE FROM ' + tables.journal + ' WHERE org_id=$1 AND key=$2',
                      [orgId, key(input)],
                      state.ctx
                    )
                  }),
                clearValues: clear,
                clearAll: clear,
                keys: () =>
                  execute(async (state) =>
                    (
                      await state.client.query(
                        'SELECT key FROM ' +
                          tables.journal +
                          ' WHERE org_id=$1 AND key>=$2 AND key<$3 ORDER BY key',
                        params,
                        state.ctx
                      )
                    ).rows.map((row) => {
                      const decoded = pgTextKey(row.key)
                      if (
                        !Array.isArray(decoded) ||
                        decoded[0] !== prefix ||
                        typeof decoded[1] !== 'string'
                      )
                        throw postgresError(PostgresErrorCode.decodeFailed)
                      return decoded[1]
                    })
                  )
              })
            )
          }
          return scope === undefined ? options.transaction(invoke) : invoke(scope)
        })
      const listen = (
        scope: Omit<ITransactionScope, 'use'>,
        effect: () => void,
        success: boolean
      ) => {
        if (typeof effect !== 'function') throw invalidArgument()
        const state = scopeState(scope)
        const effects = success ? state.terminal.committed : state.terminal.rolledBack
        effects.add(effect)
        return () => {
          effects.delete(effect)
        }
      }
      return Object.freeze({
        ...resource,
        nativeAtomic: true,
        indexExclusive: false,
        transactionInfo: (scope: Omit<ITransactionScope, 'use'>) => {
          scopeState(scope)
          return options.infoFor(scope)
        },
        run,
        onCommit: (scope: Omit<ITransactionScope, 'use'>, effect: () => void) =>
          listen(scope, effect, true),
        onRollback: (scope: Omit<ITransactionScope, 'use'>, effect: () => void) =>
          listen(scope, effect, false)
      })
    },
    changes: (scope) => authenticate(scope).journal?.changes() ?? [],
    readImage: (scope, target) =>
      runTransactionOperation(scope, () => images.readImage(authenticate(scope), target)),
    writeImage: (scope, target, image) =>
      runTransactionOperation(scope, () => images.writeImage(authenticate(scope), target, image)),
    readRevision: (scope, target) =>
      runTransactionOperation(scope, async () => {
        const state = authenticate(scope),
          key = keyFor(target)
        if (target.channel === 'metadata') return null
        if (target.channel === 'rdf') throw invalidArgument()
        const identity = pgIdentity(target.channel, key)
        const row = (
          await state.client.query(
            'SELECT version FROM ' + tables.revisions + ' WHERE org_id=$1 AND key=$2',
            [orgId, identity],
            state.ctx
          )
        ).rows[0]
        return String(row?.version ?? 0n)
      }),
    writeCommitMarker: (scope, txId) =>
      runTransactionOperation(scope, async () => {
        const state = authenticate(scope)
        if (options.infoFor(scope).id !== txId) throw invalidArgument()
        await state.client.query(
          'INSERT INTO ' +
            tables.markers +
            ' (org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO NOTHING',
          [orgId, pgKey([PgNames.journalMarkerNamespace, txId]).hex, PgNames.markerValue],
          state.ctx
        )
      }),
    hasCommitMarker: async (txId) =>
      (
        await options.configuration.driver.query(
          'SELECT value FROM ' + tables.markers + ' WHERE org_id=$1 AND key=$2',
          [orgId, pgKey([PgNames.journalMarkerNamespace, txId]).hex]
        )
      ).rows[0]?.value === PgNames.markerValue,
    removeCommitMarker: async (txId) => {
      await options.configuration.driver.query(
        'DELETE FROM ' + tables.markers + ' WHERE org_id=$1 AND key=$2',
        [orgId, pgKey([PgNames.journalMarkerNamespace, txId]).hex]
      )
    }
  }
}
