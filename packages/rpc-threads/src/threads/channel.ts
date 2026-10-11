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

/** Construct a Node-style channel from the raw port or its original complete held resource. */
export function constructNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions,
  resource?: IAdapterMessageResource
) {
  return openThreadMessageResource(
    resource ?? createEventEmitterMessageResource(port),
    peerId,
    options
  )
}

/** Construct an EventTarget channel with the same Core-owned static or ACK startup operation. */
export function constructWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions,
  resource?: IAdapterMessageResource
) {
  return openThreadMessageResource(
    resource ?? createEventTargetMessageResource(port),
    peerId,
    options
  )
}

/** Default borrowed message channels preserve their original synchronous API and zero hello. */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions & Readonly<{ capabilities?: undefined }>
): IRuntimePeerSourceResult
/** Explicit capability configuration crosses the intentional same-version ACK readiness boundary. */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions & Readonly<{ capabilities: readonly string[] }>
): Promise<IRuntimePeerSourceResult>
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult | Promise<IRuntimePeerSourceResult>
/** Retain a complete channel over the exact supplied EventEmitter resource. */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions
) {
  return constructNodeThreadChannel(port, peerId, options)
}

/** Default EventTarget channel construction remains synchronous and borrows native lifecycle. */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions & Readonly<{ capabilities?: undefined }>
): IRuntimePeerSourceResult
/** Expanded local proposals await the peer's independent raw capability declaration. */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions & Readonly<{ capabilities: readonly string[] }>
): Promise<IRuntimePeerSourceResult>
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions
): IRuntimePeerSourceResult | Promise<IRuntimePeerSourceResult>
/** Retain the whole Core construction result without replacing its Promise. */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions
) {
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
