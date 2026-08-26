import { WebRpcMessageKind } from '../protocol-constants.js'
import type { IWebRpcInboundMessage } from '../transport.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import { ChunkAssembler } from './chunk.js'
import { normalizeWebRpcEnvelope, type IWebRpcChunkFrame } from '../wire.js'
import type { IInboundIdentityPort } from './inbound-identity.js'
import type { IEndpointTimePort } from './time-port.js'

type IChunkRouteMessage = {
  readonly envelope?: IWebRpcChunkFrame
  readonly inbound?: IWebRpcInboundMessage
  readonly verifiedPeerKey?: string
}

/** Owns chunk assembly on one kernel and forwards decoded payloads through canonical routes. */
export class WebRpcChunkAttachment {
  /** Shared kernel receiving decoded chunk frames. */
  readonly #kernel: IEndpointKernelHost
  /** Endpoint identifier used to reject frames for another endpoint. */
  readonly #id: string
  /** Protocol decoder snapshotted during middleware preparation. */
  readonly #decode: (value: unknown) => unknown
  /** Shared source-proof and verified lease owner supplied by outbound closure. */
  readonly #identity: IInboundIdentityPort
  /** Chunk limits and expiry state owned by this selected feature. */
  readonly #chunks: ChunkAssembler
  /** Idempotent route release handle. */
  readonly #releaseRoute: () => void
  /** Removes the construction fallback owner when Host takes over feature disposal. */
  readonly #unregisterResource: () => void

  /** Registers chunk ownership without creating a second receiver or transport subscription. */
  constructor(
    kernel: IEndpointKernelHost,
    prepared: IPreparedEndpoint<string>,
    identity: IInboundIdentityPort,
    time: Pick<IEndpointTimePort, 'now' | 'setTimeout' | 'clearTimeout'> = kernel.time,
    observe?: (
      event: 'chunk.rejected' | 'chunk.expired',
      messageId?: string,
      peerKey?: string
    ) => void
  ) {
    this.#kernel = kernel
    this.#identity = identity
    this.#id = prepared.id
    const protocol = prepared.options.protocol
    this.#decode =
      protocol && 'decode' in protocol && protocol.decode ? protocol.decode : (value) => value
    this.#chunks = new ChunkAssembler(prepared.options.chunk, time)
    this.#chunks.observe((event, messageId, peerKey) => observe?.(event, messageId, peerKey))
    kernel.registerOwner('chunk-assembler', this.#chunks)
    this.#releaseRoute = kernel.registerRoute(WebRpcMessageKind.chunk, (message) =>
      this.#receive(message)
    )
    const unregisterResource = kernel.resources.add('chunk assembler', () => {
      this.#releaseRoute()
      this.#chunks.clear()
    })
    this.#unregisterResource =
      typeof (unregisterResource as unknown) === 'function' ? unregisterResource : () => undefined
  }

  /** Returns current partial assembly count for package lifecycle evidence. */
  get size(): number {
    return this.#chunks.size
  }

  /** Clears chunk state when the feature is explicitly disposed. */
  dispose(): void {
    this.#unregisterResource()
    this.#releaseRoute()
    this.#chunks.clear()
  }

  /** Assembles one frame, decodes its payload, and re-enters the kernel route table. */
  async #receive(message: unknown): Promise<void> {
    const record = message as IChunkRouteMessage
    const frame = record.envelope
    if (!frame || frame.kind !== WebRpcMessageKind.chunk || frame.targetId !== this.#id) return
    const admission = await this.#identity.admit({
      senderId: frame.senderId,
      targetId: frame.targetId,
      data: frame,
      inbound: record.inbound
    })
    if (!admission) return
    const peerKey = admission.token
    try {
      const assembled = this.#chunks.accept(frame, peerKey)
      if (assembled === undefined) return
      const decoded = normalizeWebRpcEnvelope(this.#decode(assembled))
      if (!decoded || decoded.kind === WebRpcMessageKind.chunk) return
      await this.#kernel.dispatchRoute(decoded.kind, {
        envelope: decoded,
        inbound: record.inbound,
        verifiedPeerKey: peerKey
      })
    } finally {
      admission.release()
    }
  }
}
