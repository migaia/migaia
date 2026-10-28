/**
 * Owns the install-scoped integration port a Host lends to one registration's core: Host identity,
 * shared-slot acquisition, shared-extension reads and Feature output snapshots. It decides whether
 * each request is admitted for this exact registration and batch; slot ownership, registrations and
 * Feature activation stay with Host state and the existing plugin handles.
 */
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IPluginHostIdentity } from './host-identity-types.js'
import type { PluginHostState } from './host-state.js'
import type { PluginHostOperationRuntime } from './operation-runtime.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IRegistration } from './registry.js'
import type {
  IPluginRuntimeFeatureSnapshot,
  IPluginRuntimeIntegration,
  IPluginRuntimeSharedSlot
} from './core.js'

/** The two handle reads this port needs from the canonical name-addressed plugin handle. */
type IIntegrationHandle = Readonly<{
  readonly extensions: object
  getFeature(feature: string): object
}>

/** Host authority lent to every integration port; nothing here can mutate Host state directly. */
export type IPluginHostRuntimeIntegrationPort<TDomainCore extends object, TValue> = Readonly<{
  /** Issuing Host, used for managed-host matching and reserved-key checks. */
  readonly host: object
  readonly identity: IPluginHostIdentity
  readonly nodeId: string
  /** Configured Host diagnostic outlet; undefined keeps the receiving domain's default reporter. */
  readonly report: ((error: unknown) => void) | undefined
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly operations: PluginHostOperationRuntime
  /** Rejects with the Host lifecycle code once the Host is closing or disposed. */
  assertActive(): void
  /** Returns whether the given object is a Host managed by this package instance and Host. */
  matchesHost(host: object): boolean
  /** Creates the canonical handle, reading candidates from an uncommitted batch when supplied. */
  createHandle(name: string, batch?: IInstallBatchContext<TDomainCore, TValue>): IIntegrationHandle
  /** Registration whose lifecycle hook is currently running, if any. */
  currentHookRegistration(): IRegistration<TDomainCore, TValue> | undefined
}>

/** Throws the canonical revocation error used by every stale integration read. */
function registrationRevoked(): never {
  throw new PluginHostError(
    PluginHostErrorCode.registrationRevoked,
    ERROR_TEXT.REGISTRATION_REVOKED
  )
}

/** Cold Feature inventory for one provider registration, captured once at read time. */
class PluginHostFeatureSnapshot<
  TDomainCore extends object,
  TValue
> implements IPluginRuntimeFeatureSnapshot {
  /** Captured frozen output map; each output keeps its original identity. */
  readonly outputs: Readonly<Record<string, object>>
  /** Calling core's current-registration check, run before every later read. */
  readonly #assertCaller: () => void
  /** Host's committed registrations, used to detect a replaced provider generation. */
  readonly #registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>
  /** Provider name the snapshot was taken for. */
  readonly #name: string
  /** Exact provider registration whose outputs were captured. */
  readonly #target: IRegistration<TDomainCore, TValue>
  /** Handle that enforces activation and output identity on each read. */
  readonly #handle: IIntegrationHandle

  /** Captures the provider's Feature outputs through the canonical handle. */
  constructor(
    assertCaller: () => void,
    registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>,
    name: string,
    target: IRegistration<TDomainCore, TValue>,
    handle: IIntegrationHandle
  ) {
    this.#assertCaller = assertCaller
    this.#registrations = registrations
    this.#name = name
    this.#target = target
    this.#handle = handle
    /** Feature names come from trusted definition metadata, never arbitrary Host fields. */
    const outputs: Record<string, object> = Object.create(null)
    for (const feature of Object.keys(target.plugin.features))
      outputs[feature] = handle.getFeature(feature)
    if (Object.keys(outputs).length === 0) void handle.extensions
    this.outputs = Object.freeze(outputs)
  }

  /** Rechecks the calling core, then resolves the provider's current named output. */
  readonly readCurrent = (feature: string): object => {
    this.#assertCaller()
    return this.#handle.getFeature(feature)
  }

  /** Rejects once the provider generation or the named output differs from the captured one. */
  readonly assertCurrent = (feature: string): void => {
    this.#assertCaller()
    if (
      this.#registrations.get(this.#name) !== this.#target ||
      this.#handle.getFeature(feature) !== this.outputs[feature]
    )
      registrationRevoked()
  }
}

/** Integration port for one registration and the install batch that created its core. */
export class PluginHostRuntimeIntegration<
  TDomainCore extends object,
  TValue
