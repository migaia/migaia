import { normalizePortable } from '../portable-index.js'
import { RpcWireLimit } from '../wire-constants.js'
import { normalizeRuntimeGeneration } from './metadata.js'
import type { IRpcRuntimeGeneration } from './types.js'
import { RemoteCatalogLimit, REMOTE_NAME_PATTERN } from '../remote/check.js'
import { normalizeMethodSchema, type IRpcMethodSchema } from '../remote/schema.js'
import {
  inspectShape,
  rejectShape,
  isShapeFailure,
  RpcShapeReason,
  type IRpcShapeCheck
} from '../remote/check-result.js'
import {
  RuntimeApiMode,
  RuntimeApiModeSource,
  RUNTIME_API_SCHEMA_VERSION
} from './directory-constants.js'

/** Identity contains only safe routing/display data, never source configuration or bootstrap data. */
export type IRuntimePeerIdentity = Readonly<{
  /** Safe connection display/registration name. */ name: string
  /** Exact accepted instance address, distinct from a physical attempt number. */ instanceId: string
}>

/** Directory modes describe actual installed routes rather than the erased handler signature. */
export type IRuntimeMethodDescription = Readonly<{
  name: string
  supportedModes: readonly RuntimeApiMode[]
  modeSource: RuntimeApiModeSource
  idempotent?: boolean
  /** Safe immediate connection name; it confers no remote principal or mutation authority. */
  forwardedVia?: string
  /** Optional provider-declared input schema. */
  input?: IRpcMethodSchema
  /** Optional provider-declared result schema. */
  output?: IRpcMethodSchema
  /** Optional provider-declared stream element schema. */
  yield?: IRpcMethodSchema
}>

/** The new application description travels on an ordinary request after runtime-api agreement. */
export type IRuntimePeerDescription = Readonly<{
  schemaVersion: 2
  self: IRuntimePeerIdentity & Readonly<{ generation?: IRpcRuntimeGeneration }>
  methods: readonly IRuntimeMethodDescription[]
  /** Exchanged only after both actual offers negotiate forward-route@1. */
  nodeId?: string
}>

/** A safe local report compares two accepted generations without retaining either endpoint. */
export type IRuntimeDirectoryDiff = Readonly<{
  type: 'runtime-contract-diff'
  previous: IRuntimePeerDescription['self']
  current: IRuntimePeerDescription['self']
  added: readonly string[]
  removed: readonly string[]
  modeChanged: readonly Readonly<{
    name: string
    previous: readonly RuntimeApiMode[]
    current: readonly RuntimeApiMode[]
  }>[]
}>

/** Reject a malformed directory without copying untrusted keys or values into public diagnostics. */
function invalid(cause?: unknown, reason: RpcShapeReason = RpcShapeReason.record): never {
  return rejectShape(reason, '$', cause)
}

/** Copy only admitted own data fields, rejecting accessors without evaluating them. */
function record(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  /** A descriptor snapshot is the only read of the remote object graph at this level. */
  const descriptors = Object.getOwnPropertyDescriptors(value)
  /** Admitted values enter a fresh record, so an unexpected field can never enter the projection. */
  const result: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key))
      invalid(undefined, RpcShapeReason['unknown-field'])
    /** No getter executes during description parsing. */
    const descriptor = descriptors[key]!
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      invalid(undefined, RpcShapeReason.record)
    result[key] = descriptor.value
  }
  return result
}

/** Validate safe identity using the existing protocol identifier budget. */
function runtimeIdentity(value: unknown): IRuntimePeerIdentity {
  /** Only the two identity fields are accepted on the description wire. */
  const identity = record(value, ['name', 'instanceId'])
  for (const field of ['name', 'instanceId'] as const) {
    if (
      typeof identity[field] !== 'string' ||
      identity[field].length === 0 ||
      identity[field].length > RpcWireLimit.maxIdentifierChars
    )
      invalid(undefined, RpcShapeReason['runtime-identity'])
  }
  return Object.freeze({ name: identity.name as string, instanceId: identity.instanceId as string })
}

/** Generation is accepted only inside the authenticated directory's identity projection. */
function directoryIdentity(value: unknown): IRuntimePeerDescription['self'] {
  const identity = record(value, ['name', 'instanceId', 'generation'])
  const self = runtimeIdentity({ name: identity.name, instanceId: identity.instanceId })
  return identity.generation === undefined
    ? self
    : Object.freeze({ ...self, generation: normalizeRuntimeGeneration(identity.generation) })
}

