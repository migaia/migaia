import { carrierSizeBytes } from '@migaia/rpc-core/adapter/internal-advanced'
import type { IRpcCarrierProbe } from '@migaia/rpc-core/probe'
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { BrowserRpcErrorText } from './error-text.js'
import { createBrowserTransportError } from './error.js'

/** Stable physical carrier names consumed by probe export and statistics. */
export const BrowserRpcCarrier = {
  /** Window postMessage traffic admitted by the configured source and origin. */
  window: 'window',
  /** Dedicated SharedWorker connection port traffic. */
  sharedWorker: 'shared-worker',
  /** ServiceWorker and Client postMessage traffic admitted by the configured peer. */
  serviceWorker: 'service-worker',
  /** BroadcastChannel messages within the channel's native origin boundary. */
  broadcastChannel: 'broadcast-channel',
  /** Reliable RTCDataChannel physical string messages. */
  rtcDataChannel: 'rtc-data-channel',
  /** WebTransport physical datagram bytes. */
  webTransport: 'web-transport'
} as const

/** Three package-owned keys describe browser carrier facts without per-event records. */
export const BrowserRpcProbeDetail = {
  /** Native receive origin or configured send origin; empty means unavailable. */
  origin: 'origin',
  /** Send transfer-list length; -1 on receive because native events hide sender transfer choice. */
  transfers: 'transfers',
  /** Rejections since the preceding valid receive, released only by a valid receive event. */
  rejectedSource: 'rejectedSource'
} as const

/**
 * Owns only the browser observation slot and reusable metadata; native carrier lifecycle and source
 * admission remain in each adapter. The adapter checks `probe` before computing arguments.
 */
export class BrowserCarrierObservation {
  /** Current endpoint observer; undefined keeps the physical hot path observation-free. */
  #probe: IRpcCarrierProbe | undefined
  /** Each observe call has distinct ownership even when callers reuse the same probe object. */
  #generation = 0
  /** Terminal carriers never retain observers installed after retirement. */
  #closed = false
  /** Native source rejections accumulate without constructing or capturing rejected events. */
  #rejectedSource = 0
  /** The detail object belongs to this emitter and stays valid only during synchronous emission. */
  #detail = {
    [BrowserRpcProbeDetail.origin]: '',
    [BrowserRpcProbeDetail.transfers]: 0,
    [BrowserRpcProbeDetail.rejectedSource]: 0
  }
  /** Export identity is fixed when the physical adapter is created. */
  #carrier: string
  /** Existing listener or transport reporting retains native carrier error semantics. */
  #report: (error: unknown) => void

  /** Capture immutable carrier identity and the existing error-reporting operation once. */
  constructor(carrier: string, report: (error: unknown) => void) {
    this.#carrier = carrier
    this.#report = report
  }

  /** Read only the current slot before the adapter evaluates any observation argument. */
  get probe(): IRpcCarrierProbe | undefined {
    return this.#probe
  }

  /** Replace the current registration; an older idempotent disposer cannot release its successor. */
  observe(probe: IRpcCarrierProbe): () => void {
    if (this.#closed) return () => undefined
    /** Registration generations distinguish repeated installation of the same object. */
    const generation = ++this.#generation
    this.#probe = probe
    this.#rejectedSource = 0
    return () => {
      if (this.#generation !== generation) return
      this.#probe = undefined
      this.#rejectedSource = 0
    }
  }

  /** Count one failed existing sourceProof without reading or retaining its payload. */
  rejectSource(): void {
    this.#rejectedSource++
  }

  /** Retire the slot without invoking the observer or changing native resource ownership. */
  close(): void {
    this.#closed = true
    this.#probe = undefined
    this.#rejectedSource = 0
    this.#generation++
  }

  /**
   * Emit one physical send or admitted receive synchronously. Only direct transferred byte payloads
   * need copying; ordinary content and detail retain their references. Observer failures enter the
   * existing carrier report channel with the original exception as cause.
   */
  emit(
    probe: IRpcCarrierProbe,
    direction: number,
    message: unknown,
    origin?: string,
    transfer?: readonly Transferable[]
  ): void {
    try {
      this.#detail.origin = origin ?? ''
      this.#detail.transfers = direction === 1 ? -1 : (transfer?.length ?? 0)
      this.#detail.rejectedSource = direction === 1 ? this.#rejectedSource : 0
      if (direction === 1) this.#rejectedSource = 0
      /** Only intrinsic byte extents are already known; strings and containers stay unknown. */
      const size = carrierSizeBytes(message)
      /** Metadata-only observation never copies or retains the payload. */
      let content: unknown
      if (probe.capturing) {
        content = message
        if (transfer && (isArrayBuffer(message) || ArrayBuffer.isView(message))) {
          /** Only this direct payload's actual buffer can lose captured bytes through transfer. */
          const buffer = isArrayBuffer(message) ? message : message.buffer
          for (let i = 0; i < transfer.length; i++) {
            if (transfer[i] !== buffer) continue
            // SC9a: preserve bytes before this send detaches the explicitly transferred buffer.
            content = isArrayBuffer(message)
              ? message.slice(0)
              : isUint8Array(message)
                ? message.slice()
                : new Uint8Array(message.buffer, message.byteOffset, message.byteLength).slice()
            break
          }
        }
      }
      probe.emit(direction, size, this.#carrier, this.#detail, content)
    } catch (error) {
      this.#report(createBrowserTransportError(BrowserRpcErrorText.carrierObservationFailed, error))
    }
  }
}
