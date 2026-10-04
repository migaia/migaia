import { normalizePortable } from '../../contract/normalize.js'
import { RpcWireLimit } from '../../contract/wire-constants.js'
import { RpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { RemoteCatalogLimit, REMOTE_NAME_PATTERN } from '../contract.js'
import {
  RuntimeApiErrorText,
  RuntimeApiMode,
  RuntimeApiModeSource,
  RUNTIME_API_SCHEMA_VERSION
} from './constants.js'

/** Identity contains only safe routing/display data, never source configuration or bootstrap data. */
export type IRuntimePeerIdentity = Readonly<{ name: string; instanceId: string }>

/** Directory modes describe actual installed routes rather than the erased handler signature. */
export type IRuntimeMethodDescription = Readonly<{
  name: string
  supportedModes: readonly RuntimeApiMode[]
  modeSource: RuntimeApiModeSource
  idempotent?: boolean
}>

/** The new application description travels on an ordinary request after runtime-api agreement. */
export type IRuntimePeerDescription = Readonly<{
  schemaVersion: 2
  self: IRuntimePeerIdentity
  methods: readonly IRuntimeMethodDescription[]
}>

/** Reject a malformed directory without copying untrusted keys or values into public diagnostics. */
function invalid(cause?: unknown): never {
  throw new RpcError(
    RpcCoreErrorCode.contractInvalid,
    RuntimeApiErrorText.descriptionInvalid,
    cause
  )
}

/** Copy only admitted own data fields, rejecting accessors without evaluating them. */
function record(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  /** A descriptor snapshot is the only read of the remote object graph at this level. */
  const descriptors = Object.getOwnPropertyDescriptors(value)
  /** Admitted values enter a fresh record, so an unexpected field can never enter the projection. */
  const result: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) invalid()
    /** No getter executes during description parsing. */
    const descriptor = descriptors[key]!
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
    result[key] = descriptor.value
  }
  return result
}

/** Validate safe identity using the existing protocol identifier budget. */
export function runtimeIdentity(value: unknown): IRuntimePeerIdentity {
  /** Only the two identity fields are accepted on the description wire. */
  const identity = record(value, ['name', 'instanceId'])
  for (const field of ['name', 'instanceId'] as const) {
    if (
      typeof identity[field] !== 'string' ||
      identity[field].length === 0 ||
      identity[field].length > RpcWireLimit.maxIdentifierChars
    )
      invalid()
  }
  return Object.freeze({ name: identity.name as string, instanceId: identity.instanceId as string })
}

/**
 * Parse the versioned cold directory once. The owning wire schema mirrors this closed shape; its
 * method index is compiled by the Peer rather than reparsed for each call.
 */
export function normalizeRuntimeDescription(value: unknown): IRuntimePeerDescription {
  try {
    /** The application description is a separate schema; v1 contract parsing stays unchanged. */
    const description = record(value, ['schemaVersion', 'self', 'methods'])
    if (
      description.schemaVersion !== RUNTIME_API_SCHEMA_VERSION ||
      !Array.isArray(description.methods) ||
      description.methods.length > RemoteCatalogLimit.methodsPerCatalog
    )
      invalid()
    /** Directory uniqueness is checked before any whitelist can be published. */
    const names = new Set<string>()
    /** The existing remote segment grammar owns the unambiguous dotted path spelling. */
    const segment = new RegExp(REMOTE_NAME_PATTERN, 'u')
    /** Only installed route summaries enter the frozen directory. */
    const methods: IRuntimeMethodDescription[] = []
    for (const value of description.methods) {
      /** Schema fields are safe descriptors, not application handlers or parameters. */
      const method = record(value, ['name', 'supportedModes', 'modeSource', 'idempotent'])
      if (
        typeof method.name !== 'string' ||
        method.name.length > RpcWireLimit.maxIdentifierChars ||
        !method.name.split('.').every((part) => segment.test(part)) ||
        names.has(method.name)
      )
        invalid()
      names.add(method.name)
      if (
        !Array.isArray(method.supportedModes) ||
        method.supportedModes.length === 0 ||
        method.supportedModes.length > Object.keys(RuntimeApiMode).length
      )
        invalid()
      if (
        new Set(method.supportedModes).size !== method.supportedModes.length ||
        method.supportedModes.some((mode) => !Object.values(RuntimeApiMode).includes(mode))
      )
        invalid()
      if (!Object.values(RuntimeApiModeSource).includes(method.modeSource as RuntimeApiModeSource))
        invalid()
      if (method.idempotent !== undefined && typeof method.idempotent !== 'boolean') invalid()
      methods.push(
        Object.freeze({
          name: method.name,
          supportedModes: Object.freeze([...method.supportedModes]) as readonly RuntimeApiMode[],
          modeSource: method.modeSource as RuntimeApiModeSource,
          ...(method.idempotent === undefined ? {} : { idempotent: method.idempotent as boolean })
        })
      )
    }
    /** Portable normalization owns the existing recursive value budget even on the cold exchange. */
    return normalizePortable({
      schemaVersion: RUNTIME_API_SCHEMA_VERSION,
      self: runtimeIdentity(description.self),
      methods
    }) as unknown as IRuntimePeerDescription
  } catch (cause) {
    if (
      cause instanceof RpcError &&
      cause.code === RpcCoreErrorCode.contractInvalid &&
      cause.message === RuntimeApiErrorText.descriptionInvalid
    )
      throw cause
    invalid(cause)
  }
}
