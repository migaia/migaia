import {
  createEventEmitterMessageResource,
  type IAdapterMessageResource
} from '@migaia/rpc-core/adapter/internal-advanced'
import type { IThreadChannelOptions } from './types.js'
import type { IThreadParentPort } from './runtime-types.js'

/**
 * Retain an actual parent message port without installing a reader at construction. This advanced
 * adapter operation borrows the physical port; it does not authenticate arbitrary workerData or own
 * parent-thread termination.
 */
export class AdapterNodeThreadParentChannel {
  /** Core alone retains raw I/O and constructs the exact channel and replay facts. */
  readonly #resource: IAdapterMessageResource

  /** Retain the actual held parentPort through the same operation available to third-party adapters. */
  constructor(native: IThreadParentPort) {
    this.#resource = createEventEmitterMessageResource(native)
  }

  /**
   * Open the fixed profile synchronously with a routing peerId and required borrowed scheduler.
   * Optional capabilities only select that fixed profile; this method performs no runtime ACK or
   * child discovery. The returned channel detaches its own listeners on close, leaving physical
   * parent-port closure to the caller.
   */
  open(peerId: string, options: IThreadChannelOptions) {
    return this.#resource.openStatic({
      peerId,
      scheduler: options.scheduler,
      enabled: options.capabilities
    })
  }
}
