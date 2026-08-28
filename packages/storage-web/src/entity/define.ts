import { passthrough } from '../schema/passthrough.js'
import { createRepository } from './repository.js'
import type { IKeyValueStore } from '../types/storage.js'
import type { ISchemaAdapter } from '../schema/types.js'
import type { IMigration } from '../schema/migrate.js'
import type {
  IEntityDefinition,
  IEntityIndex,
  IEntityIndexMap,
  IEntityOptions,
  IRepository
} from './types.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { snapshotCodec } from '../serialize/registry.js'
import { snapshotEntityIndexes } from './index-projection.js'

type IEntityOptionsWithoutIndexes<TDomain, TStored> = Omit<
  IEntityOptions<TDomain, TStored, undefined>,
  'indexes'
>

/** Curried entity declaration form that keeps the domain explicit while inferring literal indexes. */
type IDefineEntityBuilder<TDomain, TStored> = {
  (
    options: IEntityOptionsWithoutIndexes<TDomain, TStored> & { readonly indexes?: undefined }
  ): IEntityDefinition<TDomain>
  <const TIndexes extends Readonly<Record<string, IEntityIndex<TDomain>>>>(
    options: IEntityOptionsWithoutIndexes<TDomain, TStored> & { readonly indexes: TIndexes }
  ): IEntityDefinition<TDomain, IEntityIndexMap<TDomain, TIndexes>>
}

const RESERVED_ENTITY_PREFIX = '__'

const invalidDefinition = (message: string): never => {
  throw new StorageError(StorageErrorCode.invalidConfig, { cause: new TypeError(message) })
}

/** Snapshot a schema descriptor once before it becomes a long-lived repository extension. */
const snapshotSchema = <TDomain, TStored>(schema: unknown): ISchemaAdapter<TDomain, TStored> => {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    invalidDefinition('entity schema must be an object')
  const candidate = schema as Record<string, unknown>
  let name: unknown
  let validate: unknown
  let encode: unknown
  let decode: unknown
  let normalize: unknown
  try {
    name = candidate.name
    validate = candidate.validate
    encode = candidate.encode
    decode = candidate.decode
    normalize = candidate.normalize
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { cause })
  }
  if (
    typeof name !== 'string' ||
    name.trim() === '' ||
    typeof validate !== 'function' ||
    (encode !== undefined && typeof encode !== 'function') ||
    (decode !== undefined && typeof decode !== 'function') ||
    (normalize !== undefined && typeof normalize !== 'function')
  )
    invalidDefinition('entity schema must declare name and validate')
  return { name, validate, encode, decode, normalize } as ISchemaAdapter<TDomain, TStored>
}

/** Snapshot own migration steps so validation and later execution share one graph. */
const snapshotMigrations = (migrations: unknown): Record<number, IMigration> | undefined => {
  if (migrations === undefined) return undefined
  if (migrations === null || typeof migrations !== 'object' || Array.isArray(migrations))
    invalidDefinition('entity migrations must be an object')
  try {
    return Object.fromEntries(Object.entries(migrations as object))
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { cause })
  }
}

const validateDefinition = <TDomain, TStored>(
  options: IEntityOptions<TDomain, TStored>,
  version: number
): void => {
  if (typeof options.name !== 'string' || options.name.trim() === '')
    invalidDefinition('entity name must be non-empty')
  if (options.name.startsWith(RESERVED_ENTITY_PREFIX))
    invalidDefinition('entity name uses reserved prefix')
  if (!Number.isSafeInteger(version) || version < 1)
    invalidDefinition('entity version must be a positive safe integer')
  if (typeof options.key !== 'string' || options.key.length === 0)
    invalidDefinition('entity key must be a non-empty property name')
  if (options.schema === undefined) invalidDefinition('entity schema snapshot is required')
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== 'function')
    invalidDefinition('entity onDiagnostic must be a function')
  if (options.validateOnRead !== undefined && typeof options.validateOnRead !== 'boolean')
    invalidDefinition('entity validateOnRead must be a boolean')
  if (options.defaultOrderBy !== undefined && typeof options.defaultOrderBy !== 'function')
    invalidDefinition('entity defaultOrderBy must be a function')
  if (options.migrations === undefined) return
  if (
    options.migrations === null ||
    typeof options.migrations !== 'object' ||
    Array.isArray(options.migrations)
  )
    invalidDefinition('entity migrations must be an object')
  const migrationEntries = Object.entries(options.migrations)
  if (migrationEntries.length !== version - 1)
    invalidDefinition('entity migration graph must contain every version step')
  for (const [rawVersion, migration] of migrationEntries) {
    const migrationVersion = Number(rawVersion)
    if (
      !Number.isSafeInteger(migrationVersion) ||
      migrationVersion < 2 ||
      migrationVersion > version
    )
      invalidDefinition('entity migration version must be an integer between 2 and version')
    if (typeof migration !== 'function') invalidDefinition('entity migration must be a function')
  }
  for (let migrationVersion = 2; migrationVersion <= version; migrationVersion += 1) {
    if (
      !Object.hasOwn(options.migrations, migrationVersion) ||
      typeof options.migrations[migrationVersion] !== 'function'
    )
      invalidDefinition(`entity migration ${migrationVersion} is required`)
  }
}

