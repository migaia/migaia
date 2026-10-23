import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'
import {
  snapshotStorageBaseDetailed,
  type IStorageBase,
  type IStorageBaseAdmission,
  type IKeyValueStore
} from './store.js'
import type { ITransactionBuilder } from './concurrency.js'
import type { IWriteConcurrencyOptions } from './concurrency.js'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { IOperationContext, IStorageKey } from './context.js'
import type { IRecordQuery } from './query-chain.js'
import type {
  ITransactionScope,
  ITransactionKeyValueApi,
  ITransactionRecordsApi
} from './transaction.js'
import {
  STORAGE_CAPABILITY_METHODS,
  STORAGE_KEY_VALUE_METHODS,
  SYNC_KEY_VALUE_METHODS,
  STORAGE_KEY_VALUE_PROPERTIES,
  StorageCapabilityMethod
} from './capability-constants.js'

/** Type-only API carrier; runtime authority belongs exclusively to the private token set. */
declare const capabilityApi: unique symbol
/** Contravariant capability set prevents a subset store from claiming additional capabilities. */
declare const storeCapabilities: unique symbol
/** Implementation records cannot be written as ordinary public object literals. */
declare const capabilityImplementation: unique symbol
/** Only the provider can issue its installation port. */
declare const capabilityInstallerBrand: unique symbol
/** Retains the exact implementation tuple for host-side type projection. */
declare const providedImplementations: unique symbol

/** A capability names one API contract without supplying a backend or data implementation. */
export type IStorageCapability<TName extends string, TApi> = {
  readonly name: TName
  readonly [capabilityApi]: TApi
}

/** Common capability upper bound; names are diagnostic rather than runtime permissions. */
export type IAnyStorageCapability = IStorageCapability<string, unknown>

/** Projects a token's declared public API without changing its runtime identity. */
export type ICapabilityApi<TCap extends IAnyStorageCapability> =
  TCap extends IStorageCapability<string, infer TApi> ? TApi : never

export type { IStorageBase } from './store.js'

/** Minimal capability-aware store surface, retaining its exact admitted capability set. */
export type IStorageStore<TCaps extends IAnyStorageCapability = never> = IStorageBase & {
  readonly [storeCapabilities]: (capability: TCaps) => void
  use<TCap extends TCaps>(capability: TCap): ICapabilityApi<TCap>
  has(capability: IAnyStorageCapability): boolean
}

/** The existing KV contract remains the single declaration of its callable API and sync channel. */
export type IKeyValueApi = Omit<
  IKeyValueStore,
  'backend' | 'capabilities' | 'dispose' | typeof Symbol.asyncDispose
>

/**
 * Standard record entry reuses the implemented query core; writes retain the native backend
 * pipeline.
 */
