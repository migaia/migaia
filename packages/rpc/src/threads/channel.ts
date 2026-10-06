import type { IAbortSignal } from '@migaia/lifecycle'
import {
  createBrowserMessagePortTransport,
  createNodeMessagePortTransport,
  type IBrowserMessagePortLike,
  type INodeMessagePortLike
} from '../core/adapters/message-port.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { registerBatchAgreement } from '../core/internal/batch-frame.js'
import type { IRpcTransport } from '../core/transport.js'
import type { IRuntimePeerSourceResult } from '../remote/runtime-api/peer.js'
import type { IThreadReceiveHandoff } from './receive-handoff.js'
import { THREAD_CHANNEL_PROFILE } from './constants.js'
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

/** One generation owns only its borrowed message transport and stable close Promise. */
function threadChannel(
  transport: IRpcTransport,
  peerId: string,
  options: IThreadChannelOptions,
  handoff?: Pick<IThreadReceiveHandoff<unknown>, 'activateReceive' | 'close'>
): IRuntimePeerSourceResult {
  /** Concurrent teardown shares the exact same Promise, including cleanup rejection. */
  let closing: Promise<void> | undefined
  registerBatchAgreement(transport, options.capabilities ?? THREAD_CHANNEL_PROFILE.capabilities)
  return Object.freeze({
    transport,
    peerId,
    scheduler: options.scheduler,
    agreement: Object.freeze({
      source: 'static',
      codec: THREAD_CHANNEL_PROFILE.codec,
      capabilities: Object.freeze([
        ...(options.capabilities ?? THREAD_CHANNEL_PROFILE.capabilities)
      ])
    }),
    pipeline: THREAD_CHANNEL_PROFILE.pipeline,
    features: [],
    ...(handoff ? { activateReceive: handoff.activateReceive } : {}),
    close: () =>
      (closing ??= Promise.resolve().then(() => {
        handoff?.close()
        return transport.close?.()
      }))
  })
}

/** Create a Node borrowed channel; exit is observed exclusively by the launcher. */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions,
  handoff?: Pick<IThreadReceiveHandoff<unknown>, 'activateReceive' | 'close'>
): IRuntimePeerSourceResult {
  return threadChannel(createNodeMessagePortTransport(port), peerId, options, handoff)
}

/** Create an EventTarget borrowed channel after its bootstrap listener has left. */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions,
  handoff?: Pick<IThreadReceiveHandoff<unknown>, 'activateReceive' | 'close'>
): IRuntimePeerSourceResult {
  return threadChannel(
    createBrowserMessagePortTransport(threadWebPort(port), { ownership: 'borrowed' }),
    peerId,
    options,
    handoff
  )
}

/** Await only adapter preparation; abort reasons retain their original identity. */
export async function awaitThreadPreparation<T>(
  prepared: Promise<T>,
  signal: IAbortSignal
): Promise<T> {
  if (signal.aborted) throw resolveAbortReason(signal)
  /** Abort is scoped to this open attempt and never leaves a listener behind. */
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      prepared,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(resolveAbortReason(signal))
        signal.addEventListener('abort', abort, { once: true })
      })
    ])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}
