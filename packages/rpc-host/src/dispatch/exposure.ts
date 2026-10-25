/** Native Feature exposure keeps its original whitelist, guard and installation commit owners. */
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import type { IPluginRuntimeFeatureSnapshot } from '@migaia/plugin-host'
import type { IRpcMethodDescription } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import { createRpcError } from '../host/error-owner.js'
import { resolveAbortReason } from '../host/abort-reason.js'
import { registerLocalErrorWireSummary } from '../host/error-wire-metadata.js'
import type { IRpcSessionSelection } from '@migaia/rpc-contract/interfaces'
import { attachProviderCommitGate, attachProviderPreflight } from './catalog.js'
import type { IProviderCommitGate, IRpcProvide, IRpcProviderMethod } from './types.js'

/** A cold accepted identity and the existing Forwarder alone can mint held forward callables. */
export type IProviderExposureForwarding = Readonly<{
  resolve(name: string): IRpcSessionSelection | undefined
  hold(selection: IRpcSessionSelection, method: IRpcMethodDescription): Function
}>

/** One original Host commit and lifecycle signal own the admission state shared by held calls. */
class ProviderCommitGate implements IProviderCommitGate {
  /** Fulfilled failure data avoids unobserved rejection when an install has no held calls. */
  readonly #completion = deferred<ReturnType<typeof createRpcError> | undefined>()
  /** Only the original slot commit opens admission; later generations reuse the open gate. */
  #open = false
  /** Native operation cancellation may fail admission before physical source cleanup starts. */
  #failed = false
  /** Native lifecycle supplies the original rollback cause rather than an install wrapper. */
  readonly #lifecycle: IAbortSignal
  /** Rollback records its native reason before releasing this shared completion. */
  readonly #onAbort = (): void => this.fail(resolveAbortReason(this.#lifecycle))
  /** Fail the existing admission completion while preserving the original native rollback cause. */
  readonly fail = (reason: unknown): void => {
    if (this.#open || this.#failed) return
    this.#failed = true
    /** The original native rollback reason remains this failure's cause. */
    const failure = createRpcError(
      RpcCoreErrorCode.targetUnknown,
      RuntimeApiErrorText.targetUnknown,
      reason
    )
    registerLocalErrorWireSummary(
      failure,
      RpcCoreErrorCode.targetUnknown,
      RuntimeApiErrorText.targetUnknown,
      { preserveSerializedError: true }
    )
    this.#completion.resolve(failure)
    this.#lifecycle.removeEventListener('abort', this.#onAbort)
  }
  /** Subscribe once to the actual installation lifetime, including already aborted construction. */
  constructor(lifecycle: IAbortSignal) {
    this.#lifecycle = lifecycle
    if (lifecycle.aborted) this.#onAbort()
    else lifecycle.addEventListener('abort', this.#onAbort, { once: true })
  }
  /** Availability can be read before allocating an invocation resource. */
  readonly isOpen = (): boolean => this.#open
  /** A live uncommitted install cannot be joined while native cancellation waits for cleanup. */
  readonly isFailed = (): boolean => this.#failed
  /** Actual native slot commit releases waiters before ready publication. */
  readonly open = (): void => {
    if (this.#failed || this.#lifecycle.aborted) return
    this.#open = true
    this.#lifecycle.removeEventListener('abort', this.#onAbort)
    this.#completion.resolve(undefined)
  }
  /** Each invocation owns only its abort listener and settlement, never other held calls. */
  readonly wait = (signal: IAbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(resolveAbortReason(signal))
    /** Shared Utils owns Promise settlement while this explicit record owns one abort listener. */
    const operation = { signal, completion: deferred<void>() }
    /** Cancellation releases this one invocation's listener before publishing its reason. */
    function cancel(): void {
      operation.signal.removeEventListener('abort', cancel)
      operation.completion.reject(resolveAbortReason(operation.signal))
    }
    try {
      signal.addEventListener('abort', cancel, { once: true })
      this.#completion.promise.then((failure) => {
        operation.signal.removeEventListener('abort', cancel)
        if (operation.signal.aborted)
          operation.completion.reject(resolveAbortReason(operation.signal))
        else if (failure) operation.completion.reject(failure)
        else operation.completion.resolve()
      })
    } catch (error) {
      operation.completion.reject(error)
    }
    return operation.completion.promise
  }
}

/** Construct the single commit boundary consumed by native installation and actual methods. */
export function createProviderCommitGate(
  lifecycle: IAbortSignal
): IProviderCommitGate & { open(): void; fail(reason: unknown): void } {
  return new ProviderCommitGate(lifecycle)
}

/** An absent ordinary exposed method keeps its existing runtime whitelist error. */
function unavailableExposedMethod(): never {
  throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
}

/** One exact callable retains its native read port and cannot outlive Feature availability. */
class ProviderExposedMethod {
  /** Native readCurrent remains the sole authority for the installing Feature's availability. */
  readonly #read: () => object | undefined
  /** One explicitly admitted data-method key is fixed at cold compilation. */
  readonly #key: string
  /** Only this original installation's commit may postpone permission preflight. */
  readonly #gate: IProviderCommitGate
  /** Exact callable identity carries the canonical gate and preflight metadata. */
  readonly method: IRpcProviderMethod
  /** Capture ports without reading mutable Feature output until admission or actual invocation. */
  constructor(read: () => object | undefined, key: string, gate: IProviderCommitGate) {
    this.#read = read
    this.#key = key
    this.#gate = gate
    this.method = attachProviderCommitGate(
      attachProviderPreflight(this.#invoke, this.#preflight),
      gate
    )
  }
  /** Descriptor admission rejects removed, hidden or accessor methods without evaluating getters. */
  #current(): Readonly<{ receiver: object; method: Function }> {
    /** Availability is rechecked through the exact original native Feature handle. */
    const receiver = this.#read()
    /** Descriptor inspection never invokes a newly installed accessor. */
    const descriptor = receiver && Object.getOwnPropertyDescriptor(receiver, this.#key)
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    )
      unavailableExposedMethod()
    return { receiver: receiver!, method: descriptor.value }
  }
  /** Native permission and receiver identity are rechecked after every installation wait. */
  readonly #invoke: IRpcProviderMethod = (payload, context) => {
    const { receiver, method } = this.#current()
    return Reflect.apply(method, receiver, [payload, context])
  }
  /** Whole-group admission checks all available outputs before the first business side effect. */
  readonly #preflight = (): void => {
    if (this.#gate.isOpen()) this.#current()
  }
}

