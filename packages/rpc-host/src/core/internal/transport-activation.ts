import type { IEndpointKernelActivation, IEndpointKernelCallbacks } from '../endpoint-kernel.js'
import type { IRpcTransport } from '../transport.js'

/**
 * Creates the one quarantined transport subscription used by both the legacy endpoint and the
 * PluginHost activation plugin. The callback is committed only after the kernel has registered
 * every disposer, so synchronous adapter callbacks cannot escape construction.
 */
export function createEndpointTransportActivation(
  transport: IRpcTransport,
  callbacks: IEndpointKernelCallbacks,
  subscribe: IRpcTransport['subscribe'] = (listener) => transport.subscribe(listener)
): IEndpointKernelActivation {
  return new EndpointTransportActivation(transport, callbacks, subscribe)
}

/** The kernel commits one quarantined subscription only after owning every disposal receipt. */
class EndpointTransportActivation implements IEndpointKernelActivation {
  /** Physical callbacks remain quarantined until complete kernel construction. */
  #committed = false
  /** Listener registration failure is rethrown at the original commit boundary. */
  #registrationFailed = false
  /** Even a thrown undefined remains the exact original registration failure. */
  #registrationError: unknown
  /** Core retains each actual physical release receipt, including absent optional channels. */
  readonly unsubscribe: () => void
  /** Optional physical transport diagnostics share the same construction quarantine. */
  readonly unsubscribeTransportError: (() => void) | undefined
  /** Optional listener diagnostics share the same construction quarantine. */
  readonly unsubscribeListenerError: (() => void) | undefined

  /** Subscribe before registering diagnostics, preserving original acquisition and rollback order. */
  constructor(
    transport: IRpcTransport,
    callbacks: IEndpointKernelCallbacks,
    subscribe: IRpcTransport['subscribe']
  ) {
    this.unsubscribe = subscribe((message) => {
      if (!this.#committed) return
      void Promise.resolve(callbacks.receive(message)).catch(callbacks.receiveError)
    })
    try {
      this.unsubscribeTransportError = transport.onTransportError?.((error) => {
        if (this.#committed) callbacks.transportError(error)
      })
      this.unsubscribeListenerError = transport.onListenerError?.((error) => {
        if (this.#committed) callbacks.listenerError(error)
      })
    } catch (error) {
      this.#registrationFailed = true
      this.#registrationError = error
    }
  }

  /** Only complete physical registration permits messages to enter the constructed kernel. */
  readonly commit = (): void => {
    if (this.#registrationFailed) throw this.#registrationError
    this.#committed = true
  }
}
