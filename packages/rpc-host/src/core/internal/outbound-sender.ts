import { RemoteMethodName } from '@migaia/rpc-contract/remote'
import { RpcTransportTopology, type IRpcPlatformValue } from '../transport-constants.js'
import { carrierSizeBytes } from '../adapters/probe-content.js'
import {
  createRpcAuthenticationError,
  createRpcError,
  createRpcSerializationError,
  createRpcTransportError,
  isLocalRpcError,
  RpcAuthenticationError,
  RpcCoreErrorCode,
  RpcLifecycleError,
  RpcSerializationError,
  RpcTransportError
} from '../errors.js'
import {
  selectedJsonObjectPort,
  jsonObjectCandidate,
  type IRpcJsonObjectPort
} from './json-object-port.js'
import {
  isAuthenticationCounterExhaustion,
  bindAuthenticationOutboundFrame,
  readAuthenticationChallengePort,
  readAuthenticationBinaryDigest
} from './authentication-replay.js'

import type {
  IRpcAuthenticationCapability,
  IRpcAuthenticationContext,
  ISendOptions
} from '../typing.js'
import type { IRpcSendOptions, IRpcTransport } from '../transport.js'
import { isUint8Array } from './safe-value.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcSelectedComponents } from './endpoint-options.js'
import { RpcEnvelopeKind, type IRpcEnvelope } from '@migaia/rpc-contract'
import type { IRpcOutboundAdmission, IRpcOutboundGate } from './outbound-gate.js'
import {
  registerBatchWriter,
  type IRpcPeerTransportPipeline,
  type IBatchWriteGuard
} from './batch-frame.js'
import { RpcBatchPhysical, RpcCapability } from '@migaia/rpc-contract'
import { hasRpcBinaryEnvelope } from '@migaia/rpc-contract/binary/inspect'
import { assertRpcNativeBinaryFrameSize } from '@migaia/rpc-contract/binary/inspect'
import { prepareRpcBinary } from '@migaia/rpc-contract/binary/lazy'
import type { IRpcBinaryDataCodec, IRpcBinaryManifest } from '@migaia/rpc-contract/binary/lazy'
import { RpcBinaryStorage } from '@migaia/rpc-contract/framing/v1'
import { RpcNativeBinaryKind } from '@migaia/rpc-contract/framing/v1'
import { hasFastComponents, readFastInlineEncoder } from './fast-path.js'
import {
  prepareOwnedJsonSnapshot,
  prepareOwnedBinaryJsonSnapshot,
  readOwnedJsonSnapshot
} from './outbound-owned-codec.js'
import { isArrayBuffer } from '@migaia/utils/bytes'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import {
  measureRpcPhysicalFrame,
  assertRpcPhysicalFrameSize,
  inspectRpcPhysicalFrame,
  type IRpcPhysicalFrameInspection
} from '@migaia/rpc-contract/framing'
import { resolveAbortReason } from './async-control.js'
import {
  isOutboundEnvelope,
  isRuntimeOutboundEnvelope,
  createRuntimeOutboundEnvelope,
  outboundJsonByteUpperBound
} from './outbound-envelope.js'
import type { IAuthenticationChallengeFields } from './authentication-replay.js'
import { runtimeOperationCapabilities, wrapRuntimeCarrier } from '@migaia/rpc-contract/runtime'
import { RpcRuntimeKind } from '@migaia/rpc-contract/framing/v1'
import type { IRpcRuntimeEnvelope } from '@migaia/rpc-contract'
import { bindRpcFrameIngress } from '@migaia/rpc-contract/framing'
import { RpcProbeDirection, RpcProbeOutcome, RpcProbeStage } from '../probe/constants.js'
import { envelopeProbeKind, runtimeProbeKind, type IProbeEmitter } from './probe-emitter.js'

/** Fixed native selector/wrapper JSON geometry excludes only the protected metadata slot. */
const nativeBinaryJsonOverhead =
  JSON.stringify(
    wrapRuntimeCarrier({ kind: RpcNativeBinaryKind, protectedMetadata: null, sidecars: [] })
  ).length - 4

/** Whole-object runtime carriers add only the fixed kind/frame selector around owned metadata. */
const runtimeObjectJsonOverhead = JSON.stringify(wrapRuntimeCarrier(null)).length - 4

/** The private physical batch wrapper has fixed ASCII keys and an initially empty member array. */
const batchJsonOverhead = measureRpcPhysicalFrame({
  kind: RpcBatchPhysical.kind,
  [RpcBatchPhysical.members]: []
})

/** Immutable member snapshots contribute their existing one-walk bounds to the same batch record. */
function ownedBatchByteUpperBound(entries: readonly IQueuedEnvelope[]): number | undefined {
  /** Array brackets belong to the fixed wrapper; only separating commas are added here. */
  let bound = batchJsonOverhead + Math.max(0, entries.length - 1)
  /** A record preserves independent admission, cancellation and completion ownership. */
  for (const entry of entries) {
    /** A custom/opaque member never inherits another envelope's owned snapshot proof. */
    const member = outboundJsonByteUpperBound(entry.message)
    if (member === undefined) return undefined
    bound += member
  }
  return bound
}

/** An owned metadata bound charges every sidecar's original empty-object representation and bytes. */
function ownedNativeBinaryByteUpperBound(
  metadata: unknown,
  sidecarCount: number,
  backingBytes: number
): number | undefined {
  /** Opaque/custom protection output retains the original exact measurement below. */
  const prepared = readOwnedJsonSnapshot(metadata)
  return prepared
    ? nativeBinaryJsonOverhead +
        prepared.byteUpperBound +
        sidecarCount * 2 +
        Math.max(0, sidecarCount - 1) +
        backingBytes
    : undefined
}

