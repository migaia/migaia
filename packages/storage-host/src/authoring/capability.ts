import {
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  invalidCapability,
  isCapabilityToken,
  readCapabilityTokenFacts,
  readStorageImplementation,
  STORAGE_CAPABILITY_METHODS,
  STORAGE_KEY_VALUE_METHODS,
  STORAGE_KEY_VALUE_PROPERTIES,
  StorageCapabilityMethod,
  type IStorageBase,
  type IStorageBaseAdmission,
  type IAnyStorageCapability,
  type ICapabilityImpl,
  type IKeyValueApi,
  type ICapabilityStore,
  type IStorageCapabilityApiOf,
  type ICapabilityInstallPort,
  type ICapabilityPublication,
  type IStorageImplementationRecord,
  type ITransactionScope
} from '@migaia/storage-contract'
import { snapshotStorageBaseDetailed } from './store.js'

/** A token is reserved before publication and remains absent from ordinary capability reads. */
type IInstalledCapability = { readonly implementation: ICapabilityImpl; published: boolean }
/** Each installed base has one publication table and the original admitted diagnostic label. */
type ICapabilityStoreRecord = {
  readonly table: Map<IAnyStorageCapability, IInstalledCapability>
  readonly backend: IStorageBase['backend']
}
/** Only the host runtime owns per-store publication state; contract definitions own no stores. */
const stores = new WeakMap<object, ICapabilityStoreRecord>()
/** One flat KV projection borrows its original API and forwards without changing its receiver. */
type IFlatKeyValue = {
  readonly definitions: PropertyDescriptorMap
  readonly has: (key: string, context?: unknown) => Promise<boolean>
}
/**
 * Initial publication reuses the same native base admission as the host without taking cleanup
 * ownership.
 */
function admitBase(base: IStorageBase): Extract<IStorageBaseAdmission, { readonly valid: true }> {
  /** The original native resource and diagnostic facts are admitted before any base mutation. */
  const admission = snapshotStorageBaseDetailed(base)
  if (!admission.valid || stores.has(base) || !Object.isExtensible(base))
    throw invalidCapability(admission.valid ? undefined : admission.cause)
  for (const name of STORAGE_CAPABILITY_METHODS) {
    /** Only the provider may replace its own capability access methods. */
    const descriptor = Object.getOwnPropertyDescriptor(base, name)
    if (descriptor && !descriptor.configurable) throw invalidCapability()
  }
  return admission
}
/** Descriptor definitions are admitted atomically before reserving any token in a store table. */
function admitImplementations(
  entries: readonly ICapabilityImpl[],
  record: ICapabilityStoreRecord,
  transactions: boolean
): readonly ICapabilityImpl[] {
  if (!Array.isArray(entries)) throw invalidCapability()
  /** Linear local uniqueness does not reserve partially admitted caller input. */
  const seen = new Set<IAnyStorageCapability>()
  /** This list owns the accepted descriptor order across later host publication callbacks. */
  const captured: ICapabilityImpl[] = []
  for (const entry of entries) {
    /** Only the canonical implementation definition grants identity; public lookalikes grant none. */
    const definition = readStorageImplementation(entry)
    /** The definition points at the original API without granting its lifetime to this provider. */
    const descriptor = definition?.implementation
    if (!descriptor || seen.has(descriptor.capability) || record.table.has(descriptor.capability))
      throw invalidCapability()
    /** Standard validation and transaction eligibility remain canonical token facts. */
    const facts = readCapabilityTokenFacts(descriptor.capability)
    facts?.validate(descriptor.api)
    if (
      transactions &&
      facts?.transaction !== undefined &&
      definition?.forTransaction === undefined
    )
      throw invalidCapability()
    seen.add(descriptor.capability)
    captured.push(descriptor)
  }
  return captured
}
/** Capability membership observes publication state without reading caller token properties. */
function hasCapability(record: ICapabilityStoreRecord | undefined, capability: unknown): boolean {
  return isCapabilityToken(capability) && record?.table.get(capability)?.published === true
}
/** Missing capability diagnostics retain the admitted backend rather than a new property snapshot. */
function useCapability(
  store: IStorageBase,
  record: ICapabilityStoreRecord | undefined,
  capability: unknown
): ICapabilityImpl {
  if (!isCapabilityToken(capability)) throw invalidCapability()
  /** Prepared Features remain absent until their existing publication transition. */
  const installed = record?.table.get(capability)
  if (installed?.published) return installed.implementation
  /**
   * A raw resource has no captured provider identity; supported ordinary properties are read
   * directly.
   */
  const backend = record === undefined ? store.backend : record.backend
  throw new StorageContractError(
    StorageContractErrorCode.unsupported,
    { backend, capability: capability.name },
    StorageContractErrorText.capabilityMissing(capability.name, backend)
  )
}
/** Reads the original host publication table without creating or modifying a store. */
export function hasStorageCapability(
  store: IStorageBase,
  capability: IAnyStorageCapability
): boolean {
  return hasCapability(stores.get(store), capability)
}
/** Returns the same original native API as store.use while preserving its declared refinements. */
export function useStorageCapability<
  TStore extends IStorageBase,
  TCap extends IAnyStorageCapability
