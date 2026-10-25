/** Acquires a reliable WebTransport stream and lends its native IO locks to the SDK byte carrier. */
import {
  defineTransportPlugin,
  createRpcByteCarrier,
  RpcBytePump,
  RpcCarrierObservation,
  defaultRpcId
} from '@migaia/rpc-host/sdk'
import type { IRpcTransportPlugin, IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import {
  RpcCarrierPlatform,
  RpcCarrierTopology,
  RpcCarrierEncoding,
  RpcProbeDirection
} from '@migaia/rpc-contract/interfaces'
import { identifyRpcBoundaryFailure } from '@migaia/rpc-contract/errors'
import {
  RpcCoreErrorCode,
  RPC_ENDPOINT_ERROR_SOURCE,
  RpcBrowserErrorCode
} from '@migaia/rpc-contract/error-code'
import { attachErrorIdentity } from '@migaia/utils/error'
import { createBrowserPeerError } from './peer-error.js'
import { createBrowserTransportError, rejectBrowserTransfer } from './error.js'
import { BrowserPeerErrorText } from '../error-text.js'
import { WebTransportPluginText } from './web-transport-text.js'
import { BrowserNamespace } from './peer-text.js'
import { attachBrowserCarrier } from './native-message.js'
import type {
  IWebTransportPluginOptions,
  IWebTransportReliableSession
} from './web-transport-types.js'

/** Acquire one actual reliable stream; SDK borrows its successfully acquired native locks. */
async function openStream(
  session: IWebTransportReliableSession,
  context: IRpcTransportSetupContext
) {
  try {
    await session.ready
    /** Only this created stream is owned; the caller's enclosing session stays borrowed. */
    const stream = await session.createBidirectionalStream()
    /** Native reader acquisition may fail before a writer exists. */
    const reader = stream.readable.getReader()
    /** Writer acquisition failure must release the exact already-acquired reader lock. */
    let writer: WritableStreamDefaultWriter<Uint8Array>
    try {
      writer = stream.writable.getWriter()
    } catch (primary) {
      try {
        reader.releaseLock()
      } catch (cleanup) {
        context.report(cleanup)
      }
      throw primary
    }
    /** One acquired native stream supplies raw chunks, independently of SDK length framing. */
    const observation = new RpcCarrierObservation(
      {
        platform: RpcCarrierPlatform.webTransport,
        topology: RpcCarrierTopology.exclusive,
        encodedType: RpcCarrierEncoding.uint8Array
      },
      context.report
    )
    /** Shared native byte execution owns pause/read/write/close after acquisition succeeds. */
    const io = new RpcBytePump(
      {
        read: async () => {
          /** EOF emits no synthetic content; the original nonterminal chunk is lent once. */
          const next = await reader.read()
          if (!next.done) observation.emit(RpcProbeDirection.inbound, next.value)
          return next
        },
        cancel: () => reader.cancel()
      },
      {
        write: (chunk) => {
          observation.emit(RpcProbeDirection.outbound, chunk)
          return writer.write(chunk)
        },
        abort: (reason) => writer.abort(reason)
      },
      () => {
        /** Lock release attempts both originals even when the first release fails. */
        const failures: unknown[] = []
        try {
          reader.releaseLock()
        } catch (error) {
          failures.push(error)
        }
        try {
          writer.releaseLock()
        } catch (error) {
          failures.push(error)
        }
        if (failures.length) throw cleanupFailed(failures)
      },
      {
        closedError: () => createBrowserTransportError(WebTransportPluginText.closed),
        cleanupFailed,
        report: context.report
      }
    ).value
    /**
     * Byte handshake preserves its original deadline error family rather than message-source
     * diagnostics.
     */
    const carrier = createRpcByteCarrier({
      id: defaultRpcId(),
      io,
      observation,
      assertTransfer: rejectBrowserTransfer,
      report: context.report
    })
    return await attachBrowserCarrier(carrier, context, (error) => error)
  } catch (primary) {
    throw identifyRpcBoundaryFailure(
      primary,
      RpcCoreErrorCode.transport,
      WebTransportPluginText.openFailed
    )
  }
}

/** The original ordered native failures remain reachable in the existing Core transport family. */
function cleanupFailed(errors: readonly unknown[]): Error {
  return attachErrorIdentity(
    new AggregateError(errors, WebTransportPluginText.cleanupFailed, { cause: errors[0] }),
    { source: RPC_ENDPOINT_ERROR_SOURCE, code: RpcCoreErrorCode.transport }
  )
}

/** Opening is cold; the reliable stream is created only by the receiving native host install. */
export function webTransportPlugin<const N extends string = 'webTransport'>(
  options: IWebTransportPluginOptions & Readonly<{ namespace?: N }>
): IRpcTransportPlugin<NoInfer<N>> {
  if (!options?.session || typeof options.session.createBidirectionalStream !== 'function')
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  return defineTransportPlugin({
    name: options.name ?? WebTransportPluginText.name,
    namespace: (options.namespace ?? BrowserNamespace.webTransport) as N,
    expose: options.expose,
    features: options.features,
    handshakeTimeoutMs: options.connect?.timeoutMs,
    open: (context) => openStream(options.session, context)
  })
}
