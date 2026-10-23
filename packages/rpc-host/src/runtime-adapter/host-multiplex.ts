import { hostRethrowReporter } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import {
  bindRpcFrameIngress,
  messageFramerV1,
  readRpcBatchMembers
} from '@migaia/rpc-contract/framing'
import { RpcBatchPhysical, RpcCapability } from '@migaia/rpc-contract'
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
  registerPeerTransportCapabilities
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

/**
 * Adapt the real per-channel codec/framer boundary to one logical identity/message transport.
 * Detachment revokes source proof and subscriptions only; native resources remain receipt-owned.
 */
export function createHostMultiplexTransport(
  self: IRuntimePeerIdentity,
  report: (error: unknown) => void
): IHostMultiplexTransport {
  /** Only held, currently attached physical channel identities can route or prove an inbound source. */
  const sources = new Map<string, IHostPhysicalSource>()
  /** Exact private tokens cannot be reconstructed from a peer name, envelope or copied record. */
  const tokens = new WeakSet<object>()
  /** Logical endpoint subscriptions reuse the existing snapshot/reentrancy owner. */
  const incoming = createMessageListenerHub<IRpcInboundMessage>()
  /** Endpoint observation borrows events from each original physical gate without another queue. */
  const diagnostics = createMessageListenerHub<unknown>()
  /** Physical departure observations do not turn one failed source into a host-wide transport error. */
  const departures = new Set<(peerId: string, error: unknown) => unknown>()
  /** This logical boundary implements native transfer, while each target retains its own authority. */
  const capabilities = Object.freeze([
    ...RUNTIME_API_CAPABILITIES,
    RpcCapability.nativeBinary,
    RpcCapability.transfer
  ])
  /** The existing original channel handoff is activated after the logical endpoint subscribes. */
  let activated = false
  /** Terminal close immediately revokes new sends, attachments and source proof. */
  let closed = false
  /** Repeated channel and adapter close calls return the exact same terminal Promise. */
  let closing: Promise<void> | undefined
  /** The kernel lends its one genuine carrier observer to current and subsequently attached I/O. */
  let carrierProbe: IRpcCarrierProbe | undefined

  /** Admission must precede the host's session inventory mutation and native receive activation. */
  const assertAttach = (peerId: string): void => {
    if (closed)
      throw createRpcError(RpcCoreErrorCode.endpointDisposed, RpcCoreErrorText.endpointDisposed)
    if (sources.has(peerId))
      throw createRpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcCoreErrorText.unknownTarget(peerId)
      )
  }

  /** Reporter failure follows the existing host rethrow policy without replacing the original error. */
  const reportFailure = (error: unknown): void =>
    observeListener(
      () => report(error),
      (failure) => hostRethrowReporter(failure, IpcReporterContext)
    )

  /** Capability strings never manufacture native backing ownership on an unqualified carrier. */
  const capabilitiesForPeer = (peerId: string): readonly string[] => {
    /** This borrows the original held channel rather than copying or retaining another peer catalog. */
    const source = sources.get(peerId)
    if (closed || !source) return []
    /** The channel's accepted agreement remains the sole semantic authority for that physical peer. */
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

  /** The selected channel's original codec/framer performs all physical representation conversion. */
  const write = async (
    source: IHostPhysicalSource,
    value: unknown,
    options?: IRpcSendOptions
  ): Promise<void> => {
    if (closed || sources.get(source.channel.peerId) !== source)
      throw createRpcError(
        RpcCoreErrorCode.targetUnknown,
        RpcCoreErrorText.unknownTarget(source.channel.peerId)
      )
    /** Codec failure identity remains owned by the original selected codec. */
    const encoded = source.channel.pipeline.codec.encode(value)
    /** Each source retains its own framer and correlation namespace. */
    const frames = source.channel.pipeline.framer.frame(encoded, {
      source: self.instanceId,
      messageId: messageIdOf(value)
    })
    if (options?.transfer?.length && frames.length !== 1)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.transferUnsupportedForChunking
      )
    for (const frame of frames) {
      if (closed || sources.get(source.channel.peerId) !== source)
        throw createRpcError(
          RpcCoreErrorCode.targetUnknown,
          RpcCoreErrorText.unknownTarget(source.channel.peerId)
        )
      await source.channel.transport.send(frame, options)
    }
  }

  /**
   * Targeted frames never fall back to another peer; untargeted control frames snapshot live
   * sources.
   */
  const select = (value: unknown, targetId?: string): readonly IHostPhysicalSource[] => {
    /** Protected opaque frames require the sender's existing out-of-band selection context. */
    const route = routeOf(value)
    if (targetId === undefined && route === undefined)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** The semantic owner supplies physical instance ids, never display names, at this edge. */
    const selected = targetId ?? route?.targetId
    if (selected === undefined) return [...sources.values()]
    /** A departing source cannot accidentally route through its same-name successor. */
    const source = sources.get(selected)
    if (!source)
      throw createRpcError(RpcCoreErrorCode.targetUnknown, RpcCoreErrorText.unknownTarget(selected))
    return [source]
  }

  /** Share one terminal subscription release; original channels and framers are not closed here. */
  const close = (): Promise<void> => {
    if (closing) return closing
    closed = true
    closing = Promise.resolve().then(() => {
      /** Every source release is attempted even when one native unsubscribe throws. */
      const failures = collectListenerCleanupFailures(
        [...sources.values()].map((source) => source.detach)
      )
      incoming.clear(() => undefined)
      diagnostics.clear(() => undefined)
      departures.clear()
      /** The canonical listener boundary retains all exact native cleanup errors. */
      const failure = createListenerFailure(failures, { code: RpcCoreErrorCode.transport })
      if (failure) throw failure
    })
    return closing
  }

  /** This is the sole logical transport, with no peer registry beyond attached physical resources. */
  const transport: IRpcTransport = {
    platform: RpcPlatform.memory,
    topology: RpcTransportTopology.multiplexed,
    ownership: RpcTransportOwnership.borrowed,
    sourceProof: (source) =>
      !closed && typeof source === 'object' && source !== null && tokens.has(source),
    get closed() {
      return closed
    },
    subscribe(listener) {
      incoming.add(listener, () => undefined)
      return () => {
        incoming.remove(listener, () => undefined)
      }
    },
    /** Physical adapters retain observation ownership; no event forwarding probe is constructed. */
    observe(next) {
      carrierProbe = next
      /** Every native observation release is attempted even if one physical adapter fails. */
      const update = (probe?: IRpcCarrierProbe): void => {
        /** Existing listener cleanup retains the exact native failures without another owner. */
        const failure = createListenerFailure(
          collectListenerCleanupFailures(
            [...sources.values()].map((source) => () => source.observe(probe))
          ),
          { code: RpcCoreErrorCode.transport }
        )
        if (failure) throw failure
      }
      update(next)
      return () => {
        if (carrierProbe !== next) return
        carrierProbe = undefined
        update()
      }
    },
    async send(value, options?: IHostPhysicalSendOptions) {
      if (closed)
        throw createRpcError(RpcCoreErrorCode.endpointDisposed, RpcCoreErrorText.endpointDisposed)
      /** A sender-provided target survives authentication without being serialized into the frame. */
      if (options?.targetId !== undefined) {
        await write(select(value, options.targetId)[0]!, value, options)
        return
      }
      /** Canonical batch parsing leaves every member's semantic validation with the endpoint. */
      const members = readRpcBatchMembers(value)
      if (members === undefined) {
        await Promise.all(select(value).map((source) => write(source, value, options)))
        return
      }
      /** Per-target buckets retain original member order and cannot mix physical pipelines. */
      const buckets = new Map<IHostPhysicalSource, unknown[]>()
      for (const member of members)
        for (const source of select(member)) {
          /** This bucket contains only frames destined for one actual physical channel. */
          const bucket = buckets.get(source) ?? []
          if (!buckets.has(source)) buckets.set(source, bucket)
          bucket.push(member)
        }
      await Promise.all(
        [...buckets].map(async ([source, bucket]) => {
          if (source.channel.agreement.capabilities.includes(RpcCapability.batch))
            await write(
              source,
              { kind: RpcBatchPhysical.kind, [RpcBatchPhysical.members]: bucket },
              options
            )
          else for (const member of bucket) await write(source, member, options)
        })
      )
    },
    close
  }
  /** Whole envelopes enter their actual physical gates before encoding, chunking or protection. */
  const gate: IRpcOutboundGate = {
    async run(envelope, sendNow, admission) {
      /** A targeted operation reserves only its own connection's existing lane. */
      const selected = select(envelope)
      /** Untargeted control reserves each recipient once while performing its single logical send. */
      const enter = (index: number): void | Promise<void> => {
        if (index === selected.length) return sendNow()
        const physical = readOutboundGate(selected[index]!.channel.transport)
        return physical
          ? physical.run(envelope, () => enter(index + 1), admission)
          : enter(index + 1)
      }
      await enter(0)
    },
    onEvent(listener) {
      diagnostics.add(listener, () => undefined)
      return () => diagnostics.remove(listener, () => undefined)
    },
    /** Original channel receipts retain gate closure and its accepted-send failure policy. */
    close() {}
  }
  registerMultiplexedOutboundGate(transport, gate)
  registerBatchAgreement(transport, capabilities)
  registerCloneTransferCarrier(transport)
  registerPeerTransportCapabilities(transport, capabilitiesForPeer)
  /** The logical agreement describes this actual constructed endpoint boundary, not any peer's set. */
  const channel: IRuntimePeerSourceResult = Object.freeze({
    transport,
    peerId: self.instanceId,
    scheduler: systemScheduler,
    agreement: Object.freeze({
      source: 'static' as const,
      codec: identityCodec.id,
      capabilities
    }),
    pipeline: Object.freeze({ codec: identityCodec, framer: messageFramerV1 }),
    features: [],
    activateReceive() {
      if (activated || closed) return
      activated = true
      for (const source of Array.from(sources.values()))
        if (sources.get(source.channel.peerId) === source) source.channel.activateReceive?.()
    },
    close
  })

  return Object.freeze({
    channel,
    assertAttach,
    supports: (peerId, capability) => capabilitiesForPeer(peerId).includes(capability),
    onDeparture(listener) {
      departures.add(listener)
      return () => {
        departures.delete(listener)
      }
    },
    close,
    attach(physical) {
      assertAttach(physical.peerId)
      /** The token proves only this exact attachment and is revoked before native unsubscription. */
      const token = Object.freeze({})
      /** The canonical ingress owner supplies native fragment identity without a duplicate parser. */
      const prepareIngress = bindRpcFrameIngress(
        physical.pipeline.framer.accept,
        physical.pipeline.framer.frame
      )
      /** Removers arrive only after their native registration succeeds. */
      const removals: (() => void)[] = []
      /** Detach remains idempotent even if a native removal throws. */
      let detached = false
      /** Only the original physical transport owns this observation's unsubscribe receipt. */
      let removeObservation: (() => void) | undefined
      /** Replace or release the same native observer without an emit wrapper or copied event. */
      const observe = (probe?: IRpcCarrierProbe): void => {
        /** Clear ownership before calling native cleanup so failure cannot retain a stale receipt. */
        const previous = removeObservation
        removeObservation = undefined
        previous?.()
        if (probe) removeObservation = physical.transport.observe?.(probe)
      }
      removals.push(() => observe())
      /** Registration rollback and explicit removal share this subscription-only owner. */
      const detach = (): void => {
        if (detached) return
        detached = true
        tokens.delete(token)
        if (sources.get(physical.peerId) === source) sources.delete(physical.peerId)
        /** Native listener failures remain exact originals in the canonical cleanup aggregate. */
        const failure = createListenerFailure(collectListenerCleanupFailures(removals), {
          code: RpcCoreErrorCode.transport
        })
        if (failure) throw failure
      }
      /** One physical error revokes this resource only; the host owner handles session departure. */
      const departed = (error: unknown): void => {
        if (detached) return
        try {
          detach()
        } catch (cleanup) {
          reportFailure(cleanup)
        }
        reportFailure(error)
        for (const listener of Array.from(departures))
          observeListener(() => listener(physical.peerId, error), reportFailure)
      }
      /** Cold capture is installed before activation; no second receive queue is introduced. */
      const source: IHostPhysicalSource = Object.freeze({
        channel: physical,
        token,
        observe,
        detach
      })
      sources.set(physical.peerId, source)
      tokens.add(token)
      try {
        if (carrierProbe)
          try {
            observe(carrierProbe)
          } catch (error) {
            /** Observation failures follow the installed probe's original non-business report path. */
            const emitter = readInstalledProbe(transport)
            if (emitter) emitter.report(error)
            else reportFailure(error)
          }
        /** Both native diagnostics consumers observe the same original gate and event instances. */
        const physicalGate = readOutboundGate(physical.transport)
        if (physicalGate)
          removals.push(
            physicalGate.onEvent((event) =>
              diagnostics.dispatch(event, (listener, value) =>
                observeListener(() => listener(value), reportFailure)
              )
            )
          )
        const removeDiagnostics = activateIpcConnectionDiagnostics(physical.transport)
        if (removeDiagnostics) removals.push(removeDiagnostics)
        removals.push(
          physical.transport.subscribe((message) => {
            if (detached || closed) return
            try {
              /** Each original framer isolates partial assemblies using the physical peer identity. */
              const prepared = prepareIngress(message.data, {
                source: physical.peerId,
                messageId: 'whole'
              })
              /** Native accept receives the same admitted fragment id as its original ingress. */
              const accepted = physical.pipeline.framer.accept(prepared.frame, {
                source: physical.peerId,
                messageId: prepared.messageId
              })
              if (accepted.status === 'pending') return
              if (accepted.status === 'rejected') {
                reportFailure(accepted.error)
                return
              }
              /** Logical codec/protocol admission runs after this physical source's decoder. */
              const data = physical.pipeline.codec.decode(accepted.value)
              incoming.dispatch(
                { data, peerId: physical.peerId, source: token },
                (listener, frame) => observeListener(() => listener(frame), reportFailure)
              )
            } catch (error) {
              reportFailure(error)
            }
          })
        )
        if (physical.transport.onTransportError) {
          /**
           * Native error observation may synchronously report departure before yielding its
           * remover.
           */
          const removeError = physical.transport.onTransportError(departed)
          if (detached) removeError()
          else removals.push(removeError)
        }
        if (activated && !detached) physical.activateReceive?.()
        return detach
      } catch (error) {
        try {
          detach()
        } catch (cleanup) {
          reportFailure(cleanup)
        }
        throw error
      }
    }
  })
}