>(store: TStore, capability: TCap): IStorageCapabilityApiOf<TStore, TCap> {
  return useCapability(store, stores.get(store), capability).api as IStorageCapabilityApiOf<
    TStore,
    TCap
  >
}
/**
 * Reads an existing published implementation and its canonical transaction definition, without
 * invoking it.
 */
export function readTransactionImplementation(
  store: IStorageBase,
  capability: IAnyStorageCapability
): IStorageImplementationRecord & {
  readonly forTransaction: (scope: ITransactionScope) => unknown
} {
  /** The original store table remains the only publication authority. */
  const record = stores.get(store)
  /** Forged-token and missing-token diagnostics follow the same original lookup. */
  const descriptor = useCapability(store, record, capability)
  /** Definition identity and opaque transaction binding remain in the pure contract owner. */
  const binding = readStorageImplementation(descriptor)!
  if (
    readCapabilityTokenFacts(capability)?.transaction === undefined ||
    binding.forTransaction === undefined
  )
    throw new StorageContractError(
      StorageContractErrorCode.unsupported,
      { backend: record!.backend, capability: capability.name },
      StorageContractErrorText.capabilityTransactionMissing(capability.name, record!.backend)
    )
  return binding as IStorageImplementationRecord & {
    readonly forTransaction: (scope: ITransactionScope) => unknown
  }
}
/**
 * Flat forwarding normally invokes the original API directly, retaining class-private receiver
 * state.
 */
