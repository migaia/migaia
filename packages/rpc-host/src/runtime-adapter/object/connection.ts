import {
  completeRpcHandshake,
  createRpcHello,
  rpcProtocolV1,
  RpcCodecId,
  type IRpcHandshakeAgreement,
  type IRpcHandshakeOffer
} from '@migaia/rpc-contract'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode, tagRpcError } from '../../core/errors.js'
import { registerBatchAgreement } from '../../core/internal/batch-frame.js'
import { serializeRpcError } from '../../core/internal/error-wire-metadata.js'
import { registerJsonObjectPort } from '../../core/internal/json-object-port.js'
import {
  RpcTransportEncoding,
  RpcTransportOwnership,
  RpcTransportTopology
} from '../../core/transport-constants.js'
import type { IRpcTransport } from '../../core/transport.js'
import { attachIpcConnection } from '../byte/ipc-connection.js'
import { createRuntimeBytePipeline } from '../byte/pipeline.js'
import { retainRuntimeConnectionIdentity } from '../byte/connection-identity.js'
import type { IRuntimeConnectionOptions } from '../byte/types.js'
import { RuntimeObjectErrorText } from './error-text.js'
import { createRuntimeObjectPipeline } from './pipeline.js'
import type { IRuntimeObjectChannel, IRuntimeObjectConnection, IRuntimeObjectIO } from './types.js'

/** Invalid public construction sequencing uses the existing native TypeError/configuration code. */
function invalidConfiguration(message: string): never {
  throw tagRpcError(new TypeError(message), RpcCoreErrorCode.invalidConfig)
}

/**
 * Hold actual object I/O cold, then construct its own negotiated transport and paired object port.
 * The caller supplies only its local proposal; every final agreement and private fact stays
 * Core-owned.
 */
