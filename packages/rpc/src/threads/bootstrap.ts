import { ThreadBootstrap, ThreadEvent, THREAD_RUNTIME_API_VERSION } from './constants.js'
import { RpcWireLimit } from '../contract/wire-constants.js'
import type { IRuntimePeerIdentity } from '../remote/runtime-api/description.js'
import type { IRuntimePeerSourceContext } from '../remote/runtime-api/peer.js'
import type { IRpcRuntimeGeneration } from '../contract/runtime-api/types.js'
import { normalizeRuntimeGeneration } from '../contract/runtime-api/normalize.js'
import { normalizePortable } from '../contract/normalize.js'
import type { IRpcPortableValue } from '../contract/types.js'
import type { IThreadWebPort } from './types.js'
import { invalidThreadConfig } from './error.js'
import { ThreadErrorText } from './error-text.js'

/** Private addressing is separate from portable business data and carries no RPC handshake. */
export type IThreadBootstrapData = Readonly<{ peerId: string; data?: IRpcPortableValue }>

/** A library launcher supplies exact safe addresses; the native Worker supplies physical provenance. */
export type IThreadRuntimeBootstrap = Readonly<{
  version: typeof THREAD_RUNTIME_API_VERSION
  self: IRuntimePeerIdentity
  parent: IRuntimePeerIdentity
  capabilities: readonly string[]
  /** Native launch metadata supplies a stable namespace and accepted execution ordinal. */
  generation?: IRpcRuntimeGeneration
}>

/** Keep private identity within the canonical handshake identifier bound. */
function runtimeIdentity(value: unknown): IRuntimePeerIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalidThreadConfig('runtimeApi', ThreadErrorText.bootstrapFailed)
  /** Structured-cloned bootstrap data carries no accessors or arbitrary runtime ownership. */
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
    return invalidThreadConfig('runtimeApi', ThreadErrorText.bootstrapFailed)
  return Object.freeze({ name: record.name, instanceId: record.instanceId })
}

/** Snapshot actual offer labels once at bootstrap; no per-request capability scan is added. */
export function threadCapabilityOffer(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > RpcWireLimit.maxCapabilities ||
    value.some(
      (item) => typeof item !== 'string' || !item || item.length > RpcWireLimit.maxIdentifierChars
    ) ||
    new Set(value).size !== value.length
  )
    return invalidThreadConfig('runtimeApi.capabilities', ThreadErrorText.bootstrapFailed)
  return Object.freeze([...value] as string[])
}

/** Enable only independent declarations shared by both endpoints. */
export function intersectThreadCapabilities(
  local: readonly string[],
  peer: readonly string[]
): readonly string[] {
  /** Membership is compiled once in the private bootstrap owner. */
  const offered = new Set(peer)
  return Object.freeze(local.filter((capability) => offered.has(capability)))
}

/** Decode only a complete versioned runtime envelope; legacy business data never supplies authority. */
export function readThreadRuntimeBootstrap(value: unknown): IThreadRuntimeBootstrap {
  /** Existing addressing/data admission remains owned by the original bootstrap reader. */
  const original = readThreadBootstrap(value)
  if (
    !value ||
    typeof value !== 'object' ||
    !('runtimeApi' in value) ||
    !value.runtimeApi ||
    typeof value.runtimeApi !== 'object' ||
    Array.isArray(value.runtimeApi)
  )
    return invalidThreadConfig('runtimeApi', ThreadErrorText.bootstrapFailed)
  /** Exact fields prevent private metadata from acquiring extra public ownership. */
  const runtime = value.runtimeApi as Record<string, unknown>
  if (
    Object.keys(runtime).length !== (runtime.generation === undefined ? 4 : 5) ||
    runtime.version !== THREAD_RUNTIME_API_VERSION
  )
    return invalidThreadConfig('runtimeApi', ThreadErrorText.bootstrapFailed)
  /** The child address must be exactly the original launcher's immutable fingerprint. */
  const self = runtimeIdentity(runtime.self)
  if (self.instanceId !== original.peerId)
    return invalidThreadConfig('runtimeApi', ThreadErrorText.bootstrapFailed)
  /** This is private launcher metadata, never a business claim or ownership upgrade. */
  let generation: IRpcRuntimeGeneration | undefined
  if (runtime.generation !== undefined) {
    try {
      generation = normalizeRuntimeGeneration(runtime.generation)
    } catch {
      return invalidThreadConfig('runtimeApi', ThreadErrorText.bootstrapFailed)
    }
  }
  return Object.freeze({
    version: THREAD_RUNTIME_API_VERSION,
    self,
    parent: runtimeIdentity(runtime.parent),
    capabilities: threadCapabilityOffer(runtime.capabilities),
    ...(generation ? { generation } : {})
  })
}

