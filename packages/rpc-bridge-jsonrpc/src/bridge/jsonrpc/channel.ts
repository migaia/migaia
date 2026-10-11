import { holdAdapterObjectChannel, type IRuntimeObjectIO } from '@migaia/rpc-core/adapter'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import {
  collectListenerCleanupFailures,
  createListenerFailure,
  createListenerFailureState,
  reportListenerFailure,
  drainTerminalListenerFailures,
  drainListenerFailures
} from '@migaia/rpc-core/transport-kit'
import { openProcessObjectChannel } from '@migaia/rpc-process'
import type { IRemoteChannel } from '@migaia/rpc-core/remote'
import { JsonRpcLimit, JsonRpcBridgeErrorCode } from '@migaia/rpc-contract/framing/jsonrpc'
import { createJsonRpcBridgeError } from './error.js'
import {
  prepareJsonRpcOffer,
  readJsonRpcReply,
  assertJsonRpcExtensions,
  type IJsonRpcBridgeOptions
} from './handshake.js'
import { bindJsonRpcWire, type IJsonRpcWire } from './transport.js'

/** Negotiate one authenticated JSON-RPC peer, then expose its complete Core-constructed channel. */
export async function createJsonRpcAdapterChannel(
  options: IJsonRpcBridgeOptions
): Promise<IRemoteChannel> {
  /** Adapter profile admission precedes physical subscriptions and the local hello serialization. */
  const offer = prepareJsonRpcOffer(options)
  /** The cold holder addresses the same physical binding installed after Core's prepare operation. */
  let wire: IJsonRpcWire
  /** The actual correlated hello response retains its extension fields until Core completes control. */
  let received: unknown
  /** Raw operations address held bytes and logical views; none accepts a transport qualification. */
  const io: IRuntimeObjectIO = Object.freeze({
    async exchange(hello) {
      received = await wire.exchangeHello(hello)
      return readJsonRpcReply(received)
    },
    activate(capabilities) {
      assertJsonRpcExtensions(capabilities, received)
      wire.setCapabilities(capabilities)
    },
    writeText: (value, sendOptions) => wire.writeText(value, sendOptions),
    writeObject: (value, sendOptions) => wire.writeObject(value, sendOptions),
    subscribeText: (listener) => wire.subscribeText(listener),
    subscribeObject: (listener) => wire.subscribeObject(listener),
    onTransportError: (listener) => wire.onTransportError(listener),
    onClosing: (listener) => wire.onClosing(listener),
    close: (reason) => wire.close(reason),
    assertOpen: () => wire.assertOpen(),
    get closed() {
      return wire.closed
    }
  })
  /** Core captures the original local proposal while this raw resource remains cold. */
  const connection = holdAdapterObjectChannel(io)
  connection.prepare(offer)
  wire = bindJsonRpcWire(options)
  /** Deadline rejects exchange even when the underlying byte writer never drains. */
  let timer: IScheduledTask | undefined
  /** Detach the owned task before invoking its possibly throwing disposer. */
  const cancelTimer = (): void => {
    /** Taking ownership first prevents a failed cancellation from being attempted twice. */
    const owned = timer
    timer = undefined
    owned?.cancel()
  }
  try {
    timer = options.scheduler.schedule(() => {
      void wire
        .close(createJsonRpcBridgeError(JsonRpcBridgeErrorCode.handshakeTimeout))
        // The factory joins this same close Promise and surfaces collected cleanup failures.
        .catch(() => undefined)
    }, options.handshakeTimeoutMs ?? JsonRpcLimit.handshakeMs)
    /** Core reads the actual reply after the original hello write has physically drained. */
    await connection.negotiate()
    // Timer cleanup must finish before the physical connection can be published.
    drainListenerFailures(collectListenerCleanupFailures([cancelTimer]))
    /** Process owns diagnostic text/stderr; the same Core open operation mints the final facts. */
    return openProcessObjectChannel(connection, options)
  } catch (error) {
    /** An earlier primary remains first while failed timer cleanup is reported and collected. */
    const cleanup = collectListenerCleanupFailures([cancelTimer]).map((failure) =>
      createListenerFailure([failure])!
    )
    /** Physical close may already have started on abort; join it without losing timer failures. */
    let primary = error
    try {
      await wire.close(error)
    } catch (failure) {
      primary = failure
    }
    if (cleanup.length > 0) {
      /** The timer owns these reporters even when the byte owner has completed its close. */
      const failures = createListenerFailureState()
      for (const failure of cleanup) reportListenerFailure(failure, [options.report], failures)
      await drainTerminalListenerFailures([primary, ...cleanup], {
        secondaryFailures: failures,
        aggregateSingle: true
      })
    }
    throw primary
  }
}
