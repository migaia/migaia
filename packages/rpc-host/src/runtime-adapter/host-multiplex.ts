import { hostRethrowReporter } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import {
  bindRpcFrameIngress,
  messageFramerV1,
  readRpcBatchMembers
} from '@migaia/rpc-contract/framing'
import { RpcBatchPhysical, RpcCapability } from '@migaia/rpc-contract'
import { readRuntimeCarrier } from '@migaia/rpc-contract/runtime'
import { createRpcError } from '../core/errors.js'
import { RpcCoreErrorCode } from '../core/error-code.js'
import { RpcCoreErrorText } from '../core/error-text.js'
import {
  RpcPlatform,
  RpcTransportOwnership,
  RpcTransportTopology
} from '../core/transport-constants.js'
import {
  hasCloneTransferCarrier,
  registerBatchAgreement,
  registerCloneTransferCarrier,
  registerPeerTransportCapabilities,
  type IRpcPeerTransportPipeline
} from '../core/internal/batch-frame.js'
import { createMessageListenerHub } from '../core/internal/message-listener-hub.js'
import { readInstalledProbe } from '../core/internal/probe-emitter.js'
import type { IRpcCarrierProbe } from '../core/probe/types.js'
import {
  readOutboundGate,
  registerMultiplexedOutboundGate,
  type IRpcOutboundGate
} from '../core/internal/outbound-gate.js'
import { activateIpcConnectionDiagnostics } from './byte/ipc-connection.js'
import {
  collectListenerCleanupFailures,
  createListenerFailure,
  observeListener
} from '../core/internal/listener-safety.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { RUNTIME_API_CAPABILITIES } from '../remote/runtime-api/constants.js'
import type { IRuntimePeerIdentity } from '../remote/runtime-api/description.js'
import type { IRuntimePeerSourceResult } from '../remote/runtime-api/peer.js'
import type { IRpcInboundMessage, IRpcSendOptions, IRpcTransport } from '../core/transport.js'

/** The attachment borrows subscriptions while the original channel receipt retains physical close. */
type IHostPhysicalSource = Readonly<{
  channel: IRuntimePeerSourceResult
  token: object
  pipeline: IRpcPeerTransportPipeline
  observe(probe?: IRpcCarrierProbe): void
  detach(): void
}>

/** Internal routing context survives an opaque protected frame without becoming part of its wire. */
type IHostPhysicalSendOptions = IRpcSendOptions & Readonly<{ targetId?: string }>

/** One logical channel routes physical sources without owning endpoint or session admission state. */
export type IHostMultiplexTransport = Readonly<{
  channel: IRuntimePeerSourceResult
  assertAttach(peerId: string): void
  attach(channel: IRuntimePeerSourceResult): () => void
  supports(peerId: string, capability: string): boolean
  onDeparture(listener: (peerId: string, error: unknown) => unknown): () => void
  close(): Promise<void>
}>

/** Read only routing metadata already admitted by the logical endpoint; payloads are never scanned. */
function routeOf(value: unknown): Readonly<{ targetId?: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  /** Runtime envelopes place routing at the root; the original profile places it under data. */
  const record = value as { route?: unknown; data?: { route?: unknown } }
  /** This is physical selection, not a duplicate semantic-envelope validator. */
  const route = record.route ?? record.data?.route
  return typeof route === 'object' && route !== null ? route : undefined
}

/** Framing correlation stays within the original physical source's independent assembly namespace. */
function messageIdOf(value: unknown): string {
  return typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
    ? value.id
    : 'whole'
}

/** Physical admission reuses each selected channel's existing gate and original operation scope. */
type IHostPhysicalGateRun = Readonly<{
  selected: readonly IHostPhysicalSource[]
  args: Parameters<IRpcOutboundGate['run']>
}>

/** Enter each existing physical gate once before the same logical write reaches codec or crypto. */
function enterPhysicalGate(context: IHostPhysicalGateRun, index: number): void | Promise<void> {
  if (index === context.selected.length) return context.args[1]()
  /** Only this actual source's existing queue can reserve its capacity. */
  const physical = readOutboundGate(context.selected[index]!.channel.transport)
  return physical
    ? physical.run(context.args[0], () => enterPhysicalGate(context, index + 1), context.args[2])
    : enterPhysicalGate(context, index + 1)
}

