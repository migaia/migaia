import { EntityText } from './text.js'
import { passthrough } from '../schema/passthrough.js'
import { createRepository } from './repository.js'
import type { IEntityConnectStore } from './types.js'
import type { ISchemaAdapter } from '../entity.js'
import { type IMigrationStep } from '@migaia/storage-contract'
import { createMigrationPlan } from '../authoring/migration.js'
import type {
  IEntityDefinition,
  IEntityIndex,
  IEntityIndexMap,
  IEntityOptions,
  IRepository,
  IEntityConnectOptions,
  IEntityStoreQueryMethods
} from './types.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { snapshotCodec } from '../authoring/codec.js'
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
    invalidDefinition(EntityText.entitySchemaMustBeAnObject)
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
    invalidDefinition(EntityText.entitySchemaMustDeclareNameAndValidate)
  return { name, validate, encode, decode, normalize } as ISchemaAdapter<TDomain, TStored>
}

const validateDefinition = <TDomain, TStored>(
  options: IEntityOptions<TDomain, TStored>,
  version: number
): void => {
  if (typeof options.name !== 'string' || options.name.trim() === '')
    invalidDefinition(EntityText.entityNameMustBeNonEmpty)
  if (options.name.startsWith(RESERVED_ENTITY_PREFIX))
    invalidDefinition(EntityText.entityNameUsesReservedPrefix)
  if (!Number.isSafeInteger(version) || version < 1)
    invalidDefinition(EntityText.entityVersionMustBeAPositiveSafeInteger)
  if (typeof options.key !== 'string' || options.key.length === 0)
    invalidDefinition(EntityText.entityKeyMustBeANonEmptyPropertyName)
  if (options.schema === undefined) invalidDefinition(EntityText.entitySchemaSnapshotIsRequired)
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== 'function')
    invalidDefinition(EntityText.entityOnDiagnosticMustBeAFunction)
  if (options.validateOnRead !== undefined && typeof options.validateOnRead !== 'boolean')
    invalidDefinition(EntityText.entityValidateOnReadMustBeABoolean)
  if (options.defaultOrderBy !== undefined && typeof options.defaultOrderBy !== 'function')
    invalidDefinition(EntityText.entityDefaultOrderByMustBeAFunction)
}

const defaultDiagnostic = (message: string): void => {
  const runtime = globalThis as typeof globalThis & { console?: { warn(value: string): void } }
  runtime.console?.warn(message)
}

/**
 * Defines a record entity declaratively. `connect()` binds the definition to a backend and returns
 * a repository for repeated `get`, `put`, `remove`, `list`, `stream`, and `batch` calls. The same
 * definition can connect to multiple backends with capability-selected codec/query routes.
 * Definition errors throw INVALID_CONFIG before backend use; version defaults to 1 and
 * validateOnRead to true. The curried form is required when declaring indexes; each connected Store
 * retains its disposal ownership.
 */
export function defineEntity<TDomain, TStored = TDomain>(
  options: IEntityOptions<TDomain, TStored, never> & { readonly indexes?: undefined }
): IEntityDefinition<TDomain>
/** Choose the domain type first, then infer literal index names from the supplied entity options. */
export function defineEntity<TDomain, TStored = TDomain>(): IDefineEntityBuilder<TDomain, TStored>
export function defineEntity<TDomain, TStored = TDomain>(
  options?: IEntityOptions<
    TDomain,
    TStored,
    Readonly<Record<string, IEntityIndex<TDomain>>> | undefined
  >,
  allowCurriedIndexes = false
):
  | IEntityDefinition<
      TDomain,
      Readonly<Record<string, import('@migaia/storage-contract').IStorageKey>>
    >
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
  if (options === undefined) return invalidDefinition(EntityText.entityDefinitionMustBeAnObject)
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    invalidDefinition(EntityText.entityDefinitionMustBeAnObject)
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
    invalidDefinition(EntityText.entityIndexesRequireCurriedDeclaration)
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
  const indexes = snapshotEntityIndexes<TDomain>(configuredIndexes)
  const normalizedOptions = {
    name,
    key,
    schema,
    codec,
    version,
    validateOnRead: configuredValidateOnRead,
    onDiagnostic: configuredOnDiagnostic,
    defaultOrderBy: configuredDefaultOrderBy
  } as IEntityOptions<TDomain, TStored, undefined>
  validateDefinition(normalizedOptions, version)
  /**
   * Pass original own steps to the sole canonical plan admission without dropping symbols or
   * aliases.
   */
  const migrationPlan = (() => {
    try {
      return createMigrationPlan({
        version,
        steps: configuredMigrations as Readonly<Record<number, IMigrationStep>> | undefined
      })
    } catch (cause) {
      throw new StorageError(
        StorageErrorCode.invalidConfig,
        { cause },
        StorageErrorText.entityMigrationGraphIncomplete
      )
    }
  })()
  const validateOnRead = (configuredValidateOnRead ?? true) as boolean
  const onDiagnostic = (configuredOnDiagnostic ?? defaultDiagnostic) as (message: string) => void
  const defaultOrderBy = configuredDefaultOrderBy as IEntityOptions<TDomain>['defaultOrderBy']

  return {
    name,
    version,
    connect: <S extends IEntityConnectStore>(
      store: S,
      connectOptions?: IEntityConnectOptions
    ): IRepository<
      TDomain,
      Readonly<Record<string, import('@migaia/storage-contract').IStorageKey>>,
      S extends { readonly capabilities: { readonly changeFeed: true } } ? true : false,
      IEntityStoreQueryMethods<S>
    > =>
      createRepository<
        TDomain,
        TStored,
        Readonly<Record<string, import('@migaia/storage-contract').IStorageKey>>,
        IEntityStoreQueryMethods<S>,
        S extends { readonly capabilities: { readonly changeFeed: true } } ? true : false
      >(
        {
          name,
          key,
          version,
          migrationPlan,
          schema,
          codec,
          validateOnRead,
          onDiagnostic,
          defaultOrderBy,
          indexes
        },
        store,
        connectOptions
      )
  }
}