export function holdAdapterObjectChannel(io: IRuntimeObjectIO): IRuntimeObjectConnection {
  /** Retaining the original offer preserves the existing second serialization at completion. */
  let prepared: Readonly<{ offer: IRpcHandshakeOffer; hello: string }> | undefined
  /** Reentrant and repeated negotiation joins the exact same published handshake Promise. */
  let negotiating: Promise<void> | undefined
  /** Only completeRpcHandshake over the actual exchange reply can populate this construction state. */
  let agreement: IRpcHandshakeAgreement | undefined
  /** Open returns the one original channel rather than constructing another qualified transport. */
  let opened: IRuntimeObjectChannel | undefined
  /** The original IPC owner performs all adopted cleanup before closing the physical resource. */
  let closeChannel: (() => Promise<void>) | undefined
  /** The first public close request preserves its exact reason through delayed diagnostic cleanup. */
  let closeReason: unknown
  /** Later close callers cannot replace the first request's reason before the raw close begins. */
  let closeRequested = false

  /** Delegate to the actual lifetime owner while retaining its exact idempotent close Promise. */
  const close = (reason?: unknown): Promise<void> => {
    if (!closeRequested) {
      closeRequested = true
      closeReason = reason
    }
    return closeChannel ? closeChannel() : io.close(closeReason)
  }

  return Object.freeze({
    /** Validate the local proposal while held I/O is still cold; exchange cannot replace it later. */
    prepare(offer: IRpcHandshakeOffer) {
      if (negotiating) invalidConfiguration(RuntimeObjectErrorText.preparationStarted)
      /** Local grammar and caller getters are consumed before the adapter binds readers or timers. */
      const hello = createRpcHello(offer)
      prepared = Object.freeze({ offer, hello })
    },
    /** Exchange the prepared hello once and retain only Core's actual accepted peer agreement. */
    negotiate() {
      if (negotiating) return negotiating
      if (!prepared) invalidConfiguration(RuntimeObjectErrorText.preparationRequired)
      /** Snapshot only the prepared holder; its original local proposal remains the same object. */
      const proposal = prepared
      /** Publish before invoking raw I/O, which may synchronously reenter this public operation. */
      const done = deferred<void>()
      negotiating = done.promise
      void (async () => {
        try {
          /** The resource resolves only its actual correlated, physically drained peer reply. */
          const reply = await io.exchange(proposal.hello)
          /** The control owner reads the original offer again, exactly as the previous factory did. */
          const accepted = completeRpcHandshake(proposal.offer, reply)
          if (accepted.codec !== RpcCodecId.json)
            invalidConfiguration(RuntimeObjectErrorText.jsonCodecRequired)
          /** Adapter-specific extensions consume Core output after canonical control admission. */
          io.activate(accepted.capabilities)
          io.assertOpen()
          agreement = accepted
          done.resolve()
        } catch (error) {
          done.reject(error)
        }
      })()
      return negotiating
    },
    /** Construct one final channel after the adapter releases its successful handshake timer. */
    open(options: IRuntimeConnectionOptions) {
      if (opened) return opened
      if (!agreement) invalidConfiguration(RuntimeObjectErrorText.negotiationRequired)
      /** Negotiation never exposes this immutable agreement as a qualification input. */
      const accepted = agreement
      /** The inherited scheduler remains the exact caller resource used by endpoint construction. */
      const scheduler = options.scheduler ?? systemScheduler
      /** Diagnostic text is read once and never grants a component or carrier proof. */
      const expectedStringText = options.expectedStringText
      /** Text codecs remain shared by their canonical owner and original diagnostic contract. */
      const pipeline = createRuntimeBytePipeline(expectedStringText)
      /** Object materialization retains the original codec admission and getter behavior. */
      const objectPipeline = createRuntimeObjectPipeline(expectedStringText)
      /** This constructor owns the original transport identity; no supplied transport is signed. */
      const transport: IRpcTransport = {
        platform: options.platform,
        topology: RpcTransportTopology.exclusive,
        ownership: RpcTransportOwnership.owned,
        encodedType: RpcTransportEncoding.string,
        peerId: options.peerId,
        observe: io.observe === undefined ? undefined : (probe) => io.observe!(probe),
        send: (value, sendOptions) => io.writeText(value, sendOptions),
        subscribe: (listener) => io.subscribeText(listener),
        onTransportError: (listener) => io.onTransportError(listener),
        close: () => io.close(closeReason),
        get closed() {
          return io.closed
        }
      }
      /** Canonical queue/log composition creates the final public transport before private facts. */
      const ipc = attachIpcConnection(transport, options.ipc, options.report, scheduler)
      registerBatchAgreement(ipc.transport, accepted.capabilities)
      /** Only Core can pair its chosen original descriptors with this newly constructed transport. */
      const releaseObjectPort = registerJsonObjectPort(
        ipc.transport,
        Object.freeze({
          protocol: rpcProtocolV1,
          publicCodec: pipeline.codec,
          publicFramer: pipeline.framer,
          codec: objectPipeline.codec,
          framer: objectPipeline.framer,
          /** The actual object port preserves the original complete wire-error serialization policy. */
          responseError: (error: unknown) =>
            serializeRpcError(error, { report: ({ error: failure }) => options.report(failure) }),
          send: (value, sendOptions) => io.writeObject(value, sendOptions),
          subscribe: (listener) => io.subscribeObject(listener)
        })
      )
      io.onClosing(releaseObjectPort)
      closeChannel = ipc.close
      /** Actual log/cleanup resources are operations on this channel, never private proof carriers. */
      const channel: IRuntimeObjectChannel = Object.freeze({
        transport: ipc.transport,
        peerId: options.peerId,
        scheduler,
        agreement: Object.freeze({
          source: 'negotiated' as const,
          codec: accepted.codec,
          capabilities: accepted.capabilities
        }),
        pipeline,
        features: ipc.features,
        log: ipc.log,
        ownClose: ipc.ownClose,
        close: () => close()
      })
      retainRuntimeConnectionIdentity(channel)
      opened = channel
      return channel
    },
    close
  })
}