/** One captured descriptor retains native Feature/key order without evaluating application getters. */
type IProviderExposureEntry = Readonly<{
  feature: string
  key: PropertyKey
  descriptor: PropertyDescriptor | undefined
}>

/** These constructor-only indexes are never retained by published live-read callables. */
type IProviderExposureInventory = {
  snapshot: IPluginRuntimeFeatureSnapshot
  entries: IProviderExposureEntry[]
  byKey: Map<PropertyKey, IProviderExposureEntry[]>
  selected: Set<string>
  whole: boolean
}

/** One cold whitelist compilation owns overlap, ambiguity and original native output snapshots. */
class ProviderExposure {
  /** The original native integration supplies guarded Feature outputs. */
  readonly #read: (name: string) => IPluginRuntimeFeatureSnapshot
  /** Every callable in this registration shares one native commit boundary. */
  readonly #gate: IProviderCommitGate
  /** Forwarding borrows accepted compact facts and the actual Forwarder, never an outlet facade. */
  readonly #forwarding: IProviderExposureForwarding | undefined
  /** Whole-plus-single overlaps capture each Plugin's native descriptors only once. */
  readonly #snapshots = new Map<string, IProviderExposureInventory>()
  /** Each public prefix independently publishes a whole accepted directory once per actual Map. */
  readonly #remoteWhole = new Map<string, WeakSet<ReadonlyMap<string, IRpcMethodDescription>>>()
  /** Distinct Features cannot accidentally publish the same flattened Plugin method name. */
  readonly #owners = new Map<string, string>()
  /** One own-data group per Plugin keeps the established plugin.method public namespace. */
  readonly #provide: Record<string, IRpcProvide> = Object.create(null)
  /** Capture explicit ports and compile in the caller's original expose order. */
  constructor(
    expose: readonly string[],
    read: (name: string) => IPluginRuntimeFeatureSnapshot,
    gate: IProviderCommitGate,
    forwarding?: IProviderExposureForwarding
  ) {
    this.#read = read
    this.#gate = gate
    this.#forwarding = forwarding
    for (const path of expose) {
      /** The original first segment selects a Plugin or accepted remote peer. */
      const separator = path.indexOf('.')
      /** This cold name never comes from inbound business metadata. */
      const name = separator < 0 ? path : path.slice(0, separator)
      /** Absence means the original whole-Plugin union. */
      const selected = separator < 0 ? undefined : path.slice(separator + 1)
      /** Existing accepted forwarding wins over local Feature reflection, as before. */
      const connection = forwarding?.resolve(name)
      if (connection) this.#remote(name, selected, connection)
      else this.#local(name, selected)
    }
    for (const group of Object.values(this.#provide)) Object.freeze(group)
    Object.freeze(this.#provide)
  }
  /** Only this frozen compiled graph is published to the existing ProviderDispatcher. */
  get provide(): IRpcProvide {
    return this.#provide
  }
  /** Accepted directory data selects the original held-forward binding without Feature reflection. */
  #remote(name: string, selected: string | undefined, connection: IRpcSessionSelection): void {
    /** One group retains each exact original callable identity. */
    const group = (this.#provide[name] ??= Object.create(null)) as Record<
      string,
      IRpcProviderMethod
    >
    if (selected !== undefined) {
      /** Accepted directories already index the exact method name used by this selector. */
      const method = connection.view.methods.get(selected)
      if (!method)
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
      this.#remoteMethod(group, connection, method)
      return
    }
    /** Alias prefixes may borrow one directory while still requiring separate published groups. */
    const completed = this.#remoteWhole.get(name) ?? new WeakSet()
    if (completed.has(connection.view.methods)) return
    for (const method of connection.view.methods.values())
      this.#remoteMethod(group, connection, method)
    completed.add(connection.view.methods)
    this.#remoteWhole.set(name, completed)
  }
  /** A repeated selector borrows the original held callable rather than allocating another gate. */
  #remoteMethod(
    group: Record<string, IRpcProviderMethod>,
    connection: IRpcSessionSelection,
    method: IRpcMethodDescription
  ): void {
    if (!Object.hasOwn(group, method.name))
      group[method.name] = attachProviderCommitGate(
        this.#forwarding!.hold(connection, method) as IRpcProviderMethod,
        this.#gate
      )
  }
  /** Explicit local descriptors are flattened once and keep the original live readCurrent guard. */
  #local(name: string, selected: string | undefined): void {
    /** Repeated selections borrow the same native cold inventory. */
    const cached = this.#snapshots.get(name)
    /** Captured metadata remains private to this compilation, separate from the live read port. */
    const inventory: IProviderExposureInventory = cached ?? {
      snapshot: this.#read(name),
      entries: [],
      byKey: new Map(),
      selected: new Set(),
      whole: false
    }
    this.#snapshots.set(name, inventory)
    /** One group retains each exact original callable identity. */
    const group = (this.#provide[name] ?? Object.create(null)) as Record<string, IRpcProviderMethod>
    /** An explicit miss is a configuration failure before opening a native source. */
    const found = cached
      ? this.#select(name, selected, group, inventory)
      : this.#capture(name, selected, group, inventory)
    if (!found)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
    if (selected === undefined) inventory.whole = true
    this.#provide[name] = group
  }
  /** Apply the first selector during capture so its failure precedes later Feature reflection. */
  #capture(
    name: string,
    selected: string | undefined,
    group: Record<string, IRpcProviderMethod>,
    inventory: IProviderExposureInventory
  ): boolean {
    let found = selected === undefined
    for (const [feature, output] of Object.entries(inventory.snapshot.outputs)) {
      /** Native output data members are read as descriptors, never application getters. */
      const descriptors = Object.getOwnPropertyDescriptors(output)
      for (const key of Reflect.ownKeys(descriptors)) {
        /** Ordered entries and exact-key buckets share the same immutable descriptor receipt. */
        const entry = { feature, key, descriptor: descriptors[key as string] }
        inventory.entries.push(entry)
        /** Each descriptor enters one bucket; later selectors never scan unrelated entries. */
        const bucket = inventory.byKey.get(key) ?? []
        bucket.push(entry)
        inventory.byKey.set(key, bucket)
        if (selected === undefined || key === selected)
          if (this.#apply(name, group, inventory, entry)) found = true
      }
    }
    return found
  }
  /** Each distinct single bucket and the whole inventory are applied at most once. */
  #select(
    name: string,
    selected: string | undefined,
    group: Record<string, IRpcProviderMethod>,
    inventory: IProviderExposureInventory
  ): boolean {
    if (selected === undefined ? inventory.whole : inventory.selected.has(selected)) return true
    /**
     * A whole selection retains original Feature/key order; single selection keeps its bucket
     * order.
     */
    const entries =
      selected === undefined ? inventory.entries : (inventory.byKey.get(selected) ?? [])
    let found = selected === undefined
    for (const entry of entries) if (this.#apply(name, group, inventory, entry)) found = true
    return found
  }
  /**
   * Only selected descriptors grant authority; ambiguity still belongs to original Feature
   * identity.
   */
  #apply(
    name: string,
    group: Record<string, IRpcProviderMethod>,
    inventory: IProviderExposureInventory,
    entry: IProviderExposureEntry
  ): boolean {
    const { key, descriptor, feature } = entry
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    )
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
    if (typeof descriptor.value !== 'function') return false
    /** Feature identity detects ambiguous flattening without invoking business code. */
    const fullName = `${name}.${key}`
    if (this.#owners.has(fullName) && this.#owners.get(fullName) !== feature)
      throw createRpcError(RpcCoreErrorCode.capabilityConflict, RuntimeApiErrorText.featureConflict)
    /**
     * Native integration supplies an arrow port; retaining it avoids retaining the cold output
     * graph.
     */
    const readCurrent = inventory.snapshot.readCurrent
    if (!Object.hasOwn(group, key))
      group[key] = new ProviderExposedMethod(() => readCurrent(feature), key, this.#gate).method
    this.#owners.set(fullName, feature)
    inventory.selected.add(key)
    return true
  }
}

/** Compile only explicit real Feature methods and exact accepted forwards before native source open. */
export function exposedProvide(
  expose: readonly string[],
  read: (name: string) => IPluginRuntimeFeatureSnapshot,
  gate: IProviderCommitGate,
  forwarding?: IProviderExposureForwarding
): IRpcProvide {
  return new ProviderExposure(expose, read, gate, forwarding).provide
}
