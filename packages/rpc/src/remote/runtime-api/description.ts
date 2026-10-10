import { normalizePortable } from '../../contract/index.js'
import { RpcWireLimit } from '../../contract/index.js'
import { normalizeRuntimeGeneration } from '../../contract/runtime-api/metadata.js'
import type { IRpcRuntimeGeneration } from '../../contract/index.js'
import type { IRuntimeMethodEntry } from './catalog.js'
import { RpcError, RpcCoreErrorCode } from '../../core/index.js'
import { isRpcErrorInstance } from '../../core/spi.js'
import { RemoteCatalogLimit, REMOTE_NAME_PATTERN } from '../contract.js'
import {
  RuntimeApiErrorText,
  RuntimeApiMode,
  RuntimeApiModeSource,
  RuntimeReportKind,
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
  /** Safe immediate connection name; it confers no remote principal or mutation authority. */
  forwardedVia?: string
}>

/** The new application description travels on an ordinary request after runtime-api agreement. */
export type IRuntimePeerDescription = Readonly<{
  schemaVersion: 2
  self: IRuntimePeerIdentity & Readonly<{ generation?: IRpcRuntimeGeneration }>
  methods: readonly IRuntimeMethodDescription[]
  /** Exchanged only after both actual offers negotiate forward-route@1. */
  nodeId?: string
}>

/** Project the original compiled routes once for Peer and listener directories before any query. */
export function describeRuntimeMethods(
  methods: readonly IRuntimeMethodEntry[],
  supportsStream: boolean
): readonly IRuntimeMethodDescription[] {
  return methods.map((entry) => ({
    name: entry.name,
    supportedModes: entry.supportedModes ?? [
      RuntimeApiMode.request,
      RuntimeApiMode.notify,
      ...(supportsStream ? [RuntimeApiMode.stream] : [])
    ],
    modeSource: entry.supportedModes
      ? RuntimeApiModeSource.declared
      : RuntimeApiModeSource.generatedRoutes,
    ...(entry.declaration ? { idempotent: entry.declaration.idempotent } : {}),
    ...(entry.kind === 'forward' ? { forwardedVia: entry.forwardedVia } : {})
  }))
}

/** A safe local report compares two accepted generations without retaining either endpoint. */
export type IRuntimeDirectoryDiff = Readonly<{
  type: typeof RuntimeReportKind.contractDiff
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

/** Compare actual route sets only at accepted replacement; erased TS signatures cannot participate. */
export function runtimeDirectoryDiff(
  previous: IRuntimePeerDescription,
  current: IRuntimePeerDescription
): IRuntimeDirectoryDiff | undefined {
  /** Both bounded directories have already passed canonical cold description admission. */
  const before = new Map(previous.methods.map((method) => [method.name, method]))
  /** The replacement's method index exists only for this cold comparison, never dispatch. */
  const after = new Map(current.methods.map((method) => [method.name, method]))
  /** Reports contain safe method names, not handlers, payloads or native configuration. */
  const added = [...after.keys()].filter((name) => !before.has(name)).sort()
  /** Removed routes remain an observation; the new accepted whitelist rejects their actual use. */
  const removed = [...before.keys()].filter((name) => !after.has(name)).sort()
  /** Mode order is immaterial: only an actual set difference is an incompatible route change. */
  const modeChanged: IRuntimeDirectoryDiff['modeChanged'][number][] = []
  for (const name of [...after.keys()].sort()) {
    /** Missing old entries are additions rather than changed modes. */
    const old = before.get(name)
    /** This name comes from the admitted replacement index. */
    const next = after.get(name)!
    if (
      old &&
      (old.supportedModes.length !== next.supportedModes.length ||
        old.supportedModes.some((mode) => !next.supportedModes.includes(mode)))
    )
      modeChanged.push(
        Object.freeze({
          name,
          previous: Object.freeze([...old.supportedModes].sort()),
          current: Object.freeze([...next.supportedModes].sort())
        })
      )
  }
  if (!added.length && !removed.length && !modeChanged.length) return undefined
  return Object.freeze({
    type: RuntimeReportKind.contractDiff,
    previous: previous.self,
    current: current.self,
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    modeChanged: Object.freeze(modeChanged)
  })
}

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
export function normalizeRuntimeDescription(value: unknown): IRuntimePeerDescription {
  try {
    /** The application description is a separate schema; v1 contract parsing stays unchanged. */
    const description = record(value, ['schemaVersion', 'self', 'methods', 'nodeId'])
    if (
      description.nodeId !== undefined &&
      (typeof description.nodeId !== 'string' || !/^[0-9a-f]{32}$/u.test(description.nodeId))
    )
      invalid()
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
      const method = record(value, [
        'name',
        'supportedModes',
        'modeSource',
        'idempotent',
        'forwardedVia'
      ])
      if (
        method.forwardedVia !== undefined &&
        (typeof method.forwardedVia !== 'string' || !segment.test(method.forwardedVia))
      )
        invalid()
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
          ...(method.idempotent === undefined ? {} : { idempotent: method.idempotent as boolean }),
          ...(method.forwardedVia === undefined
            ? {}
            : { forwardedVia: method.forwardedVia as string })
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
    if (
      isRpcErrorInstance(cause) &&
      cause.code === RpcCoreErrorCode.contractInvalid &&
      cause.message === RuntimeApiErrorText.descriptionInvalid
    )
      throw cause
    invalid(cause)
  }
}
