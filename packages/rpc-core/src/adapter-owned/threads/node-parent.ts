import { registerLazyNativeReplayOwner } from '../../core/internal/native-replay.js'
import { constructNodeThreadChannel } from './channel.js'
import type { IThreadChannelOptions } from './types.js'
import type { IThreadParentPort } from './runtime-resource.js'

/**
 * A complete borrowed parent-channel resource retains actual raw I/O and can open its channel.
 * Construction installs no listeners; the first canonical channel alone starts lifetime
 * observation.
 */
export class AdapterNodeThreadParentChannel {
  /** The actual held port supplies all physical writes, close events and reader-count observations. */
  readonly #native: IThreadParentPort

  /** Hold one real parent port; only privately constructed channels may consume its lazy facts. */
  constructor(native: IThreadParentPort) {
    this.#native = native
    registerLazyNativeReplayOwner(native, () => {
      /** The actual close event permanently ends this borrowed resource's lifetime. */
      let alive = true
      native.once('close', () => {
        alive = false
      })
      return { alive: () => alive, exclusive: () => native.listenerCount('message') <= 1 }
    })
  }

  /** Construct the complete channel over this exact held port, preserving the original raw I/O. */
  open(peerId: string, options: IThreadChannelOptions) {
    return constructNodeThreadChannel(this.#native, peerId, options)
  }
}
