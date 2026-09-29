import { VerifiedPeerRegistry } from './identity.js'
import { SourceIdentityRegistry } from './source-identity.js'
import { tupleKey, type IRpcPropertyReadReporter } from './safe-value.js'
import { recordInboundIdentityRelease } from './test-observer.js'
import type { IRpcConnectCapability } from '../typing.js'
import type { IRpcInboundMessage, IRpcTransportTopology } from '../transport.js'
import type { IRpcPlatform } from '../typing.js'

/** Result of shared inbound identity admission; token is leased until release. */
export type IInboundIdentityAdmission = {
  readonly token: string
  readonly bindingKey: string
  readonly release: () => void
}

/** One-shot physical-source receipt consumed only by its creating identity owner. */
export type IInboundIdentityPreparedSource = Readonly<{
  readonly data: unknown
  readonly source: unknown
  readonly origin: string | undefined
  readonly peerId: string | undefined
  readonly sourceToken: string
}>

/** Narrow request context accepted by the endpoint-local identity owner. */
export type IInboundIdentityRequest = {
  readonly senderId: string
  readonly targetId: string
  readonly data: unknown
  readonly inbound?: IRpcInboundMessage
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
  readonly #connect: IRpcConnectCapability | undefined
  /** Existing endpoint failure sink used when connect verification reads hostile metadata. */
  readonly #reportRead: IRpcPropertyReadReporter | undefined
  /** Adapter source proof is the first fail-closed admission check. */
  readonly #sourceProof: ((source: unknown, origin?: string) => boolean) | undefined
  /** Platform and topology context passed to connect verification. */
  readonly #platform: IRpcPlatform
  readonly #topology: IRpcTransportTopology | undefined
  /** Discovery-established peer leases reused by later frames on source-less transports. */
  readonly #established = new Map<string, string>()
  /** Exact prepared receipts prevent copied, foreign, or replayed source admission. */
  readonly #prepared = new WeakSet<object>()
  /** Terminal clear prevents a stale asynchronous verification from reviving identity state. */
  #closed = false

  /** Creates one endpoint-local identity owner without subscribing or allocating feature state. */
  constructor(options: {
    /** Endpoint clock forwarded to the verified binding registry. */
    readonly now: () => number
    readonly connect?: IRpcConnectCapability
    readonly reportRead?: IRpcPropertyReadReporter
    readonly sourceProof?: (source: unknown, origin?: string) => boolean
    readonly platform: IRpcPlatform
    readonly topology?: IRpcTransportTopology
    readonly peers?: VerifiedPeerRegistry
  }) {
    this.#connect = options.connect
    this.#reportRead = options.reportRead
    this.#sourceProof = options.sourceProof
    this.#platform = options.platform
    this.#topology = options.topology
    this.#peers = options.peers ?? new VerifiedPeerRegistry(options.now)
  }

  /** Reports whether a stable peer token is a valid identity value without creating a lease. */
  verify(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0
  }

  /** Verifies source and connect identity before a feature allocates protocol state. */
  async admit(request: IInboundIdentityRequest): Promise<IInboundIdentityAdmission | undefined> {
    const prepared = this.prepareSource(request.inbound)
    return prepared === undefined ? undefined : this.admitPrepared(prepared, request)
  }

  /** Snapshots physical inbound metadata and proves its source before framing allocates state. */
  prepareSource(
    inbound: IInboundIdentityRequest['inbound']
  ): IInboundIdentityPreparedSource | undefined {
    if (this.#closed) return undefined
    const data = inbound?.data
    const source = inbound?.source
    const origin = inbound?.origin
    const peerId = inbound?.peerId
    if (this.#sourceProof && !this.#sourceProof(source, origin)) return undefined
    if (this.#closed) return undefined
    const prepared = Object.freeze({
      data,
      source,
      origin,
      peerId,
      sourceToken: this.#sources.token(source)
    })
    this.#prepared.add(prepared)
    return prepared
  }

  /** Consumes one prepared physical proof before establishing or retaining a logical lease. */
  async admitPrepared(
    prepared: IInboundIdentityPreparedSource,
    request: IInboundIdentityRequest
  ): Promise<IInboundIdentityAdmission | undefined> {
    if (this.#closed || !this.#prepared.delete(prepared)) return undefined
    const establishedKey = tupleKey(
      request.senderId,
      request.targetId,
      prepared.peerId ?? '',
      prepared.origin ?? '',
      prepared.sourceToken
    )
    const establishedToken = this.#established.get(establishedKey)
    if (establishedToken !== undefined && this.#peers.retain(establishedToken))
      return {
        token: establishedToken,
        bindingKey: establishedKey,
        release: () => {
          this.#peers.release(establishedToken)
          recordInboundIdentityRelease(this)
        }
      }
    if (this.#connect?.verify) {
      const verified = await this.#connect.verify(
        {
          senderId: request.senderId,
          targetId: request.targetId,
          peerId: prepared.peerId,
          origin: prepared.origin,
          source: prepared.source,
          data: request.data,
          platform: this.#platform,
          topology: this.#topology
        },
        this.#reportRead
      )
      if (!verified || this.#closed) return undefined
    }
    const token = this.#peers.register(
      request.senderId,
      prepared.peerId,
      prepared.origin,
      prepared.sourceToken
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
      bindingKey: establishedKey,
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
    this.#closed = true
    this.#established.clear()
    this.#peers.clear()
  }
}
