import {
  createEventEmitterMessageResource,
  type IAdapterMessageResource
} from '@migaia/rpc-core/adapter'
import type { IThreadChannelOptions } from './types.js'
import type { IThreadParentPort } from './runtime-types.js'

/** Borrow the actual parent message resource without installing listeners before first opening. */
export class AdapterNodeThreadParentChannel {
  /** Core alone retains raw I/O and constructs the exact channel and replay facts. */
  readonly #resource: IAdapterMessageResource

  /** Retain the actual held parentPort through the same operation available to third-party adapters. */
  constructor(native: IThreadParentPort) {
    this.#resource = createEventEmitterMessageResource(native)
  }

  /** Borrow this held parent resource through the synchronous fixed Thread profile. */
  open(peerId: string, options: IThreadChannelOptions) {
    return this.#resource.openStatic({
      peerId,
      scheduler: options.scheduler,
      enabled: options.capabilities
    })
  }
}
