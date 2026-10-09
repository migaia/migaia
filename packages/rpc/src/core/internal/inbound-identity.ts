import { VerifiedPeerRegistry } from './identity.js'
import { SourceIdentityRegistry } from './source-identity.js'
import { tupleKey, type IRpcPropertyReadReporter } from './safe-value.js'
import { recordInboundIdentityRelease } from './test-observer.js'
import type { IRpcConnectCapability } from '../typing.js'
import type { IRpcInboundMessage, IRpcTransportTopology } from '../transport.js'
import type { IRpcPlatform } from '../typing.js'
import type { INativeReplayReceipt } from './native-replay.js'
import type { IRpcRuntimeGeneration } from '../../contract/runtime-api/types.js'

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
  /** Physical qualification is shared with core; this identity owner never claims another consumer. */
  readonly #native: INativeReplayReceipt | undefined

  /** Creates one endpoint-local identity owner without subscribing or allocating feature state. */
  constructor(options: {
    readonly native?: INativeReplayReceipt
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
    this.#native = options.native
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
    this.#native?.observeOwner()
    if (this.#native && !this.#native.active) return undefined
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
  admitPrepared(
    prepared: IInboundIdentityPreparedSource,
    request: IInboundIdentityRequest,
    synchronous = false
  ): IInboundIdentityAdmission | undefined | Promise<IInboundIdentityAdmission | undefined> {
    try {
      const admission = this.#consumePrepared(prepared, request, synchronous)
      return synchronous ? admission : Promise.resolve(admission)
    } catch (error) {
      if (synchronous) throw error
      return Promise.reject(error)
    }
  }

  /** Qualified batch ingress omits only the legacy async handoff, using the same proof owner. */
  #consumePrepared(
    prepared: IInboundIdentityPreparedSource,
    request: IInboundIdentityRequest,
    synchronous: boolean
  ): IInboundIdentityAdmission | undefined | Promise<IInboundIdentityAdmission | undefined> {
    this.#native?.observeOwner()
    if (this.#native && !this.#native.active) return undefined
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
    /** A spent native binding cannot issue another token on the same still-live physical resource. */
    if (establishedToken !== undefined && this.#native) {
      this.#native.retire()
      return undefined
    }
    if (this.#connect?.verify) {
      const verified = this.#connect.verify(
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
      if (!synchronous || typeof verified !== 'boolean')
        return Promise.resolve(verified).then((accepted) =>
          accepted ? this.#establish(prepared, request, establishedKey) : undefined
        )
      if (!verified) return undefined
    }
    return this.#establish(prepared, request, establishedKey)
  }

  /** Consumes one physical proof and issues one single-use member proof per logical admission. */
  splitPrepared(
    prepared: IInboundIdentityPreparedSource,
    count: number
  ): readonly IInboundIdentityPreparedSource[] {
    if (this.#closed || !this.#prepared.delete(prepared)) return []
    /** No inbound getter or source-proof callback is reread while issuing member receipts. */
    return Array.from({ length: count }, () => {
      const member = Object.freeze({ ...prepared })
      this.#prepared.add(member)
      return member
    })
  }

  /** Finalizes both synchronous and genuinely asynchronous verification through one binding owner. */
  #establish(
    prepared: IInboundIdentityPreparedSource,
    request: IInboundIdentityRequest,
    establishedKey: string
  ): IInboundIdentityAdmission | undefined {
    this.#native?.observeOwner()
    if (this.#closed || (this.#native && !this.#native.active)) return undefined
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
    /** Replay admission may cross hard expiry after logical admission retained this exact binding. */
    const retained = this.#peers.retain(token)
    if (!retained && this.#native && [...this.#established.values()].includes(token))
      this.#native.retire()
    return retained
  }

  /** Releases one replay/operation identity lease. */
  release(token: string): void {
    this.#peers.release(token)
  }

  /** Clears all endpoint-local identity state during terminal disposal. */
  bindGeneration(token: string, generation: IRpcRuntimeGeneration): boolean {
    return !this.#closed && this.#peers.bindGeneration(token, generation)
  }

  /** A verified response uses the same established source binding as the directory request. */
  bindResponseGeneration(binding: string, generation: IRpcRuntimeGeneration): boolean {
    const token = this.#established.get(binding)
    return token !== undefined && this.bindGeneration(token, generation)
  }

  /** Resolve only the generation already bound to this exact authenticated response source. */
  readResponseGeneration(binding: string): IRpcRuntimeGeneration | undefined {
    /** The original established table remains the only response identity owner. */
    const token = this.#established.get(binding)
    return token === undefined ? undefined : this.readGeneration(token)
  }

  /** Runtime fences read only previously accepted describe identity on this original peer owner. */
  readGeneration(token: string): IRpcRuntimeGeneration | undefined {
    return this.#closed ? undefined : this.#peers.readGeneration(token)
  }

  /** Clears all endpoint-local identity state during terminal disposal. */
  clear(): void {
    this.#closed = true
    this.#established.clear()
    this.#peers.clear()
  }
}
