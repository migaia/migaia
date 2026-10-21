import { assimilateCapturedThen } from '@migaia/utils/function'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import type {
  IPluginDataOrderSlot,
  IPluginHostCompositionIntegration,
  IPluginAdmissionRequest,
  IPluginHostPhysicalCleanupResult,
  IPluginPreparedAdmissions,
  IPluginPreparedRemovalBatch,
  IRegistrationToken
} from './typing.js'
import { createPluginHostExtensionPublication } from './publication.js'
import { PluginHostErrorCode } from './error-code.js'

/** Validates a publication-ordered request list and resolves its Host-owned definition snapshots. */
export const resolveAdmissionDefinitions = <TDefinition>(
  requests: readonly IPluginAdmissionRequest[],
  host: object
): readonly TDefinition[] => {
  if (!Array.isArray(requests)) throw createPluginHostTypeError(ERROR_TEXT.ADMISSION_REQUESTS_ARRAY)
  const seenSlots = new Set<object>()
  return requests.map((request) => {
    let admission: unknown
    let slot: unknown
    try {
      admission = request?.admission
      slot = request?.slot
    } catch (cause) {
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
    }
    if (!admission || typeof admission !== 'object')
      throw createPluginHostTypeError(ERROR_TEXT.ADMISSION_REQUIRED)
    const definition = readAdmissionDefinition<TDefinition>(admission)
    if (!definition) throw createPluginHostTypeError(ERROR_TEXT.ADMISSION_FOREIGN)
    const definitionName = (definition as { readonly name?: unknown }).name
    const slotState = slot && typeof slot === 'object' ? readDataOrderSlotState(slot) : undefined
    if (!slotState || slotState.host !== host || slotState.name !== definitionName)
      throw createPluginHostTypeError(ERROR_TEXT.ADMISSION_SLOT_FOREIGN)
    if (slotState.retired) throw createPluginHostTypeError(ERROR_TEXT.ADMISSION_SLOT_RETIRED)
    if (seenSlots.has(slot as object))
      throw createPluginHostTypeError(ERROR_TEXT.ADMISSION_SLOT_DUPLICATE)
    seenSlots.add(slot as object)
    return definition
  })
}

/** Private prepared-admission state bound to one concrete Host instance. */
type IPreparedAdmissionsState<TRegistration, TBatch> = {
  readonly host: object
  readonly installed: readonly TRegistration[]
  readonly batch: TBatch
  readonly baseRevision: number
  committed: boolean
  discarded: boolean
}

/** Private prepared-removal state bound to exact live registrations. */
type IPreparedRemovalState<TRegistration> = {
  readonly host: object
  readonly registrations: readonly TRegistration[]
  committed: boolean
}

/** Host-owned ordering lane state; retirement permanently invalidates its opaque handle. */
export type IDataOrderSlotState = {
  readonly host: object
  readonly name: string
  readonly ordinal: bigint
  /** Stable lane segment allocated with the slot, before a plugin binds to it. */
  segment?: import('./stage-lanes.js').IStageOwnerSegment
  retired: boolean
}

/** Prepared admission capsules and their private candidate state. */
const preparedAdmissions = new WeakMap<object, IPreparedAdmissionsState<unknown, unknown>>()
/** Prepared removal capsules and their exact registration state. */
const preparedRemovals = new WeakMap<object, IPreparedRemovalState<unknown>>()
/** Exact committed registration to opaque receipt provenance. */
const registrationReceipts = new WeakMap<object, IRegistrationToken>()
/** Reverse receipt lookup keeps standalone composition views identity-bound. */
const receiptRegistrations = new WeakMap<
  object,
  { readonly registration: object; readonly host: object }
>()
/** Permanent revocation marker retained after physical cleanup resets registration lifecycle. */
const revokedRegistrations = new WeakSet<object>()
/** Opaque admission snapshot to captured plugin definition provenance. */
const admissionDefinitions = new WeakMap<object, unknown>()
/** Opaque data-order handle to its Host-owned ordering lane. */
const dataOrderSlots = new WeakMap<object, IDataOrderSlotState>()

/** Stores one Host-owned admission snapshot without exposing its captured definition. */
export const registerAdmissionDefinition = <TDefinition>(
  admission: object,
  definition: TDefinition
): void => {
  admissionDefinitions.set(admission, definition)
}

/** Reads a captured definition only through its exact opaque admission object. */
export const readAdmissionDefinition = <TDefinition>(admission: object): TDefinition | undefined =>
  admissionDefinitions.get(admission) as TDefinition | undefined

