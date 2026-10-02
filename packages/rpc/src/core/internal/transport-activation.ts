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
  let committed = false
  const unsubscribe = subscribe((message) => {
    if (!committed) return
    void Promise.resolve(callbacks.receive(message)).catch(callbacks.receiveError)
  })
  let unsubscribeTransportError: (() => void) | undefined
  let unsubscribeListenerError: (() => void) | undefined
  let registrationFailed = false
  let registrationError: unknown
  try {
    unsubscribeTransportError = transport.onTransportError?.((error) => {
      if (committed) callbacks.transportError(error)
    })
    unsubscribeListenerError = transport.onListenerError?.((error) => {
      if (committed) callbacks.listenerError(error)
    })
  } catch (error) {
    registrationFailed = true
    registrationError = error
  }
  return {
    unsubscribe,
    unsubscribeTransportError,
    unsubscribeListenerError,
    commit: () => {
      if (registrationFailed) throw registrationError
      committed = true
    }
  }
}