/** One logical settlement remains owned until its actual physical write completes. */
type IQueuedEnvelope = {
  message: IRpcEnvelope
  transfer: readonly unknown[] | undefined
  readonly options: ISendOptions | undefined
  readonly admission: IRpcOutboundAdmission | undefined
  readonly beforeWrite: (() => IRpcEnvelope) | undefined
  readonly onStarted: (() => void) | undefined
  readonly guard: IBatchWriteGuard | undefined
  /** Cold protocol frames wait in this existing sender until their actual gate admission. */
  readonly deferredGate?: true
  /** Original gate settlement releases capacity before the next cold frame reserves it. */
  gateSettled?: Promise<void>
  /** Only waiting entries retain a queued cancellation listener. */
  cancelQueued?: () => void
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

/** Cold protocol traffic shares the original sender queue without admitting user business early. */
function isColdProtocol(message: IRpcEnvelope): boolean {
  return (
    message.kind === RpcEnvelopeKind.discovery ||
    ((message.kind === RpcEnvelopeKind.request || message.kind === RpcEnvelopeKind.response) &&
      (message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method) ===
        RemoteMethodName.runtimeDescribe)
  )
}

/** One complete encoded/protected physical value retains its exact logical settlements. */
type IPreparedBatch = Readonly<{
  entries: IQueuedEnvelope[]
  value: unknown
  /** Only immutable strings may reuse this pre-protection bound through an identity signer. */
  byteUpperBound?: number
}>

/** The sender becomes idle in the same reaction as its final actual host-write settlement. */
type IPhysicalDrain = { pending: number; preparing: boolean; finish(): void }

/** A cursor retains an existing prepared suffix without copying it for each physical write. */
type IPreparedBatchCursor = {
  readonly frames: readonly IPreparedBatch[]
  index: number
  readonly continuation?: IPreparedBatchCursor
}

/** One actual host write retains its generation and the original admission failure identity. */
type IPhysicalWriteRecord = {
  readonly value: unknown
  readonly transfer: readonly unknown[] | undefined
  readonly generation: number | undefined
  readonly beforeSend: (() => void) | undefined
  readonly immediate: boolean
  admissionFailure: unknown
  /** Runtime preparation supplies its existing start admission without a per-frame callback. */
  runtimeStart?: IRuntimeWriteRecord
  /** Only the first physical chunk carries its existing logical envelope's sent observation. */
  message?: IRpcEnvelope
}

/** One runtime frame retains captured codec/auth/backing facts through its actual write. */
type IRuntimeWriteRecord = Readonly<{
  envelope: IRpcRuntimeEnvelope
  binary: boolean
  transferRequested: boolean
  transfer: readonly unknown[] | undefined
  native: boolean
  digest: ReturnType<typeof readAuthenticationBinaryDigest>
  codec: IRpcPeerTransportPipeline['codec']
  framer: IRpcSelectedComponents['framer']
  generation: number | undefined
  limit: number
  admission: IRpcOutboundAdmission | undefined
  onStarted: (() => void) | Readonly<{ started(): void }> | undefined
  onPrepared: (() => Promise<void>) | undefined
}>

/** The selected codec's exact encoded result and native backing accounting for one runtime frame. */
type IRuntimeEncodedFrame = Readonly<{
  encoded: unknown
  sidecars: readonly ArrayBuffer[]
  backingBytes: number
  encodedByteUpperBound: number | undefined
}>

/** Minimal canonical send port consumed by the outbound owner. */
export type IRpcOutboundTransport = {
  readonly platform: IRpcPlatformValue
  readonly encodedType?: IRpcTransport['encodedType']
  send(message: unknown, options?: IRpcSendOptions): void | Promise<void>
} & Partial<Omit<IRpcTransport, 'send' | 'platform' | 'encodedType'>>

/** Optional kernel lifecycle surface used to reject frames captured before endpoint close. */
type IRpcOutboundLifecycle = Readonly<{
  readonly generation: number
  assertActive(generation?: number): void
}>

/** Owns outbound protocol encoding, chunk framing, and transport error classification. */
export class RpcOutboundSender {
  readonly transport: IRpcOutboundTransport
  readonly id: string
  readonly components: IRpcSelectedComponents
  readonly authentication: IRpcAuthenticationCapability | undefined
  /** Cold installation supplies the one endpoint emitter; stage checks never query plugin ports. */
  readonly #probe: IProbeEmitter | undefined
  /** Captures the validated transport payload discriminant for every outbound frame. */
  readonly #transportEncodedType: IRpcTransport['encodedType']
  /** Captures the kernel lifecycle once so every asynchronous send phase shares one generation. */
  readonly #lifecycle: IRpcOutboundLifecycle | undefined
  /** Optional whole-envelope admission keeps plugin capacity outside the core codec pipeline. */
  readonly #gate: IRpcOutboundGate | undefined
  /** Once-selected private data port; public transport and descriptor snapshots remain unchanged. */
  readonly #objectPort: IRpcJsonObjectPort | undefined
  /** Genuine bridge identity survives an optional object-port optimization falling back to strings. */
  readonly #bridge: boolean
  /** Existing endpoint diagnostics observe genuine local counter exhaustion before rejection. */
  readonly #reportConfiguration: ((error: unknown) => void) | undefined
  /** Exact endpoint proof bypasses generic fanout only for ordinary request/response envelopes. */
  readonly #fast: boolean
  /** Completed carrier agreement and canonical components permit physical grouping only. */
  readonly #batch: boolean
  /** Exact negotiated adapter overhead is included without estimating any semantic member. */
  readonly #physicalLimit: number
  /** Only the original native adapter receipt authorizes a real clone/transfer boundary. */
  readonly #cloneTransfer: boolean
  /** A routed carrier borrows each selected physical agreement instead of a host-wide capability. */
  readonly #capabilitiesForPeer: ((peerId: string) => readonly string[] | undefined) | undefined
  /** Routed native sends borrow the original codec/framer pair from the admitted physical owner. */
  readonly #pipelineForPeer: ((peerId: string) => IRpcPeerTransportPipeline | undefined) | undefined
  /** The framing owner supplies limits while binding the actual selected callable pair once. */
  readonly #singleFrameLimits:
    | Readonly<{
        maxConcurrentMessages: number
        maxMessageBytes: number
      }>
    | undefined
  /** Busy physical writes accumulate ready requests and responses in this single owner. */
  #writing = false
  /** Insertion-ordered semantic settlements support direct cancellation without queue scans. */
  #queued = new Set<IQueuedEnvelope>()

  constructor(
    transport: IRpcOutboundTransport,
    id: string,
    components: IRpcSelectedComponents,
    authentication?: IRpcAuthenticationCapability,
    platform: IRpcPlatformValue = transport.platform,
    gate?: IRpcOutboundGate,
    reportConfiguration?: (error: unknown) => void,
    fast = false,
    batch = false,
    physicalLimit = RpcBatchPhysical.maxBytes,
    receiverId = id,
    cloneTransfer = false,
    probe?: IProbeEmitter,
    capabilitiesForPeer?: (peerId: string) => readonly string[] | undefined,
    pipelineForPeer?: (peerId: string) => IRpcPeerTransportPipeline | undefined
  ) {
    this.transport = transport
    this.id = id
    this.components = components
    this.#objectPort = selectedJsonObjectPort(components)
    this.#bridge = jsonObjectCandidate(components) !== undefined
    this.authentication = authentication
    this.#probe = probe
    this.#transportEncodedType = transport.encodedType
    this.#gate = gate
    this.#reportConfiguration = reportConfiguration
    this.#fast = fast && authentication === undefined
    this.#batch = batch
    this.#physicalLimit = physicalLimit
    this.#cloneTransfer = cloneTransfer
    this.#capabilitiesForPeer = capabilitiesForPeer
    this.#pipelineForPeer = pipelineForPeer
    this.#singleFrameLimits = this.#objectPort
      ? bindRpcFrameIngress(this.#objectPort.framer.accept, this.#objectPort.framer.frame)
          .singleFrameLimits
      : components.ingressPrepare.singleFrameLimits
    this.#receiverId = receiverId
    const lifecycle = transport as Partial<IRpcOutboundLifecycle>
    this.#lifecycle =
      typeof lifecycle.assertActive === 'function' && typeof lifecycle.generation === 'number'
        ? (lifecycle as IRpcOutboundLifecycle)
        : undefined
    this.#authenticationContext = Object.freeze({
      direction: 'outbound',
      endpointId: id,
      platform
    })
  }

  /** Stable context passed to every outbound authentication transform. */
  readonly #authenticationContext: IRpcAuthenticationContext
  /** Original outbound identity supplies reverse freshness without another discovery round trip. */
  readonly #receiverId: string

  /** Protects a payload-free rejection through the existing physical sender and error policy. */
  sendAuthenticationControl(fields: IAuthenticationChallengeFields): Promise<void> {
    /** A late signature cannot send through a replacement endpoint generation. */
    const generation = this.#lifecycle?.generation
    /** Receiver freshness is selected by the same original auth context owner for either profile. */
    const context = { ...this.#authenticationContext }
    bindAuthenticationOutboundFrame(context, undefined, this.#receiverId, fields)
    /** Control protection retains the category required by the existing codec/carrier pair. */
    const encodedType =
      this.#transportEncodedType === 'any' || this.#transportEncodedType === undefined
        ? this.components.codec.encodedType
        : this.#transportEncodedType
    /** The physical preparation retains its actual encoded value for opted-in observation. */
    const value =
      encodedType === 'uint8array' ? new Uint8Array() : encodedType === 'string' ? '' : undefined
    return this.#prepareTransportValue(value, undefined, false, generation, context).then(
      (protectedValue) => this.#sendPreparedTransport(protectedValue, undefined, generation)
    )
  }

  /** Prepare one opt-in semantic frame through the original codec/framer/auth/write owners. */
  assertRuntimeTransfer(
    capabilities: readonly string[],
    options?: Pick<ISendOptions, 'transfer'>
  ): void {
    if (!options || !Object.hasOwn(options, 'transfer')) return
    if (!this.#nativeBinaryEnabled(capabilities) || !capabilities.includes(RpcCapability.transfer))
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
  }

  /** Only exact canonical component/config/carrier facts may select the native representation. */
  #nativeBinaryEnabled(capabilities: readonly string[]): boolean {
    return (
      this.#cloneTransfer &&
      readAuthenticationBinaryDigest(this.authentication) !== undefined &&
      (hasFastComponents(this.components) || this.#objectPort !== undefined) &&
      (this.#objectPort?.codec ?? this.components.codec).encodedType === 'unknown' &&
      capabilities.includes(RpcCapability.portableBinary) &&
      capabilities.includes(RpcCapability.nativeBinary)
    )
  }

  /** Prepare one opt-in semantic frame through the original codec/framer/auth/write owners. */
  async sendRuntime(
    message: IRpcRuntimeEnvelope,
    capabilities: readonly string[],
    admission?: IRpcOutboundAdmission,
    onStarted?: (() => void) | Readonly<{ started(): void }>,
    onPrepared?: () => Promise<void>,
    transferOptions?: Pick<ISendOptions, 'transfer'>
  ): Promise<void> {
    /** All permission-bearing fields are snapshotted before any async signature or gate handoff. */
    const envelope = isRuntimeOutboundEnvelope(message)
      ? message
      : createRuntimeOutboundEnvelope(message)
    /** The same physical destination controls native storage and required mode admission. */
    const selectedCapabilities =
      this.#capabilitiesForPeer?.(envelope.route.targetId) ?? capabilities
    /** Proof is minted during portable normalization, so ordinary calls never scan a binary graph. */
    const binary = hasRpcBinaryEnvelope(envelope)
    /**
     * Own presence, including [], selects native ownership semantics instead of an inline
     * downgrade.
     */
    const transferRequested =
      transferOptions !== undefined && Object.hasOwn(transferOptions, 'transfer')
    this.assertRuntimeTransfer(selectedCapabilities, transferOptions)
    /** The original snapshot is read before gate, digest or authentication can yield. */
    const transfer = transferRequested ? (this.#snapshotTransfer(transferOptions) ?? []) : undefined
    /**
     * Canonical config facts exclude encrypt/opaque capabilities and byte/string/custom codec
     * mappings.
     */
    const digest = readAuthenticationBinaryDigest(this.authentication)
    const native = (binary || transferRequested) && this.#nativeBinaryEnabled(selectedCapabilities)
    if (transfer) {
      const unique = new Set<object>()
      for (const backing of transfer) {
        if (!isArrayBuffer(backing) || unique.has(backing))
          throw createRpcSerializationError(RpcCoreErrorText.invalidTransferList)
        unique.add(backing)
      }
    }
    /** These labels come from the accepted channel intersection, never from one-sided offers. */
    const required = runtimeOperationCapabilities(
      envelope.task.mode,
      'options' in envelope ? envelope.options : {}
    )
    if (
      required.some((capability) => !selectedCapabilities.includes(capability)) ||
      (binary && !selectedCapabilities.includes(RpcCapability.portableBinary)) ||
      (this.#bridge && envelope.kind === RpcRuntimeKind.group)
    )
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** The selected private/public frame pair must have actual first-party whole-accept facts. */
    const pipeline = this.#pipelineForPeer?.(envelope.route.targetId)
    /** Capture physical encoding before any gate, binary preparation or protection can yield. */
    const codec = pipeline?.codec ?? this.#objectPort?.codec ?? this.components.codec
    /** The same actual peer owns both halves of the native whole-frame contract. */
    const framer = pipeline?.framer ?? this.#objectPort?.framer ?? this.components.framer
    /** No opaque callable is invoked merely to guess whether it fragments. */
    const facts = pipeline ? pipeline.ingressPrepare.singleFrameLimits : this.#singleFrameLimits
    if (!facts)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** Capture exact endpoint lifetime before queueing, never retarget a late prepared frame. */
    const generation = this.#lifecycle?.generation
    this.#lifecycle?.assertActive(generation)
    /** This whole byte bound already includes the original channel framing overhead. */
    const limit = Math.min(RpcBatchPhysical.maxBytes, this.#physicalLimit, facts.maxMessageBytes)
    /** The original gate owns physical FIFO/capacity; this branch never enters batch/chunk queues. */
    /** The same sender owns every captured fact; no replacement gate or queue is introduced. */
    const record: IRuntimeWriteRecord = {
      envelope,
      binary,
      transferRequested,
      transfer,
      native,
      digest,
      codec,
      framer,
      generation,
      limit,
      admission,
      onStarted,
      onPrepared
    }
    return this.#gate
      ? this.#gate.run(envelope, () => this.#writeRuntime(record), admission)
      : this.#writeRuntime(record)
  }

  /** Per-write binary metadata uses explicit sender/limit state and never captures a send frame. */
  static #SenderBinaryCodec = class SenderBinaryCodec implements IRpcBinaryDataCodec {
    /** This actual write's admitted physical limit stays explicit instead of closing over a send. */
    #limit: number
    /** The admitted physical destination retains its original codec through binary preparation. */
    #codec: IRpcPeerTransportPipeline['codec']
    /** Only this resource's actual first native metadata capture performs prehash admission. */
    #nativePreflightComplete = false
    /** The genuine selected Core components determine whether an owned JSON capture exists. */
    readonly captureJsonData: IRpcBinaryDataCodec['captureJsonData']
    /** The original platform encoder is read at the same selected-components point. */
    readonly encodeInline: IRpcBinaryDataCodec['encodeInline']

    /** Keep fast-path qualification private while exposing only actual codec operations. */
    constructor(
      sender: RpcOutboundSender,
      limit: number,
      codec: IRpcPeerTransportPipeline['codec']
    ) {
      this.#limit = limit
      this.#codec = codec
      /** Exact component identity, never a caller-provided flag, selects the existing snapshot. */
      const fast = codec === sender.components.codec && hasFastComponents(sender.components)
      this.encodeInline = fast ? readFastInlineEncoder(sender.components) : undefined
      this.captureJsonData = fast
        ? (manifest, roots, bytes) => this.#capture(manifest, roots, bytes)
        : undefined
    }

    /** Actual encoding keeps the original selected codec lookup and invocation point. */
    encode(manifest: unknown): unknown {
      return this.#codec.encode(manifest as IRpcEnvelope)
    }

    /** Capture real metadata and enforce this sender's held physical limit before hashing. */
    #capture(manifest: object, roots: ReadonlyMap<object, number>, bytes: number): unknown {
      prepareOwnedBinaryJsonSnapshot(manifest, roots)
      /** This manifest was constructed by Contract from this operation's actual captured data. */
      const binaryManifest = manifest as IRpcBinaryManifest
      if (binaryManifest.storage === RpcBinaryStorage.native && !this.#nativePreflightComplete) {
        /** The private snapshot bound cannot be supplied or copied by a third-party codec. */
        const bound = ownedNativeBinaryByteUpperBound(
          manifest,
          binaryManifest.backings.length,
          bytes
        )
        if (bound === undefined || bound > this.#limit)
          assertRpcNativeBinaryFrameSize(
            this.encode(manifest),
            binaryManifest.backings.length,
            bytes,
            this.#limit
          )
        this.#nativePreflightComplete = true
      }
      return readOwnedJsonSnapshot(manifest)!.value
    }
  }

  /** Stable sender preparation yields only for actual binary, crypto, sealing or physical work. */
  async #writeRuntime(record: IRuntimeWriteRecord): Promise<void> {
    const {
      envelope,
      binary,
      transferRequested,
      transfer,
      native,
      digest,
      generation,
      limit,
      admission,
      onPrepared
    } = record

    this.#lifecycle?.assertActive(generation)
    admission?.assertCanSend()
    /** Runtime normalization already produced the selected semantic envelope before preparation. */
    const p = this.#probe
    if (p !== undefined && (p.mask & (1 << RpcProbeStage.envelope)) !== 0)
      p.envelope(
        RpcProbeDirection.outbound,
        envelope.id,
        envelope.task.method,
        -1,
        (p.captureMask & (1 << RpcProbeStage.envelope)) !== 0 ? envelope : undefined,
        envelope.route.senderId
      )
    /** Only the original binary preparation path yields; ordinary encoding stays synchronous. */
    let encoding: IRuntimeEncodedFrame
    try {
      /** Only the exact canonical string codec consumes an owned JSON view; custom codecs stay full. */
      const ownedJson =
        record.codec === this.components.codec &&
        hasFastComponents(this.components) &&
        record.codec.encodedType === 'string'
      /** Worker keeps the original object; its exact canonical identity function needs no copy. */
      const ownedIdentity =
        hasFastComponents(this.components) &&
        this.#objectPort === undefined &&
        record.codec.encode === identityCodec.encode
      const prepared =
        binary || transferRequested
          ? await prepareRpcBinary(
              envelope,
              native ? RpcBinaryStorage.native : RpcBinaryStorage.inline,
              limit,
              digest,
              new RpcOutboundSender.#SenderBinaryCodec(this, limit, record.codec)
            )
          : undefined
      encoding = this.#encodeRuntime(record, prepared, ownedJson, ownedIdentity)
    } catch (cause) {
      throw createRpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    /** Protection and framing consume the exact original encoded value and backing identities. */
    const { encoded, sidecars, backingBytes, encodedByteUpperBound } = encoding
    /** Framing preserves the original single-frame profile and pre-protection sizing boundary. */
    const frame = this.#frameRuntime(record, encoding)
    /** Receiver freshness is selected by the same original auth context owner for either profile. */
    const context = { ...this.#authenticationContext }
    bindAuthenticationOutboundFrame(context, undefined, this.#receiverId, undefined, envelope.route)
    /** Complete protection and selector construction precede the sole physical write. */
    const protectedValue = this.authentication
      ? await this.#prepareTransportValue(
          frame,
          undefined,
          false,
          generation,
          context,
          envelope.id,
          -1,
          -1,
          envelope.task.method,
          envelope.route.senderId
        )
      : this.#unprotectedTransportValue(frame, generation)
    if (!this.authentication && p !== undefined && (p.mask & (1 << RpcProbeStage.frame)) !== 0)
      p.frame(
        RpcProbeDirection.outbound,
        envelope.id,
        carrierSizeBytes(frame),
        -1,
        -1,
        (p.captureMask & (1 << RpcProbeStage.frame)) !== 0
          ? this.#probeContent(frame, transfer)
          : undefined,
        envelope.task.method,
        envelope.route.senderId
      )
    /** Selector overhead is charged after auth, without splitting or re-signing this frame. */
    if (
      native &&
      (!protectedValue ||
        typeof protectedValue !== 'object' ||
        Array.isArray(protectedValue) ||
        isUint8Array(protectedValue) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(protectedValue)))
    )
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    const carrier = wrapRuntimeCarrier(
      native
        ? { kind: RpcNativeBinaryKind, protectedMetadata: protectedValue, sidecars }
        : protectedValue
    )
    /** Real post-protection string/byte lengths are safe bounds without inspecting payload text. */
    const finalBound = native
      ? this.authentication
        ? undefined
        : ownedNativeBinaryByteUpperBound(protectedValue, sidecars.length, backingBytes)
      : typeof carrier === 'string'
        ? carrier.length * 3
        : isUint8Array(carrier)
          ? carrier.byteLength
          : !this.authentication &&
              protectedValue === encoded &&
              encodedByteUpperBound !== undefined
            ? runtimeObjectJsonOverhead + encodedByteUpperBound
            : undefined
    if (finalBound === undefined || finalBound > limit) {
      /** Custom signer objects and inconclusive bounds retain complete original physical sizing. */
      if (native)
        assertRpcNativeBinaryFrameSize(protectedValue, sidecars.length, backingBytes, limit)
      else assertRpcPhysicalFrameSize(carrier, limit)
    }
    /** The original result owner can seal only this fully valid frame, before physical commit. */
    if (onPrepared) await onPrepared()
    return this.#writePreparedTransport({
      value: carrier,
      transfer,
      generation,
      beforeSend: undefined,
      immediate: true,
      admissionFailure: undefined,
      runtimeStart: record
    })
  }

  /** Observe encoded output and frame one admitted runtime envelope before protection. */
  #frameRuntime(record: IRuntimeWriteRecord, encoding: IRuntimeEncodedFrame): unknown {
    const { envelope, transfer, framer, limit } = record
    const { encoded, encodedByteUpperBound } = encoding
    /** Encoding and frame observations share the sender's originally selected endpoint emitter. */
    const p = this.#probe
    if (p !== undefined && (p.mask & (1 << RpcProbeStage.encoded)) !== 0)
      p.encoded(
        RpcProbeDirection.outbound,
        envelope.id,
        carrierSizeBytes(encoded),
        (p.captureMask & (1 << RpcProbeStage.encoded)) !== 0
          ? this.#probeContent(encoded, transfer)
          : undefined,
        envelope.task.method,
        envelope.route.senderId
      )
    /** Known string encodings reuse their preparation bound without a second character scan. */
    if (!(encodedByteUpperBound !== undefined && encodedByteUpperBound <= limit))
      assertRpcPhysicalFrameSize(encoded, limit)
    /** Native framing runs once; multiple fragments are refused before protection or host send. */
    const frames = framer.frame(encoded, { source: this.id, messageId: envelope.id })
    if (frames.length !== 1)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    return frames[0]
  }

  /** Encode an already prepared binary/ordinary envelope without adding an async boundary. */
  #encodeRuntime(
    record: IRuntimeWriteRecord,
    prepared: Awaited<ReturnType<typeof prepareRpcBinary>> | undefined,
    ownedJson: boolean,
    ownedIdentity: boolean
  ): IRuntimeEncodedFrame {
    const { envelope, transfer } = record
    /** The original selected codec produces the same semantic envelope representation. */
    let encoded: unknown
    /** Native preparation retains the original backing buffer identities. */
    let sidecars: readonly ArrayBuffer[] = []
    /** Unique backing bytes contribute to the existing physical frame budget. */
    let backingBytes = 0
    /** Only canonical owned snapshots may bypass a second encoded character scan. */
    let encodedByteUpperBound: number | undefined
    if (prepared) {
      sidecars = prepared.sidecars
      backingBytes = prepared.backingBytes
      /** Native transfer admission compares exact backing identities once per manifest. */
      const sidecarSet = transfer ? new Set(sidecars) : undefined
      if (transfer?.some((backing) => !sidecarSet!.has(backing as ArrayBuffer)))
        throw createRpcSerializationError(RpcCoreErrorText.invalidTransferList)
    }
    /** Ordinary large values get one owned JSON walk; binary preparation already retained its view. */
    const selected = prepared?.manifest ?? envelope
    if ((ownedJson || ownedIdentity) && !prepared) prepareOwnedJsonSnapshot(selected)
    encoded = record.codec.encode(selected as unknown as IRpcEnvelope)
    if (ownedJson || (hasFastComponents(this.components) && encoded === selected))
      encodedByteUpperBound = readOwnedJsonSnapshot(selected)?.byteUpperBound
    if (!this.#objectPort) this.assertProtocolEncodedType(encoded, record.codec.encodedType)
    return { encoded, sidecars, backingBytes, encodedByteUpperBound }
  }

  /**
   * Original sourceful/exclusive transforms reuse their stable context; only admitted challenge
   * facts require a receiver-specific snapshot.
   */
  #frameContext(frame: IRpcEnvelope): IRpcAuthenticationContext {
    if (!readAuthenticationChallengePort(this.authentication)?.contextNeeded(frame))
      return this.#authenticationContext
    /** Receiver freshness is selected by the same original auth context owner for either profile. */
    const context = { ...this.#authenticationContext }
    bindAuthenticationOutboundFrame(context, frame, this.#receiverId)
    return context
  }

  /** Encodes one semantic envelope once, then protects and sends each selected physical frame. */
  send(
    message: IRpcEnvelope,
    options?: ISendOptions,
    admission?: IRpcOutboundAdmission,
    beforeWrite?: () => IRpcEnvelope,
    onStarted?: () => void
  ): void | Promise<void> {
    if (this.#gate && isColdProtocol(message))
      return this.#enqueueProtocol(message, options, admission, beforeWrite, onStarted)
    if (this.#batch) {
      /** Only the idle writer releases busy ownership after its own original gate fully settles. */
      let ownsWriter = false
      /** A queued member borrows this exact gate Promise; no capacity lifetime is recreated. */
      let queuedEntry: IQueuedEnvelope | undefined
      /** The existing gate owns capacity; its closed check accompanies each queued member. */
      const write = registerBatchWriter((guard?: IBatchWriteGuard) => {
        if (!this.#writing) {
          guard?.()
          admission?.assertCanSend()
          const envelope = beforeWrite?.() ?? message
          this.#writing = true
          ownsWriter = true
          /** Idle traffic reuses the original single-frame owner without allocating a queued entry. */
          let sent: void | Promise<void>
          try {
            sent =
              this.#fast &&
              ((envelope.kind === RpcEnvelopeKind.request &&
                envelope.data.route.dispatchOnly !== true) ||
                envelope.kind === RpcEnvelopeKind.response)
                ? this.#sendFast(envelope, options, admission, onStarted, true)
                : this.#sendEnvelope(envelope, options, false, admission, onStarted, true)
          } catch (error) {
            sent = Promise.reject(error)
          }
          return Promise.resolve(sent)
        }
        return new Promise<void>((resolve, reject) => {
          /** A record preserves independent admission, cancellation and completion ownership. */
          const entry: IQueuedEnvelope = {
            message,
            transfer: undefined,
            options,
            admission,
            beforeWrite,
            onStarted,
            guard,
            resolve,
            reject
          }
          queuedEntry = entry
          this.#queueEntry(entry)
        })
      })
      const physical = Promise.resolve(
        this.#gate ? this.#gate.run(message, write, admission) : write()
      )
      /** Idle admission has already selected this sender's writer; reuse its original callbacks. */
      const settled = ownsWriter
        ? physical.then(this.#settleWriterSuccess, this.#settleWriterFailure)
        : physical.then(
            () => {
              if (ownsWriter) this.#finishWriting()
            },
            (error: unknown) => {
              if (ownsWriter) this.#finishWriting()
              throw error
            }
          )
      if (queuedEntry) queuedEntry.gateSettled = settled
      return settled
    }
    if (
      this.#fast &&
      ((message.kind === RpcEnvelopeKind.request && message.data.route.dispatchOnly !== true) ||
        message.kind === RpcEnvelopeKind.response)
    ) {
      return this.#gate
        ? this.#gate.run(
            message,
            () => this.#sendFast(beforeWrite?.() ?? message, options, admission, onStarted),
            admission
          )
        : this.#sendFast(message, options)
    }
    if (this.#gate)
      return this.#gate.run(
        message,
        () => this.#sendEnvelope(beforeWrite?.() ?? message, options, true, admission, onStarted),
        admission
      )
    return this.#sendEnvelope(message, options, false, admission, onStarted)
  }

  /** Queue one existing logical record with its original cancellation and gate-close receipts. */
  #queueEntry(entry: IQueuedEnvelope): void {
    /** Reuse the existing operation signal only when real writability queues this member. */
    const signal = entry.admission?.queueSignal
    if (signal?.aborted) {
      entry.reject(resolveAbortReason(signal))
      return
    }
    if (signal) {
      /** Cancellation releases the existing gate's capacity before the held writer drains. */
      const cancel = () => {
        if (!this.#queued.delete(entry)) return
        entry.cancelQueued?.()
        entry.reject(resolveAbortReason(signal))
      }
      signal.addEventListener('abort', cancel, { once: true })
      entry.cancelQueued = () => signal.removeEventListener('abort', cancel)
    }
    this.#queued.add(entry)
    /** Gate closure releases only this not-yet-started member through the same queue owner. */
    const releaseGate = entry.guard?.((reason) => {
      if (!this.#queued.delete(entry)) return
      entry.cancelQueued?.()
      entry.reject(reason)
    })
    if (releaseGate) {
      const releaseSignal = entry.cancelQueued
      entry.cancelQueued = () => {
        releaseSignal?.()
        releaseGate()
      }
    }
  }

  /** Serialize discovery and directory frames in the existing sender before their gate admission. */
  #enqueueProtocol(
    message: IRpcEnvelope,
    options?: ISendOptions,
    admission?: IRpcOutboundAdmission,
    beforeWrite?: () => IRpcEnvelope,
    onStarted?: () => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      /** A record preserves independent admission, cancellation and completion ownership. */
      const entry: IQueuedEnvelope = {
        message,
        options,
        admission,
        beforeWrite,
        onStarted,
        transfer: undefined,
        guard: undefined,
        resolve,
        reject,
        deferredGate: true
      }
      if (this.#writing) this.#queueEntry(entry)
      else {
        this.#writing = true
        this.#writeProtocol(entry)
      }
    })
  }

  /** Actual admission precedes every codec, framing and crypto read for this single protocol frame. */
  #writeProtocol(entry: IQueuedEnvelope): void {
    entry.cancelQueued?.()
    const write = () => {
      this.#lifecycle?.assertActive()
      entry.admission?.assertCanSend()
      return this.#sendEnvelope(
        entry.beforeWrite?.() ?? entry.message,
        entry.options,
        true,
        entry.admission,
        entry.onStarted,
        this.#batch
      )
    }
    let sent: void | Promise<void>
    try {
      sent = this.#gate ? this.#gate.run(entry.message, write, entry.admission) : write()
    } catch (error) {
      sent = Promise.reject(error)
    }
    void Promise.resolve(sent).then(
      () => {
        this.#finishWriting()
        entry.resolve()
      },
      (error: unknown) => {
        this.#finishWriting()
        entry.reject(error)
      }
    )
  }

  /** Starts an idle singleton synchronously; only an existing physical write creates a queue. */
  #flush(): void {
    this.#writing = true
    /** Consume only this ready prefix; a cold protocol boundary retains the rest in the same Set. */
    const entries: IQueuedEnvelope[] = []
    /** A record preserves independent admission, cancellation and completion ownership. */
    for (const entry of this.#queued) {
      if (entry.deferredGate) {
        if (entries.length === 0) {
          this.#queued.delete(entry)
          this.#writeProtocol(entry)
          return
        }
        break
      }
      this.#queued.delete(entry)
      entries.push(entry)
    }
    /** Cancellation/close failures remove only their own logical member before preparation. */
    const admitted = this.#admitBatch(entries, true)
    /** Transfer and opaque variation frames are boundaries, preserving their original ownership. */
    const groups: IQueuedEnvelope[][] = []
    /** The current portable run can share one encoded/protected representation. */
    let group: IQueuedEnvelope[] = []
    /** A record preserves independent admission, cancellation and completion ownership. */
    for (const entry of admitted) {
      if (
        entry.transfer?.length ||
        entry.message.kind === RpcEnvelopeKind.variation ||
        this.#capabilitiesForPeer?.(entry.message.data.route.targetId)?.includes(
          RpcCapability.batch
        ) === false
      ) {
        if (group.length) groups.push(group)
        groups.push([entry])
        group = []
      } else {
        if (
          group.length &&
          ((this.transport.topology === RpcTransportTopology.multiplexed &&
            group[0]!.message.data.route.targetId !== entry.message.data.route.targetId) ||
            (group[0]!.message.data.route.receiverId !== entry.message.data.route.receiverId &&
              (readAuthenticationChallengePort(this.authentication)?.contextNeeded(
                group[0]!.message
              ) ||
                readAuthenticationChallengePort(this.authentication)?.contextNeeded(
                  entry.message
                ))))
        ) {
          groups.push(group)
          group = []
        }
        group.push(entry)
      }
    }
    if (group.length) groups.push(group)
    /** Encode whole groups; authentication below follows the actual physical invocation order. */
    const prepared = groups.flatMap((members) => this.#prepareBatch(members))
    /** Final write settlement releases busy ownership before any awaiting caller can send again. */
    const drain: IPhysicalDrain = {
      pending: 0,
      preparing: true,
      finish: () => {
        /** Logical entries settle below; their original gate callbacks then release actual capacity. */
        void Promise.allSettled(admitted.map((entry) => entry.gateSettled)).then(() =>
          this.#finishWriting()
        )
      }
    }
    this.#writeBatch({ frames: prepared, index: 0 }, drain)
  }

  /** Releases physical ownership before caller continuation and drains exactly one ready snapshot. */
  #finishWriting(): void {
    this.#writing = false
    if (this.#queued.size === 0) return
    this.#flush()
  }

  /** Release one synchronously selected idle writer in its original gate-settlement reaction. */
  #settleWriterSuccess = (): void => {
    this.#finishWriting()
  }

  /** Preserve the physical rejection after releasing that same idle writer for the next request. */
  #settleWriterFailure = (error: unknown): never => {
    this.#finishWriting()
    throw error
  }

  /** Every supported cancellation/close is checked through the original operation/gate owners. */
  #admitBatch(entries: Iterable<IQueuedEnvelope>, refresh: boolean): IQueuedEnvelope[] {
    /** Rejected members cannot abort or reorder the survivors. */
    const admitted: IQueuedEnvelope[] = []
    /** A record preserves independent admission, cancellation and completion ownership. */
    for (const entry of entries) {
      if (refresh) entry.cancelQueued?.()
      try {
        this.#lifecycle?.assertActive()
        if (refresh) entry.guard?.()
        entry.admission?.assertCanSend()
        if (refresh) {
          entry.transfer = this.#snapshotTransfer(entry.options)
          if (entry.beforeWrite) entry.message = entry.beforeWrite()
        }
        admitted.push(entry)
      } catch (error) {
        entry.reject(error)
      }
    }
    return admitted
  }

  /**
   * Encodes the entire physical value once; actual oversize results fall back to ordinary singleton
   * members.
   */
  #prepareBatch(entries: IQueuedEnvelope[]): IPreparedBatch[] {
    if (!entries.length) return []
    try {
      /** A singleton retains the ordinary wire shape, including transfer and opaque variations. */
      const physical =
        entries.length === 1
          ? entries[0]!.message
          : {
              kind: RpcBatchPhysical.kind,
              [RpcBatchPhysical.members]: entries.map((entry) => entry.message)
            }
      /** Canonical codec owns portability; byte carriers reuse the resulting encoded bytes. */
      const encoded = (this.#objectPort?.codec ?? this.components.codec).encode(
        physical as IRpcEnvelope
      )
      /** The physical preparation retains its actual encoded value for opted-in observation. */
      let value = encoded
      if (!this.#objectPort) this.assertProtocolEncodedType(value)
      /** Fast singletons alone omit the actual framer call; a grouped batch retains it. */
      const framed =
        !this.#fast ||
        this.authentication ||
        entries.length !== 1 ||
        !(
          (entries[0]!.message.kind === RpcEnvelopeKind.request &&
            entries[0]!.message.data.route.dispatchOnly !== true) ||
          entries[0]!.message.kind === RpcEnvelopeKind.response
        )
      if (framed) {
        /** Qualified whole-frame framers cannot chunk; retain their existing full-path invocation. */
        const frames = (this.#objectPort?.framer ?? this.components.framer).frame(value, {
          source: this.id,
          messageId: entries[0]!.message.id
        })
        value = frames[0]
      }
      /** Singleton proofs skip byte scans; exact sizing retains this queue's original error policy. */
      let bound =
        typeof value === 'string'
          ? value.length * 3
          : entries.length === 1
            ? outboundJsonByteUpperBound(value)
            : this.#fast &&
                !this.#objectPort &&
                this.components.codec === identityCodec &&
                value === physical
              ? ownedBatchByteUpperBound(entries)
              : undefined
      if (bound === undefined || bound > this.#physicalLimit) {
        /** Inconclusive/custom values keep the original exact sizing and split decision. */
        const inspection = inspectRpcPhysicalFrame(value, this.#physicalLimit)
        if (inspection.bytes > this.#physicalLimit) return this.#splitBatch(entries, inspection)
        if (typeof value === 'string') bound = inspection.bytes
      }
      /**
       * Observe only this bounded physical group; ordinary singleton fallbacks emit their own real
       * members.
       */
      const p = this.#probe
      if (p !== undefined && (p.mask & (1 << RpcProbeStage.envelope)) !== 0)
        /** A record preserves independent admission, cancellation and completion ownership. */
        for (const entry of entries)
          p.envelope(
            RpcProbeDirection.outbound,
            entry.message.id,
            entry.message.kind === RpcEnvelopeKind.request
              ? entry.message.method
              : entry.message.data.route.method,
            entries.length > 1 ? entries.length : -1,
            (p.captureMask & (1 << RpcProbeStage.envelope)) !== 0 ? entry.message : undefined,
            entry.message.data.route.senderId,
            undefined,
            -1,
            entry.message.kind === RpcEnvelopeKind.variation
              ? entry.message.data.route.variation
              : undefined
          )
      if (p !== undefined && (p.mask & (1 << RpcProbeStage.encoded)) !== 0)
        p.encoded(
          RpcProbeDirection.outbound,
          entries[0]!.message.id,
          carrierSizeBytes(encoded),
          (p.captureMask & (1 << RpcProbeStage.encoded)) !== 0
            ? this.#probeContent(encoded, entries[0]!.transfer)
            : undefined,
          entries[0]!.message.kind === RpcEnvelopeKind.request
            ? entries[0]!.message.method
            : entries[0]!.message.data.route.method,
          entries[0]!.message.data.route.senderId
        )
      if (
        framed &&
        !this.authentication &&
        p !== undefined &&
        (p.mask & (1 << RpcProbeStage.frame)) !== 0
      )
        p.frame(
          RpcProbeDirection.outbound,
          entries[0]!.message.id,
          carrierSizeBytes(value),
          -1,
          -1,
          (p.captureMask & (1 << RpcProbeStage.frame)) !== 0
            ? this.#probeContent(value, entries[0]!.transfer)
            : undefined,
          entries[0]!.message.kind === RpcEnvelopeKind.request
            ? entries[0]!.message.method
            : entries[0]!.message.data.route.method,
          entries[0]!.message.data.route.senderId
        )
      return [{ entries, value, ...(typeof value === 'string' ? { byteUpperBound: bound } : {}) }]
    } catch (cause) {
      /** Existing native contract/authentication errors retain their original instances and causes. */
      const error =
        isLocalRpcError(cause, RpcAuthenticationError) ||
        isLocalRpcError(cause, RpcLifecycleError) ||
        isLocalRpcError(cause, RpcTransportError)
          ? cause
          : createRpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
      /** A record preserves independent admission, cancellation and completion ownership. */
      for (const entry of entries) entry.reject(error)
      return []
    }
  }

  /** Fall back to ordinary singleton frames after a real oversize measurement. */
  #splitBatch(
    entries: IQueuedEnvelope[],
    inspection: IRpcPhysicalFrameInspection
  ): IPreparedBatch[] {
    if (entries.length === 1) {
      try {
        inspection.splitBatch(entries)
      } catch (cause) {
        throw createRpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
      }
    }
    return this.#prepareIndividualMembers(entries)
  }

  /** Encode each surviving member once; auxiliary batch packing never repeats a growing subtree. */
  #prepareIndividualMembers(entries: readonly IQueuedEnvelope[]): IPreparedBatch[] {
    return entries.flatMap((entry) => this.#prepareBatch([entry]))
  }

  /** Sequential preparation/invocation supplies FIFO without copying already prepared suffixes. */
  #writeBatch(cursor: IPreparedBatchCursor | undefined, drain: IPhysicalDrain): void {
    while (cursor) {
      if (cursor.index >= cursor.frames.length) {
        cursor = cursor.continuation
        continue
      }
      /** The same existing prepared frame is consumed once before its continuation advances. */
      const frame = cursor.frames[cursor.index++]!
      /** Cancellation preserves survivor order while falling back to their ordinary frame path. */
      const admitted = this.#admitBatch(frame.entries, false)
      if (!admitted.length) continue
      if (admitted.length !== frame.entries.length) {
        cursor = {
          frames: this.#prepareIndividualMembers(admitted),
          index: 0,
          continuation: cursor
        }
        continue
      }
      if (this.authentication) {
        /** This existing suffix stays shared while the current physical protection yields. */
        const continuation = cursor
        void this.#prepareTransportValue(
          frame.value,
          frame.entries[0]!.transfer,
          undefined,
          undefined,
          this.#frameContext(frame.entries[0]!.message),
          frame.entries[0]!.message.id,
          -1,
          -1,
          frame.entries[0]!.message.kind === RpcEnvelopeKind.request
            ? frame.entries[0]!.message.method
            : frame.entries[0]!.message.data.route.method,
          frame.entries[0]!.message.data.route.senderId
        )
          .then((value) => {
            /** Recheck actual cancellation after the original asynchronous signer completes. */
            const current = this.#admitBatch(frame.entries, false)
            if (current.length !== frame.entries.length) {
              this.#writeBatch(
                { frames: this.#prepareIndividualMembers(current), index: 0, continuation },
                drain
              )
              return
            }
            /**
             * Opaque signer objects retain exact physical sizing; strings keep safe existing
             * bounds.
             */
            const bound =
              typeof value === 'string'
                ? value === frame.value
                  ? frame.byteUpperBound
                  : value.length * 3
                : undefined
            if (bound === undefined || bound > this.#physicalLimit) {
              /** One actual protected-frame measurement decides the unchanged physical quota. */
              const inspection = inspectRpcPhysicalFrame(value, this.#physicalLimit)
              if (inspection.bytes > this.#physicalLimit) {
                this.#writeBatch(
                  { frames: this.#splitBatch(current, inspection), index: 0, continuation },
                  drain
                )
                return
              }
            }
            this.#invokeBatch(frame.entries, value, drain)
            this.#writeBatch(continuation, drain)
          })
          .catch((error: unknown) => {
            /** A record preserves independent admission, cancellation and completion ownership. */
            for (const entry of frame.entries) entry.reject(error)
            this.#writeBatch(continuation, drain)
          })
        return
      }
      this.#invokeBatch(frame.entries, frame.value, drain)
    }
    drain.preparing = false
    if (drain.pending === 0) drain.finish()
  }

  /** One synchronous host invocation settles every member of precisely this physical frame. */
  #invokeBatch(entries: IQueuedEnvelope[], value: unknown, drain: IPhysicalDrain): void {
    drain.pending += 1
    /** Existing error and started owners stay immediately adjacent to the real host writer. */
    const sent = this.#sendPreparedTransport(
      value,
      entries[0]!.transfer,
      this.#lifecycle?.generation,
      () => {
        /** The existing per-member start loop also owns exactly one sent event per semantic member. */
        const p = this.#probe
        /** A record preserves independent admission, cancellation and completion ownership. */
        for (const entry of entries) {
          entry.onStarted?.()
          if (p !== undefined && (p.mask & (1 << RpcProbeStage.message)) !== 0)
            this.#probeSent(entry.message, p)
        }
      },
      true,
      undefined,
      entries[0]!.message
    )
    /** Both outcomes release busy identity before the logical member Promises settle. */
    const complete = () => {
      drain.pending -= 1
      if (!drain.preparing && drain.pending === 0) drain.finish()
    }
    void sent.then(
      () => {
        complete()
        /** A record preserves independent admission, cancellation and completion ownership. */
        for (const entry of entries) entry.resolve()
      },
      (error: unknown) => {
        complete()
        /** A record preserves independent admission, cancellation and completion ownership. */
        for (const entry of entries) entry.reject(error)
      }
    )
  }

  /** Reuses canonical codec/write owners while omitting only proven whole-frame collectors. */
  #sendFast(
    message: IRpcEnvelope,
    options?: ISendOptions,
    admission?: IRpcOutboundAdmission,
    onStarted?: () => void,
    immediate = false
  ): Promise<void> {
    /** Async handoff must still reject a frame captured before this lifecycle generation closes. */
    const generation = this.#lifecycle?.generation
    this.#lifecycle?.assertActive(generation)
    /** The original transfer owner retains once-read getter and immutable snapshot semantics. */
    const transfer = this.#snapshotTransfer(options)
    /** The normalizer already owns this semantic object before the codec is selected. */
    const p = this.#probe
    if (p !== undefined && (p.mask & (1 << RpcProbeStage.envelope)) !== 0)
      p.envelope(
        RpcProbeDirection.outbound,
        message.id,
        message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method,
        -1,
        (p.captureMask & (1 << RpcProbeStage.envelope)) !== 0 ? message : undefined,
        message.data.route.senderId,
        undefined,
        -1,
        message.kind === RpcEnvelopeKind.variation ? message.data.route.variation : undefined
      )
    /** The canonical codec keeps first-user portability and existing source/code/cause boundaries. */
    let encoded: unknown
    try {
      encoded = (this.#objectPort?.codec ?? this.components.codec).encode(message)
      if (!this.#objectPort) this.assertProtocolEncodedType(encoded)
    } catch (cause) {
      throw createRpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    if (p !== undefined && (p.mask & (1 << RpcProbeStage.encoded)) !== 0)
      p.encoded(
        RpcProbeDirection.outbound,
        message.id,
        carrierSizeBytes(encoded),
        (p.captureMask & (1 << RpcProbeStage.encoded)) !== 0
          ? this.#probeContent(encoded, transfer)
          : undefined,
        message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method,
        message.data.route.senderId
      )
    this.#lifecycle?.assertActive(generation)
    if (immediate) this.#assertPhysicalSize(encoded)
    /** Only qualified idle writes remove the old deferred handoff; foreign paths retain it. */
    const write = () => {
      this.#lifecycle?.assertActive(generation)
      if (!this.#objectPort) this.assertTransportEncodedType(encoded)
      return this.#sendPreparedTransport(
        encoded,
        transfer,
        generation,
        admission
          ? () => {
              admission.assertCanSend()
              onStarted?.()
            }
          : undefined,
        immediate,
        message
      )
    }
    return immediate ? write() : Promise.resolve().then(write)
  }

  /** Retains the original synchronous encode/framing path when no IPC gate was selected. */
  #sendEnvelope(
    message: IRpcEnvelope,
    options?: ISendOptions,
    gated = false,
    admission?: IRpcOutboundAdmission,
    onStarted?: () => void,
    immediate = false
  ): void | Promise<void> {
    const generation = this.#lifecycle?.generation
    this.#lifecycle?.assertActive(generation)
    const transfer = this.#snapshotTransfer(options)
    const hasTransfer = transfer !== undefined && transfer.length > 0
    /** Envelope capture reuses the original normalized value rather than walking it again. */
    const p = this.#probe
    if (p !== undefined && (p.mask & (1 << RpcProbeStage.envelope)) !== 0)
      p.envelope(
        RpcProbeDirection.outbound,
        message.id,
        message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method,
        -1,
        (p.captureMask & (1 << RpcProbeStage.envelope)) !== 0 ? message : undefined,
        message.data.route.senderId,
        undefined,
        -1,
        message.kind === RpcEnvelopeKind.variation ? message.data.route.variation : undefined
      )
    let encoded: unknown
    try {
      encoded = (this.#objectPort?.codec ?? this.components.codec).encode(message)
      if (!this.#objectPort) this.assertProtocolEncodedType(encoded)
    } catch (cause) {
      throw createRpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    if (p !== undefined && (p.mask & (1 << RpcProbeStage.encoded)) !== 0)
      p.encoded(
        RpcProbeDirection.outbound,
        message.id,
        carrierSizeBytes(encoded),
        (p.captureMask & (1 << RpcProbeStage.encoded)) !== 0
          ? this.#probeContent(encoded, transfer)
          : undefined,
        message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method,
        message.data.route.senderId
      )
    let frames: readonly unknown[]
    try {
      frames = (this.#objectPort?.framer ?? this.components.framer).frame(encoded, {
        source: this.id,
        messageId: message.id
      })
    } catch (cause) {
      throw createRpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    this.#lifecycle?.assertActive(generation)
    if (hasTransfer && frames.length !== 1)
      throw createRpcSerializationError(RpcCoreErrorText.transferUnsupportedForChunking)
    if (immediate) {
      /** Private JSON materialization preserves the original owned snapshot's byte bound. */
      this.#assertPhysicalSize(
        this.#objectPort && isOutboundEnvelope(message) ? message : frames[0]
      )
      /** Canonical whole-frame components retain their original encode/framing/protection owners. */
      const write = (value: unknown) => {
        this.#assertPhysicalSize(value)
        return this.#sendPreparedTransport(
          value,
          transfer,
          generation,
          () => {
            admission?.assertCanSend()
            onStarted?.()
          },
          true,
          message
        )
      }
      if (!this.authentication) {
        if (!this.#objectPort) this.assertTransportEncodedType(frames[0])
        if (p !== undefined && (p.mask & (1 << RpcProbeStage.frame)) !== 0)
          p.frame(
            RpcProbeDirection.outbound,
            message.id,
            carrierSizeBytes(frames[0]),
            -1,
            -1,
            (p.captureMask & (1 << RpcProbeStage.frame)) !== 0
              ? this.#probeContent(frames[0], transfer)
              : undefined,
            message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method,
            message.data.route.senderId
          )
        return this.#sendPreparedTransport(
          frames[0],
          transfer,
          generation,
          () => {
            admission?.assertCanSend()
            onStarted?.()
          },
          true,
          message
        )
      }
      return this.#prepareTransportValue(
        frames[0],
        transfer,
        hasTransfer,
        generation,
        this.#frameContext(message),
        message.id,
        -1,
        -1,
        message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method,
        message.data.route.senderId
      ).then(write)
    }
    return this.#prepareFrames(
      frames,
      transfer,
      hasTransfer,
      generation,
      this.authentication ? this.#frameContext(message) : undefined,
      message.id,
      message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method,
      message.data.route.senderId
    ).then((preparedFrames) => {
      this.#lifecycle?.assertActive(generation)
      return gated || admission !== undefined
        ? this.#sendPreparedFramesGated(
            preparedFrames,
            transfer,
            generation,
            admission,
            onStarted,
            message
          )
        : this.#sendPreparedFrames(preparedFrames, transfer, generation, message)
    })
  }

  /** Physical admission retains the existing transport error and original native cause. */
  #assertPhysicalSize(value: unknown): void {
    try {
      /** Existing owned-envelope proof avoids JSON encoding solely to size an identity frame. */
      const bound = outboundJsonByteUpperBound(value)
      if (bound !== undefined && bound <= this.#physicalLimit) return
      assertRpcPhysicalFrameSize(value, this.#physicalLimit)
    } catch (cause) {
      throw createRpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
    }
  }

  /** Validates codec output before it reaches a typed transport boundary. */
  private assertProtocolEncodedType(
    value: unknown,
    encodedType = this.components.codec.encodedType
  ): void {
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw createRpcSerializationError(RpcCoreErrorText.protocolEncodedType(encodedType))
  }

  /** Validates protected output against transport payload requirements. */
  private assertTransportEncodedType(value: unknown): void {
    /** Control protection retains the category required by the existing codec/carrier pair. */
    const encodedType = this.#transportEncodedType
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw createRpcAuthenticationError(RpcCoreErrorText.protectedEncodedType(encodedType))
  }

  /** Captures one owned, immutable transfer-list snapshot before any encoding or framing work. */
  #snapshotTransfer(options: ISendOptions | undefined): readonly unknown[] | undefined {
    let transfer: unknown
    try {
      transfer = options?.transfer
    } catch (cause) {
      throw createRpcSerializationError(RpcCoreErrorText.invalidTransferList, cause)
    }
    if (transfer === undefined) return undefined
    try {
      if (!Array.isArray(transfer))
        throw createRpcSerializationError(RpcCoreErrorText.invalidTransferList)
      const transferLength = transfer.length
      if (!Number.isSafeInteger(transferLength))
        throw createRpcSerializationError(RpcCoreErrorText.invalidTransferList)
      const snapshot: unknown[] = []
      for (let index = 0; index < transferLength; index += 1) snapshot.push(transfer[index])
      return Object.freeze(snapshot)
    } catch (cause) {
      if (isLocalRpcError(cause, RpcSerializationError)) throw cause
      throw createRpcSerializationError(RpcCoreErrorText.invalidTransferList, cause)
    }
  }

  /** Only bytes whose actual transfer backing will detach receive a capture copy. */
  #probeContent(value: unknown, transfer: readonly unknown[] | undefined): unknown {
    if (transfer === undefined || transfer.length === 0) return value
    if (isUint8Array(value)) {
      if (transfer.includes(value.buffer)) return new Uint8Array(value)
      return value
    }
    if (isArrayBuffer(value) && transfer.includes(value))
      return new Uint8Array(new Uint8Array(value)).buffer
    return value
  }

  /** Protects every frame before any transport send and preserves the first observed failure. */
  #prepareFrames(
    frames: readonly unknown[],
    transfer: readonly unknown[] | undefined,
    hasTransfer: boolean,
    generation: number | undefined,
    authenticationContext?: IRpcAuthenticationContext,
    messageId?: string,
    method?: string,
    senderId?: string
  ): Promise<readonly unknown[]> {
    let hasFailure = false
    let firstFailure: unknown
    const preparations = frames.map((frame, index) =>
      this.#prepareTransportValue(
        frame,
        transfer,
        hasTransfer,
        generation,
        authenticationContext,
        messageId,
        frames.length > 1 ? index : -1,
        frames.length > 1 ? frames.length : -1,
        method,
        senderId
      ).catch((error: unknown) => {
        if (!hasFailure) {
          hasFailure = true
          firstFailure = error
        }
        throw error
      })
    )
    return Promise.all(
      preparations.map((preparation) =>
        preparation.then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      )
    ).then((results) => {
      if (hasFailure) throw firstFailure
      const prepared: unknown[] = []
      for (const result of results) {
        if (result.ok) prepared.push(result.value)
      }
      return prepared
    })
  }

  /** Starts all transport sends only after protection succeeded, while retaining first failure. */
  #sendPreparedFrames(
    frames: readonly unknown[],
    transfer: readonly unknown[] | undefined,
    generation: number | undefined,
    message?: IRpcEnvelope
  ): Promise<void> {
    let hasFailure = false
    let firstFailure: unknown
    const sends = frames.map((frame, index) =>
      this.#sendPreparedTransport(
        frame,
        transfer,
        generation,
        undefined,
        false,
        index === 0 ? message : undefined,
        message
      ).catch((error: unknown) => {
        if (!hasFailure) {
          hasFailure = true
          firstFailure = error
        }
        throw error
      })
    )
    return Promise.all(
      sends.map((send) =>
        send.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error })
        )
      )
    ).then(() => {
      if (hasFailure) throw firstFailure
    })
  }

  /** Awaits real adapter writability between frames while committing the first frame atomically. */
  async #sendPreparedFramesGated(
    frames: readonly unknown[],
    transfer: readonly unknown[] | undefined,
    generation: number | undefined,
    admission?: IRpcOutboundAdmission,
    onStarted?: () => void,
    message?: IRpcEnvelope
  ): Promise<void> {
    let first = true
    /** Remove only members whose existing operation has actually cancelled or closed. */
    for (const frame of frames) {
      /** Logical sent belongs only to the first physical write of this existing envelope. */
      const logical = first ? message : undefined
      const beforeSend = first
        ? () => {
            admission?.assertCanSend()
            onStarted?.()
          }
        : undefined
      first = false
      await this.#sendPreparedTransport(
        frame,
        transfer,
        generation,
        beforeSend,
        false,
        logical,
        message
      )
    }
  }

  /** An absent protection resource needs only the original category and generation checks. */
  #unprotectedTransportValue(value: unknown, generation?: number): unknown {
    try {
      this.#lifecycle?.assertActive(generation)
      if (!this.#objectPort) this.assertTransportEncodedType(value)
      return value
    } catch (cause) {
      if (isLocalRpcError(cause, RpcLifecycleError)) throw cause
      throw createRpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
    }
  }

  /** Normalizes synchronous and asynchronous transport failures without changing send ordering. */
  #prepareTransportValue(
    value: unknown,
    transfer?: readonly unknown[],
    hasTransfer = transfer !== undefined && transfer.length > 0,
    generation?: number,
    authenticationContext = this.#authenticationContext,
    messageId?: string,
    index = -1,
    count = -1,
    method?: string,
    senderId?: string
  ): Promise<unknown> {
    if (this.authentication && hasTransfer)
      return Promise.reject(
        createRpcAuthenticationError(RpcCoreErrorText.transferUnsupportedWithAuthentication)
      )
    const authentication = this.authentication
    if (!authentication)
      return Promise.resolve().then(() => {
        /** Deferred unprotected preparation preserves the existing physical invocation timing. */
        const p = this.#probe
        if (
          messageId !== undefined &&
          p !== undefined &&
          (p.mask & (1 << RpcProbeStage.frame)) !== 0
        )
          p.frame(
            RpcProbeDirection.outbound,
            messageId,
            carrierSizeBytes(value),
            index,
            count,
            (p.captureMask & (1 << RpcProbeStage.frame)) !== 0
              ? this.#probeContent(value, transfer)
              : undefined,
            method,
            senderId
          )
        return this.#unprotectedTransportValue(value, generation)
      })

    return Promise.resolve()
      .then(() => {
        this.#lifecycle?.assertActive(generation)
        /** Observe each actual protect invocation without serializing concurrent chunk work. */
        const p = this.#probe
        if (
          messageId !== undefined &&
          p !== undefined &&
          (p.mask & (1 << RpcProbeStage.frame)) !== 0
        )
          p.frame(
            RpcProbeDirection.outbound,
            messageId,
            carrierSizeBytes(value),
            index,
            count,
            (p.captureMask & (1 << RpcProbeStage.frame)) !== 0
              ? this.#probeContent(value, transfer)
              : undefined,
            method,
            senderId
          )
        return authentication.protect(value, authenticationContext)
      })
      .catch((cause) => {
        if (isAuthenticationCounterExhaustion(cause)) {
          this.#reportConfiguration?.(cause)
          throw cause
        }
        if (isLocalRpcError(cause, RpcAuthenticationError)) throw cause
        if (isLocalRpcError(cause, RpcLifecycleError)) throw cause
        throw createRpcAuthenticationError(RpcCoreErrorText.authenticationFailed, cause)
      })
      .then((protectedValue) => {
        try {
          this.#lifecycle?.assertActive(generation)
          this.assertTransportEncodedType(protectedValue)
          /** Protection content is captured before any physical transport can detach its backing. */
          const p = this.#probe
          if (
            messageId !== undefined &&
            p !== undefined &&
            (p.mask & (1 << RpcProbeStage.protected)) !== 0
          )
            p.protected(
              RpcProbeDirection.outbound,
              messageId,
              carrierSizeBytes(protectedValue),
              index,
              count,
              (p.captureMask & (1 << RpcProbeStage.protected)) !== 0
                ? this.#probeContent(protectedValue, transfer)
                : undefined,
              method,
              senderId
            )
          return protectedValue
        } catch (cause) {
          if (isLocalRpcError(cause, RpcAuthenticationError)) throw cause
          if (isLocalRpcError(cause, RpcLifecycleError)) throw cause
          throw createRpcAuthenticationError(
            RpcCoreErrorText.protectedEncodedType(this.#transportEncodedType ?? 'any'),
            cause
          )
        }
      })
  }

  /** Capture one physical write for a stable continuation in this existing sender owner. */
  #sendPreparedTransport(
    value: unknown,
    transfer: readonly unknown[] | undefined,
    generation: number | undefined,
    beforeSend?: () => void,
    immediate = false,
    message?: IRpcEnvelope,
    carrierContext = message
  ): Promise<void> {
    return this.#writePreparedTransport(
      {
        value,
        transfer,
        generation,
        beforeSend,
        immediate,
        admissionFailure: undefined,
        message
      },
      carrierContext
    )
  }

  /** Only a real write or the original deferred invocation suspends this stable owner method. */
  async #writePreparedTransport(
    record: IPhysicalWriteRecord,
    carrierContext?: IRpcEnvelope | IRpcRuntimeEnvelope
  ): Promise<void> {
    /** Non-immediate callers retain their original deferred host invocation. */
    if (!record.immediate) await undefined
    try {
      this.#lifecycle?.assertActive(record.generation)
      try {
        if (record.runtimeStart) {
          record.runtimeStart.admission?.assertCanSend()
          const start = record.runtimeStart.onStarted
          if (typeof start === 'function') start()
          else start?.started()
        } else record.beforeSend?.()
      } catch (error) {
        record.admissionFailure = error
        throw error
      }
      /** Existing physical admission has won; observe once before a writer can synchronously reply. */
      const p = this.#probe
      if (p !== undefined && (p.mask & (1 << RpcProbeStage.message)) !== 0) {
        if (record.message) this.#probeSent(record.message, p)
        else if (record.runtimeStart) {
          /** Runtime task identity remains the original captured owner through native preparation. */
          const envelope = record.runtimeStart.envelope
          p.message(
            RpcProbeDirection.outbound,
            runtimeProbeKind(envelope),
            RpcProbeOutcome.sent,
            envelope.id,
            envelope.task.method,
            envelope.route.senderId,
            envelope.route.targetId,
            undefined,
            -1,
            undefined,
            undefined
          )
        }
      }
      /** The actual transport method keeps its receiver and remains adjacent to admission/start. */
      /** Only an installed carrier stage borrows context; the two assignments allocate nothing. */
      const observeCarrier = p !== undefined && (p.mask & (1 << RpcProbeStage.carrier)) !== 0
      if (observeCarrier)
        p.sendContext = carrierContext ?? record.message ?? record.runtimeStart?.envelope
      /** The original returned Promise is awaited after the synchronous context lifetime ends. */
      let sent: void | Promise<void>
      try {
        /** Protection may hide the frame, so routed carriers use the already captured envelope. */
        const logical = carrierContext ?? record.message ?? record.runtimeStart?.envelope
        /** Other carriers keep their existing physical options and transfer snapshot unchanged. */
        const options: IRpcSendOptions =
          this.transport.topology === RpcTransportTopology.multiplexed
            ? {
                transfer: record.transfer,
                targetId:
                  logical === undefined
                    ? undefined
                    : 'profile' in logical
                      ? logical.route.targetId
                      : logical.data.route.targetId
              }
            : { transfer: record.transfer }
        sent = this.#objectPort
          ? this.#objectPort.send(record.value, options)
          : this.transport.send(record.value, options)
      } finally {
        if (observeCarrier) p.sendContext = undefined
      }
      await sent
      /** A late physical completion cannot commit across the captured endpoint generation. */
      this.#lifecycle?.assertActive(record.generation)
    } catch (cause) {
      if (cause === record.admissionFailure && (record.beforeSend || record.runtimeStart))
        throw cause
      if (isLocalRpcError(cause, RpcAuthenticationError)) throw cause
      if (isLocalRpcError(cause, RpcLifecycleError)) throw cause
      throw createRpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
    }
  }

  /** Sends share the envelope's original identity and explicit trace without a new logical record. */
  #probeSent(message: IRpcEnvelope, p: IProbeEmitter): void {
    p.message(
      RpcProbeDirection.outbound,
      envelopeProbeKind(message),
      RpcProbeOutcome.sent,
      message.id,
      message.kind === RpcEnvelopeKind.request ? message.method : message.data.route.method,
      message.data.route.senderId,
      message.data.route.targetId,
      message.data.route.trace,
      -1,
      undefined,
      undefined,
      message.kind === RpcEnvelopeKind.variation ? message.data.route.variation : undefined
    )
  }
}
