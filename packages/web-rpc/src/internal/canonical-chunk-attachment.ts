import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IRpcFramer } from '@migaia/rpc-contract'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'

/**
 * Owns selected-framer lifetime. Sole outbound receiver accepts physical frames, so this bridge
 * never registers a semantic chunk route or a second reassembly map.
 */
export class WebRpcCanonicalChunkAttachment {
  /** Retains the first selected-framer close failure for root ResourceScope collection. */
  #closeError: unknown
  /** Distinguishes a caught `throw undefined` from no close failure. */
  #closeFailed = false
  /** Prevents later cleanup from closing the selected framer a second time. */
  #closed = false

  /** Registers exactly one selected-framer cleanup owner for an outbound-capable endpoint. */
  constructor(
    kernel: IEndpointKernelHost,
    framer: Pick<IRpcFramer<unknown, unknown, string, number>, 'close'> | undefined
  ) {
    if (!framer)
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
    kernel.registerOwner('chunk-assembler', framer)
    const close = (): void => {
      if (this.#closed) return
      this.#closed = true
      try {
        framer.close(kernel.closingSignal.reason)
      } catch (error) {
        this.#closeFailed = true
        this.#closeError = error
      }
    }
    kernel.closingSignal.addEventListener('abort', close, { once: true })
    kernel.resources.add('selected framer', () => {
      kernel.closingSignal.removeEventListener('abort', close)
      close()
      if (this.#closeFailed) throw this.#closeError
    })
  }

  /** Feature disposal leaves root ResourceScope as the sole selected-framer close owner. */
  dispose(): void {
    // Root disposal collects close failures and preserves its first close reason.
  }
}
