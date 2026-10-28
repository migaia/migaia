import { EntityFeatureName } from './constants.ts'
import { EntityText } from './text.ts'
import { passthrough } from '../schema/passthrough.ts'
import { createRepository } from './repository.ts'
import type { IEntityConnectStore } from './types.ts'
import type { ISchemaAdapter } from '../entity.ts'
import type {
  IEntityDefinition,
  IEntityIndex,
  IEntityIndexMap,
  IEntityOptions,
  IRepository,
  IEntityConnectOptions,
  IEntityStoreQueryMethods
} from './types.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { assertCodec } from '@migaia/storage-contract'
import type { IRepositoryConfig } from './repository-shared.ts'
import { missingEntityFeature } from './assembly.ts'

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

/** Entity names cannot enter the host's reserved internal key namespace. */
const RESERVED_ENTITY_PREFIX = '__'
/** Definition admission retains its existing native TypeError cause and public config code. */
function invalidDefinition(message: string): never {
  throw new StorageError(StorageHostErrorCode.invalidConfig, { cause: new TypeError(message) })
}
/** Validate public schema ports while borrowing the original class/object receiver. */
function assertEntitySchema<TDomain, TStored>(
  schema: unknown
): asserts schema is ISchemaAdapter<TDomain, TStored> {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    invalidDefinition(EntityText.entitySchemaMustBeAnObject)
  /** Ordinary properties are admitted without hostile-accessor interception or method copies. */
  const candidate = schema as Record<string, unknown>
  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim() === '' ||
    typeof candidate.validate !== 'function' ||
    (candidate.encode !== undefined && typeof candidate.encode !== 'function') ||
    (candidate.decode !== undefined && typeof candidate.decode !== 'function') ||
    (candidate.normalize !== undefined && typeof candidate.normalize !== 'function')
  )
    invalidDefinition(EntityText.entitySchemaMustDeclareNameAndValidate)
}
/** Validate scalar declaration choices before any repository is connected. */
function validateDefinition<TDomain, TStored>(
  options: IEntityOptions<TDomain, TStored>,
  version: number
): void {
  if (typeof options.name !== 'string' || options.name.trim() === '')
    invalidDefinition(EntityText.entityNameMustBeNonEmpty)
  if (options.name.startsWith(RESERVED_ENTITY_PREFIX))
    invalidDefinition(EntityText.entityNameUsesReservedPrefix)
  if (!Number.isSafeInteger(version) || version < 1)
    invalidDefinition(EntityText.entityVersionMustBeAPositiveSafeInteger)
  if (typeof options.key !== 'string' || options.key.length === 0)
    invalidDefinition(EntityText.entityKeyMustBeANonEmptyPropertyName)
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== 'function')
    invalidDefinition(EntityText.entityOnDiagnosticMustBeAFunction)
  if (options.validateOnRead !== undefined && typeof options.validateOnRead !== 'boolean')
    invalidDefinition(EntityText.entityValidateOnReadMustBeABoolean)
  if (options.defaultOrderBy !== undefined && typeof options.defaultOrderBy !== 'function')
    invalidDefinition(EntityText.entityDefaultOrderByMustBeAFunction)
}
/** Default diagnostics reuse the host's existing console channel. */
function defaultDiagnostic(message: string): void {
  /** Console is optional in neutral hosts and creates no extra reporting owner. */
  const runtime = globalThis as typeof globalThis & { console?: { warn(value: string): void } }
  runtime.console?.warn(message)
}
/** One reusable declaration owns configuration while each connected repository owns its work. */
class EntityDefinition<TDomain, TStored> {
  /** The original repository config type prevents a parallel declaration contract. */
  readonly #configuration: Parameters<typeof createRepository<TDomain, TStored>>[0]
  /** Public namespace is captured before future connections can await native work. */
  readonly name: string
  /** Public envelope version selects the same canonical migration plan at every connection. */
  readonly version: number
  /** Admit a declaration, retaining original schema/codec receivers and canonical index facts. */
  constructor(
    options: IEntityOptions<
      TDomain,
      TStored,
      Readonly<Record<string, IEntityIndex<TDomain>>> | undefined
    >,
    allowIndexes: boolean
  ) {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      invalidDefinition(EntityText.entityDefinitionMustBeAnObject)
    if (options.indexes !== undefined && !allowIndexes)
      invalidDefinition(EntityText.entityIndexesRequireCurriedDeclaration)
    /** Omitted schema has the original domain-preserving passthrough behavior. */
    const schema =
      options.schema === undefined
        ? (passthrough<TDomain>() as unknown as ISchemaAdapter<TDomain, TStored>)
        : options.schema
    // Explicit null must remain invalid rather than being treated as omitted.
    if (options.schema !== undefined) assertEntitySchema<TDomain, TStored>(options.schema)
    /** Codec admission borrows its original receiver; the native route is selected at connect. */
    const codec = options.codec
    if (codec !== undefined) assertCodec(codec)
    this.version = options.version === undefined ? 1 : options.version
    validateDefinition(options as IEntityOptions<TDomain, TStored>, this.version)
    if (options.features !== undefined && !Array.isArray(options.features))
      invalidDefinition(EntityText.featuresMustBeArray)
    /** Index declaration errors retain their original precedence before scalar/migration admission. */
    const features = [...(options.features ?? [])]
    /** Reject malformed or repeated explicit units before any definition callback executes. */
    const declaredFeatures = new Set<string>()
    for (const feature of features) {
      if (
        feature === null ||
        typeof feature !== 'object' ||
        typeof feature.name !== 'string' ||
        typeof feature.create !== 'function' ||
        (feature.configure !== undefined && typeof feature.configure !== 'function') ||
        declaredFeatures.has(feature.name)
      )
        invalidDefinition(EntityText.featuresMustBeArray)
      declaredFeatures.add(feature.name)
    }
    if (
      options.indexes !== undefined &&
      !features.some(
        (feature) =>
          feature.name === EntityFeatureName.indexes || feature.name === EntityFeatureName.unique
      )
    )
      missingEntityFeature(EntityFeatureName.indexes)
    if (
      (this.version !== 1 || options.migrations !== undefined) &&
      !features.some((feature) => feature.name === EntityFeatureName.migration)
    )
      missingEntityFeature(EntityFeatureName.migration)
    const configured: Partial<IRepositoryConfig<TDomain, TStored>> = Object.assign(
      {},
      ...features.map((feature) => feature.configure?.(options))
    )
    const indexes = configured.indexes ?? {}
    if (
      Object.values(indexes).some((index) => index.definition.unique) &&
      !features.some((feature) => feature.name === EntityFeatureName.unique)
    )
      missingEntityFeature(EntityFeatureName.unique)
    validateDefinition(options as IEntityOptions<TDomain, TStored>, this.version)
    this.name = options.name
    this.#configuration = {
      name: this.name,
      key: options.key,
      version: this.version,
      migrationPlan: configured.migrationPlan,
      features,
      schema,
      codec,
      validateOnRead: options.validateOnRead ?? true,
      onDiagnostic: options.onDiagnostic ?? defaultDiagnostic,
      defaultOrderBy: options.defaultOrderBy,
      indexes
    }
  }
  /** The own arrow retains the original extractable connect method without taking store ownership. */
  readonly connect = <S extends IEntityConnectStore>(
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
    >(this.#configuration, store, connectOptions)
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
  if (arguments.length === 0)
    return ((
      configured: IEntityOptions<TDomain, TStored, Readonly<Record<string, IEntityIndex<TDomain>>>>
    ) => new EntityDefinition(configured, true)) as IDefineEntityBuilder<TDomain, TStored>
  if (options === undefined) return invalidDefinition(EntityText.entityDefinitionMustBeAnObject)
  return new EntityDefinition(options, allowCurriedIndexes)
}
