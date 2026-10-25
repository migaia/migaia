/**
 * Adapt managed raw delivery to the Browser transport's native listener shape without owning a
 * Worker.
 */
import type { IWorkerPluginOptions } from '@migaia/rpc-plugin-browser'

/** Borrow the actual native port accepted by the dedicated Worker transport's public factory. */
export type IWorkerMessagePort = IWorkerPluginOptions['worker']

/**
 * The part of a native worker `message` event that store-worker reads. Declared structurally so the
 * package needs no DOM types; a real `MessageEvent` from any supported runtime is assignable.
 */
export type IWorkerMessageEvent = Readonly<{ data: unknown }>

/** Native listener shape is derived from the existing authoring SDK contract. */
type IWorkerPortListener = Parameters<IWorkerMessagePort['addEventListener']>[1]
/** Native event names remain constrained by the existing authoring SDK. */
type IWorkerPortEventName = Parameters<IWorkerMessagePort['addEventListener']>[0]

/** Raw managed delivery borrows one outbound callback and the actual transport's message listener. */
export class WorkerMessagePort implements IWorkerMessagePort {
  /** The caller retains physical Worker lifetime and outbound delivery. */
  #post: IWorkerMessagePort['postMessage']
  /** The canonical transport installs and removes this exact inbound callback. */
  #listener: IWorkerPortListener | undefined

  /** Capture physical output without installing any independent native subscription. */
  constructor(post: IWorkerMessagePort['postMessage']) {
    this.#post = post
  }

  /** Forward the original transfer list without changing its ownership semantics. */
  postMessage(...[message, transfer]: Parameters<IWorkerMessagePort['postMessage']>): void {
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
    // The managed bridge supplies the data view read by the actual Browser carrier, without DOM allocation.
    this.#listener?.({ data: message } as Parameters<IWorkerPortListener>[0])
  }
}