/** Original launchers admit their metadata before native Worker construction. */
export function createThreadRuntimeBootstrap(
  name: string,
  fingerprint: string,
  context: IRuntimePeerSourceContext & Readonly<{ generation?: IRpcRuntimeGeneration }>
): IThreadRuntimeBootstrap {
  return readThreadRuntimeBootstrap({
    kind: ThreadBootstrap.data,
    peerId: fingerprint,
    runtimeApi: {
      version: THREAD_RUNTIME_API_VERSION,
      self: { name, instanceId: fingerprint },
      parent: context.self,
      capabilities: context.capabilities,
      ...(context.generation ? { generation: context.generation } : {})
    }
  })
}

/** A runtime ACK proves the child's actual offer, without claiming endpoint activation. */
export function readThreadRuntimeAcknowledgement(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalidThreadConfig('runtimeApi.ack', ThreadErrorText.bootstrapFailed)
  /** ACK is a closed private record, distinct from legacy bootstrap readiness. */
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== 3 ||
    record.kind !== ThreadBootstrap.runtimeAcknowledged ||
    record.version !== THREAD_RUNTIME_API_VERSION
  )
    return invalidThreadConfig('runtimeApi.ack', ThreadErrorText.bootstrapFailed)
  return threadCapabilityOffer(record.capabilities)
}

/** Read Node workerData or Web bootstrap without leaking its wrapper into business configuration. */
export function readThreadBootstrap(value: unknown): IThreadBootstrapData {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== ThreadBootstrap.data ||
    !('peerId' in value) ||
    typeof value.peerId !== 'string' ||
    value.peerId.length === 0
  )
    return invalidThreadConfig('bootstrap', ThreadErrorText.bootstrapFailed)
  return Object.freeze({
    peerId: value.peerId,
    ...('data' in value && value.data !== undefined ? { data: normalizePortable(value.data) } : {})
  })
}

/** Consume data and address, remove the listener, prepare the service, then acknowledge readiness. */
export function receiveThreadData(
  port: IThreadWebPort,
  prepare: (data: IRpcPortableValue | undefined, peerId: string) => PromiseLike<void> | void
): Promise<IRpcPortableValue | undefined> {
  return new Promise((resolve, reject) => {
    /** This listener owns only the first private bootstrap message. */
    const receive = (event: { data: unknown }): void => {
      if (
        event.data === null ||
        typeof event.data !== 'object' ||
        !('kind' in event.data) ||
        event.data.kind !== ThreadBootstrap.data
      )
        return
      port.removeEventListener(ThreadEvent.message, receive)
      void (async () => {
        /** A fresh snapshot keeps private business data under the public portable contract. */
        const bootstrap = readThreadBootstrap(event.data)
        await prepare(bootstrap.data, bootstrap.peerId)
        port.postMessage({ kind: ThreadBootstrap.acknowledged }, undefined)
        resolve(bootstrap.data)
      })().catch(reject)
    }
    port.addEventListener(ThreadEvent.message, receive)
  })
}
