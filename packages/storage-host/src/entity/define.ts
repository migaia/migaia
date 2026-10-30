import { EntityFeatureName } from './constants.ts'
import { EntityText } from './text.ts'
import { passthrough } from '../schema/passthrough.ts'
import { createRepository } from './repository.ts'
import { definePlugin } from '../contracts.ts'
import type { IStoragePipelineInput } from '../types.ts'
import type { IFeatureRecord, IFeatureOutputs, IPluginHostCore } from '@migaia/plugin-host'
import type { IRepositoryConfig } from './repository-shared.ts'
import type { ISchemaAdapter } from '../entity.ts'
import type {
  IEntityPlugin,
  IEntityIndex,
  IEntityIndexMap,
  IEntityPluginOptions,
  IEntityConnectStore,
  IEntityConnectOptions,
  IEntityRepositoryAccess
} from './types.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { assertCodec, type IStorageKey } from '@migaia/storage-contract'
import {
  captureEntityUnitRecord,
  configureEntityUnits,
  entityUnitTarget,
  missingEntityFeature,
  snapshotEntityUnits,
  type IInstalledRepositoryUnit,
  type IRepositoryUnitFactory
} from './assembly.ts'

/** Explicit-domain declarations infer literal plugin ids and declared index names at the call. */
export type IDefineEntityPluginBuilder<TDomain, TStored> = {
  <const TId extends string>(
    id: TId,
    options: IEntityPluginOptions<TDomain, TStored, undefined> & { readonly indexes?: undefined }
  ): IEntityPlugin<TDomain, Readonly<Record<never, IStorageKey>>, TId>
  <
    const TId extends string,
    const TIndexes extends Readonly<Record<string, IEntityIndex<TDomain>>>
  >(
    id: TId,
    options: Omit<IEntityPluginOptions<TDomain, TStored, TIndexes>, 'indexes'> & {
      readonly indexes: TIndexes
    }
  ): IEntityPlugin<TDomain, IEntityIndexMap<TDomain, TIndexes>, TId>
}

/** Native installation lends its exact root outputs and existing registration lifetime. */
type IEntityPluginCore = Pick<IPluginHostCore<IStoragePipelineInput>, 'lifecycle'> &
  Readonly<{ features: IFeatureOutputs<IFeatureRecord> }>

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
  options: IEntityPluginOptions<TDomain, TStored, any>,
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
/** One actual host registration owns installed factories and its immutable entity configuration. */
class EntityPluginRegistration<TDomain, TStored, TId extends string> {
  /** The explicit id addresses the native extension independently of the persisted namespace. */
  readonly #id: TId
  /** Native outputs are read only after feature construction, in the descriptor install hook. */
  readonly #core: IEntityPluginCore
  /** Resolved role addresses are installation-local and never scanned by an operation. */
  readonly #roles: ReadonlyMap<EntityFeatureName, string>
  /** Ordered native outputs are captured once without allocating Map entry tuples per repository. */
  readonly #units: IInstalledRepositoryUnit[] = []
  /** Configuration borrows the native signal and never owns the supplied backends. */
  readonly #configuration: IRepositoryConfig<TDomain, TStored>

