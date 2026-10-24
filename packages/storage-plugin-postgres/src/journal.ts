import {
  StorageContractError,
  StorageContractErrorCode,
  runTransactionOperation,
  snapshotStorageKeyPrefix,
  type IStorageKey,
  type ITransactionScope,
  type ITransactionInfo,
  type ISqlRow
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
  preparePgRevisionRows,
  readPgRevisionRows,
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
  reportCleanupError,
  encodeFlatStorageKey,
  decodeFlatStorageKey
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
/** The original attempt retains actual native mutation order until its real terminal. */
export type IPgJournalCapture = {
  capture(channel: IPgMutationChannel, keys: readonly IStorageKey[]): Promise<void>
  stage(channel: IPgMutationChannel, key: IStorageKey, after?: ISqlRow): void
  finalize(): Promise<void>
  changes(): readonly IStorageJournalChange[]
}
/** One backend image uses the existing collections codec, including exact bytea values. */
export function encodePgJournalImage(wire: IPgJournalWire): IStorageJournalImage {
  return Object.freeze({
    present: true,
    value: encodePgRecord({
      version: wire.version,
      channel: wire.channel,
      value: wire.value instanceof Uint8Array ? bytesToBase64(wire.value) : wire.value,
      ...(wire.channel === 'vector' ? { payload: wire.payload, projection: wire.projection } : {}),
      expiresAt: wire.expiresAt
    })
  })
}
/** Existing native reads and RETURNING rows share one exact image encoder and field admission. */
function journalRowImage(channel: IPgMutationChannel, row: ISqlRow): IStorageJournalImage {
  if (
    !(typeof row.value === 'string' || row.value instanceof Uint8Array) ||
    (channel !== 'metadata' && row.deadline !== null && typeof row.deadline !== 'string') ||
    (channel === 'vector' &&
      (!(row.payload === null || typeof row.payload === 'string') ||
        !(row.projection === null || typeof row.projection === 'string')))
  )
    throw postgresError(PostgresErrorCode.decodeFailed)
  return encodePgJournalImage({
    version: 1,
    channel,
    value: row.value,
    expiresAt: channel === 'metadata' ? null : (row.deadline as string | null),
    ...(channel === 'vector'
      ? {
          payload: row.payload as string | null,
          projection: row.projection as string | null
        }
      : {})
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
    return { channel, key: encodeFlatStorageKey(key) }
  }
  return pgLockKey(channel, key)
}
/** Original vector lock targets carry a tuple only inside native row helpers. */
function keyFor(target: IStorageJournalTarget): IStorageKey {
  if (target.channel === 'metadata') {
    const key = decodeFlatStorageKey(target.key, PgNames.backend)
    if (typeof key !== 'string') throw invalidArgument()
    return key
  }
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
      if (typeof key !== 'string') throw postgresError(PostgresErrorCode.decodeFailed)
      result.set(key, journalRowImage(channel, row))
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
      /**
       * Raw after rows come from the actual mutation, so concurrent accepted writes cannot
       * overwrite them.
       */
      const stages: {
        channel: IPgMutationChannel
        key: IStorageKey
        target: IStorageJournalTarget
        before: IStorageJournalImage
        after: IStorageJournalImage
      }[] = []
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
        stage: (channel, key, row) => {
          const id = channel + ':' + pgKey(key).hex
          const previous = before.get(id)
          if (previous === undefined) throw postgresError(PostgresErrorCode.decodeFailed)
          const after =
            row === undefined ? { present: false as const } : journalRowImage(channel, row)
          stages.push({ channel, key, target: previous.target, before: previous.image, after })
          before.set(id, { target: previous.target, image: after })
        },
        finalize: async () => {
          const final: IStorageJournalChange[] = []
          /** This attempt alone prepares changed revision rows before persisting complete mirrors. */
          const identities = [...state.changed].flatMap(([channel, keys]) =>
            [...keys.values()].map((key) => pgIdentity(channel, key))
          )
          await preparePgRevisionRows(state, tables, identities)
          /** Native births come from those same rows and remain unchanged at actual COMMIT. */
          const revisions = await readPgRevisionRows(state, tables, identities)
          for (const stage of stages) {
            const id = pgIdentity(stage.channel, stage.key)
            final.push({
              target: stage.target,
              before: stage.before,
              after: stage.after,
              afterRevision: {
                birth: revisions.get(id)!.birth!,
                version: String((state.baseline.get(id)?.version ?? 0n) + 1n)
              }
            })
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
      await state.guardKeys([pgLockKey(channel, key)])
      const nativeKey = channel === 'record' ? pgKey(key).bytes : pgKey(key).hex
      let after: ISqlRow | undefined
      if (wire === undefined) {
        const removed = await state.client.query(
          'DELETE FROM ' + tables[channel] + ' WHERE org_id=$1 AND key=$2',
          [state.orgId, nativeKey],
          state.ctx
        )
        if (removed.rowCount === 0) return
      } else
        after = (
          await state.client.query(
            'INSERT INTO ' +
              tables[channel] +
              ' (org_id,key,value' +
              (channel === 'metadata' ? '' : ',expires_at') +
              ') VALUES($1,$2,$3' +
              (channel === 'metadata' ? '' : ',$4::timestamptz') +
              ') ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value' +
              (channel === 'metadata' ? '' : ',expires_at=excluded.expires_at') +
              ' RETURNING key,value' +
              (channel === 'metadata' ? '' : ',expires_at::text AS deadline'),
            [
              state.orgId,
              nativeKey,
              wire.value,
              ...(channel === 'metadata' ? [] : [wire.expiresAt])
            ],
            state.ctx
          )
        ).rows[0]
      markPgChanged(state, channel, key, after)
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
    lockTarget: (target) => {
      const key = keyFor(target)
      if (target.channel === 'rdf') throw invalidArgument()
      return pgLockKey(target.channel, key)
    },
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
                /**
                 * The existing PK bootstraps first-open races, then the row lock serializes all
                 * heads.
                 */
                getOrInsert: (input, initial) =>
                  execute(async (state) => {
                    const encoded = key(input)
                    await state.client.query(
                      'INSERT INTO ' +
                        tables.journal +
                        ' (org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO NOTHING',
                      [orgId, encoded, encodePgRecord(initial)],
                      state.ctx
                    )
                    const row = (
                      await state.client.query(
                        'SELECT value FROM ' +
                          tables.journal +
                          ' WHERE org_id=$1 AND key=$2 FOR UPDATE',
                        [orgId, encoded],
                        state.ctx
                      )
                    ).rows[0]
                    const value = decodePgRecord(row?.value)
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
        runCommitted: <R>(
          work: (view: IStorageJournalNamespaceView) => Promise<R>,
          committed: (value: R) => void
        ) =>
          options.transaction(async (scope) => {
            const value = await run(work, scope)
            listen(scope, () => committed(value), true)
            return value
          }),
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
        if (target.channel === 'rdf') throw invalidArgument()
        const identity = pgIdentity(target.channel, key)
        const current = (await readPgRevisionRows(state, tables, [identity])).get(identity)
        return { birth: current?.birth ?? null, version: String(current?.version ?? 0n) }
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
