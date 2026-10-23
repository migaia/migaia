import type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'
import { defineTransportPlugin, RpcTransportMode } from '@migaia/rpc-host/plugin'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPluginName } from './peer-text.js'
import { getBrowserMessageAdapter } from './peer-adapter.js'
import type { IWorkerPluginOptions } from './peer-types.js'

/** Borrow an existing Worker or worker self without launching or terminating its native owner. */
export function dedicatedWorkerPlugin(options: IWorkerPluginOptions): IRpcTransportPlugin {
  /** Native operations admit both sides of the same EventTarget carrier. */
  const worker = options?.worker
  if (
    !worker ||
    typeof worker.postMessage !== 'function' ||
    typeof worker.addEventListener !== 'function' ||
    typeof worker.removeEventListener !== 'function'
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  return defineTransportPlugin({
    name: options.name ?? BrowserPluginName.worker,
    expose: options.expose,
    connect: options.connect,
    mode: RpcTransportMode.connect,
    deployment: getBrowserMessageAdapter().deployment({ connect: { worker } })
  })
}