function projectKeyValue(api: IKeyValueApi, base: IStorageBase): IFlatKeyValue {
  /** Definitions remain local until the existing publication step applies them together. */
  const definitions: PropertyDescriptorMap = {}
  for (const name of STORAGE_KEY_VALUE_METHODS) {
    if (name === StorageCapabilityMethod.has) continue
    definitions[name] = {
      configurable: true,
      enumerable: true,
      value: (...args: unknown[]) =>
        (api as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!(...args)
    }
  }
  for (const name of STORAGE_KEY_VALUE_PROPERTIES) {
    /** Optional synchronous channels retain their original object identity. */
    const value = api[name]
    if (value !== undefined) definitions[name] = { configurable: true, enumerable: true, value }
  }
  if ((api as object) === base) {
    /**
     * The supported self-publication path overwrites the same original methods. Direct late lookup
     * would recurse; these exact receiver calls preserve that existing path pending C3
     * adjudication.
     */
    for (const name of STORAGE_KEY_VALUE_METHODS) {
      if (name === StorageCapabilityMethod.has) continue
      /** This original method would otherwise be replaced by its own flat forwarding wrapper. */
      const method = api[name]
      definitions[name] = {
        configurable: true,
        enumerable: true,
        value: (...args: unknown[]) => Reflect.apply(method, api, args)
      }
    }
    /** The original native string has must survive installation of capability-aware has. */
    const originalHas = api.has
    return { definitions, has: (key, context) => Reflect.apply(originalHas, api, [key, context]) }
  }
  return { definitions, has: (key, context) => api.has(key, context as never) }
}
/** A single provider owns initial and Feature publications for the original native base. */
class CapabilityProvider {
  /** Native resource ownership remains with the caller; this provider only installs methods. */
  readonly #base: IStorageBase
  /** The only per-store token table is shared by methods, lookup helpers and publication jobs. */
  readonly #record: ICapabilityStoreRecord
  /** Standard transactional bases require their original declared finite scope binders. */
  readonly #transactions: boolean
  /** Initial method definitions are staged before a caller callback can publish Features. */
  readonly #definitions: PropertyDescriptorMap = {}
  /** The host receives only prepare authority; the provider itself never escapes. */
  readonly #installer: ICapabilityInstallPort
  /**
   * The current original KV has survives the provider's capability overload and publication
   * rollback.
   */
  #keyHas: IFlatKeyValue['has'] | undefined
  /** Admits all input before mutating the original native base or invoking its installer callback. */
  constructor(base: IStorageBase, entries: readonly ICapabilityImpl[]) {
    /** Shared native admission captures diagnostics without acquiring cleanup authority. */
    const admission = admitBase(base)
    this.#base = base
    this.#installer = { prepare: this.prepare } as unknown as ICapabilityInstallPort
    this.#transactions = admission.capabilities.transactions
    this.#record = { table: new Map(), backend: admission.backend }
    /** Every descriptor is accepted before any token becomes visible. */
    const captured = admitImplementations(entries, this.#record, this.#transactions)
    /** Only the authentic standard KV definition grants flat native methods. */
    const keyValue = captured.find(
      (entry) => readCapabilityTokenFacts(entry.capability)?.flatKeyValue === true
    )
    if (keyValue) {
      /** Projection is shared by initial and later Feature KV installation. */ const flat =
        projectKeyValue(keyValue.api as IKeyValueApi, base)
      Object.assign(this.#definitions, flat.definitions)
      this.#keyHas = flat.has
    }
    for (const name of Reflect.ownKeys(this.#definitions)) {
      /** Existing nonconfigurable native members cannot be replaced. */ const descriptor =
        Object.getOwnPropertyDescriptor(base, name)
      if (descriptor && !descriptor.configurable) throw invalidCapability()
    }
    this.#definitions.use = {
      configurable: true,
      enumerable: true,
      value: (capability: unknown) => useCapability(this.#base, this.#record, capability).api
    }
    this.#definitions.has = {
      configurable: true,
      enumerable: true,
      value: (capability: unknown, context?: unknown) =>
        typeof capability === 'string' && this.#keyHas
          ? this.#keyHas(capability, context)
          : hasCapability(this.#record, capability)
    }
    for (const descriptor of captured)
      this.#record.table.set(descriptor.capability, { implementation: descriptor, published: true })
  }
  /** Preserve callback-before-install ordering so Features can prepare against this same provider. */
  install(onInstaller: ((port: ICapabilityInstallPort) => void) | undefined): void {
    onInstaller?.(this.#installer)
    Object.defineProperties(this.#base, this.#definitions)
    stores.set(this.#base, this.#record)
  }
  /** Each prepared Feature publication reserves all accepted tokens together. */
  readonly prepare = (next: readonly ICapabilityImpl[]): ICapabilityPublication =>
    new CapabilityPublication(
      this.#base,
      this.#record,
      this.#transactions,
      next,
      this.#keyHas,
      (value) => {
        this.#keyHas = value
      }
    )
}
/** One reversible Feature publication owns only its descriptor reservation and rollback baseline. */
class CapabilityPublication implements ICapabilityPublication {
  /** Flat methods are published on the same original native base. */
  readonly #base: IStorageBase
  /** Reservations share the provider's sole publication table. */
  readonly #record: ICapabilityStoreRecord
  /** A Feature may add the same standard KV projection as a native backend. */
  readonly #flat: IFlatKeyValue | undefined
  /** Only properties changed by this publication are restored on release. */
  readonly #previous = new Map<PropertyKey, PropertyDescriptor | undefined>()
  /** The provider's prior original string has is restored together with released flat methods. */
  readonly #previousHas: IFlatKeyValue['has'] | undefined
  /** Updating the original provider's one has projection adds no second capability table. */
  readonly #setKeyHas: (value: IFlatKeyValue['has'] | undefined) => void
  /** Exact reservation identity prevents release from deleting another publication. */
  readonly #reserved: readonly IInstalledCapability[]
  /** A released reservation cannot revive itself. */
  #released = false
  /** Repeated publish never replaces the original rollback baseline. */
  #published = false
  /** Validates descriptors and all reversible property changes before reserving any token. */
  constructor(
    base: IStorageBase,
    record: ICapabilityStoreRecord,
    transactions: boolean,
    next: readonly ICapabilityImpl[],
    previousHas: IFlatKeyValue['has'] | undefined,
    setKeyHas: (value: IFlatKeyValue['has'] | undefined) => void
  ) {
    this.#base = base
    this.#record = record
    this.#previousHas = previousHas
    this.#setKeyHas = setKeyHas
    /** Input order is preserved across the original prepare/publish boundary. */
    const additions = admitImplementations(next, record, transactions)
    /** Only the authentic standard token may add flat KV methods. */
    const keyValue = additions.find(
      (entry) => readCapabilityTokenFacts(entry.capability)?.flatKeyValue === true
    )
    this.#flat = keyValue ? projectKeyValue(keyValue.api as IKeyValueApi, base) : undefined
    if (this.#flat)
      for (const name of Reflect.ownKeys(this.#flat.definitions)) {
        /** Release must be able to restore or remove every affected property. */ const descriptor =
          Object.getOwnPropertyDescriptor(base, name)
        if (descriptor && !descriptor.configurable) throw invalidCapability()
        this.#previous.set(name, descriptor)
      }
    this.#reserved = additions.map((implementation) => ({ implementation, published: false }))
    for (const entry of this.#reserved) record.table.set(entry.implementation.capability, entry)
  }
  /** Publishing only exposes this already admitted reservation and its original API objects. */
  readonly publish = (): void => {
    if (this.#released || this.#published) return
    if (this.#flat) {
      Object.defineProperties(this.#base, this.#flat.definitions)
      this.#setKeyHas(this.#flat.has)
    }
    for (const entry of this.#reserved) entry.published = true
    this.#published = true
  }
  /**
   * Release reverses only this publication's original changes and cannot remove a later
   * reservation.
   */
  readonly release = (): void => {
    if (this.#released) return
    this.#released = true
    if (this.#published && this.#flat) {
      for (const [name, descriptor] of this.#previous) {
        if (descriptor) Object.defineProperty(this.#base, name, descriptor)
        else Reflect.deleteProperty(this.#base, name)
      }
      this.#setKeyHas(this.#previousHas)
    }
    for (const entry of this.#reserved)
      if (this.#record.table.get(entry.implementation.capability) === entry)
        this.#record.table.delete(entry.implementation.capability)
  }
}
/** Publishes capabilities on the same admitted base; native resource disposal remains caller owned. */
export function provideCapabilities<
  const TBase extends IStorageBase,
  const TImplementations extends readonly ICapabilityImpl[]
>(
  base: TBase,
  entries: TImplementations,
  options?: { readonly onInstaller?: (port: ICapabilityInstallPort) => void }
): ICapabilityStore<TBase, TImplementations[number]['capability'], TImplementations> {
  const onInstaller = options?.onInstaller
  /** The named provider admits definitions and original base before any external callback executes. */
  const provider = new CapabilityProvider(base, entries)
  try {
    provider.install(onInstaller)
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidCapability(cause)
  }
  return base as unknown as ICapabilityStore<
    TBase,
    TImplementations[number]['capability'],
    TImplementations
  >
}
