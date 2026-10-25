/** Admits an actual ServiceWorker or Client source and supplies its native messaging carrier. */
import type { IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import { RpcCarrierPlatform, RpcCarrierTopology } from '@migaia/rpc-contract/interfaces'
import { browserMessageCarrier } from '../native-message.js'

/** Outgoing ServiceWorker or actual Client stays distinct from the receiving EventTarget. */
export type IServiceWorkerMessageTarget = {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  readonly id?: string
}
/** A page container or worker global owns only incoming native event registration. */
export type IServiceWorkerMessageReceiver = {
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void
}
/** An actual Client id supports genuine cross-realm wrappers, independently from RPC peer names. */
export type IServiceWorkerTransportOptions = Readonly<{
  target: IServiceWorkerMessageTarget
  receiver: IServiceWorkerMessageReceiver
  peerId?: string
}>

/** Source identity is native-only; business metadata can never select another Client connection. */
export function createServiceWorkerCarrier(
  options: IServiceWorkerTransportOptions,
  context: Pick<IRpcTransportSetupContext, 'report'>
) {
  /** The original native Client identity is read once when acquisition succeeds. */
  const id = options.peerId ?? options.target.id
  return browserMessageCarrier(
    {
      receiver: options.receiver,
      send: (value, transfer) => options.target.postMessage(value, transfer),
      accept: (event) =>
        event.source === options.target ||
        (id !== undefined && event.source !== null && Reflect.get(event.source, 'id') === id)
    },
    context,
    RpcCarrierPlatform.worker,
    RpcCarrierTopology.multiplexed
  )
}
