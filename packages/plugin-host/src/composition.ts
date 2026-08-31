import { assimilateCapturedThen } from '@migaia/lifecycle'
import { createPluginHostTypeError } from './error-text.js'
import ERROR_TEXT from './error-text.js'
import type {
  IPluginDataOrderSlot,
  IPluginAdmissionRequest,
  IPluginHostPhysicalCleanupResult,
  IPluginPreparedAdmissions,
  IPluginPreparedRemovalBatch,
  IPluginRegistrationReceipt
} from './typing.js'

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
export type IPreparedAdmissionsState<TRegistration, TBatch> = {
  readonly host: object
  readonly installed: readonly TRegistration[]
  readonly batch: TBatch
  readonly baseRevision: number
  committed: boolean
  discarded: boolean
}

/** Private prepared-removal state bound to exact live registrations. */
export type IPreparedRemovalState<TRegistration> = {
  readonly host: object
  readonly registrations: readonly TRegistration[]
  committed: boolean
}

/** Host-owned ordering lane state; retirement permanently invalidates its opaque handle. */
export type IDataOrderSlotState = {
  readonly host: object
  readonly name: string
  readonly ordinal: bigint
  retired: boolean
}

/** Prepared admission capsules and their private candidate state. */
const preparedAdmissions = new WeakMap<object, IPreparedAdmissionsState<unknown, unknown>>()
/** Prepared removal capsules and their exact registration state. */
const preparedRemovals = new WeakMap<object, IPreparedRemovalState<unknown>>()
/** Exact committed registration to opaque receipt provenance. */
const registrationReceipts = new WeakMap<object, IPluginRegistrationReceipt>()
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
export const createRegistrationReceipt = (registration: object): IPluginRegistrationReceipt => {
  /** Frozen receipt exposes only identity-based authority. */
  const receipt = Object.freeze({})
  registrationReceipts.set(registration, receipt)
  return receipt
}

/** Reads the exact receipt issued for one committed registration. */
export const readRegistrationReceipt = (
  registration: object
): IPluginRegistrationReceipt | undefined => registrationReceipts.get(registration)

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
