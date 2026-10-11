import type { IAbortSignal } from '@migaia/lifecycle'
import {
  createEventEmitterMessageResource,
  createEventTargetMessageResource,
  readAdapterAbortReason,
  type IAdapterMessageResource
} from '@migaia/rpc-core/adapter'
import type {
  INodeMessagePortLike,
  IBrowserMessagePortLike
} from '@migaia/rpc-core/adapters/message-port'
import type { IRuntimePeerSourceResult } from '@migaia/rpc-core/remote'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import type { IThreadChannelOptions, IThreadWebPort } from './types.js'

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
  const expanded = options.capabilities.some(
    (value) => !rpcMessageCapabilityControl.staticCapabilities.includes(value)
  )
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

/** Borrow the supplied EventEmitter port with the original zero-handshake fixed profile. */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult {
  return constructNodeThreadChannel(port, peerId, options)
}

/** Borrow the supplied EventTarget port with the original zero-handshake fixed profile. */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult {
  return constructWebThreadChannel(port, peerId, options)
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
