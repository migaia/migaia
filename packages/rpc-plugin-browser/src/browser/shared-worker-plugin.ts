import type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'
import {
  createAdapterDeployment,
  defineTransportPlugin,
  RpcTransportMode
} from '@migaia/rpc-host/plugin'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPluginName } from './peer-text.js'
import { getBrowserMessageAdapter } from './peer-adapter.js'
import { listenBrowserPorts } from './peer-listener.js'
import type { ISharedWorkerPluginOptions } from './peer-types.js'

/** Capture one borrowed page port or a worker connect scope; installation owns all native effects. */
export function sharedWorkerPlugin(options: ISharedWorkerPluginOptions): IRpcTransportPlugin {
  if (
    !options ||
    Number(options.sharedWorker !== undefined) + Number(options.listen !== undefined) !== 1
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  /** Admission is structural so explicit native doubles do not depend on the current global realm. */
  const port = options.sharedWorker?.port
  /** A worker scope has its own native accept registration, separate from every accepted port. */
  const scope = options.listen
  if (
    scope
      ? typeof scope.addEventListener !== 'function' ||
        typeof scope.removeEventListener !== 'function'
      : !port ||
        typeof port.postMessage !== 'function' ||
        typeof port.addEventListener !== 'function' ||
        typeof port.removeEventListener !== 'function'
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  return defineTransportPlugin({
    name: options.name ?? BrowserPluginName.shared,
    expose: options.expose,
    connect: options.connect,
    mode: scope ? RpcTransportMode.listen : RpcTransportMode.connect,
    deployment: scope
      ? createAdapterDeployment({
          runtimeKey: 'thread',
          runtimeFamily: getBrowserMessageAdapter(),
          open: async () => {
            throw createBrowserPeerError(
              RpcBrowserErrorCode.invalidPeerSource,
              BrowserPeerErrorText.invalidPeerSource
            )
          },
          listen: (context, accept) => listenBrowserPorts(scope, context, accept)
        })
      : getBrowserMessageAdapter().deployment({ connect: { sharedWorker: { port: port! } } })
  })
}
