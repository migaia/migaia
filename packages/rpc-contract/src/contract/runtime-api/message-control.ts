import { RpcCapability, RpcWireLimit } from '../wire-constants.js'
import { normalizePortable } from '../normalize.js'
import { normalizeRuntimeGeneration } from './metadata.js'
import type { IRpcPortableValue } from '../types.js'
import type { IRpcRuntimeGeneration } from './types.js'

/** Existing private startup spellings remain stable for same-version message adapters. */
export const RuntimeMessageControl = {
  /** Initial cloned-data wrapper discriminator, separate from ordinary RPC frames. */
  data: 'migaia.thread.data',
  /** Legacy readiness acknowledgement; it contributes no capability proposal. */
  ready: 'migaia.thread.data.ack',
  /** Independent runtime capability acknowledgement discriminator. */
  acknowledgement: 'migaia.thread.runtime.ack',
  /** Closed startup metadata version required by admission. */
  version: 1,
  /** Startup acknowledgement budget consumed by the adapter's existing timer owner. */
  timeoutMs: 10_000,
  /** Stable adapter diagnostic when the initial data bootstrap is not acknowledged. */
  failureText: 'Thread data bootstrap was not acknowledged'
} as const

/** Pure control admission reports the original field without constructing another package's error. */
export type IRuntimeMessageControlResult<T> =
  | Readonly<{
      /** Structural admission succeeded; no physical-source authority is implied. */
      valid: true
      /** Admitted projected data for the original startup owner. */
      value: T
    }>
  | Readonly<{
      /** Structural admission failed without constructing an adapter-owned error. */
      valid: false
      /** Original failure field used by the adapter's existing diagnostic boundary. */
      field: string
    }>

/** Closed native startup identity contains only the original bounded routing/display fields. */
type IRuntimeMessageIdentity = Readonly<{ name: string; instanceId: string }>

/** The original launch envelope contains data proposals, never physical ownership authority. */
type IRuntimeMessageBootstrap = Readonly<{
  version: typeof RuntimeMessageControl.version
  self: IRuntimeMessageIdentity
  parent: IRuntimeMessageIdentity
  capabilities: readonly string[]
  generation?: IRpcRuntimeGeneration
}>

/** Use the original exact identity grammar without depending on the remote implementation owner. */
function readRuntimeMessageIdentity(value: unknown): IRuntimeMessageIdentity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  /** Raw cloned input is admitted with the original field count and identifier bounds. */
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== 2 ||
    typeof record.name !== 'string' ||
    !record.name ||
    record.name.length > RpcWireLimit.maxIdentifierChars ||
    typeof record.instanceId !== 'string' ||
    !record.instanceId ||
    record.instanceId.length > RpcWireLimit.maxIdentifierChars
  )
    return undefined
  return Object.freeze({ name: record.name, instanceId: record.instanceId })
}

/** Read the original portable address/data wrapper before interpreting runtime metadata. */
function readRuntimeMessageData(
  value: unknown
): IRuntimeMessageControlResult<Readonly<{ peerId: string; data?: IRpcPortableValue }>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== RuntimeMessageControl.data ||
    !('peerId' in value) ||
    typeof value.peerId !== 'string' ||
    value.peerId.length === 0
  )
    return { valid: false, field: 'bootstrap' }
  return {
    valid: true,
    value: Object.freeze({
      peerId: value.peerId,
      ...('data' in value && value.data !== undefined
        ? { data: normalizePortable(value.data) }
        : {})
    })
  }
}

/** Preserve the complete original bootstrap admission and its generation failure boundary. */
function readRuntimeMessageInitial(
  value: unknown
): IRuntimeMessageControlResult<
  Readonly<{ capabilities: readonly string[]; metadata: IRuntimeMessageBootstrap }>
> {
  /** Portable business admission remains first, with its original Contract error identity. */
  const original = readRuntimeMessageData(value)
  if (!original.valid) return original
  if (
    !value ||
    typeof value !== 'object' ||
    !('runtimeApi' in value) ||
    !value.runtimeApi ||
    typeof value.runtimeApi !== 'object' ||
    Array.isArray(value.runtimeApi)
  )
    return { valid: false, field: 'runtimeApi' }
  /** Private metadata retains its original required fields and one optional generation. */
  const runtime = value.runtimeApi as Record<string, unknown>
  if (
    Object.keys(runtime).length !== (runtime.generation === undefined ? 4 : 5) ||
    runtime.version !== RuntimeMessageControl.version ||
    !Object.hasOwn(runtime, 'self') ||
    !Object.hasOwn(runtime, 'parent') ||
    !Object.hasOwn(runtime, 'capabilities')
  )
    return { valid: false, field: 'runtimeApi' }
  /** The native address and offered identity must remain exactly the same startup route. */
  const self = readRuntimeMessageIdentity(runtime.self)
  if (!self || self.instanceId !== original.value.peerId)
    return { valid: false, field: 'runtimeApi' }
  /** Generation validation used to present the established bootstrap error without its inner cause. */
  let generation: IRpcRuntimeGeneration | undefined
  if (runtime.generation !== undefined) {
    try {
      generation = normalizeRuntimeGeneration(runtime.generation)
    } catch {
      return { valid: false, field: 'runtimeApi' }
    }
  }
  /** Parent and capability admission retain their original final construction order. */
  const parent = readRuntimeMessageIdentity(runtime.parent)
  if (!parent) return { valid: false, field: 'runtimeApi' }
  /** One bounded offer parser is shared by the initial message and subsequent ACK. */
  const offer = readRuntimeMessageCapabilityOffer(runtime.capabilities)
  if (!offer.valid) return offer
  /** Frozen metadata remains descriptive; Core separately owns the observed raw source. */
  const metadata = Object.freeze({
    version: RuntimeMessageControl.version,
    self,
    parent,
    capabilities: offer.value,
    ...(generation ? { generation } : {})
  })
  return { valid: true, value: { capabilities: offer.value, metadata } }
}

