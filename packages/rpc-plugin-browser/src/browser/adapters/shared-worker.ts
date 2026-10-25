/** Starts a borrowed SharedWorker port and supplies its structured-clone carrier to Host. */
import type { IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import { RpcCarrierPlatform } from '@migaia/rpc-contract/interfaces'
import { browserMessageCarrier } from '../native-message.js'
import type { IBrowserEventPort } from '../native-message.js'
import { BrowserRpcErrorText } from '../error-text.js'

/** A borrowed MessagePort owns native activation and structured-clone transfer only. */
export type ISharedWorkerPort = IBrowserEventPort

/** Original start-before-subscribe ordering and shared-worker diagnostics stay at acquisition. */
export function createSharedWorkerCarrier(
  port: ISharedWorkerPort,
  context: Pick<IRpcTransportSetupContext, 'report'>
) {
  return browserMessageCarrier(
    {
      receiver: port,
      start: () => port.start?.(),
      send: (value, transfer) => port.postMessage(value, transfer),
      messageError: BrowserRpcErrorText.rpcSharedWorkerMessageError
    },
    context,
    RpcCarrierPlatform.worker
  )
}