export type IRecordsApi<
  TValue = ICodecValue,
  _TChangeFeed extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = {
  query<R = TValue>(): IRecordQuery<R, IOperationContext, TAugmentMethods>
  removeByPrefix(
    prefix: IStorageKey,
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<number>
}

/** Only standard capabilities with a declared transaction projection belong to transaction use. */
export type ITransactionalCapability<TCaps extends IAnyStorageCapability> = Extract<
  TCaps,
  typeof kv | typeof records
>

/** Projects the standard transaction API without creating or admitting a transaction scope. */
export type ITransactionCapabilityApi<TCap extends IAnyStorageCapability> = TCap extends typeof kv
  ? ITransactionKeyValueApi
  : TCap extends typeof records
    ? ITransactionRecordsApi
    : never

/** Optional contravariant proof permits complete external scopes without private symbol access. */
export type ITransactionCapabilityView<
  TCaps extends IAnyStorageCapability,
  TValue = ICodecValue
> = {
  readonly [storeCapabilities]?: (capability: TCaps) => void
  use<TCap extends ITransactionalCapability<TCaps>>(
    capability: TCap
  ): TCap extends typeof records ? ITransactionRecordsApi<TValue> : ITransactionCapabilityApi<TCap>
}
/** Actual record values follow the original backend getRecord declaration, never a root API cast. */
type IScopeRecordValue<TScope> = TScope extends {
  getRecord(key: IStorageKey): Promise<(infer TValue) | undefined>
}
  ? TValue
  : ICodecValue
/** Replaces only capability-facing members while preserving every native scope extension. */
type IAddScopedCapabilities<TScope, TCaps extends IAnyStorageCapability> = Omit<
  TScope,
  'use' | typeof storeCapabilities
> &
  ITransactionCapabilityView<TCaps, IScopeRecordValue<TScope>>
/** Frozen implementation descriptor; the API object keeps its backend-owned lifetime. */
export type ICapabilityImpl<
  TCap extends IAnyStorageCapability = IAnyStorageCapability,
  TApi extends ICapabilityApi<TCap> = ICapabilityApi<TCap>
> = {
  readonly [capabilityImplementation]: true
  readonly capability: TCap
  readonly api: TApi
}

/** Exact API supplied for a selected token, including backend-specific refinements. */
type IProvidedApi<
  TImplementations extends readonly ICapabilityImpl[],
  TCap extends IAnyStorageCapability
> =
  Extract<TImplementations[number], { readonly capability: TCap }> extends infer TMatch
    ? [TMatch] extends [never]
      ? ICapabilityApi<TCap>
      : TMatch extends { readonly api: infer TApi }
        ? TApi
        : ICapabilityApi<TCap>
    : never

/** KV methods become flat only when the provider receives the real standard KV token. */
type IFlatKeyValue<TCaps extends IAnyStorageCapability> = [Extract<TCaps, typeof kv>] extends [
  never
]
  ? Record<never, never>
  : IKeyValueApi

/**
 * Retains the backend's full scope, options and existing builder augmentation without owning
 * execution.
 */
type ITransactionMembers<TBase, TCaps extends IAnyStorageCapability> = TBase extends {
  transaction(run: (scope: infer TScope) => unknown, options?: infer TOptions): unknown
}
  ? {
      transaction<TResult>(
        run: (scope: IAddScopedCapabilities<TScope, TCaps>) => TResult,
        options?: TOptions
      ): Promise<Awaited<TResult>>
    } & (TBase extends { tx(): ITransactionBuilder<infer TBuilderScope, infer TAugmentMethods> }
      ? { tx(): ITransactionBuilder<IAddScopedCapabilities<TBuilderScope, TCaps>, TAugmentMethods> }
      : TBase extends { tx(): infer TBuilder }
        ? { tx(): TBuilder }
        : Record<never, never>)
  : Record<never, never>

/** Refines the original base object without spreading away class or nonenumerable public members. */
export type ICapabilityStore<
  TBase,
  TCaps extends IAnyStorageCapability,
  TImplementations extends readonly ICapabilityImpl[] = readonly []
> = Omit<
  TBase,
  'use' | 'has' | 'transaction' | 'tx' | typeof providedImplementations | typeof storeCapabilities
> &
  Omit<IStorageStore<TCaps>, 'use'> & {
    readonly [providedImplementations]?: TImplementations
    use<TCap extends TCaps>(capability: TCap): IProvidedApi<TImplementations, TCap>
  } & IFlatKeyValue<TCaps> &
  ITransactionMembers<TBase, TCaps>

/** Public type projection; only the provider's private object table grants runtime authority. */
export type IStorageCapabilitySet<TStore> = TStore extends {
  readonly [storeCapabilities]: (capability: infer TCaps) => void
}
  ? Extract<TCaps, IAnyStorageCapability>
  : never

/** Projects the exact original implementation tuple without creating any capability. */
export type IStorageImplementationsOf<TStore> = TStore extends {
  readonly [providedImplementations]?: infer TImplementations extends readonly ICapabilityImpl[]
}
  ? TImplementations
  : readonly []

/** Projects the original API from admitted implementation metadata without creating authority. */
export type IStorageCapabilityApiOf<TStore, TCap extends IAnyStorageCapability> = IProvidedApi<
  IStorageImplementationsOf<TStore>,
  TCap
>

/** A prepared publication is local until publish; release removes only its own installations. */
export type ICapabilityPublication = {
  publish(): void
  release(): void
}

/** Unique per-store installation port used by its host to publish selected Feature outputs. */
export type ICapabilityInstallPort = {
  readonly [capabilityInstallerBrand]: true
  prepare(implementations: readonly ICapabilityImpl[]): ICapabilityPublication
}

/** Authentic token identities; no global name-to-token lookup exists. */
const tokens = new WeakSet<object>()
/** Transaction binding stays private until the original transaction owner asks for its projection. */
type IImplementationRecord = {
  readonly implementation: ICapabilityImpl
  readonly forTransaction?: (scope: ITransactionScope) => unknown
}
/** Authentic immutable descriptors; public symbols and lookalike fields do not authorize them. */
const implementations = new WeakMap<object, IImplementationRecord>()

/** One entry retains descriptor identity and publication visibility inside its owning store table. */
type IInstalledCapability = { readonly implementation: ICapabilityImpl; published: boolean }
/** Each provided base owns exactly one token table, including prepared unpublished entries. */
const stores = new WeakMap<object, ICapabilityStoreRecord>()
/** The one registry retains original diagnostics beside its existing capability table. */
type ICapabilityStoreRecord = {
  readonly table: Map<IAnyStorageCapability, IInstalledCapability>
  readonly backend: IStorageBase['backend']
}

/** Creates a frozen identity token for one API contract; duplicate names remain distinct tokens. */
export function defineStorageCapability<TApi>(): <const TName extends string>(
  name: TName
) => IStorageCapability<TName, TApi> {
  return <const TName extends string>(name: TName): IStorageCapability<TName, TApi> => {
    if (typeof name !== 'string' || name.length === 0) throw invalidCapability()
    /** Only this captured object identity is later admitted as the token. */
    const token = Object.freeze({ name }) as IStorageCapability<TName, TApi>
    tokens.add(token)
    return token
  }
}

/** Standard text key-value API token; its implementation still belongs to the backend. */
export const kv = defineStorageCapability<IKeyValueApi>()('kv')
/** Standard records token grants only an authentic provided record API, never a legacy support flag. */
export const records = defineStorageCapability<IRecordsApi>()('records')

/** Builds the canonical argument error, preserving a reflected provider failure when available. */
function invalidCapability(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.capabilityArgument
  )
}