/** Creates and registers one opaque Host-owned data-order lane. */
export const createDataOrderSlotState = (
  host: object,
  name: string,
  ordinal: bigint
): Readonly<{ slot: IPluginDataOrderSlot; state: IDataOrderSlotState }> => {
  /** Mutable private lane state retained behind the frozen public token. */
  const state: IDataOrderSlotState = { host, name, ordinal, retired: false }
  /** Frozen capability token carrying no forgeable public data. */
  const slot = Object.freeze({}) as IPluginDataOrderSlot
  dataOrderSlots.set(slot, state)
  return Object.freeze({ slot, state })
}

/** Resolves one exact data-order token to its private Host lane. */
export const readDataOrderSlotState = (slot: object): IDataOrderSlotState | undefined =>
  dataOrderSlots.get(slot)

/** Registers a prepared admission capsule and returns its frozen public token. */
export const registerPreparedAdmissions = <TRegistration, TBatch>(
  state: IPreparedAdmissionsState<TRegistration, TBatch>
): IPluginPreparedAdmissions => {
  /** Frozen public capsule whose identity is the only lookup authority. */
  const prepared = Object.freeze({})
  preparedAdmissions.set(prepared, state as IPreparedAdmissionsState<unknown, unknown>)
  return prepared
}

/** Reads prepared admission state with the caller's package-private registration types. */
export const readPreparedAdmissions = <TRegistration, TBatch>(
  prepared: IPluginPreparedAdmissions
): IPreparedAdmissionsState<TRegistration, TBatch> | undefined =>
  preparedAdmissions.get(prepared) as IPreparedAdmissionsState<TRegistration, TBatch> | undefined

/** Registers a prepared removal capsule and returns its frozen public token. */
export const registerPreparedRemoval = <TRegistration>(
  state: IPreparedRemovalState<TRegistration>
): IPluginPreparedRemovalBatch => {
  /** Frozen public capsule whose identity binds the exact removal set. */
  const prepared = Object.freeze({})
  preparedRemovals.set(prepared, state as IPreparedRemovalState<unknown>)
  return prepared
}

/** Reads exact prepared removal state for one opaque capsule. */
export const readPreparedRemoval = <TRegistration>(
  prepared: IPluginPreparedRemovalBatch
): IPreparedRemovalState<TRegistration> | undefined =>
  preparedRemovals.get(prepared) as IPreparedRemovalState<TRegistration> | undefined

/** Creates and binds one opaque receipt to an exact committed registration. */
export const createRegistrationReceipt = (
  registration: object,
  host: object
): IRegistrationToken => {
  /** Frozen receipt exposes only identity-based authority. */
  const receipt = Object.freeze({})
  registrationReceipts.set(registration, receipt)
  receiptRegistrations.set(receipt, { registration, host })
  return receipt
}

/** Reads the exact receipt issued for one committed registration. */
export const readRegistrationReceipt = (registration: object): IRegistrationToken | undefined =>
  registrationReceipts.get(registration)

/** Resolves a token to its exact registration without exposing registry ownership. */
export const readRegistrationForReceipt = (
  receipt: IRegistrationToken
): { readonly registration: object; readonly host: object } | undefined =>
  receiptRegistrations.get(receipt)

/** Marks a registration token permanently stale at logical revocation. */
export const markRegistrationRevoked = (registration: object): void => {
  revokedRegistrations.add(registration)
}

/** Creates a narrow extension-only view for one live registration token. */
export const createRegistrationView = (
  receipt: IRegistrationToken
): Readonly<{ readonly extensions: Readonly<Record<PropertyKey, unknown>> }> => {
  const resolved = readRegistrationForReceipt(receipt)
  const registration = resolved?.registration as
    | {
        readonly extensions: readonly {
          readonly key: PropertyKey
          readonly descriptor: PropertyDescriptor
        }[]
        readonly installed: boolean
        readonly lifecycle: string
        readonly name: string
        readonly plugin: { readonly owner: object }
      }
    | undefined
  if (
    !resolved ||
    !registration ||
    revokedRegistrations.has(resolved.registration) ||
    !registration.installed ||
    registration.lifecycle === 'dispose'
  )
    throw new PluginHostError(
      PluginHostErrorCode.registrationRevoked,
      ERROR_TEXT.REGISTRATION_REVOKED
    )
  return createPluginHostExtensionPublication(
    [registration] as never,
    resolved.host,
    (captured) => {
      if (
        !captured[0] ||
        revokedRegistrations.has(captured[0]) ||
        !captured[0].installed ||
        captured[0].lifecycle === 'dispose'
      )
        throw new PluginHostError(
          PluginHostErrorCode.registrationRevoked,
          ERROR_TEXT.REGISTRATION_REVOKED
        )
    }
  ) as Readonly<{ readonly extensions: Readonly<Record<PropertyKey, unknown>> }>
}