  /** Resolve role-dependent admission before any unit install or public extension can run. */
  constructor(
    id: TId,
    options: IEntityPluginOptions<TDomain, TStored, any>,
    schema: ISchemaAdapter<TDomain, TStored>,
    version: number,
    record: IFeatureRecord,
    core: IEntityPluginCore
  ) {
    this.#id = id
    this.#core = core
    /** Duplicate and missing roles are rejected in this native installation window. */
    const assembly = snapshotEntityUnits(record)
    this.#roles = assembly.roles
    if (
      options.indexes !== undefined &&
      !assembly.roles.has(EntityFeatureName.indexes) &&
      !assembly.roles.has(EntityFeatureName.unique)
    )
      missingEntityFeature(EntityFeatureName.indexes)
    if (
      (version !== 1 || options.migrations !== undefined) &&
      !assembly.roles.has(EntityFeatureName.migration)
    )
      missingEntityFeature(EntityFeatureName.migration)
    /** Configuration callbacks remain declaration-only; installed outputs hold capability factories. */
    const configured = configureEntityUnits(assembly, options)
    /** Indexes/unique share their one canonical immutable projection. */
    const indexes = configured.indexes ?? {}
    /** Every repository borrows the same immutable unique projection of the admitted snapshots. */
    const uniqueIndexes: Record<string, (typeof indexes)[string]> = {}
    /** Native/fallback commits reuse the exact existing definition identities in declaration order. */
    const uniqueDefinitions: (typeof indexes)[string]['definition'][] = []
    for (const [key, index] of Object.entries(indexes)) {
      if (!index.definition.unique) continue
      uniqueIndexes[key] = index
      uniqueDefinitions.push(index.definition)
    }
    if (uniqueDefinitions.length !== 0 && !assembly.roles.has(EntityFeatureName.unique))
      missingEntityFeature(EntityFeatureName.unique)
    this.#configuration = {
      name: options.name,
      key: options.key,
      version,
      migrationPlan: configured.migrationPlan,
      units: this.#units,
      signal: core.lifecycle.signal,
      schema,
      codec: options.codec,
      validateOnRead: options.validateOnRead ?? true,
      onDiagnostic: options.onDiagnostic ?? defaultDiagnostic,
      defaultOrderBy: options.defaultOrderBy,
      indexes,
      uniqueIndexes,
      uniqueDefinitions
    }
  }

  /** The native host creates feature outputs before invoking this single install callback. */
  descriptor() {
    return { install: () => this.#install() }
  }

  /** Publish the flat guarded native repository extension after indexing exact factory outputs. */
  #install(): Record<TId, IEntityRepositoryAccess<TDomain, Readonly<Record<string, IStorageKey>>>> {
    for (const [role, key] of this.#roles)
      this.#units.push({ role, factory: this.#core.features[key] as IRepositoryUnitFactory })
    return {
      [this.#id]: (store: IEntityConnectStore, options?: IEntityConnectOptions) =>
        createRepository(this.#configuration, store, options)
    } as Record<TId, IEntityRepositoryAccess<TDomain, Readonly<Record<string, IStorageKey>>>>
  }
}

/** Capture a reusable declaration; host installation creates its native registration state. */
class EntityPluginDefinition<TDomain, TStored, TId extends string> {
  /** Plugin registration identity is independent of its persisted entity namespace. */
  readonly #id: TId
  /** Scalar choices and original schema/codec receivers are captured before asynchronous install. */
  readonly #options: IEntityPluginOptions<TDomain, TStored, any>
  /** Native root admission is snapshotted while role-dependent failures remain install-time. */
  readonly #record: IFeatureRecord
  /** The original schema remains authoritative for every repository obtained from this plugin. */
  readonly #schema: ISchemaAdapter<TDomain, TStored>
  /** One validated target version supplies migration admission in each host installation. */
  readonly #version: number

  /** Validate scalar declaration facts without running role admission or creating a repository. */
  constructor(id: TId, options: IEntityPluginOptions<TDomain, TStored, any>) {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      invalidDefinition(EntityText.entityDefinitionMustBeAnObject)
    this.#id = id
    this.#version = options.version === undefined ? 1 : options.version
    validateDefinition(options, this.#version)
    if (options.schema !== undefined) assertEntitySchema<TDomain, TStored>(options.schema)
    if (options.codec !== undefined) assertCodec(options.codec)
    this.#schema =
      options.schema === undefined
        ? (passthrough<TDomain>() as unknown as ISchemaAdapter<TDomain, TStored>)
        : options.schema
    this.#record = captureEntityUnitRecord(options.features)
    this.#options = { ...options, features: this.#record }
  }

  /** Existing storage admission installs this actual native plugin, with no private Host. */
  plugin(): IEntityPlugin<TDomain, Readonly<Record<string, IStorageKey>>, TId> {
    return definePlugin(this.#id, (core) => this.#descriptor(core), this.#record, entityUnitTarget)
  }

  /** One descriptor owner is created per host installation, before native feature construction. */
  #descriptor(core: IEntityPluginCore) {
    return new EntityPluginRegistration(
      this.#id,
      this.#options,
      this.#schema,
      this.#version,
      this.#record,
      core
    ).descriptor()
  }
}

/** Build a declaration from either public call form without retaining a closure-based component. */
function createEntityPlugin<TDomain, TStored, const TId extends string>(
  id: TId,
  options: IEntityPluginOptions<TDomain, TStored, any>
): IEntityPlugin<TDomain, Readonly<Record<string, IStorageKey>>, TId> {
  return new EntityPluginDefinition(id, options).plugin()
}

/** Select an explicit domain first, then infer the plugin id and literal index contract. */
export function defineEntityPlugin<TDomain, TStored = TDomain>(): IDefineEntityPluginBuilder<
  TDomain,
  TStored
>
/** Infer an entity's domain and stored form from its schema while preserving its literal id. */
export function defineEntityPlugin<
  const TId extends string,
  TDomain,
  TStored = TDomain,
  const TIndexes extends Readonly<Record<string, IEntityIndex<TDomain>>> | undefined = undefined
>(
  id: TId,
  options: IEntityPluginOptions<TDomain, TStored, TIndexes>
): IEntityPlugin<
  TDomain,
  TIndexes extends Readonly<Record<string, IEntityIndex<TDomain>>>
    ? IEntityIndexMap<TDomain, TIndexes>
    : Readonly<Record<never, IStorageKey>>,
  TId
>
/** Dispatch declaration forms; native factories run only when a storage host installs the plugin. */
export function defineEntityPlugin<TDomain, TStored = TDomain>(
  id?: string,
  options?: IEntityPluginOptions<TDomain, TStored, any>
):
  | IDefineEntityPluginBuilder<TDomain, TStored>
  | IEntityPlugin<TDomain, Readonly<Record<string, IStorageKey>>> {
  if (arguments.length === 0)
    return createEntityPlugin as IDefineEntityPluginBuilder<TDomain, TStored>
  if (options === undefined) return invalidDefinition(EntityText.entityDefinitionMustBeAnObject)
  return createEntityPlugin(id!, options)
}