/** Tests private token identity without consulting a name, user getter, or public brand. */
function isToken(value: unknown): value is IAnyStorageCapability {
  return typeof value === 'object' && value !== null && tokens.has(value)
}

/** Shared token membership path for store methods and read-only root access, with no user reads. */
function hasCapability(record: ICapabilityStoreRecord | undefined, capability: unknown): boolean {
  return isToken(capability) && record?.table.get(capability)?.published === true
}

/** Shared token lookup retains the original captured backend diagnostic and exact API identity. */
function useCapability(
  store: IStorageBase,
  record: ICapabilityStoreRecord | undefined,
  capability: unknown
): unknown {
  if (!isToken(capability)) throw invalidCapability()
  /** Prepared Feature entries remain absent until their original publication is visible. */
  const installed = record?.table.get(capability)
  if (installed?.published) return installed.implementation.api
  /** Provided stores never re-read backend getters; a raw base has no prior captured identity. */
  let backend: IStorageBase['backend']
  try {
    backend = record === undefined ? store.backend : record.backend
  } catch (cause) {
    throw invalidCapability(cause)
  }
  throw new StorageContractError(
    StorageContractErrorCode.unsupported,
    { backend },
    StorageContractErrorText.capabilityMissing(capability.name, backend)
  )
}

/**
 * Reads the original provider table without changing the base, granting installation authority or
 * acquiring cleanup ownership. Authentic published tokens behave exactly like store.has(token);
 * missing, forged and raw-store tokens return false, including on frozen bases.
 */
export function hasStorageCapability(
  store: IStorageBase,
  capability: IAnyStorageCapability
): boolean {
  return hasCapability(stores.get(store), capability)
}

/**
 * Returns the same original API as store.use(token), including exact native implementation types.
 * Forged tokens throw INVALID_ARGUMENT; authentic missing tokens throw UNSUPPORTED_CAPABILITY using
 * the original provider backend diagnostic. Raw and frozen bases remain unmodified.
 */
export function useStorageCapability<
  TStore extends IStorageBase,
  TCap extends IAnyStorageCapability
