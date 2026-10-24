import { holdAdapterObjectChannel } from '@migaia/rpc-host/plugin'
import type { IRuntimeObjectIO, IRuntimeObjectConnection } from '@migaia/rpc-host/plugin'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import {
  collectListenerCleanupFailures,
  createListenerFailure,
  createListenerFailureState,
  reportListenerFailure,
  drainTerminalListenerFailures,
  drainListenerFailures
} from '@migaia/rpc-host/plugin'
import type { IRemoteChannel } from '@migaia/rpc-host/plugin'
import { JsonRpcLimit, JsonRpcBridgeErrorCode } from '@migaia/rpc-contract/framing/jsonrpc'
import { createJsonRpcBridgeError } from '@migaia/rpc-host/plugin'
import {
  prepareJsonRpcOffer,
  readJsonRpcReply,
  assertJsonRpcExtensions,
  type IAdapterJsonRpcChannelOptions
} from '@migaia/rpc-host/plugin'
import { bindJsonRpcWire, type IJsonRpcWire } from './transport.js'

/** Ordinary physical-owner operations retain their diagnostic errors and held connection opening. */
export type IAdapterJsonRpcChannelPresentation<
  TOptions extends IAdapterJsonRpcChannelOptions = IAdapterJsonRpcChannelOptions
> = Readonly<{
  /** Construct the physical owner's existing closed error without changing its cause identity. */
  closedError(cause?: unknown): Error
  /** Open this actually negotiated connection with its original platform diagnostics and cleanup. */
  openConnection(connection: IRuntimeObjectConnection, options: TOptions): IRemoteChannel
}>

/**
 * Negotiate one authenticated JSON-RPC peer through the existing held object connection. The
 * physical owner supplies only error presentation and opening of that same held connection;
 * protocol admission, correlation, cleanup and accepted capabilities retain their sole Core owner.
 */
/** Own the actual JSON-RPC hello, held raw wire and its one startup deadline. */
class JsonRpcChannelOpening<TOptions extends IAdapterJsonRpcChannelOptions> {
  /** Original physical options retain their caller-owned scheduler and diagnostics. */
  #options: TOptions
  /** The physical process adapter remains the only diagnostics/presentation boundary. */
  #presentation: IAdapterJsonRpcChannelPresentation<TOptions>
  /** Installed after the canonical holder captures the original cold proposal. */
  #wire!: IJsonRpcWire
  /** Keep the actual correlated hello extension until the same Core negotiation activates it. */
  #received: unknown
  /** Core owns this exact held connection's negotiation and accepted capabilities. */
  #connection: IRuntimeObjectConnection
  /** A single deadline task can be detached once even if cancellation throws. */
  #timer: IScheduledTask | undefined
  /** Prepare the cold proposal before installing physical bytes, matching original capture ordering. */
  constructor(options: TOptions, presentation: IAdapterJsonRpcChannelPresentation<TOptions>) {
    this.#options = options
    this.#presentation = presentation
    /** Profile admission precedes physical subscription and local hello serialization. */
    const offer = prepareJsonRpcOffer(options)
    /** The raw operation projection borrows only this opening owner's exact physical wire. */
    const io: IRuntimeObjectIO = {
      observe: (probe) => this.#wire.observe!(probe),
      exchange: async (hello) => {
        this.#received = await this.#wire.exchangeHello(hello)
        return readJsonRpcReply(this.#received)
      },
      activate: (capabilities) => {
        assertJsonRpcExtensions(capabilities, this.#received)
        this.#wire.setCapabilities(capabilities)
      },
      writeText: (value, sendOptions) => this.#wire.writeText(value, sendOptions),
      writeObject: (value, sendOptions) => this.#wire.writeObject(value, sendOptions),
      subscribeText: (listener) => this.#wire.subscribeText(listener),
      subscribeObject: (listener) => this.#wire.subscribeObject(listener),
      onTransportError: (listener) => this.#wire.onTransportError(listener),
      onClosing: (listener) => this.#wire.onClosing(listener),
      close: (reason) => this.#wire.close(reason),
      assertOpen: () => this.#wire.assertOpen(),
      closed: false
    }
    Object.defineProperties(io, { closed: { get: () => this.#wire.closed } })
    this.#connection = holdAdapterObjectChannel(Object.freeze(io))
    this.#connection.prepare(offer)
    this.#wire = bindJsonRpcWire(options, presentation.closedError)
  }
  /** Negotiate once, detach the deadline, and retain original rollback/report failures. */
  async open(): Promise<IRemoteChannel> {
    try {
      this.#timer = this.#options.scheduler.schedule(() => {
        void this.#wire
          .close(createJsonRpcBridgeError(JsonRpcBridgeErrorCode.handshakeTimeout))
          // The factory joins this same close Promise and surfaces collected cleanup failures.
          .catch(() => undefined)
      }, this.#options.handshakeTimeoutMs ?? JsonRpcLimit.handshakeMs)
      /** Core reads the actual reply after the original hello write has physically drained. */
      await this.#connection.negotiate()
      // Timer cleanup must finish before the physical connection can be published.
      drainListenerFailures(collectListenerCleanupFailures([this.#cancelTimer]))
      /** The physical owner retains its diagnostic resources around this same Core open operation. */
      return this.#presentation.openConnection(this.#connection, this.#options)
    } catch (error) {
      /** An earlier primary remains first while failed timer cleanup is reported and collected. */
      const cleanup = collectListenerCleanupFailures([this.#cancelTimer]).map((failure) =>
        createListenerFailure([failure])!
      )
      /** Physical close may already have started on abort; join it without losing timer failures. */
      let primary = error
      try {
        await this.#wire.close(error)
      } catch (failure) {
        primary = failure
      }
      if (cleanup.length > 0) {
        /** The timer owns these reporters even when the byte owner has completed its close. */
        const failures = createListenerFailureState()
        for (const failure of cleanup)
          reportListenerFailure(failure, [this.#options.report], failures)
        await drainTerminalListenerFailures([primary, ...cleanup], {
          secondaryFailures: failures,
          aggregateSingle: true
        })
      }
      throw primary
    }
  }
  /** Take timer ownership before invoking its possibly throwing native disposer. */
  #cancelTimer = (): void => {
    /** Taking ownership first prevents a failed cancellation from being attempted twice. */
    const owned = this.#timer
    this.#timer = undefined
    owned?.cancel()
  }
}

/** Negotiate the one actual JSON-RPC connection with the physical owner's original presentation. */
export async function createAdapterJsonRpcChannel<TOptions extends IAdapterJsonRpcChannelOptions>(
  options: TOptions,
  presentation: IAdapterJsonRpcChannelPresentation<TOptions>
): Promise<IRemoteChannel> {
  return new JsonRpcChannelOpening(options, presentation).open()
}