/** Own subscription proof and receive activation for one actual physical channel. */
class HostPhysicalAttachment {
  /** The logical transport retains routing, event dispatch and the shared terminal boundary. */
  #owner: HostMultiplexTransport
  /** This exact native receipt retains codec, framer and physical resource close authority. */
  #physical: IRuntimePeerSourceResult
  /** Each attachment has one uncopyable token revoked before native unsubscription. */
  #token = Object.freeze({})
  /** Native ingress owns fragment correlation without another receive parser or queue. */
  #prepareIngress: ReturnType<typeof bindRpcFrameIngress>
  /** Successful native registrations alone contribute their original removal receipts. */
  #removals: (() => void)[] = []
  /** Registration rollback and explicit removal share the same one-time teardown. */
  #detached = false
  /** Probe replacement borrows only the actual native observation's current remover. */
  #removeObservation: (() => void) | undefined
  /** This frozen source record is the exact routing and source-proof identity held by the owner. */
  readonly value: IHostPhysicalSource

  /** Capture the native channel without subscribing or transferring its physical close ownership. */
  constructor(owner: HostMultiplexTransport, physical: IRuntimePeerSourceResult) {
    this.#owner = owner
    this.#physical = physical
    this.#prepareIngress = bindRpcFrameIngress(
      physical.pipeline.framer.accept,
      physical.pipeline.framer.frame
    )
    this.#removals.push(() => this.observe())
    this.value = Object.freeze({
      channel: physical,
      token: this.#token,
      pipeline: Object.freeze({ ...physical.pipeline, ingressPrepare: this.#prepareIngress }),
      observe: (probe) => this.observe(probe),
      detach: () => this.detach()
    })
  }

  /** Replace the same native observer, clearing ownership before a failing original unsubscribe. */
  observe(probe?: IRpcCarrierProbe): void {
    /** A previous remover must not remain resident when native cleanup reenters or throws. */
    const previous = this.#removeObservation
    this.#removeObservation = undefined
    previous?.()
    if (probe) this.#removeObservation = this.#physical.transport.observe?.(probe)
  }

  /** Revoke proof before attempting every original native subscription cleanup. */
  detach(): void {
    if (this.#detached) return
    this.#detached = true
    this.#owner.withdraw(this.value)
    /** Preserve every exact native cleanup failure under the canonical listener aggregate. */
    const failure = createListenerFailure(collectListenerCleanupFailures(this.#removals), {
      code: RpcCoreErrorCode.transport
    })
    if (failure) throw failure
  }

  /** One native error retires this source; the logical owner alone publishes session departure. */
  #departed = (error: unknown): void => {
    if (this.#detached) return
    try {
      this.detach()
    } catch (cleanup) {
      this.#owner.reportFailure(cleanup)
    }
    /** An existing departure owner retires this exact reason; isolated resources use the reporter. */
    if (!this.#owner.depart(this.#physical.peerId, error)) this.#owner.reportFailure(error)
  }

  /** Decode through this actual pipeline, then lend its exact proof token to logical admission. */
  #receive = (message: IRpcInboundMessage): void => {
    if (this.#detached || this.#owner.closed) return
    try {
      /** Core selects, unprotects and decodes native frames using this proven physical source. */
      if (readRuntimeCarrier(message.data) !== undefined) {
        this.#owner.receive({
          data: message.data,
          peerId: this.#physical.peerId,
          source: this.#token
        })
        return
      }
      /** Correlation stays in this physical peer's original fragment assembly namespace. */
      const prepared = this.#prepareIngress(message.data, {
        source: this.#physical.peerId,
        messageId: 'whole'
      })
      /** Native acceptance receives the original admitted fragment identifier. */
      const accepted = this.#physical.pipeline.framer.accept(prepared.frame, {
        source: this.#physical.peerId,
        messageId: prepared.messageId
      })
      if (accepted.status === 'pending') return
      if (accepted.status === 'rejected') {
        this.#owner.reportFailure(accepted.error)
        return
      }
      /** Logical validation follows the original physical decoder rather than replacing it. */
      const data = this.#physical.pipeline.codec.decode(accepted.value)
      this.#owner.receive({ data, peerId: this.#physical.peerId, source: this.#token })
    } catch (error) {
      this.#owner.reportFailure(error)
    }
  }

  /** Subscribe cold capture before native activation and retain synchronous-departure cleanup. */
  start(): () => void {
    if (this.#owner.carrierProbe)
      try {
        this.observe(this.#owner.carrierProbe)
      } catch (error) {
        this.#owner.reportObservation(error)
      }
    /** Diagnostics consumers see the exact events from the original gate, without a probe wrapper. */
    const physicalGate = readOutboundGate(this.#physical.transport)
    if (physicalGate)
      this.#removals.push(physicalGate.onEvent((event) => this.#owner.diagnostic(event)))
    /** The original diagnostic activation retains its own subscription remover. */
    const removeDiagnostics = activateIpcConnectionDiagnostics(this.#physical.transport)
    if (removeDiagnostics) this.#removals.push(removeDiagnostics)
    this.#removals.push(this.#physical.transport.subscribe(this.#receive))
    if (this.#physical.transport.onTransportError) {
      /** A native source can synchronously depart before returning its subscription remover. */
      const removeError = this.#physical.transport.onTransportError(this.#departed)
      if (this.#detached) removeError()
      else this.#removals.push(removeError)
    }
    if (this.#owner.activated && !this.#detached) this.#physical.activateReceive?.()
    return this.value.detach
  }
}

/** Adapt original physical pipelines to one logical identity, with no endpoint or session owner. */
class HostMultiplexTransport {
  /** Local framing correlation always uses this admitted logical identity. */
  #self: IRuntimePeerIdentity
  /** Failure reporting retains the original unbound callback and host rethrow policy. */
  #report: (error: unknown) => void
  /** Only currently attached physical receipts can route or prove an inbound source. */
  #sources = new Map<string, IHostPhysicalSource>()
  /** Uncopyable private tokens are revoked before any physical unsubscribe. */
  #tokens = new WeakSet<object>()
  /** Logical subscriptions retain the canonical snapshot/reentrancy listener owner. */
  #incoming = createMessageListenerHub<IRpcInboundMessage>()
  /** Native events retain their existing physical diagnostic identity. */
  #diagnostics = createMessageListenerHub<unknown>()
  /** Source departure does not convert one physical failure to a host-wide transport error. */
  #departures = new Set<(peerId: string, error: unknown) => unknown>()
  /** Logical implementation rights remain distinct from each peer's actual accepted agreement. */
  #capabilities = Object.freeze([
    ...RUNTIME_API_CAPABILITIES,
    RpcCapability.nativeBinary,
    RpcCapability.transfer
  ])
  /** The endpoint subscribes before the existing held channel handoffs activate. */
  #activated = false
  /** Terminal close immediately revokes new sends, attachment and proof. */
  #closed = false
  /** All channel and adapter closes share the exact first subscription-release Promise. */
  #closing: Promise<void> | undefined
  /** The kernel lends its one original carrier probe to each current and future physical source. */
  #carrierProbe: IRpcCarrierProbe | undefined
  /** The actual logical transport retains original own-property callbacks and getter surface. */
  #transport: IRpcTransport
  /** One frozen logical channel is reused by the kernel and every Host session. */
  #channel: IRuntimePeerSourceResult

  /** Construct the same logical transport without acquiring a physical source. */
  constructor(self: IRuntimePeerIdentity, report: (error: unknown) => void) {
    this.#self = self
    this.#report = report
    this.#transport = this.#createTransport()
    registerMultiplexedOutboundGate(this.#transport, this.#createGate())
    registerBatchAgreement(this.#transport, this.#capabilities)
    registerCloneTransferCarrier(this.#transport)
    registerPeerTransportCapabilities(
      this.#transport,
      (peerId) => this.#capabilitiesForPeer(peerId),
      (peerId) => (this.#closed ? undefined : this.#sources.get(peerId)?.pipeline)
    )
    this.#channel = this.#createChannel()
  }

  /** Native source callbacks observe the same terminal boundary as logical send and attachment. */
  get closed(): boolean {
    return this.#closed
  }
  /** Only original endpoint activation permits newly attached sources to flush cold capture. */
  get activated(): boolean {
    return this.#activated
  }
  /** Physical attachment borrows the kernel's exact current observer. */
  get carrierProbe(): IRpcCarrierProbe | undefined {
    return this.#carrierProbe
  }

  /** Reporter failure follows the existing rethrow route without replacing the primary error. */
  reportFailure = (error: unknown): void =>
    observeListener(
      () => (0, this.#report)(error),
      (failure) => hostRethrowReporter(failure, IpcReporterContext)
    )

  /** Observation failure belongs to the installed probe's original non-business report channel. */
  reportObservation(error: unknown): void {
    /** The real installed emitter remains the only probe error policy authority. */
    const emitter = readInstalledProbe(this.#transport)
    if (emitter) emitter.report(error)
    else this.reportFailure(error)
  }

  /** Retire only the matching attachment before native cleanup may reenter. */
  withdraw(source: IHostPhysicalSource): void {
    this.#tokens.delete(source.token)
    if (this.#sources.get(source.channel.peerId) === source)
      this.#sources.delete(source.channel.peerId)
  }

  /** Snapshot actual departure observers and preserve their original bare callback receiver. */
  depart(peerId: string, error: unknown): boolean {
    /** Snapshot the current terminal owners before one retirement can remove its own subscription. */
    const listeners = Array.from(this.#departures)
    for (const listener of listeners)
      observeListener(() => listener(peerId, error), this.reportFailure)
    return listeners.length > 0
  }

  /** Dispatch original gate events through the existing logical listener membership owner. */
  diagnostic(event: unknown): void {
    this.#diagnostics.dispatch(event, (listener, value) =>
      observeListener(() => listener(value), this.reportFailure)
    )
  }

  /** The physical decoder lends the exact attachment token to ordinary logical admission. */
  receive(message: IRpcInboundMessage): void {
    this.#incoming.dispatch(message, (listener, frame) =>
      observeListener(() => listener(frame), this.reportFailure)
    )
  }

  /** Admission precedes session inventory mutation and any native receive activation. */
  #assertAttach(peerId: string): void {
    if (this.#closed)
      throw createRpcError(RpcCoreErrorCode.endpointDisposed, RpcCoreErrorText.endpointDisposed)
    if (this.#sources.has(peerId))
      throw createRpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcCoreErrorText.unknownTarget(peerId)
      )
  }

  /** Actual accepted peer rights never manufacture backing ownership on an unqualified carrier. */
  #capabilitiesForPeer(peerId: string): readonly string[] | undefined {
    /** Borrow the original held channel rather than retaining another peer catalog. */
    const source = this.#sources.get(peerId)
    if (this.#closed || !source) return undefined
    /** The existing channel agreement alone grants semantic authority to this peer. */
    const accepted = source.channel.agreement.capabilities
    if (
      hasCloneTransferCarrier(source.channel.transport) ||
      (!accepted.includes(RpcCapability.nativeBinary) && !accepted.includes(RpcCapability.transfer))
    )
      return accepted
    return accepted.filter(
      (capability) =>
        capability !== RpcCapability.nativeBinary && capability !== RpcCapability.transfer
    )
  }

  /** Codec/framer conversion remains with the selected original physical pipeline. */
  async #write(
    source: IHostPhysicalSource,
    value: unknown,
    options?: IRpcSendOptions
  ): Promise<void> {
    this.#assertCurrent(source)
    /** Native Core already encoded/framed/protected once with this source's original pair. */
    if (readRuntimeCarrier(value) !== undefined) {
      await source.channel.transport.send(value, options)
      return
    }
    /** Preserve original codec failure identity before entering the existing framer. */
    const encoded = source.channel.pipeline.codec.encode(value)
    /** Correlation retains this source's independent native assembly namespace. */
    const frames = source.channel.pipeline.framer.frame(encoded, {
      source: this.#self.instanceId,
      messageId: messageIdOf(value)
    })
    if (options?.transfer?.length && frames.length !== 1)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.transferUnsupportedForChunking
      )
    for (const frame of frames) {
      this.#assertCurrent(source)
      await source.channel.transport.send(frame, options)
    }
  }

  /** A departure can never redirect an accepted write through a same-name successor. */
  #assertCurrent(source: IHostPhysicalSource): void {
    if (this.#closed || this.#sources.get(source.channel.peerId) !== source)
      throw createRpcError(
        RpcCoreErrorCode.targetUnknown,
        RpcCoreErrorText.unknownTarget(source.channel.peerId)
      )
  }

  /** Targeted frames select exactly one source; untargeted control snapshots the live receipts. */
  #select(value: unknown, targetId?: string): readonly IHostPhysicalSource[] {
    /** Protected frames use the sender's out-of-band target without rescanning semantic payloads. */
    const route = routeOf(value)
    if (targetId === undefined && route === undefined)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** Native instance ids alone select a physical source at this boundary. */
    const selected = targetId ?? route?.targetId
    if (selected === undefined) return [...this.#sources.values()]
    /** A retired source cannot accidentally select its same-name replacement. */
    const source = this.#sources.get(selected)
    if (!source)
      throw createRpcError(RpcCoreErrorCode.targetUnknown, RpcCoreErrorText.unknownTarget(selected))
    return [source]
  }

  /** Release logical subscriptions once; original physical resource receipts still own close. */
  #close = (): Promise<void> => {
    if (this.#closing) return this.#closing
    this.#closed = true
    this.#closing = Promise.resolve().then(() => {
      /** Every original source cleanup is attempted even if another native unsubscribe throws. */
      const failures = collectListenerCleanupFailures(
        [...this.#sources.values()].map((source) => source.detach)
      )
      this.#incoming.clear(() => undefined)
      this.#diagnostics.clear(() => undefined)
      this.#departures.clear()
      /** Canonical cleanup aggregation preserves exact native errors. */
      const failure = createListenerFailure(failures, { code: RpcCoreErrorCode.transport })
      if (failure) throw failure
    })
    return this.#closing
  }

  /** Replace every native observer while preserving the original aggregate cleanup behavior. */
  #updateObservation(probe?: IRpcCarrierProbe): void {
    /** The listener failure owner retains every exact physical observation failure. */
    const failure = createListenerFailure(
      collectListenerCleanupFailures(
        [...this.#sources.values()].map((source) => () => source.observe(probe))
      ),
      { code: RpcCoreErrorCode.transport }
    )
    if (failure) throw failure
  }

  /** The latest exact probe identity alone may release current physical observation. */
  #observe(next: IRpcCarrierProbe): () => void {
    this.#carrierProbe = next
    this.#updateObservation(next)
    return () => {
      if (this.#carrierProbe !== next) return
      this.#carrierProbe = undefined
      this.#updateObservation()
    }
  }

  /** Route original members in order, grouping only frames sharing the same actual physical source. */
  async #send(value: unknown, options?: IHostPhysicalSendOptions): Promise<void> {
    if (this.#closed)
      throw createRpcError(RpcCoreErrorCode.endpointDisposed, RpcCoreErrorText.endpointDisposed)
    if (options?.targetId !== undefined) {
      await this.#write(this.#select(value, options.targetId)[0]!, value, options)
      return
    }
    /** Semantic validation remains with the existing endpoint batch parser. */
    const members = readRpcBatchMembers(value)
    if (members === undefined) {
      await Promise.all(this.#select(value).map((source) => this.#write(source, value, options)))
      return
    }
    /** Buckets preserve original member order and never combine distinct physical pipelines. */
    const buckets = new Map<IHostPhysicalSource, unknown[]>()
    for (const member of members)
      for (const source of this.#select(member)) {
        /** Each frame contributes once to each actual recipient's output bucket. */
        const bucket = buckets.get(source) ?? []
        if (!buckets.has(source)) buckets.set(source, bucket)
        bucket.push(member)
      }
    await Promise.all(
      [...buckets].map(([source, bucket]) => this.#sendBucket(source, bucket, options))
    )
  }

  /** Retain the selected source's original batch capability and sequential fallback writes. */
  async #sendBucket(
    source: IHostPhysicalSource,
    bucket: unknown[],
    options?: IRpcSendOptions
  ): Promise<void> {
    if (source.channel.agreement.capabilities.includes(RpcCapability.batch))
      await this.#write(
        source,
        { kind: RpcBatchPhysical.kind, [RpcBatchPhysical.members]: bucket },
        options
      )
    else for (const member of bucket) await this.#write(source, member, options)
  }

  /** Publish original own callbacks while all mutable implementation state remains explicit here. */
  #createTransport(): IRpcTransport {
    /** The getter delegates to the same class state without borrowing the transport receiver. */
    const readClosed = () => this.#closed
    return {
      platform: RpcPlatform.memory,
      topology: RpcTransportTopology.multiplexed,
      ownership: RpcTransportOwnership.borrowed,
      sourceProof: (source) =>
        !this.#closed && typeof source === 'object' && source !== null && this.#tokens.has(source),
      get closed() {
        return readClosed()
      },
      subscribe: (listener) => {
        this.#incoming.add(listener, () => undefined)
        return () => {
          this.#incoming.remove(listener, () => undefined)
        }
      },
      observe: (next) => this.#observe(next),
      send: (value, options?: IHostPhysicalSendOptions) => this.#send(value, options),
      close: this.#close
    }
  }

  /** Borrow existing physical gates before encoding, chunking or protection; no queue is added. */
  #createGate(): IRpcOutboundGate {
    return {
      run: async (...args) => {
        await enterPhysicalGate({ selected: this.#select(args[0]), args }, 0)
      },
      onEvent: (listener) => {
        this.#diagnostics.add(listener, () => undefined)
        return () => this.#diagnostics.remove(listener, () => undefined)
      },
      close() {}
    }
  }

  /** Describe only the constructed logical boundary; peers retain independent accepted agreements. */
  #createChannel(): IRuntimePeerSourceResult {
    return Object.freeze({
      transport: this.#transport,
      peerId: this.#self.instanceId,
      scheduler: systemScheduler,
      agreement: Object.freeze({
        source: 'static' as const,
        codec: identityCodec.id,
        capabilities: this.#capabilities
      }),
      pipeline: Object.freeze({ codec: identityCodec, framer: messageFramerV1 }),
      features: [],
      activateReceive: () => this.#activate(),
      close: this.#close
    })
  }

  /** Activate original held receive handoffs only after the endpoint's logical subscription exists. */
  #activate(): void {
    if (this.#activated || this.#closed) return
    this.#activated = true
    for (const source of Array.from(this.#sources.values()))
      if (this.#sources.get(source.channel.peerId) === source) source.channel.activateReceive?.()
  }

  /** Attach before subscribing/activating so actual peer facts exist during every startup callback. */
  #attach(physical: IRuntimePeerSourceResult): () => void {
    this.#assertAttach(physical.peerId)
    /** One resource owner retains the original source token and all native unsubscribe receipts. */
    const attachment = new HostPhysicalAttachment(this, physical)
    this.#sources.set(physical.peerId, attachment.value)
    this.#tokens.add(attachment.value.token)
    try {
      return attachment.start()
    } catch (error) {
      try {
        attachment.detach()
      } catch (cleanup) {
        this.reportFailure(cleanup)
      }
      throw error
    }
  }

  /** Expose the same frozen logical channel and callback record used by the original Host. */
  surface(): IHostMultiplexTransport {
    return Object.freeze({
      channel: this.#channel,
      assertAttach: (peerId) => this.#assertAttach(peerId),
      supports: (peerId, capability) =>
        this.#capabilitiesForPeer(peerId)?.includes(capability) ?? false,
      onDeparture: (listener) => {
        this.#departures.add(listener)
        return () => {
          this.#departures.delete(listener)
        }
      },
      close: this.#close,
      attach: (physical) => this.#attach(physical)
    })
  }
}

/** Reuse the actual physical codec/framer resources beneath one logical endpoint identity. */
export function createHostMultiplexTransport(
  self: IRuntimePeerIdentity,
  report: (error: unknown) => void
): IHostMultiplexTransport {
  return new HostMultiplexTransport(self, report).surface()
}