>(store: TStore, capability: TCap): IProvidedApi<IStorageImplementationsOf<TStore>, TCap> {
  return useCapability(store, stores.get(store), capability) as IProvidedApi<
    IStorageImplementationsOf<TStore>,
    TCap
  >
}

/**
 * Internal original-owner access reads the same published store table and private implementation
 * record. It returns no public provider/registration authority and never invokes the binder.
 */
export function readTransactionImplementation(
  store: IStorageBase,
  capability: IAnyStorageCapability
): IImplementationRecord & { readonly forTransaction: (scope: ITransactionScope) => unknown } {
  /** Root membership and forged-token diagnostics use the exact canonical lookup first. */
  const record = stores.get(store)
  useCapability(store, record, capability)
  /** Published implementation identity remains the authority for transaction binding. */
  const installed = record!.table.get(capability)!
  /** Only the implemented finite standard projections can be requested from this owner. */
  const binding = implementations.get(installed.implementation)!
  if ((capability !== kv && capability !== records) || binding.forTransaction === undefined)
    throw new StorageContractError(
      StorageContractErrorCode.unsupported,
      { backend: record!.backend },
      StorageContractErrorText.capabilityTransactionMissing(capability.name, record!.backend)
    )
  return binding as IImplementationRecord & {
    readonly forTransaction: (scope: ITransactionScope) => unknown
  }
}
/** Creates a frozen authentic implementation descriptor without taking ownership of its API. */
export function implement<
  TCap extends IAnyStorageCapability,
  TApi extends ICapabilityApi<NoInfer<TCap>> = ICapabilityApi<TCap>
>(
  capability: TCap,
  api: TApi,
  options?: {
    readonly forTransaction?: (scope: ITransactionScope) => NoInfer<ITransactionCapabilityApi<TCap>>
  }
): ICapabilityImpl<TCap, TApi> {
  if (!isToken(capability)) throw invalidCapability()
  /** Capture the binder without executing it or exposing root API authority to a transaction. */
  let forTransaction: ((scope: ITransactionScope) => unknown) | undefined
  try {
    if (
      options !== undefined &&
      (typeof options !== 'object' || options === null || Array.isArray(options))
    )
      throw invalidCapability()
    forTransaction = options?.forTransaction
    if (
      forTransaction !== undefined &&
      ((capability !== kv && capability !== records) || typeof forTransaction !== 'function')
    )
      throw invalidCapability()
  } catch (cause) {
    if (
      cause instanceof StorageContractError &&
      cause.code === StorageContractErrorCode.invalidArgument
    )
      throw cause
    throw invalidCapability(cause)
  }
  /** API shape admission for standard tokens happens again at the atomic provider boundary. */
  const descriptor = Object.freeze({ capability, api }) as ICapabilityImpl<TCap, TApi>
  implementations.set(descriptor, { implementation: descriptor, forTransaction })
  return descriptor
}

/** Admits all descriptors before changing the base or reserving a token in its unique table. */
function admitImplementations(
  entries: readonly ICapabilityImpl[],
  table: Map<IAnyStorageCapability, IInstalledCapability>,
  transactions: boolean
): readonly ICapabilityImpl[] {
  if (!Array.isArray(entries)) throw invalidCapability()
  /** Local uniqueness is linear and does not reserve partially admitted input. */
  const seen = new Set<IAnyStorageCapability>()
  /** The captured list never rereads caller array slots after successful admission. */
  const captured: ICapabilityImpl[] = []
  for (const entry of entries) {
    /** Lookup ignores forged capability/api fields and reads the real frozen descriptor instead. */
    const descriptor =
      typeof entry === 'object' && entry !== null
        ? implementations.get(entry)?.implementation
        : undefined
    if (!descriptor || seen.has(descriptor.capability) || table.has(descriptor.capability))
      throw invalidCapability()
    if (descriptor.capability === kv) {
      /** KV is the only standard API installed by this foundation; backends own all operations. */
      const api = descriptor.api as Record<string, unknown> | undefined
      if (
        !api ||
        typeof api !== 'object' ||
        STORAGE_KEY_VALUE_METHODS.some((name) => typeof api[name] !== 'function')
      )
        throw invalidCapability()
      if (
        api.sync !== undefined &&
        (typeof api.sync !== 'object' ||
          api.sync === null ||
          SYNC_KEY_VALUE_METHODS.some(
            (name) => typeof (api.sync as Record<string, unknown>)[name] !== 'function'
          ))
      )
        throw invalidCapability()
    }
    if (descriptor.capability === records) {
      /**
       * Native records and Feature records share the same callable admission without running a
       * query.
       */
      const api = descriptor.api as IRecordsApi | undefined
      if (
        typeof api !== 'object' ||
        api === null ||
        typeof api.query !== 'function' ||
        typeof api.removeByPrefix !== 'function'
      )
        throw invalidCapability()
    }
    if (
      transactions &&
      (descriptor.capability === kv || descriptor.capability === records) &&
      implementations.get(descriptor)?.forTransaction === undefined
    )
      throw invalidCapability()
    seen.add(descriptor.capability)
    captured.push(descriptor)
  }
  return captured
}