/** Snapshot bounded independent capability proposals using the original startup admission. */
function readRuntimeMessageCapabilityOffer(
  value: unknown
): IRuntimeMessageControlResult<readonly string[]> {
  if (
    !Array.isArray(value) ||
    value.length > RpcWireLimit.maxCapabilities ||
    value.some(
      (item) => typeof item !== 'string' || !item || item.length > RpcWireLimit.maxIdentifierChars
    ) ||
    new Set(value).size !== value.length
  )
    return { valid: false, field: 'runtimeApi.capabilities' }
  return { valid: true, value: Object.freeze([...value] as string[]) }
}

/** Read the existing closed ACK record; descriptive extra fields cannot grant capabilities. */
function readRuntimeMessageAcknowledgement(
  value: unknown
): IRuntimeMessageControlResult<readonly string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { valid: false, field: 'runtimeApi.ack' }
  /** This is the original three-field ACK grammar, separate from readiness. */
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== 3 ||
    record.kind !== RuntimeMessageControl.acknowledgement ||
    record.version !== RuntimeMessageControl.version
  )
    return { valid: false, field: 'runtimeApi.ack' }
  return readRuntimeMessageCapabilityOffer(record.capabilities)
}

/** Enable exactly the shared declarations, retaining local ordering and immutable identity. */
function intersectRuntimeMessageCapabilities(
  local: readonly string[],
  peer: readonly string[]
): readonly string[] {
  /** Membership is compiled once at startup, never per application message. */
  const offered = new Set(peer)
  return Object.freeze(local.filter((capability) => offered.has(capability)))
}

/** The canonical control descriptor supplies grammar, never a completed agreement or receipt. */
export const rpcMessageCapabilityControl = Object.freeze({
  ...RuntimeMessageControl,
  /** Built-in message-carrier stream and physical-batch baseline, not an accepted peer agreement. */
  staticCapabilities: Object.freeze([
    RpcCapability.stream,
    RpcCapability.batch
  ]) as readonly string[],
  /** Validate and freeze a bounded duplicate-free independent capability proposal. */
  readOffer: readRuntimeMessageCapabilityOffer,
  /** Canonical clone carriers offer native storage only alongside their actual portable-binary root. */
  localOffer(capabilities: readonly string[]): IRuntimeMessageControlResult<readonly string[]> {
    return readRuntimeMessageCapabilityOffer(
      capabilities.includes(RpcCapability.portableBinary) &&
        !capabilities.includes(RpcCapability.nativeBinary)
        ? [...capabilities, RpcCapability.nativeBinary]
        : capabilities
    )
  },
  /** Admit the closed versioned ACK; invalid grammar returns its original field diagnostic. */
  readAcknowledgement: readRuntimeMessageAcknowledgement,
  /** Admit the address/data wrapper; invalid portable business data keeps its Contract error. */
  readData: readRuntimeMessageData,
  /** Freeze the shared declarations in local order without expanding dependency closure. */
  intersect: intersectRuntimeMessageCapabilities,
  /** Initial launch messages retain the original wrapper and are read as raw control input. */
  isInitial(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === RuntimeMessageControl.data
    )
  },
  /** Recognize ACK traffic without turning ordinary application frames into control records. */
  isAcknowledgement(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === RuntimeMessageControl.acknowledgement
    )
  },
  /** Legacy readiness is private control traffic and never contributes a capability proposal. */
  isReady(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === RuntimeMessageControl.ready
    )
  },
  /** Raw initial input provides the independent peer proposal, never an already accepted result. */
  readInitial: readRuntimeMessageInitial,
  /** Capability ACKs retain their existing versioned wire shape. */
  acknowledgement(offer: readonly string[]) {
    return {
      kind: RuntimeMessageControl.acknowledgement,
      version: RuntimeMessageControl.version,
      capabilities: offer
    }
  }
})

/** Only this package-owned descriptor may choose the built-in message control grammar. */
export type IRpcMessageCapabilityControl = typeof rpcMessageCapabilityControl
