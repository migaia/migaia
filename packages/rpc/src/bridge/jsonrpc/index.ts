import { registerJsonObjectPort } from '../../core/internal/json-object-port.js'
import { rpcProtocolV1 } from '../../contract/index.js'
import { jsonObjectCodec, jsonObjectFramer } from './object-pipeline.js'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import {
  collectListenerCleanupFailures,
  createListenerFailure,
  createListenerFailureState,
  reportListenerFailure,
  drainTerminalListenerFailures,
  drainListenerFailures
} from '../../core/transport-kit.js'
import { RpcCodecId } from '../../contract/wire-constants.js'
import { attachIpcConnection } from '../../process/ipc-connection.js'
import { byteProcessPipeline } from '../../process/pipeline.js'
import type { IRemoteChannel } from '../../remote/types.js'
import { JsonRpcLimit } from './constants.js'
import { JsonRpcBridgeErrorCode } from './error-code.js'
import { createJsonRpcBridgeError } from './error.js'
import {
  prepareJsonRpcHello,
  completeJsonRpcHello,
  type IJsonRpcBridgeOptions
} from './handshake.js'
import { bindJsonRpcWire } from './transport.js'

export type { IJsonRpcBridgeOptions } from './handshake.js'
export { JsonRpcBridgeErrorCode } from './error-code.js'
export { JsonRpcBridgeErrorText } from './error-text.js'

/** Negotiate one authenticated JSON-RPC peer, then expose its complete gated remote channel. */
export async function createJsonRpcRemoteChannel(
  options: IJsonRpcBridgeOptions
): Promise<IRemoteChannel> {
  /** Admission completes before the physical channel acquires a reader or a write. */
  const prepared = prepareJsonRpcHello(options)
  /** The byte binding owns pending ids and physical teardown until IPC adoption. */
  const wire = bindJsonRpcWire(options)
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
    /** Hello resolves only after its complete physical write has drained. */
    const result = await wire.exchangeHello(prepared.hello)
    /** Only the control owner authenticates the negotiated reply grammar. */
    const agreement = completeJsonRpcHello(prepared.offer, result)
    wire.assertOpen()
    // Timer cleanup must finish before the physical connection can be published.
    drainListenerFailures(collectListenerCleanupFailures([cancelTimer]))
    /** Adopt exactly one canonical gate, log Feature and stderr subscription. */
    const ipc = attachIpcConnection(wire.transport, options.ipc, options.report)
    wire.registerObjectPortRelease(
      registerJsonObjectPort(
        ipc.transport,
        Object.freeze({
          protocol: rpcProtocolV1,
          publicCodec: byteProcessPipeline.codec,
          publicFramer: byteProcessPipeline.framer,
          codec: jsonObjectCodec,
          framer: jsonObjectFramer,
          send: wire.sendObject,
          subscribe: wire.subscribeObject
        })
      )
    )
    return Object.freeze({
      transport: ipc.transport,
      peerId: options.peerId,
      scheduler: options.scheduler,
      agreement: Object.freeze({
        source: 'negotiated' as const,
        codec: RpcCodecId.json,
        capabilities: agreement.capabilities
      }),
      pipeline: byteProcessPipeline,
      features: ipc.features,
      close: ipc.close
    })
  } catch (error) {
    // Shared cleanup may throw an aggregate whose first error is the original primary failure.
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
