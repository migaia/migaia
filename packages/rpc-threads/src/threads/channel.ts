import type { IAbortSignal } from '@migaia/utils/promise'
import {
  createEventEmitterMessageResource,
  createEventTargetMessageResource,
  readAdapterAbortReason,
  type IAdapterMessageResource
} from '@migaia/rpc-core/adapter/internal-advanced'
import type {
  INodeMessagePortLike,
  IBrowserMessagePortLike
} from '@migaia/rpc-core/adapters/message-port'
import type { IRuntimePeerSourceResult } from '@migaia/rpc-core/remote'
import { RpcCapability } from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import type { IThreadChannelOptions, IThreadWebPort } from './types.js'

/** Static policy keeps its synchronous zero-handshake path; runtime proposals require actual ACK. */
function requiresCapabilityAcknowledgement(capabilities: readonly string[] | undefined): boolean {
  return (
    capabilities?.some(
      (value) => !rpcMessageCapabilityControl.staticCapabilities.includes(value)
    ) ?? false
  )
}

/** Adapt EventTarget message shape without transferring Worker lifecycle ownership. */
export function threadWebPort(port: IThreadWebPort): IBrowserMessagePortLike {
  return {
    postMessage: (message, transfer) => port.postMessage(message, transfer),
    addEventListener: (type, listener) => port.addEventListener(type, listener),
    removeEventListener: (type, listener) => port.removeEventListener(type, listener),
    start: () => undefined,
    close: () => undefined
  }
}

/** Fixed profile construction is synchronous; expanded proposals await Core's actual raw ACK. */
export function openThreadMessageResource(
  resource: IAdapterMessageResource,
  peerId: string,
  options: IThreadChannelOptions,
  signal?: IAbortSignal,
  bootstrap?: Parameters<IAdapterMessageResource['open']>[0]['bootstrap']
): IRuntimePeerSourceResult | Promise<IRuntimePeerSourceResult> {
  if (options.capabilities === undefined)
    return resource.openStatic({ peerId, scheduler: options.scheduler })
  /** Explicit local policy only narrows the static baseline unless it actually proposes extensions. */
  const expanded = requiresCapabilityAcknowledgement(options.capabilities)
  return expanded
    ? resource.open({
        peerId,
        scheduler: options.scheduler,
        offer: options.capabilities,
        control: rpcMessageCapabilityControl,
        signal,
        bootstrap
      })
    : Promise.resolve(
        resource.openStatic({ peerId, scheduler: options.scheduler, enabled: options.capabilities })
      )
}

/** Construct a synchronous borrowed Node channel with the fixed Thread capability profile. */
export function constructNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult {
  return createEventEmitterMessageResource(port).openStatic({
    peerId,
    scheduler: options.scheduler,
    enabled: options.capabilities
  })
}

/** Construct a synchronous borrowed Web channel without runtime bootstrap or capability ACK. */
export function constructWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult {
  return createEventTargetMessageResource(port).openStatic({
    peerId,
    scheduler: options.scheduler,
    enabled: options.capabilities
  })
}

/**
 * Borrow a Node/EventEmitter port with a synchronous identity channel and no hello for the fixed
 * profile. peerId is the caller's routing label and scheduler is required. close shares one Promise
 * and removes this channel's listeners/observer without physically closing the borrowed port.
 */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions &
    Readonly<{
      capabilities?: readonly (typeof RpcCapability.stream | typeof RpcCapability.batch)[]
    }>
): IRuntimePeerSourceResult
/**
 * Expanded capabilities return a Promise and require Core's actual bilateral ACK on this port.
 * Unsupported/missing/malformed acknowledgement rejects; local labels alone grant no Peer RPC
 * runtime, binary, authentication or transfer authority. The caller still owns the physical port.
 */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult | Promise<IRuntimePeerSourceResult>
/** Preserve fixed construction while the held resource owns expanded control and capability facts. */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult | Promise<IRuntimePeerSourceResult> {
  return requiresCapabilityAcknowledgement(options.capabilities)
    ? openThreadMessageResource(createEventEmitterMessageResource(port), peerId, options)
    : constructNodeThreadChannel(port, peerId, options)
}

/**
 * Borrow an EventTarget port synchronously with the fixed identity profile and no bootstrap hello.
 * peerId is a routing label, scheduler is required, and logical close only detaches this channel's
 * observers/listeners. The caller retains Worker/physical-port shutdown responsibility.
 */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions &
    Readonly<{
      capabilities?: readonly (typeof RpcCapability.stream | typeof RpcCapability.batch)[]
    }>
): IRuntimePeerSourceResult
/**
 * Expanded proposals await the same bounded raw ACK on the actual EventTarget port. The Promise
 * rejects failed admission rather than treating a matching local declaration as trusted agreement.
 * Peer RPC binary/transfer use also requires Core's separate authentication and profile checks.
 */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult | Promise<IRuntimePeerSourceResult>
/** Preserve fixed construction while Core captures the peer's actual expanded proposal. */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult | Promise<IRuntimePeerSourceResult> {
  return requiresCapabilityAcknowledgement(options.capabilities)
    ? openThreadMessageResource(createEventTargetMessageResource(port), peerId, options)
    : constructWebThreadChannel(port, peerId, options)
}

/** Await only adapter preparation; cancellation keeps the original reason and removes its listener. */
export async function awaitThreadPreparation<T>(
  prepared: Promise<T>,
  signal: IAbortSignal
): Promise<T> {
  if (signal.aborted) throw readAdapterAbortReason(signal)
  /** Cancellation belongs only to this opening attempt. */
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      prepared,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(readAdapterAbortReason(signal))
        signal.addEventListener('abort', abort, { once: true })
      })
    ])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}
