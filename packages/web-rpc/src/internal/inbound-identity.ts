import { VerifiedPeerRegistry } from './identity.js'
import { SourceIdentityRegistry } from './source-identity.js'
import { tupleKey } from './safe-value.js'
import { recordInboundIdentityRelease } from './test-observer.js'
import type { IWebRpcConnectCapability } from '../typing.js'
import type { IWebRpcInboundMessage, IWebRpcTransportTopology } from '../transport.js'
import type { IWebRpcPlatform } from '../typing.js'

/** Result of shared inbound identity admission; token is leased until release. */
export type IInboundIdentityAdmission = {
  readonly token: string
  readonly release: () => void
}

/** Narrow request context accepted by the endpoint-local identity owner. */
export type IInboundIdentityRequest = {
  readonly senderId: string
  readonly targetId: string
  readonly data: unknown
  readonly inbound?: IWebRpcInboundMessage
}

/** Narrow lifecycle-neutral identity surface shared with chunk and D95 consumers. */
export type IInboundIdentityPort = {
  readonly admit: (
    request: IInboundIdentityRequest
  ) => Promise<IInboundIdentityAdmission | undefined>
  readonly retain: (token: string) => boolean
  readonly release: (token: string) => void
  readonly clear: () => void
}

/** Canonical source-proof, connect verification, binding, and lease owner. */
export class InboundIdentityCoordinator {
  /** Stable object/function source identity owner. */
  readonly #sources = new SourceIdentityRegistry()
  /** Verified binding and reference-count owner. */
  readonly #peers: VerifiedPeerRegistry
  /** Adapter/connect verification snapshot shared by all inbound features. */
  readonly #connect: IWebRpcConnectCapability | undefined
  /** Adapter source proof is the first fail-closed admission check. */
  readonly #sourceProof: ((source: unknown, origin?: string) => boolean) | undefined
  /** Platform and topology context passed to connect verification. */
  readonly #platform: IWebRpcPlatform
  readonly #topology: IWebRpcTransportTopology | undefined
  /** Discovery-established peer leases reused by later frames on source-less transports. */
  readonly #established = new Map<string, string>()

  /** Creates one endpoint-local identity owner without subscribing or allocating feature state. */
  constructor(options: {
    readonly connect?: IWebRpcConnectCapability
    readonly sourceProof?: (source: unknown, origin?: string) => boolean
    readonly platform: IWebRpcPlatform
    readonly topology?: IWebRpcTransportTopology
    readonly peers?: VerifiedPeerRegistry
  }) {
    this.#connect = options.connect
    this.#sourceProof = options.sourceProof
    this.#platform = options.platform
    this.#topology = options.topology
    this.#peers = options.peers ?? new VerifiedPeerRegistry()
  }

  /** Reports whether a stable peer token is a valid identity value without creating a lease. */
  verify(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0
  }

  /** Verifies source and connect identity before a feature allocates protocol state. */
  async admit(request: IInboundIdentityRequest): Promise<IInboundIdentityAdmission | undefined> {
    const inbound = request.inbound
    if (this.#sourceProof && !this.#sourceProof(inbound?.source, inbound?.origin)) return undefined
    const establishedKey = tupleKey(request.senderId, request.targetId)
    const establishedToken = this.#established.get(establishedKey)
    if (establishedToken !== undefined && this.#peers.retain(establishedToken))
      return {
        token: establishedToken,
        release: () => {
          this.#peers.release(establishedToken)
          recordInboundIdentityRelease(this)
        }
      }
    if (this.#connect?.verify) {
      const verified = await this.#connect.verify({
        senderId: request.senderId,
        targetId: request.targetId,
        peerId: inbound?.peerId,
        origin: inbound?.origin,
        source: inbound?.source,
        data: request.data,
        platform: this.#platform,
        topology: this.#topology
      })
      if (!verified) return undefined
    }
    const token = this.#peers.register(
      request.senderId,
      inbound?.peerId,
      inbound?.origin,
      this.#sources.token(inbound?.source)
    )
    if (!token || !this.#peers.retain(token)) return undefined
    if (this.#established.get(establishedKey) !== token) {
      const previousToken = this.#established.get(establishedKey)
      if (previousToken !== undefined) this.#peers.release(previousToken)
      this.#established.set(establishedKey, token)
      this.#peers.retain(token)
    }
    return {
      token,
      release: () => {
        this.#peers.release(token)
        recordInboundIdentityRelease(this)
      }
    }
  }

  /** Retains a previously admitted identity for replay/operation ownership. */
  retain(token: string): boolean {
    return this.#peers.retain(token)
  }

  /** Releases one replay/operation identity lease. */
  release(token: string): void {
    this.#peers.release(token)
  }

  /** Clears all endpoint-local identity state during terminal disposal. */
  clear(): void {
    this.#established.clear()
    this.#peers.clear()
  }
}
