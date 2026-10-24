import { RpcTransportMode } from '@migaia/rpc-host/plugin'
import {
  defineByteAdapter,
  defineTransportPlugin,
  createRuntimeWebByteStream,
  createRpcTransportError,
  identifyRpcBoundaryFailure,
  IpcReporterContext,
  RpcPlatform,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/plugin'
import { RpcCoreErrorCode, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-host'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { attachErrorIdentity } from '@migaia/utils/error'
import { createBrowserPeerError } from './peer-error.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { BrowserPeerErrorText } from '../error-text.js'
import { WebTransportPluginText } from './web-transport-text.js'
import type {
  IWebTransportPluginOptions,
  IWebTransportReliableSession
} from './web-transport-types.js'

/** One raw reliable byte opener reuses the canonical byte handshake, codec and endpoint pipeline. */
const reliableWebTransport = defineByteAdapter<IWebTransportReliableSession>({
  presentation: {
    platform: RpcPlatform.webTransport,
    expectedStringText: WebTransportPluginText.expectedString
  },
  async open(session) {
    try {
      await session.ready
      /**
       * Only this created stream is acquired; no session close or alternate datagram channel
       * exists.
       */
      const stream = await session.createBidirectionalStream()
      return createRuntimeWebByteStream(stream.readable, stream.writable, () => undefined, {
        openFailed: (error) =>
          identifyRpcBoundaryFailure(
            error,
            RpcCoreErrorCode.transport,
            WebTransportPluginText.openFailed
          ),
        closedError: () => createRpcTransportError(WebTransportPluginText.closed),
        cleanupFailed: (errors) =>
          attachErrorIdentity(
            new AggregateError(errors, WebTransportPluginText.cleanupFailed, { cause: errors[0] }),
            { source: RPC_CORE_ERROR_SOURCE, code: RpcCoreErrorCode.transport }
          ),
        report: (error) => hostRethrowReporter(error, IpcReporterContext)
      })
    } catch (error) {
      throw identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.transport,
        WebTransportPluginText.openFailed
      )
    }
  }
})

/** Capture one borrowed session; physical opening happens only during native Host installation. */
export function webTransportPlugin(options: IWebTransportPluginOptions): IRpcTransportPlugin {
  if (!options?.session || typeof options.session.createBidirectionalStream !== 'function')
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  return defineTransportPlugin({
    name: options.name ?? WebTransportPluginText.name,
    mode: RpcTransportMode.connect,
    ...(options.expose ? { expose: options.expose } : {}),
    ...(options.connect ? { connect: options.connect } : {}),
    /** The byte owner replaces this pre-hello route label with the negotiated runtime peer id. */
    deployment: reliableWebTransport.deployment({
      connect: options.session,
      peerId: WebTransportPluginText.name
    })
  })
}