/**
 * Parse the versioned cold directory once. The owning wire schema mirrors this closed shape; its
 * method index is compiled by the Peer rather than reparsed for each call.
 */
function readRuntimeDescription(value: unknown): IRuntimePeerDescription {
  try {
    /** The application description is a separate schema; v1 contract parsing stays unchanged. */
    const description = record(value, ['schemaVersion', 'self', 'methods', 'nodeId'])
    if (
      description.nodeId !== undefined &&
      (typeof description.nodeId !== 'string' || !/^[0-9a-f]{32}$/u.test(description.nodeId))
    )
      invalid(undefined, RpcShapeReason['runtime-node'])
    if (
      description.schemaVersion !== RUNTIME_API_SCHEMA_VERSION ||
      !Array.isArray(description.methods) ||
      description.methods.length > RemoteCatalogLimit.methodsPerCatalog
    )
      invalid(
        undefined,
        description.schemaVersion !== RUNTIME_API_SCHEMA_VERSION
          ? RpcShapeReason.version
          : RpcShapeReason['runtime-methods']
      )
    /** Directory uniqueness is checked before any whitelist can be published. */
    const names = new Set<string>()
    /** The existing remote segment grammar owns the unambiguous dotted path spelling. */
    const segment = new RegExp(REMOTE_NAME_PATTERN, 'u')
    /** Only installed route summaries enter the frozen directory. */
    const methods: IRuntimeMethodDescription[] = []
    for (const value of description.methods) {
      /** Schema fields are safe descriptors, not application handlers or parameters. */
      const method = record(value, [
        'name',
        'supportedModes',
        'modeSource',
        'idempotent',
        'forwardedVia',
        'input',
        'output',
        'yield'
      ])
      if (
        method.forwardedVia !== undefined &&
        (typeof method.forwardedVia !== 'string' || !segment.test(method.forwardedVia))
      )
        invalid(undefined, RpcShapeReason['runtime-forward'])
      if (
        typeof method.name !== 'string' ||
        method.name.length > RpcWireLimit.maxIdentifierChars ||
        !method.name.split('.').every((part) => segment.test(part)) ||
        names.has(method.name)
      )
        invalid(undefined, RpcShapeReason['runtime-method'])
      names.add(method.name)
      if (
        !Array.isArray(method.supportedModes) ||
        method.supportedModes.length === 0 ||
        method.supportedModes.length > Object.keys(RuntimeApiMode).length
      )
        invalid(undefined, RpcShapeReason['runtime-modes'])
      if (
        new Set(method.supportedModes).size !== method.supportedModes.length ||
        method.supportedModes.some((mode) => !Object.values(RuntimeApiMode).includes(mode))
      )
        invalid(undefined, RpcShapeReason['runtime-modes'])
      if (!Object.values(RuntimeApiModeSource).includes(method.modeSource as RuntimeApiModeSource))
        invalid(undefined, RpcShapeReason['runtime-mode-source'])
      if (method.idempotent !== undefined && typeof method.idempotent !== 'boolean')
        invalid(undefined, RpcShapeReason['runtime-idempotency'])
      methods.push(
        Object.freeze({
          name: method.name,
          supportedModes: Object.freeze([...method.supportedModes]) as readonly RuntimeApiMode[],
          modeSource: method.modeSource as RuntimeApiModeSource,
          ...(method.idempotent === undefined ? {} : { idempotent: method.idempotent as boolean }),
          ...(method.forwardedVia === undefined
            ? {}
            : { forwardedVia: method.forwardedVia as string }),
          ...Object.fromEntries(
            ['input', 'output', 'yield']
              .filter((key) => Object.hasOwn(method, key))
              .map((key) => [key, normalizeMethodSchema(method[key])])
          )
        })
      )
    }
    /** Portable normalization owns the existing recursive value budget even on the cold exchange. */
    return normalizePortable({
      schemaVersion: RUNTIME_API_SCHEMA_VERSION,
      self: directoryIdentity(description.self),
      ...(description.nodeId === undefined ? {} : { nodeId: description.nodeId }),
      methods
    }) as unknown as IRuntimePeerDescription
  } catch (cause) {
    if (isShapeFailure(cause)) throw cause
    invalid(cause, RpcShapeReason.portable)
  }
}

/** Check the original versioned directory without throwing or rereading caller input after failure. */
export function checkRuntimeDescription(input: unknown): IRpcShapeCheck<IRuntimePeerDescription> {
  return inspectShape(() => readRuntimeDescription(input))
}