/** Admits a resource-backed base before any method is installed; failures never dispose it. */
function admitBase(base: IStorageBase): Extract<IStorageBaseAdmission, { readonly valid: true }> {
  /** The host and provider consume this same non-owning field snapshot. */
  const admission = snapshotStorageBaseDetailed(base)
  if (!admission.valid || stores.has(base) || !Object.isExtensible(base))
    throw invalidCapability(admission.valid ? undefined : admission.cause)
  for (const name of STORAGE_CAPABILITY_METHODS) {
    /** Only providers need permission to replace their own use/has methods. */
    const descriptor = Object.getOwnPropertyDescriptor(base, name)
    if (descriptor && !descriptor.configurable) throw invalidCapability()
  }
  return admission
}

/** Captures standard KV forwarding once without changing the API's method receiver. */
function captureKeyValue(api: IKeyValueApi): {
  readonly definitions: PropertyDescriptorMap
  readonly has: (key: string, context?: unknown) => Promise<boolean>
} {
  /** Local descriptors can be validated before publishing a capability or changing its base. */
  const definitions: PropertyDescriptorMap = {}
  /** Capture before the provider installs its capability-aware has overload. */
  const originalHas = api.has
  for (const name of STORAGE_KEY_VALUE_METHODS) {
    if (name === StorageCapabilityMethod.has) continue
    /** Forward exactly once and preserve the original Promise and thrown error identities. */
    const method = api[name]
    definitions[name] = {
      configurable: true,
      enumerable: true,
      value: (...args: unknown[]) => Reflect.apply(method, api, args)
    }
  }
  for (const name of STORAGE_KEY_VALUE_PROPERTIES) {
    /** Capture optional sync once so the flat store retains the supplied precise channel. */
    const value = api[name]
    if (value !== undefined) definitions[name] = { configurable: true, enumerable: true, value }
  }
  return { definitions, has: (key, context) => Reflect.apply(originalHas, api, [key, context]) }
}

/** Modifies and returns the same base, with all validation complete before capability publication. */
export function provideCapabilities<
  const TBase extends IStorageBase,
  const TImplementations extends readonly ICapabilityImpl[]