> implements IPluginRuntimeIntegration {
  readonly identity: IPluginHostIdentity
  readonly nodeId: string
  readonly report: ((error: unknown) => void) | undefined
  /** Host authority shared by every port the Host issues. */
  readonly #port: IPluginHostRuntimeIntegrationPort<TDomainCore, TValue>
  /** Registration this core belongs to. */
  readonly #registration: IRegistration<TDomainCore, TValue>
  /** Install batch that created the core; mutation authority belongs to it while uncommitted. */
  readonly #batch: IInstallBatchContext<TDomainCore, TValue> | undefined
  /** Handle created at issue time so connection admission keeps the canonical handle checks. */
  readonly #connectionHandle: IIntegrationHandle

  /** Issues the port; the connection handle is created now, as the original port did. */
  constructor(
    port: IPluginHostRuntimeIntegrationPort<TDomainCore, TValue>,
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue> | undefined
  ) {
    this.#port = port
    this.#registration = registration
    this.#batch = batch
    this.identity = port.identity
    this.nodeId = port.nodeId
    this.report = port.report
    this.#connectionHandle = port.createHandle(registration.name)
  }

  /** Validates this registration against the Host's current operation. */
  #assertValid(): void {
    this.#port.state.assertRegistrationValid(this.#registration, (current) =>
      this.#port.operations.assertCurrent(current)
    )
  }

  /** Mutation authority belongs only to this original, still uncommitted install batch. */
  #assertInstall = (): void => {
    this.#assertValid()
    if (
      !this.#batch ||
      this.#batch.committed ||
      this.#registration.lifecycle !== PluginHostRegistrationLifecycle.install
    )
      throw new PluginHostError(
        PluginHostErrorCode.resourceOutsideInstall,
        ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
      )
  }

  /** Re-validates an acquired slot's owner after the Host is known to be live. */
  #assertSlotOwner = (): void => {
    this.#port.assertActive()
    this.#assertValid()
  }

  /** Capture one original domain predicate without creating another hook or ownership registry. */
  readonly allowRemovalWhen = (allowed: () => boolean): void => {
    this.#assertInstall()
    if (typeof allowed !== 'function')
      throw createPluginHostTypeError(ERROR_TEXT.REMOVAL_ADMISSION_FUNCTION)
    if (this.#registration.removalAdmission !== undefined)
      throw createPluginHostTypeError(ERROR_TEXT.REMOVAL_ADMISSION_ALREADY_SET)
    this.#registration.removalAdmission = Object.freeze({ allowed })
  }

  /** Queries only the original managed-host authority. */
  readonly matchesHost = (host: object): boolean => this.#port.matchesHost(host)

  /** Exact registration is checked before a name-addressed handle can select any successor. */
  readonly assertCurrent = (): void => {
    this.#port.assertActive()
    if (this.#port.state.registrations.get(this.#registration.name) !== this.#registration)
      registrationRevoked()
    void this.#connectionHandle.extensions
  }

  /** Admits the prepared registration during its current install, or ordinary published access. */
  readonly assertPreparedRegistration = (): void => {
    this.#port.assertActive()
    const registration = this.#registration
    if (registration.lifecycle === PluginHostRegistrationLifecycle.install) {
      this.#assertValid()
      return
    }
    if (this.#port.state.registrations.get(registration.name) === registration) {
      this.assertCurrent()
      return
    }
    /** The original lifecycle owner already retains the exact active install row. */
    const current = this.#port.currentHookRegistration()
    const batch = this.#batch
    if (
      batch &&
      !batch.committed &&
      batch.registrations.get(registration.name) === registration &&
      registration.installed &&
      !registration.lifecycleController?.signal.aborted &&
      current !== undefined &&
      batch.registrations.get(current.name) === current &&
      current.lifecycle === PluginHostRegistrationLifecycle.install &&
      this.#port.operations.isCurrent(current.operation)
    ) {
      /** The original candidate handle owns installed/enabled/activation checks. */
      void this.#port.createHandle(registration.name, batch).extensions
      return
    }
    registrationRevoked()
  }

  /** Reads a committed shared facade without acquiring ownership. */
  readonly readSharedExtension = (key: PropertyKey): object | undefined => {
    this.#port.assertActive()
    return this.#port.state.readSharedExtension(key)
  }

  /** Acquires one key/family slot during this core's original uncommitted install only. */
  readonly acquireSharedSlot = <TFacade extends object>(
    key: PropertyKey,
    family: object,
    create: (slot: IPluginRuntimeSharedSlot<TFacade>) => TFacade
  ): IPluginRuntimeSharedSlot<TFacade> => {
    this.#assertInstall()
    /** Normalize numeric PropertyKey once before entering the canonical ownership map. */
    const slotKey = typeof key === 'number' ? String(key) : key
    if (Reflect.has(this.#port.host, slotKey) && !this.#port.state.ownsSharedExtension(slotKey))
      throw new PluginHostError(
        PluginHostErrorCode.extensionReserved,
        ERROR_TEXT.EXTENSION_RESERVED(this.#registration.name, slotKey)
      )
    return this.#port.state.acquireSharedSlot(
      this.#registration,
      this.#batch!,
      slotKey,
      family,
      create,
      this.#assertInstall,
      this.#assertSlotOwner
    )
  }

  /** Captures one provider's cold Feature inventory through the canonical handle. */
  readonly readFeatureOutputs = (name: string): IPluginRuntimeFeatureSnapshot => {
    /** The original install batch owns candidates; later generations require this exact live core. */
    const candidateBatch = this.#batch && !this.#batch.committed ? this.#batch : undefined
    if (candidateBatch) this.#assertInstall()
    else this.assertCurrent()
    /** A name is resolved only once to the exact registered Feature owner. */
    const target =
      candidateBatch?.registrations.get(name) ?? this.#port.state.registrations.get(name)
    /** Original getFeature access enforces activation and output identity. */
    const handle = this.#port.createHandle(name, candidateBatch)
    if (!target) {
      void handle.extensions
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotInstalled,
        ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
      )
    }
    return Object.freeze(
      new PluginHostFeatureSnapshot(
        this.assertCurrent,
        this.#port.state.registrations,
        name,
        target,
        handle
      )
    )
  }
}
