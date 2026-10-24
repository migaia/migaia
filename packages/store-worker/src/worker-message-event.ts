import type { IWebWorkerLikePort } from '@migaia/rpc-host/plugin'

/**
 * The part of a native worker `message` event that store-worker reads. Declared structurally so the
 * package needs no DOM types; a real `MessageEvent` from any supported runtime is assignable.
 */
export type IWorkerMessageEvent = Readonly<{ data: unknown }>

/** Native listener shape is derived from the existing authoring SDK contract. */
type IWorkerPortListener = Parameters<IWebWorkerLikePort['addEventListener']>[1]
/** Native event names remain constrained by the existing authoring SDK. */
type IWorkerPortEventName = Parameters<IWebWorkerLikePort['addEventListener']>[0]

/** Raw managed delivery borrows one outbound callback and the actual transport's message listener. */
export class WorkerMessagePort implements IWebWorkerLikePort {
  /** The caller retains physical Worker lifetime and outbound delivery. */
  #post: IWebWorkerLikePort['postMessage']
  /** The canonical transport installs and removes this exact inbound callback. */
  #listener: IWorkerPortListener | undefined

  /** Capture physical output without installing any independent native subscription. */
  constructor(post: IWebWorkerLikePort['postMessage']) {
    this.#post = post
  }

  /** Forward the original transfer list without changing its ownership semantics. */
  postMessage(message: unknown, transfer?: readonly unknown[]): void {
    this.#post(message, transfer)
  }

  /** Raw managed callbacks supply message events only, matching the borrowed bridge contract. */
  addEventListener(type: IWorkerPortEventName, listener: IWorkerPortListener): void {
    if (type === 'message') this.#listener = listener
  }

  /** Detach only the original transport listener. */
  removeEventListener(type: IWorkerPortEventName, listener: IWorkerPortListener): void {
    if (type === 'message' && this.#listener === listener) this.#listener = undefined
  }

  /** Deliver one raw frame through the existing transport listener, if still attached. */
  deliver = (message: unknown): void => {
    this.#listener?.({ data: message })
  }
}