>(
  base: TBase,
  entries: TImplementations,
  options?: { readonly onInstaller?: (port: ICapabilityInstallPort) => void }
): ICapabilityStore<TBase, TImplementations[number]['capability'], TImplementations> {
  try {
    /** Capture the optional callback before any base property changes. */
    const onInstaller = options?.onInstaller
    if (onInstaller !== undefined && typeof onInstaller !== 'function') throw invalidCapability()
    const baseAdmission = admitBase(base)
    /** This sole map is shared by base capabilities and later Feature publications. */
    const table = new Map<IAnyStorageCapability, IInstalledCapability>()
    /** Method closures and root read access share the same table and captured diagnostic. */
    const record: ICapabilityStoreRecord = { table, backend: baseAdmission.backend }
    /** No caller or base mutation occurs while descriptors and duplicates are checked. */
    const captured = admitImplementations(entries, table, baseAdmission.capabilities.transactions)
    /** Capture original KV method receivers before replacing the overlapping has entry. */
    const kvDescriptor = captured.find((entry) => entry.capability === kv)
    /** Definitions are staged locally so ordinary descriptor failures cannot partially install. */
    const definitions: PropertyDescriptorMap = {}
    /** Original KV has is never recovered by reading the modified base, preventing recursion. */
    let keyHas: ((key: string, context?: unknown) => Promise<boolean>) | undefined
    if (kvDescriptor) {
      /** Root and Feature KV installations share exactly one method capture implementation. */
      const flat = captureKeyValue(kvDescriptor.api as IKeyValueApi)
      Object.assign(definitions, flat.definitions)
      keyHas = flat.has
    }
    for (const name of Reflect.ownKeys(definitions)) {
      /** Existing nonconfigurable public members are retained only if no replacement is needed. */
      const descriptor = Object.getOwnPropertyDescriptor(base, name)
      if (descriptor && !descriptor.configurable) throw invalidCapability()
    }
    definitions.use = {
      configurable: true,
      enumerable: true,
      value: (capability: unknown): unknown => useCapability(base, record, capability)
    }
    definitions.has = {
      configurable: true,
      enumerable: true,
      value: (capability: unknown, context?: unknown): boolean | Promise<boolean> => {
        if (typeof capability === 'string' && keyHas) return keyHas(capability, context)
        return hasCapability(record, capability)
      }
    }
    /** The original host receives this private authority once; tokens alone do not grant it. */
    const installer = {
      prepare(next: readonly ICapabilityImpl[]): ICapabilityPublication {
        try {
          /** Reserve all admitted tokens together, including other unpublished preparations. */
          const additions = admitImplementations(
            next,
            table,
            baseAdmission.capabilities.transactions
          )
          /** A Feature can add the same standard KV API that a native backend provides. */
          const keyValue = additions.find((entry) => entry.capability === kv)
          /** Stage optional flat KV methods before reserving any descriptor. */
          const flat = keyValue ? captureKeyValue(keyValue.api as IKeyValueApi) : undefined
          /** Original descriptors are restored if this publication later rolls back. */
          const previous = new Map<PropertyKey, PropertyDescriptor | undefined>()
          if (flat)
            for (const name of Reflect.ownKeys(flat.definitions)) {
              /** Base changes must be reversible before the Feature can reserve its token. */
              const descriptor = Object.getOwnPropertyDescriptor(base, name)
              if (descriptor && !descriptor.configurable) throw invalidCapability()
              previous.set(name, descriptor)
            }
          /** Existing string-key has forwarding returns after this publication is released. */
          const previousHas = keyHas
          /** Capture each exact table entry so release cannot remove a later publication. */
          const reserved = additions.map((implementation) => ({ implementation, published: false }))
          for (const entry of reserved) table.set(entry.implementation.capability, entry)
          /** Released publications cannot be revived after installation rollback. */
          let released = false
          /** Repeated publish must not replace descriptors or their captured rollback baseline. */
          let published = false
          return Object.freeze({
            publish(): void {
              if (released || published) return
              if (flat) {
                Object.defineProperties(base, flat.definitions)
                keyHas = flat.has
              }
              for (const entry of reserved) entry.published = true
              published = true
            },
            release(): void {
              if (released) return
              released = true
              if (published && flat) {
                for (const [name, descriptor] of previous) {
                  if (descriptor) Object.defineProperty(base, name, descriptor)
                  else Reflect.deleteProperty(base, name)
                }
                keyHas = previousHas
              }
              for (const entry of reserved)
                if (table.get(entry.implementation.capability) === entry)
                  table.delete(entry.implementation.capability)
            }
          })
        } catch (cause) {
          if (
            cause instanceof StorageContractError &&
            cause.code === StorageContractErrorCode.invalidArgument
          )
            throw cause
          throw invalidCapability(cause)
        }
      }
    } as ICapabilityInstallPort
    for (const descriptor of captured)
      table.set(descriptor.capability, { implementation: descriptor, published: true })
    onInstaller?.(Object.freeze(installer))
    Object.defineProperties(base, definitions)
    stores.set(base, record)
    return base as unknown as ICapabilityStore<
      TBase,
      TImplementations[number]['capability'],
      TImplementations
    >
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidCapability(cause)
  }
}
