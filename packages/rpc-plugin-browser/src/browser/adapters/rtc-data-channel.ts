/** Adapts one borrowed ordered RTC channel to native text message IO for the shared SDK carrier. */
import { BrowserPeerEvent, BrowserNativeState } from '../peer-text.js'
import { inspectThenable, assimilateCapturedThen } from '@migaia/utils/function'
import {
  createRpcMessageCarrier,
  RpcJsonCarrierCodec,
  defaultRpcId,
  RpcCarrierObservation
} from '@migaia/rpc-host/sdk'
import type { IRpcMessageIO, IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import {
  RpcCarrierPlatform,
  RpcCarrierTopology,
  RpcCarrierEncoding,
  RpcProbeDirection,
  type IRpcCarrierFrame,
  type IRpcCarrierWriteOptions
} from '@migaia/rpc-contract/interfaces'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'
import { safeRead } from '@migaia/rpc-contract/errors'
import {
  RpcCoreErrorCode,
  RpcBrowserErrorCode,
  RPC_ENDPOINT_ERROR_SOURCE
} from '@migaia/rpc-contract/error-code'
import { attachErrorIdentity } from '@migaia/utils/error'
import { BrowserRpcErrorText } from '../error-text.js'
import { createBrowserTransportError, rejectBrowserTransfer } from '../error.js'
import { createBrowserPeerError } from '../peer-error.js'
import { BrowserPeerErrorText } from '../../error-text.js'
import { emitBrowserObservation, type IBrowserObservationMetadata } from '../native-observation.js'

/** Native RTC transmits one JSON text message; signaling and the channel lifetime remain borrowed. */
export type IRTCDataChannel = {
  send(data: string): void
  readonly readyState: string
  addEventListener(
    type: 'message' | 'closing' | 'close' | 'error',
    listener: (event: unknown) => void
  ): void
  removeEventListener(
    type: 'message' | 'closing' | 'close' | 'error',
    listener: (event: unknown) => void
  ): void
}
/** The original terminal events share one native listener and deterministic registration order. */
const terminalEvents = [
  BrowserPeerEvent.closing,
  BrowserPeerEvent.close,
  BrowserPeerEvent.error
] as const

/** Only native event acquisition and text framing live here; SDK owns codec and all pending work. */
class RtcMessageIO implements IRpcMessageIO {
  /** Cold RTC text facts and raw observations belong to this one acquired native channel. */
  readonly observation: RpcCarrierObservation
  /** Native RTC has no source selector; its original detail records only actual send/receive facts. */
  readonly #metadata: IBrowserObservationMetadata = { rejectedSource: 0 }
  /** The exact native channel remains borrowed until the caller closes it. */
  readonly #channel: IRTCDataChannel
  /** Native data/reflection failures use the receiving installation's existing reporter. */
  readonly #report: (error: unknown) => void
  /** SDK's original terminal callback is installed after native message acquisition. */
  #closed: ((reason?: unknown) => void) | undefined
  /** SDK's original physical-failure callback receives hostile data getter failures. */
  #error: ((error: unknown) => void) | undefined
  /** Native already-closed and repeated terminal events preserve the first original reason. */
  #ended = false
  /** Stored only to replay a native terminal event that precedes SDK callback installation. */
  #reason: unknown

  /** Reject incomplete or connecting native channels before registering any callback. */
  constructor(channel: IRTCDataChannel, report: (error: unknown) => void) {
    if (
      !channel ||
      typeof channel.send !== 'function' ||
      typeof channel.readyState !== 'string' ||
      typeof channel.addEventListener !== 'function' ||
      typeof channel.removeEventListener !== 'function'
    )
      throw attachErrorIdentity(
        new TypeError(
          BrowserRpcErrorText.rtcDataChannelMustExposeReadyStateAndTerminalEventListeners
        ),
        { source: RPC_ENDPOINT_ERROR_SOURCE, code: RpcCoreErrorCode.invalidConfig }
      )
    if (
      channel.readyState !== BrowserNativeState.open &&
      channel.readyState !== BrowserNativeState.closed
    )
      throw attachErrorIdentity(
        new TypeError(BrowserRpcErrorText.rtcDataChannelMustBeOpenBeforeTransportConstruction),
        { source: RPC_ENDPOINT_ERROR_SOURCE, code: RpcCoreErrorCode.invalidConfig }
      )
    this.#channel = channel
    this.#report = report
    this.observation = new RpcCarrierObservation(
      {
        platform: RpcCarrierPlatform.rtcDataChannel,
        topology: RpcCarrierTopology.exclusive,
        encodedType: RpcCarrierEncoding.string
      },
      report
    )
    if (channel.readyState === BrowserNativeState.closed) {
      this.#ended = true
      this.#reason = createBrowserTransportError(BrowserRpcErrorText.rtcClosed)
    }
  }
  /** Canonical codec already supplies JSON text; native RTC never encodes or parses business data. */
  send(
    value: unknown,
    _transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ): void | Promise<void> {
    if (this.#ended) throw this.#reason
    /** This shell is the actual admitted media frame produced by SDK, not untrusted business data. */
    const frame = value as IRpcCarrierFrame & { data: string }
    /** Only an actual async seal waits; ordinary callbacks keep the immediate native send. */
    const started: unknown = options?.onWriteStart?.()
    /** Admit the original then method once without replacing callback failures. */
    const inspection = inspectThenable(started)
    if ('error' in inspection) throw inspection.error
    if (inspection.then) {
      /** This operation borrows the same already-admitted text frame until handoff. */
      const operation = { owner: this, frame }
      return assimilateCapturedThen<void>(inspection.then, started).then(() => {
        if (operation.owner.#ended) throw operation.owner.#reason
        operation.owner.#sendNative(operation.frame)
      })
    }
    this.#sendNative(frame)
  }
  /** Actual RTC state and original text remain the sole physical send authority. */
  #sendNative(frame: IRpcCarrierFrame & { data: string }): void {
    emitBrowserObservation(this.observation, this.#metadata, RpcProbeDirection.outbound, frame.data)
    this.#channel.send(frame.data)
  }
  /** Acquire native terminal listeners before message delivery; rollback preserves original errors. */
  onMessage(listener: (value: unknown) => void): () => void {
    /** Exact acquired native callbacks are the entire rollback receipt. */
    const admitted: Array<() => void> = []
    /** Getter failure is a physical failure; no fabricated data reaches Session. */
    const receive = (event: unknown): void => {
      try {
        /** Read the actual native data getter once for both observation and codec delivery. */
        const data = Reflect.get(event as object, 'data')
        emitBrowserObservation(this.observation, this.#metadata, RpcProbeDirection.inbound, data)
        listener({ kind: RpcCarrierFrameKind.message, data })
      } catch (cause) {
        this.#failure(createBrowserTransportError(BrowserRpcErrorText.rtcMessageReadFailed, cause))
      }
    }
    try {
      for (const type of terminalEvents) {
        this.#channel.addEventListener(type, this.#terminal)
        admitted.push(() => this.#channel.removeEventListener(type, this.#terminal))
      }
      this.#channel.addEventListener(BrowserPeerEvent.message, receive)
      admitted.push(() => this.#channel.removeEventListener(BrowserPeerEvent.message, receive))
    } catch (primary) {
      for (const remove of admitted.reverse())
        try {
          remove()
        } catch (cleanup) {
          this.#report(cleanup)
        }
      throw primary
    }
    return () => {
      /** Original terminal-before-message cleanup attempts every native listener once. */
      const failures: unknown[] = []
      for (const remove of admitted)
        try {
          remove()
        } catch (error) {
          failures.push(error)
        }
      if (failures.length === 0) return
      /** Native terminal cleanup keeps its primary first; ordinary unsubscribe keeps its identity. */
      const errors =
        this.#ended && this.#reason !== undefined ? [this.#reason, ...failures] : failures
      if (errors.length === 1) throw errors[0]
      throw attachErrorIdentity(
        new AggregateError(errors, BrowserRpcErrorText.rtcSubscriptionCleanupFailed, {
          cause: errors[0]
        }),
        { source: RPC_ENDPOINT_ERROR_SOURCE, code: RpcCoreErrorCode.transport }
      )
    }
  }
  /** An original native close observed during acquisition is replayed unchanged to SDK. */
  onClose(listener: (reason?: unknown) => void): () => void {
    this.#closed = listener
    if (this.#ended) listener(this.#reason)
    return () => {
      if (this.#closed === listener) this.#closed = undefined
    }
  }
  /** Error observation is independent of native ownership. */
  onError(listener: (error: unknown) => void): () => void {
    this.#error = listener
    return () => {
      if (this.#error === listener) this.#error = undefined
    }
  }
  /** Logical close never invokes the caller-owned RTC channel or RTCPeerConnection close. */
  close(): void {}
  /** Native terminal Error identity and event.error cause preserve the previous browser policy. */
  readonly #terminal = (event: unknown): void => {
    if (this.#ended) return
    this.#ended = true
    /** Reflection failures stay reported behind the primary native terminal reason. */
    const cause =
      event instanceof Error
        ? event
        : (safeRead(event, 'error', ({ error }) => {
            this.#report(error)
            return undefined
          }) ?? event)
    try {
      this.#reason =
        cause instanceof Error &&
        Object.isExtensible(cause) &&
        !('source' in cause) &&
        !('code' in cause)
          ? attachErrorIdentity(cause, {
              source: RPC_ENDPOINT_ERROR_SOURCE,
              code: RpcCoreErrorCode.transport
            })
          : createBrowserTransportError(BrowserRpcErrorText.rtcClosed, cause)
    } catch (failure) {
      this.#report(failure)
      this.#reason = createBrowserTransportError(BrowserRpcErrorText.rtcClosed, cause)
    }
    this.#closed?.(this.#reason)
  }
  /** Reflection failures before SDK error admission retain the installation diagnostic destination. */
  #failure(error: unknown): void {
    if (this.#error) this.#error(error)
    else this.#report(error)
  }
}

/** Preserve native RTC terminal/source semantics while sharing SDK's one JSON and lifetime owner. */
export function createRtcDataChannelCarrier(
  channel: IRTCDataChannel,
  context: Pick<IRpcTransportSetupContext, 'report'>
) {
  /** The native IO and carrier lend the same observer, without another codec or receiver. */
  const io = new RtcMessageIO(channel, context.report)
  return createRpcMessageCarrier({
    id: defaultRpcId(),
    closingWrites: true,
    nativeBinary: false,
    assertTransfer: rejectBrowserTransfer,
    codec: new RpcJsonCarrierCodec({
      projectDecodeFailure: (cause) =>
        createBrowserPeerError(
          RpcBrowserErrorCode.messageDecodeFailed,
          BrowserPeerErrorText.messageDecodeFailed,
          cause
        )
    }),
    io,
    observation: io.observation,
    report: context.report
  })
}
