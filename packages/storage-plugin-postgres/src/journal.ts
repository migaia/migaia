import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageKey,
  type ITransactionScope,
  type ITransactionInfo,
  type ISqlRow
} from '@migaia/storage-contract'
import {
  runTransactionOperation,
  snapshotStorageKeyPrefix,
  createStorageOperationReporter,
  reportCleanupError,
  encodeFlatStorageKey,
  decodeFlatStorageKey
} from '@migaia/storage-host/sdk'
import type {
  IStorageJournalNamespace,
  IStorageJournalNamespaceView,
  IStorageJournalImage,
  IStorageJournalTarget,
  IStorageJournalChange,
  IStorageJournalBackendBinding
} from '@migaia/storage-host'
import type { IBackendChangeController } from '@migaia/storage-host/sdk'
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
  return {
    present: true,
    value: encodePgRecord({
      version: wire.version,
      channel: wire.channel,
      value: wire.value instanceof Uint8Array ? bytesToBase64(wire.value) : wire.value,
      ...(wire.channel === 'vector' ? { payload: wire.payload, projection: wire.projection } : {}),
      expiresAt: wire.expiresAt
    })
  }
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
/** Fixed layout and vector image ports share one native image codec. */
class PgJournalImages {
  /** Native table identities remain fixed for the installed backend. */
  readonly #tables: IPgTables
  /** Vector images borrow the already selected collection implementation. */
  readonly #vectors: () => IPgJournalVectorPort | undefined
  /** Keep layout and feature ownership separate from per-attempt image state. */
  constructor(tables: IPgTables, vectors: () => IPgJournalVectorPort | undefined) {
    this.#tables = tables
    this.#vectors = vectors
  }
  /** Read one original channel through its native table or vector owner. */
  async read(
    state: IPgState,
    channel: IPgMutationChannel,
    keys: readonly IStorageKey[]
  ): Promise<ReadonlyMap<string, IStorageJournalImage>> {
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
      const port = this.#vectors()
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
          this.#tables[channel] +
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
  /** Every physical attempt receives an independent ordered capture. */
  capture(state: IPgState): IPgJournalCapture {
    return new PgJournalCapture(this, state, this.#tables)
  }
  /** Decode one target through the original native image owner. */
  async readImage(state: IPgState, target: IStorageJournalTarget) {
    const key = keyFor(target)
    if (target.channel === 'rdf') throw invalidArgument()
    return (await this.read(state, target.channel, [key])).get(pgKey(key).hex)!
  }
  /** Restore one image with the existing revision, guard and mutation order. */
  async writeImage(state: IPgState, target: IStorageJournalTarget, image: IStorageJournalImage) {
    const key = keyFor(target)
    if (target.channel === 'rdf') throw invalidArgument()
    if (target.channel === 'vector') {
      const port = this.#vectors()
      if (port === undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: PgNames.backend
        })
      return port.write(state, target.collection, target.id, image)
    }
    const channel = target.channel
    const wire = image.present ? decodePgJournalImage(image, channel) : undefined
    await observePgRevision(state, this.#tables, channel, key)
    await state.guardKeys([pgLockKey(channel, key)])
    const nativeKey = channel === 'record' ? pgKey(key).bytes : pgKey(key).hex
    let after: ISqlRow | undefined
    if (wire === undefined) {
      const removed = await state.client.query(
        'DELETE FROM ' + this.#tables[channel] + ' WHERE org_id=$1 AND key=$2',
        [state.orgId, nativeKey],
        state.ctx
      )
      if (removed.rowCount === 0) return
    } else
      after = (
        await state.client.query(
          'INSERT INTO ' +
            this.#tables[channel] +
            ' (org_id,key,value' +
            (channel === 'metadata' ? '' : ',expires_at') +
            ') VALUES($1,$2,$3' +
            (channel === 'metadata' ? '' : ',$4::timestamptz') +
            ') ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value' +
            (channel === 'metadata' ? '' : ',expires_at=excluded.expires_at') +
            ' RETURNING key,value' +
            (channel === 'metadata' ? '' : ',expires_at::text AS deadline'),
          [state.orgId, nativeKey, wire.value, ...(channel === 'metadata' ? [] : [wire.expiresAt])],
          state.ctx
        )
      ).rows[0]
    markPgChanged(state, channel, key, after)
  }
}
/** One physical attempt owns its before images, native mutation order and final revision images. */
class PgJournalCapture implements IPgJournalCapture {
  /** Native state remains attached to the same authentic physical attempt. */
  readonly #state: IPgState
  /** Shared image codec and layout stay owned by their backend. */
  readonly #images: PgJournalImages
  /** Revisions are finalized against the original native tables. */
  readonly #tables: IPgTables
  /** First capture per identity prevents later writes from replacing its original image. */
  readonly #before = new Map<
    string,
    { target: IStorageJournalTarget; image: IStorageJournalImage }
  >()
  /** RETURNING rows preserve actual accepted mutation order through commit preparation. */
  readonly #stages: {
    channel: IPgMutationChannel
    key: IStorageKey
    target: IStorageJournalTarget
    before: IStorageJournalImage
    after: IStorageJournalImage
  }[] = []
  /** Final images become available only after native revisions have been prepared. */
  #changes: readonly IStorageJournalChange[] = []
  /** Keep per-attempt state separate from the reusable native image codec. */
  constructor(images: PgJournalImages, state: IPgState, tables: IPgTables) {
    this.#images = images
    this.#state = state
    this.#tables = tables
  }
  /** Read each missing before image once before its first accepted mutation. */
  readonly capture: IPgJournalCapture['capture'] = async (channel, keys) => {
    const missing = keys.filter((key) => !this.#before.has(channel + ':' + pgKey(key).hex))
    const images = await this.#images.read(this.#state, channel, missing)
    for (const key of missing)
      this.#before.set(channel + ':' + pgKey(key).hex, {
        target: targetFor(channel, key),
        image: images.get(pgKey(key).hex)!
      })
  }
  /** Retain the actual native after row in accepted mutation order. */
  readonly stage: IPgJournalCapture['stage'] = (channel, key, row) => {
    const id = channel + ':' + pgKey(key).hex
    const previous = this.#before.get(id)
    if (previous === undefined) throw postgresError(PostgresErrorCode.decodeFailed)
    const after = row === undefined ? { present: false as const } : journalRowImage(channel, row)
    this.#stages.push({ channel, key, target: previous.target, before: previous.image, after })
    this.#before.set(id, { target: previous.target, image: after })
  }
  /** Attach original native birth and next revision to each staged mutation. */
  readonly finalize: IPgJournalCapture['finalize'] = async () => {
    const final: IStorageJournalChange[] = []
    /** This attempt alone prepares changed revision rows before persisting complete mirrors. */
    const identities = [...this.#state.changed].flatMap(([channel, keys]) =>
      [...keys.values()].map((key) => pgIdentity(channel, key))
    )
    await preparePgRevisionRows(this.#state, this.#tables, identities)
    /** Native births come from those same rows and remain unchanged at actual COMMIT. */
    const revisions = await readPgRevisionRows(this.#state, this.#tables, identities)
    for (const stage of this.#stages) {
      const id = pgIdentity(stage.channel, stage.key)
      final.push({
        target: stage.target,
        before: stage.before,
        after: stage.after,
        afterRevision: {
          birth: revisions.get(id)!.birth!,
          version: String((this.#state.baseline.get(id)?.version ?? 0n) + 1n)
        }
      })
    }
    this.#changes = final
  }
  /** Return the finalized ordered images for the original journal terminal. */
  readonly changes: IPgJournalCapture['changes'] = () => {
    return this.#changes
  }
}
/** All fixed-table images share one native codec while each attempt owns its capture state. */
export function createPgJournalImages(
  tables: IPgTables,
  vectors: () => IPgJournalVectorPort | undefined
) {
  return new PgJournalImages(tables, vectors)
}

/** The journal borrows only authentic organization scopes and the fixed native layout. */
type IPgJournalBindingOptions = {
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
}
/**
 * Native journal binding delegates scope identity and transaction lifetime to their existing
 * owners.
 */
class PgJournalBinding {
  /** Fixed organization and native execution ports remain shared by its private namespaces. */
  readonly #options: IPgJournalBindingOptions
  /** Keep namespace and image state separate from installation context. */
  constructor(options: IPgJournalBindingOptions) {
    this.#options = options
  }
  /** Expose own journal callbacks because the host captures each binding port once. */
  open(): Omit<IStorageJournalBackendBinding, 'forOrg'> {
    return {
      externalWal: true,
      openNamespace: async (prefix) => {
        this.#options.controller.assertLive()
        if (typeof prefix !== 'string' || prefix.length === 0) throw invalidArgument()
        return new PgJournalNamespace(this.#options, prefix).open()
      },
      lockTarget: (target) => {
        const key = keyFor(target)
        if (target.channel === 'rdf') throw invalidArgument()
        return pgLockKey(target.channel, key)
      },
      changes: (scope) => this.#options.stateFor(scope).journal?.changes() ?? [],
      readImage: (scope, target) =>
        runTransactionOperation(scope, () =>
          this.#options.images.readImage(this.#options.stateFor(scope), target)
        ),
      writeImage: (scope, target, image) =>
        runTransactionOperation(scope, () =>
          this.#options.images.writeImage(this.#options.stateFor(scope), target, image)
        ),
      readRevision: (scope, target) =>
        runTransactionOperation(scope, async () => {
          const state = this.#options.stateFor(scope),
            key = keyFor(target)
          if (target.channel === 'rdf') throw invalidArgument()
          const identity = pgIdentity(target.channel, key)
          const current = (await readPgRevisionRows(state, this.#options.tables, [identity])).get(
            identity
          )
          return { birth: current?.birth ?? null, version: String(current?.version ?? 0n) }
        }),
      writeCommitMarker: (scope, txId) =>
        runTransactionOperation(scope, async () => {
          const state = this.#options.stateFor(scope)
          if (this.#options.infoFor(scope).id !== txId) throw invalidArgument()
          await state.client.query(
            'INSERT INTO ' +
              this.#options.tables.markers +
              ' (org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO NOTHING',
            [
              this.#options.orgId,
              pgKey([PgNames.journalMarkerNamespace, txId]).hex,
              PgNames.markerValue
            ],
            state.ctx
          )
        }),
      hasCommitMarker: async (txId) =>
        (
          await this.#options.configuration.driver.query(
            'SELECT value FROM ' + this.#options.tables.markers + ' WHERE org_id=$1 AND key=$2',
            [this.#options.orgId, pgKey([PgNames.journalMarkerNamespace, txId]).hex]
          )
        ).rows[0]?.value === PgNames.markerValue,
      removeCommitMarker: async (txId) => {
        await this.#options.configuration.driver.query(
          'DELETE FROM ' + this.#options.tables.markers + ' WHERE org_id=$1 AND key=$2',
          [this.#options.orgId, pgKey([PgNames.journalMarkerNamespace, txId]).hex]
        )
      }
    }
  }
}
/** A private namespace owns resource retention and the exact original key interval. */
class PgJournalNamespace {
  /** Authentic scopes and native I/O remain owned by the installed backend. */
  readonly options: IPgJournalBindingOptions
  /** Prefix is immutable for this namespace and all of its transaction views. */
  readonly prefix: string
  /** One precomputed native interval is reused for ordered keys and clear operations. */
  readonly params: readonly [string, string, string]
  /** Canonical driver resource admission retains each authentic attempt until its terminal. */
  readonly #resource: ReturnType<typeof pgResource>
  /** Attempt IDs ensure the original namespace resource is retained once per native terminal. */
  readonly #attempts = new Set<string>()
  /** Build the existing native interval without allocating new transaction machinery. */
  constructor(options: IPgJournalBindingOptions, prefix: string) {
    this.options = options
    this.prefix = prefix
    this.#resource = pgResource(async () => {})
    /** Canonical prefix projection computes bounds for this generated private namespace tuple. */
    const range = snapshotStorageKeyPrefix([prefix], PgNames.backend)
    this.params = [options.orgId, pgKeyHex(range.lower), pgKeyHex(range.upper)]
  }
  /** Authenticate a scope and retain this namespace until the actual native terminal. */
  scopeState(scope: Omit<ITransactionScope, 'use'>) {
    this.#resource.assertLive()
    const state = this.options.stateFor(scope)
    const id = this.options.infoFor(scope).id
    if (!this.#attempts.has(id)) {
      this.#attempts.add(id)
      const ended = deferred<void>()
      const finish = () => {
        this.#attempts.delete(id)
        ended.resolve()
      }
      state.terminal.ended.add(finish)
      void this.#resource
        .run(() => ended.promise)
        .catch((error) => reportCleanupError(createStorageOperationReporter(), error))
    }
    return state
  }
  /** Execute the caller's view inside its original scope or one canonical native transaction. */
  readonly run: IStorageJournalNamespace['run'] = <R>(
    work: (view: IStorageJournalNamespaceView) => Promise<R>,
    scope?: Omit<ITransactionScope, 'use'>
  ): Promise<R> =>
    this.#resource.run(async () => {
      if (typeof work !== 'function') throw invalidArgument()
      const invoke = (current: Omit<ITransactionScope, 'use'>) =>
        work(new PgJournalNamespaceView(this, current))
      return scope === undefined ? this.options.transaction(invoke) : invoke(scope)
    })
  /** Register one original terminal effect and return its exact removal callback. */
  #listen(scope: Omit<ITransactionScope, 'use'>, effect: () => void, success: boolean) {
    if (typeof effect !== 'function') throw invalidArgument()
    const state = this.scopeState(scope)
    const effects = success ? state.terminal.committed : state.terminal.rolledBack
    effects.add(effect)
    return () => {
      effects.delete(effect)
    }
  }
  /** Keep the original resource callbacks and own journal ports on the returned namespace. */
  open(): IStorageJournalNamespace {
    return {
      ...this.#resource,
      nativeAtomic: true,
      indexExclusive: false,
      transactionInfo: (scope) => {
        this.scopeState(scope)
        return this.options.infoFor(scope)
      },
      run: this.run,
      runCommitted: <R>(
        work: (view: IStorageJournalNamespaceView) => Promise<R>,
        committed: (value: R) => void
      ) =>
        this.options.transaction(async (scope) => {
          const value = await this.run(work, scope)
          this.#listen(scope, () => committed(value), true)
          return value
        }),
      onCommit: (scope, effect) => this.#listen(scope, effect, true),
      onRollback: (scope, effect) => this.#listen(scope, effect, false)
    }
  }
}
/** One journal view binds only an authentic scope and its existing private namespace. */
class PgJournalNamespaceView implements IStorageJournalNamespaceView {
  /** Resource retention and native interval belong to the namespace, not the view. */
  readonly #namespace: PgJournalNamespace
  /** All operations use the exact authentic transaction scope supplied to this view. */
  readonly #scope: Omit<ITransactionScope, 'use'>
  /** Bind one short-lived view to the original transaction context. */
  constructor(namespace: PgJournalNamespace, scope: Omit<ITransactionScope, 'use'>) {
    this.#namespace = namespace
    this.#scope = scope
  }
  /** Run native journal work through canonical transaction operation admission. */
  #execute<R>(query: (state: IPgState) => Promise<R>) {
    return runTransactionOperation(this.#scope, () =>
      query(this.#namespace.scopeState(this.#scope))
    )
  }
  /** Encode one validated journal key inside the original private prefix. */
  #key(input: unknown): string {
    if (typeof input !== 'string') throw invalidArgument()
    return pgKey([this.#namespace.prefix, input]).hex
  }
  /** Delete only this namespace interval in the authentic native transaction. */
  #clear() {
    return this.#execute(async (state) => {
      await state.client.query(
        'DELETE FROM ' +
          this.#namespace.options.tables.journal +
          ' WHERE org_id=$1 AND key>=$2 AND key<$3',
        this.#namespace.params,
        state.ctx
      )
    })
  }
  /** Native get keeps original transaction admission and persisted codec semantics. */
  readonly get: IStorageJournalNamespaceView['get'] = (input) =>
    this.#execute(async (state) => {
      const row = (
        await state.client.query(
          'SELECT value FROM ' +
            this.#namespace.options.tables.journal +
            ' WHERE org_id=$1 AND key=$2',
          [this.#namespace.options.orgId, this.#key(input)],
          state.ctx
        )
      ).rows[0]
      if (row === undefined) return null
      const value = decodePgRecord(row.value)
      if (typeof value !== 'string') throw postgresError(PostgresErrorCode.decodeFailed)
      return value
    })
  /** Native getOrInsert keeps original transaction admission and persisted codec semantics. */
  readonly getOrInsert: IStorageJournalNamespaceView['getOrInsert'] = (input, initial) =>
    this.#execute(async (state) => {
      const encoded = this.#key(input)
      await state.client.query(
        'INSERT INTO ' +
          this.#namespace.options.tables.journal +
          ' (org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO NOTHING',
        [this.#namespace.options.orgId, encoded, encodePgRecord(initial)],
        state.ctx
      )
      const row = (
        await state.client.query(
          'SELECT value FROM ' +
            this.#namespace.options.tables.journal +
            ' WHERE org_id=$1 AND key=$2 FOR UPDATE',
          [this.#namespace.options.orgId, encoded],
          state.ctx
        )
      ).rows[0]
      const value = decodePgRecord(row?.value)
      if (typeof value !== 'string') throw postgresError(PostgresErrorCode.decodeFailed)
      return value
    })
  /** Native has keeps original transaction admission and persisted codec semantics. */
  readonly has: IStorageJournalNamespaceView['has'] = (input) =>
    this.#execute(
      async (state) =>
        (
          await state.client.query(
            'SELECT key FROM ' +
              this.#namespace.options.tables.journal +
              ' WHERE org_id=$1 AND key=$2',
            [this.#namespace.options.orgId, this.#key(input)],
            state.ctx
          )
        ).rows.length !== 0
    )
  /** Native set keeps original transaction admission and persisted codec semantics. */
  readonly set: IStorageJournalNamespaceView['set'] = (input, value) =>
    this.#execute(async (state) => {
      if (typeof value !== 'string') throw invalidArgument()
      await state.client.query(
        'INSERT INTO ' +
          this.#namespace.options.tables.journal +
          ' (org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value',
        [this.#namespace.options.orgId, this.#key(input), encodePgRecord(value)],
        state.ctx
      )
    })
  /** Native remove keeps original transaction admission and persisted codec semantics. */
  readonly remove: IStorageJournalNamespaceView['remove'] = (input) =>
    this.#execute(async (state) => {
      await state.client.query(
        'DELETE FROM ' + this.#namespace.options.tables.journal + ' WHERE org_id=$1 AND key=$2',
        [this.#namespace.options.orgId, this.#key(input)],
        state.ctx
      )
    })
  /** Clear values and all share the original exact native interval operation. */
  readonly clearValues: IStorageJournalNamespaceView['clearValues'] = () => this.#clear()
  /** Preserve the shared clear callback identity. */
  readonly clearAll = this.clearValues
  /** Native keys keeps original transaction admission and persisted codec semantics. */
  readonly keys: IStorageJournalNamespaceView['keys'] = () =>
    this.#execute(async (state) =>
      (
        await state.client.query(
          'SELECT key FROM ' +
            this.#namespace.options.tables.journal +
            ' WHERE org_id=$1 AND key>=$2 AND key<$3 ORDER BY key',
          this.#namespace.params,
          state.ctx
        )
      ).rows.map((row) => {
        const decoded = pgTextKey(row.key)
        if (
          !Array.isArray(decoded) ||
          decoded[0] !== this.#namespace.prefix ||
          typeof decoded[1] !== 'string'
        )
          throw postgresError(PostgresErrorCode.decodeFailed)
        return decoded[1]
      })
    )
}
/** Private journal I/O borrows only original native scopes and never recursively prepares a journal. */
export function createPgJournalBinding(
  options: IPgJournalBindingOptions
): Omit<IStorageJournalBackendBinding, 'forOrg'> {
  return new PgJournalBinding(options).open()
}
