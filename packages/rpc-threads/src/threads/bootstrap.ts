import { ThreadBootstrap, ThreadEvent, THREAD_RUNTIME_API_VERSION } from './constants.js'
import type { IRuntimePeerIdentity } from '@migaia/rpc-core/remote'
import type { IRuntimePeerSourceContext } from '@migaia/rpc-core/remote'
import type { IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IThreadWebPort } from './types.js'
import { invalidThreadConfig } from './error.js'
import { ThreadErrorText } from './error-text.js'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'

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

/**
 * A local clone adapter offers native storage only when its compiled endpoint restores portable
 * binary. Peer declarations stay untouched; core still requires the actual clone carrier.
 */
export function createThreadRuntimeCapabilityOffer(
  capabilities: readonly string[]
): readonly string[] {
  /** The standard clone-control profile owns this one capability-proposal augmentation. */
  const parsed = rpcMessageCapabilityControl.localOffer(capabilities)
  if (!parsed.valid) return invalidThreadConfig(parsed.field, ThreadErrorText.bootstrapFailed)
  return parsed.value
}

/** Enable only independent declarations shared by both endpoints. */
export function intersectThreadCapabilities(
  local: readonly string[],
  peer: readonly string[]
): readonly string[] {
  return rpcMessageCapabilityControl.intersect(local, peer)
}

/** Decode only a complete versioned runtime envelope; legacy business data never supplies authority. */
export function readThreadRuntimeBootstrap(value: unknown): IThreadRuntimeBootstrap {
  /** Contract owns the complete original closed bootstrap grammar and portable admission order. */
  const parsed = rpcMessageCapabilityControl.readInitial(value)
  if (!parsed.valid) return invalidThreadConfig(parsed.field, ThreadErrorText.bootstrapFailed)
  return parsed.value.metadata
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
      capabilities: createThreadRuntimeCapabilityOffer(context.capabilities),
      ...(context.generation ? { generation: context.generation } : {})
    }
  })
}

/** Read Node workerData or Web bootstrap without leaking its wrapper into business configuration. */
export function readThreadBootstrap(value: unknown): IThreadBootstrapData {
  /** Address/data admission delegates to the same single grammar used by Core resource capture. */
  const parsed = rpcMessageCapabilityControl.readData(value)
  if (!parsed.valid) return invalidThreadConfig(parsed.field, ThreadErrorText.bootstrapFailed)
  return parsed.value
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