/**
 * Captures one cleanup-fence `then` exactly once and assimilates foreign-realm promises and
 * thenables without relying on realm-local `instanceof Promise` branding.
 */
export const captureCleanupFence = (value: PromiseLike<void> | undefined): Promise<void> => {
  if (value === undefined) return Promise.resolve()
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
    throw createPluginHostTypeError(ERROR_TEXT.BEFORE_CLEANUP_THENABLE)
  /** One-time captured then method; hostile access becomes a stable invalid-option boundary. */
  let then: unknown
  try {
    then = value.then
  } catch (cause) {
    throw createPluginHostTypeError(ERROR_TEXT.BEFORE_CLEANUP_THENABLE, { cause })
  }
  if (typeof then !== 'function')
    throw createPluginHostTypeError(ERROR_TEXT.BEFORE_CLEANUP_THENABLE)
  return assimilateCapturedThen(then as (...args: unknown[]) => void, value)
}

/** Empty physical cleanup result shared by idempotent discard calls. */
export const emptyPhysicalCleanupResult = (): IPluginHostPhysicalCleanupResult =>
  Object.freeze({ cleanupErrors: Object.freeze([]) })

/**
 * Hosts this package constructed, mapped to their managed-protocol port.
 *
 * Module-private and deliberately separate from the disposal-provenance map in `host-runtime`: the
 * two answer different questions about the same objects, and one map answering both would make
 * either owner unable to change its own key set. A `WeakMap` means a host that goes out of scope
 * takes its entry with it, so there is no registration to undo and nothing to leak.
 */
const managedHosts = new WeakMap<object, IPluginHostCompositionIntegration<object>>()

/**
 * Builds the managed-protocol port over a host's composition runtime.
 *
 * It lives here rather than in the host constructor because this module owns what the protocol is:
 * the host only owns the runtime the port delegates to, and a literal spelled out in the
 * constructor put the shape of a composition-only surface in the middle of ordinary host wiring.
 */
export const buildManagedPort = <TRuntime extends IPluginHostCompositionIntegration<object>>(
  runtime: TRuntime,
  readRevision: () => number,
  readCurrentSnapshot: () => unknown
): IPluginHostCompositionIntegration<object> =>
  Object.freeze({
    createPluginAdmission: (plugin) => runtime.createPluginAdmission(plugin),
    createDataOrderSlot: (name) => runtime.createDataOrderSlot(name),
    retireDataOrderSlot: (slot) => runtime.retireDataOrderSlot(slot),
    prepareAdmissions: (requests) => runtime.prepareAdmissions(requests),
    commitPreparedAdmissions: (prepared) => runtime.commitPreparedAdmissions(prepared),
    discardPreparedAdmissions: (prepared) => runtime.discardPreparedAdmissions(prepared),
    prepareUnUseBatch: (receipts) => runtime.prepareUnUseBatch(receipts),
    commitPreparedUnUseBatch: (prepared, options) =>
      runtime.commitPreparedUnUseBatch(prepared, options),
    // getter，不是快照：`revision` 每次读都必须反映当前提交代次。
    get revision(): number {
      return readRevision()
    },
    getCurrentSnapshot: () =>
      readCurrentSnapshot() as ReturnType<
        IPluginHostCompositionIntegration<object>['getCurrentSnapshot']
      >
  })

/** Records a host's managed-protocol port. Called once, at the end of host construction. */
export const registerManagedHost = (
  target: object,
  port: IPluginHostCompositionIntegration<object>
): void => {
  managedHosts.set(target, port)
}

/**
 * Whether a value is a host this package constructed.
 *
 * Recognizes class instances and defineHost() handles issued by this package instance, without
 * inspecting user properties. It checks provenance rather than current lifecycle state; structural
 * lookalikes and Hosts from another copy of the package return false.
 */
export const isManagedHost = (target: unknown): boolean =>
  (typeof target === 'object' || typeof target === 'function') &&
  target !== null &&
  managedHosts.has(target as object)

/**
 * Returns the stable frozen composition port for a Host issued by this package instance. Use it
 * only when owning prepare/commit/discard and cleanup-fence protocols; ordinary consumers use
 * plugin handles. Unknown targets throw COMPOSITION_TARGET_UNMANAGED. Opening the port does not
 * reactivate a closing or disposed Host; individual operations keep their lifecycle checks.
 */
export const openComposition = (target: object): IPluginHostCompositionIntegration<object> => {
  const port = managedHosts.get(target)
  if (!port)
    throw new PluginHostError(
      PluginHostErrorCode.compositionTargetUnmanaged,
      ERROR_TEXT.COMPOSITION_TARGET_UNMANAGED
    )
  return port
}