const defaultDiagnostic = (message: string): void => {
  const runtime = globalThis as typeof globalThis & { console?: { warn(value: string): void } }
  runtime.console?.warn(message)
}

/**
 * 声明式定义一类 record。`connect()` 把定义绑定到具体 backend，产出可反复调用 get/put/remove/list/stream/batch 的仓储对象。 同一个
 * definition 可以 connect 到多个 backend，行为在两者上保持一致。
 */
export function defineEntity<TDomain, TStored = TDomain>(
  options: IEntityOptions<TDomain, TStored, never> & { readonly indexes?: undefined }
): IEntityDefinition<TDomain>
export function defineEntity<TDomain, TStored = TDomain>(): IDefineEntityBuilder<TDomain, TStored>
export function defineEntity<TDomain, TStored = TDomain>(
  options?: IEntityOptions<
    TDomain,
    TStored,
    Readonly<Record<string, IEntityIndex<TDomain>>> | undefined
  >,
  allowCurriedIndexes = false
):
  | IEntityDefinition<TDomain, Readonly<Record<string, import('../types/context.js').IStorageKey>>>
  | IDefineEntityBuilder<TDomain, TStored> {
  if (arguments.length === 0) {
    const defineConfigured = defineEntity as unknown as (
      configured: IEntityOptions<TDomain, TStored, Readonly<Record<string, IEntityIndex<TDomain>>>>,
      allowIndexes: boolean
    ) => IEntityDefinition<TDomain, IEntityIndexMap<TDomain>>
    return ((
      configured: IEntityOptions<TDomain, TStored, Readonly<Record<string, IEntityIndex<TDomain>>>>
    ) => defineConfigured(configured, true)) as IDefineEntityBuilder<TDomain, TStored>
  }
  if (options === undefined) return invalidDefinition('entity definition must be an object')
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    invalidDefinition('entity definition must be an object')
  let configuredName: unknown
  let configuredKey: unknown
  let configuredSchema: unknown
  let configuredCodec: unknown
  let configuredVersion: unknown
  let configuredMigrations: unknown
  let configuredValidateOnRead: unknown
  let configuredOnDiagnostic: unknown
  let configuredDefaultOrderBy: unknown
  let configuredIndexes: unknown
  try {
    configuredName = options.name
    configuredKey = options.key
    configuredSchema = options.schema
    configuredCodec = options.codec
    configuredVersion = options.version
    configuredMigrations = options.migrations
    configuredValidateOnRead = options.validateOnRead
    configuredOnDiagnostic = options.onDiagnostic
    configuredDefaultOrderBy = options.defaultOrderBy
    configuredIndexes = options.indexes
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { cause })
  }
  if (configuredIndexes !== undefined && !allowCurriedIndexes)
    invalidDefinition('entity indexes require curried declaration')
  const name = configuredName as string
  const key = configuredKey as Extract<keyof TDomain, string>
  // 未提供 schema 时只有 TStored=TDomain 才合法（没有 schema 就无法在两者间转换），
  // passthrough<TDomain>() 在这个前提下就是 ISchemaAdapter<TDomain, TStored> 的正确形状。
  const schema: ISchemaAdapter<TDomain, TStored> =
    configuredSchema === undefined
      ? (passthrough<TDomain>() as unknown as ISchemaAdapter<TDomain, TStored>)
      : snapshotSchema<TDomain, TStored>(configuredSchema)
  // 不在这里默认成 jsonCodec：结构化后端（IndexedDB/memory）与 KV 后端的
  // 合理默认不同，且只有 connect(store) 时才知道是哪种后端。未显式配置时
  // 由 createRepository 按 store.capabilities 决定；显式配置的 codec 原样
  // 传递，经 selectCodec 按后端能力选路，见 repository.ts。
  const codec = configuredCodec === undefined ? undefined : snapshotCodec(configuredCodec)
  const version = configuredVersion === undefined ? 1 : (configuredVersion as number)
  const migrations = snapshotMigrations(configuredMigrations)
  const indexes = snapshotEntityIndexes<TDomain>(configuredIndexes)
  const normalizedOptions = {
    name,
    key,
    schema,
    codec,
    version,
    migrations,
    validateOnRead: configuredValidateOnRead,
    onDiagnostic: configuredOnDiagnostic,
    defaultOrderBy: configuredDefaultOrderBy
  } as IEntityOptions<TDomain, TStored, undefined>
  validateDefinition(normalizedOptions, version)
  const validateOnRead = (configuredValidateOnRead ?? true) as boolean
  const onDiagnostic = (configuredOnDiagnostic ?? defaultDiagnostic) as (message: string) => void
  const defaultOrderBy = configuredDefaultOrderBy as IEntityOptions<TDomain>['defaultOrderBy']

  return Object.freeze({
    name,
    version,
    connect: (
      store: IKeyValueStore
    ): IRepository<TDomain, Readonly<Record<string, import('../types/context.js').IStorageKey>>> =>
      createRepository<
        TDomain,
        TStored,
        Readonly<Record<string, import('../types/context.js').IStorageKey>>
      >(
        {
          name,
          key,
          version,
          schema,
          codec,
          migrations,
          validateOnRead,
          onDiagnostic,
          defaultOrderBy,
          indexes
        },
        store
      )
  })
}
