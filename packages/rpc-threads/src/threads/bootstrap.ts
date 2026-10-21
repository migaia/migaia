import { ThreadBootstrap, ThreadEvent, THREAD_RUNTIME_API_VERSION } from './constants.js'
import type { IRuntimePeerIdentity } from '@migaia/rpc-core/remote'
import type { IRuntimePeerSourceContext } from '@migaia/rpc-core/remote'
import type { IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IThreadWebPort } from './types.js'
import { invalidThreadConfig } from './error.js'
import { ThreadErrorText } from './error-text.js'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'

/** Launcher addressing is separate from portable business initialization data. */
export type IThreadBootstrapData = Readonly<{
  /** Launcher-selected route identity; a valid data wrapper alone does not prove runtime trust. */
  peerId: string
  /** Optional normalized portable business data, without the private runtime bootstrap wrapper. */
  data?: IRpcPortableValue
}>

/** A library launcher supplies exact safe addresses; the native Worker supplies physical provenance. */
export type IThreadRuntimeBootstrap = Readonly<{
  version: typeof THREAD_RUNTIME_API_VERSION
  self: IRuntimePeerIdentity
  parent: IRuntimePeerIdentity
  capabilities: readonly string[]
  /** Native launch metadata supplies a stable namespace and accepted execution ordinal. */
  generation?: IRpcRuntimeGeneration
}>

/** Snapshot actual offer labels once at bootstrap; no per-request capability scan is added. */
export function threadCapabilityOffer(value: unknown): readonly string[] {
  /** Contract owns the same bounded startup proposal grammar used by Core raw ACK reads. */
  const parsed = rpcMessageCapabilityControl.readOffer(value)
  if (!parsed.valid) return invalidThreadConfig(parsed.field, ThreadErrorText.bootstrapFailed)
  return parsed.value
}

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

/** A runtime ACK proves the child's actual offer, without claiming endpoint activation. */
export function readThreadRuntimeAcknowledgement(value: unknown): readonly string[] {
  /** The compatibility reader delegates to the one public wire grammar, without minting trust. */
  const parsed = rpcMessageCapabilityControl.readAcknowledgement(value)
  if (!parsed.valid) return invalidThreadConfig(parsed.field, ThreadErrorText.bootstrapFailed)
  return parsed.value
}

/**
 * Validate Node workerData or a Web initial message using Contract's closed bootstrap grammar.
 * Return only peerId and optional portable data, not executable ports or runtime trust. Invalid
 * bootstrap/data throws Core INVALID_CONFIG with a field diagnostic before service preparation.
 */
export function readThreadBootstrap(value: unknown): IThreadBootstrapData {
  /** Address/data admission delegates to the same single grammar used by Core resource capture. */
  const parsed = rpcMessageCapabilityControl.readData(value)
  if (!parsed.valid) return invalidThreadConfig(parsed.field, ThreadErrorText.bootstrapFailed)
  return parsed.value
}

/**
 * Wait for the first matching Web bootstrap, remove this listener, then await prepare(data, peerId)
 * before posting readiness ACK. Unrelated messages are ignored. Validation, prepare, or ACK-post
 * failure rejects this Promise and no success ACK is sent. This helper installs no timeout and does
 * not terminate the borrowed Worker/port; its launcher/supervisor owns that lifetime.
 */
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
