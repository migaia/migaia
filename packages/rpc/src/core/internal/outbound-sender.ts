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
import {
  RpcAuthenticationError,
  RpcLifecycleError,
  RpcSerializationError,
  RpcTransportError,
  RpcError,
  RpcCoreErrorCode
} from '../errors.js'
import type {
  IRpcAuthenticationCapability,
  IRpcAuthenticationContext,
  IRpcPlatform,
  ISendOptions
} from '../typing.js'
import type { IRpcSendOptions, IRpcTransport } from '../transport.js'
import { isUint8Array } from './safe-value.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcSelectedComponents } from './endpoint-options.js'
import { RpcEnvelopeKind, type IRpcEnvelope } from '../../contract/index.js'
import type { IRpcOutboundAdmission, IRpcOutboundGate } from './outbound-gate.js'
import { registerBatchWriter, type IBatchWriteGuard } from './batch-frame.js'
import { RpcBatchPhysical, RpcCapability } from '../../contract/index.js'
import { hasRpcBinaryEnvelope } from '../../contract/runtime-api/binary-capture.js'
import { measureRpcNativeBinaryFrame } from '../../contract/runtime-api/binary-capture.js'
import { prepareRpcBinaryLazy as prepareRpcBinary } from '../../contract/runtime-api/binary-lazy.js'
import { RpcBinaryStorage } from '../../contract/framing/v1.js'
import { RpcNativeBinaryKind } from '../../contract/framing/v1.js'
import { hasFastComponents, readFastInlineEncoder } from './fast-path.js'
import {
  prepareOwnedJsonSnapshot,
  prepareOwnedBinaryJsonSnapshot,
  readOwnedJsonSnapshot
} from './outbound-owned-codec.js'
import { isArrayBuffer } from '@migaia/utils/bytes'
import { identityCodecV1 } from '@migaia/serialize/codec'
import {
  measureRpcPhysicalFrame,
  assertRpcPhysicalFrameSize,
  rejectRpcPhysicalFrameSize
} from '../../contract/framing/index.js'
import { resolveAbortReason } from './async-control.js'
import {
  isOutboundEnvelope,
  isRuntimeOutboundEnvelope,
  createRuntimeOutboundEnvelope,
  outboundJsonByteUpperBound
} from './outbound-envelope.js'
import type { IAuthenticationChallengeFields } from './authentication-replay.js'
import {
  runtimeOperationCapabilities,
  wrapRuntimeCarrier
} from '../../contract/runtime-api/index.js'
import { RpcRuntimeKind } from '../../contract/framing/v1.js'
import type { IRpcRuntimeEnvelope } from '../../contract/index.js'
import { bindRpcFrameIngress } from '../../contract/framing/index.js'

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
  /** Only waiting entries retain a queued cancellation listener. */
  cancelQueued?: () => void
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
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
}

/** One runtime frame retains captured codec/auth/backing facts through its actual write. */
type IRuntimeWriteRecord = Readonly<{
  envelope: IRpcRuntimeEnvelope
  binary: boolean
  transferRequested: boolean
  transfer: readonly unknown[] | undefined
  native: boolean
  digest: ReturnType<typeof readAuthenticationBinaryDigest>
  framer: IRpcSelectedComponents['framer']
  generation: number | undefined
  limit: number
  admission: IRpcOutboundAdmission | undefined
  onStarted: (() => void) | Readonly<{ started(): void }> | undefined
  onPrepared: (() => Promise<void>) | undefined
}>

/** Minimal canonical send port consumed by the outbound owner. */
export type IRpcOutboundTransport = {
  readonly platform: IRpcPlatform
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
  /** The framing owner supplies limits while binding the actual selected callable pair once. */
  readonly #singleFrameLimits:
    | Readonly<{
        maxConcurrentMessages: number
        maxMessageBytes: number
      }>
    | undefined
  /** Busy physical writes accumulate ready requests and responses in this single owner. */
  #writing = false
  /** FIFO contains semantic settlements, never serialized per-member size estimates. */
  #queued: IQueuedEnvelope[] = []
  /** One owner callback releases an idle physical write before its caller continuation. */
  #idleWriteCompleted = (): void => {
    this.#finishWriting()
  }
  /** Reuse the failure reaction while preserving the exact transport error and release order. */
  #idleWriteFailed = (error: unknown): never => {
    this.#finishWriting()
    throw error
  }

  constructor(
    transport: IRpcOutboundTransport,
    id: string,
    components: IRpcSelectedComponents,
    authentication?: IRpcAuthenticationCapability,
    platform: IRpcPlatform = transport.platform,
    gate?: IRpcOutboundGate,
    reportConfiguration?: (error: unknown) => void,
    fast = false,
    batch = false,
    physicalLimit = RpcBatchPhysical.maxBytes,
    receiverId = id,
    cloneTransfer = false
  ) {
    this.transport = transport
    this.id = id
    this.components = components
    this.#objectPort = selectedJsonObjectPort(components)
    this.#bridge = jsonObjectCandidate(components) !== undefined
    this.authentication = authentication
    this.#transportEncodedType = transport.encodedType
    this.#gate = gate
    this.#reportConfiguration = reportConfiguration
    this.#fast = fast && authentication === undefined
    this.#batch = batch
    this.#physicalLimit = physicalLimit
    this.#cloneTransfer = cloneTransfer
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
    const context = { ...this.#authenticationContext }
    bindAuthenticationOutboundFrame(context, undefined, this.#receiverId, fields)
    /** Control protection retains the category required by the existing codec/carrier pair. */
    const encodedType =
      this.#transportEncodedType === 'any' || this.#transportEncodedType === undefined
        ? this.components.codec.encodedType
        : this.#transportEncodedType
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
      throw new RpcError(
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
    /** Proof is minted during portable normalization, so ordinary calls never scan a binary graph. */
    const binary = hasRpcBinaryEnvelope(envelope)
    /**
     * Own presence, including [], selects native ownership semantics instead of an inline
     * downgrade.
     */
    const transferRequested =
      transferOptions !== undefined && Object.hasOwn(transferOptions, 'transfer')
    this.assertRuntimeTransfer(capabilities, transferOptions)
    /** The original snapshot is read before gate, digest or authentication can yield. */
    const transfer = transferRequested ? (this.#snapshotTransfer(transferOptions) ?? []) : undefined
    /**
     * Canonical config facts exclude encrypt/opaque capabilities and byte/string/custom codec
     * mappings.
     */
    const digest = readAuthenticationBinaryDigest(this.authentication)
    const native = (binary || transferRequested) && this.#nativeBinaryEnabled(capabilities)
    if (transfer) {
      const unique = new Set<object>()
      for (const backing of transfer) {
        if (!isArrayBuffer(backing) || unique.has(backing))
          throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList)
        unique.add(backing)
      }
    }
    /** These labels come from the accepted channel intersection, never from one-sided offers. */
    const required = runtimeOperationCapabilities(
      envelope.task.mode,
      'options' in envelope ? envelope.options : {}
    )
    if (
      required.some((capability) => !capabilities.includes(capability)) ||
      (binary && !capabilities.includes(RpcCapability.portableBinary)) ||
      (this.#bridge && envelope.kind === RpcRuntimeKind.group)
    )
      throw new RpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** The selected private/public frame pair must have actual first-party whole-accept facts. */
    const framer = this.#objectPort?.framer ?? this.components.framer
    /** No opaque callable is invoked merely to guess whether it fragments. */
    const facts = this.#singleFrameLimits
    if (!facts)
      throw new RpcError(
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

  /** Stable sender preparation yields only for actual binary, crypto, sealing or physical work. */
  async #writeRuntime(record: IRuntimeWriteRecord): Promise<void> {
    const {
      envelope,
      binary,
      transferRequested,
      transfer,
      native,
      digest,
      framer,
      generation,
      limit,
      admission,
      onPrepared
    } = record

    this.#lifecycle?.assertActive(generation)
    admission?.assertCanSend()
    /** Codec descriptors encode data; this independent normalized union is never a legacy wrapper. */
    let encoded: unknown
    /** Native metadata retains these exact original buffers through protection and physical commit. */
    let sidecars: readonly ArrayBuffer[] = []
    /** Unique full backing bytes are charged in addition to metadata and selector/framing overhead. */
    let backingBytes = 0
    /** Only the actual canonical string encoding retains a bound for its returned text. */
    let encodedByteUpperBound: number | undefined
    try {
      /** Only the exact canonical string codec consumes an owned JSON view; custom codecs stay full. */
      const ownedJson =
        hasFastComponents(this.components) && this.components.codec.encodedType === 'string'
      /** Worker keeps the original object; its exact canonical identity function needs no copy. */
      const ownedIdentity =
        hasFastComponents(this.components) &&
        this.#objectPort === undefined &&
        this.components.codec.encode === identityCodecV1.encode
      const prepared =
        binary || transferRequested
          ? await prepareRpcBinary(
              envelope,
              native ? RpcBinaryStorage.native : RpcBinaryStorage.inline,
              limit,
              digest,
              (manifest, bytes) => {
                /** Owned metadata geometry is captured before any hash; no dummy codec pass. */
                const bound = ownedNativeBinaryByteUpperBound(
                  manifest,
                  manifest.backings.length,
                  bytes
                )
                if (bound !== undefined && bound <= limit) return
                /** An inconclusive bound preserves the original codec/exact-size/error path. */
                const metadata = (this.#objectPort?.codec ?? this.components.codec).encode(
                  manifest as unknown as IRpcEnvelope
                )
                if (measureRpcNativeBinaryFrame(metadata, manifest.backings.length, bytes) > limit)
                  rejectRpcPhysicalFrameSize()
              },
              hasFastComponents(this.components)
                ? {
                    encodeInline: readFastInlineEncoder(this.components),
                    capture: prepareOwnedBinaryJsonSnapshot
                  }
                : undefined
            )
          : undefined
      if (prepared) {
        sidecars = prepared.sidecars
        backingBytes = prepared.backingBytes
        if (transfer?.some((backing) => !sidecars.includes(backing as ArrayBuffer)))
          throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList)
      }
      /**
       * Ordinary large values get one owned JSON walk; binary preparation already retained its
       * view.
       */
      const selected = prepared?.manifest ?? envelope
      if ((ownedJson || ownedIdentity) && !prepared) prepareOwnedJsonSnapshot(selected)
      encoded = (this.#objectPort?.codec ?? this.components.codec).encode(
        selected as unknown as IRpcEnvelope
      )
      if (ownedJson || (hasFastComponents(this.components) && encoded === selected))
        encodedByteUpperBound = readOwnedJsonSnapshot(selected)?.byteUpperBound
      if (!this.#objectPort) this.assertProtocolEncodedType(encoded)
    } catch (cause) {
      throw new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    /** Known string encodings reuse their preparation bound without a second character scan. */
    if (!(encodedByteUpperBound !== undefined && encodedByteUpperBound <= limit))
      assertRpcPhysicalFrameSize(encoded, limit)
    /** Native framing runs once; multiple fragments are refused before protection or host send. */
    const frames = framer.frame(encoded, { source: this.id, messageId: envelope.id })
    if (frames.length !== 1)
      throw new RpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** Receiver freshness is selected by the same original auth context owner for either profile. */
    const context = { ...this.#authenticationContext }
    bindAuthenticationOutboundFrame(context, undefined, this.#receiverId, undefined, envelope.route)
    /** Complete protection and selector construction precede the sole physical write. */
    const protectedValue = this.authentication
      ? await this.#prepareTransportValue(frames[0], undefined, false, generation, context)
      : this.#unprotectedTransportValue(frames[0], generation)
    /** Selector overhead is charged after auth, without splitting or re-signing this frame. */
    if (
      native &&
      (!protectedValue ||
        typeof protectedValue !== 'object' ||
        Array.isArray(protectedValue) ||
        isUint8Array(protectedValue) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(protectedValue)))
    )
      throw new RpcError(
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
      if (
        (native
          ? measureRpcNativeBinaryFrame(protectedValue, sidecars.length, backingBytes)
          : measureRpcPhysicalFrame(carrier)) > limit
      )
        rejectRpcPhysicalFrameSize()
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

  /**
   * Original sourceful/exclusive transforms reuse their stable context; only admitted challenge
   * facts require a receiver-specific snapshot.
   */
  #frameContext(frame: IRpcEnvelope): IRpcAuthenticationContext {
    if (!readAuthenticationChallengePort(this.authentication)?.contextNeeded(frame))
      return this.#authenticationContext
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
    if (this.#batch) {
      /** The existing gate owns capacity; its closed check accompanies each queued member. */
      const write = registerBatchWriter((guard?: IBatchWriteGuard) => {
        if (!this.#writing) {
          guard?.()
          admission?.assertCanSend()
          const envelope = beforeWrite?.() ?? message
          this.#writing = true
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
          return Promise.resolve(sent).then(this.#idleWriteCompleted, this.#idleWriteFailed)
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
          if (this.#writing) {
            /** Reuse the existing operation signal only when real writability queues this member. */
            const signal = admission?.queueSignal
            if (signal?.aborted) {
              reject(resolveAbortReason(signal))
              return
            }
            if (signal) {
              /** Cancellation releases the existing gate's capacity before the held writer drains. */
              const cancel = () => {
                const index = this.#queued.indexOf(entry)
                if (index < 0) return
                this.#queued.splice(index, 1)
                entry.cancelQueued?.()
                reject(resolveAbortReason(signal))
              }
              signal.addEventListener('abort', cancel, { once: true })
              entry.cancelQueued = () => signal.removeEventListener('abort', cancel)
            }
            this.#queued.push(entry)
            /** Gate closure releases only this not-yet-started member through the same queue owner. */
            const releaseGate = guard?.((reason) => {
              const index = this.#queued.indexOf(entry)
              if (index < 0) return
              this.#queued.splice(index, 1)
              entry.cancelQueued?.()
              reject(reason)
            })
            if (releaseGate) {
              const releaseSignal = entry.cancelQueued
              entry.cancelQueued = () => {
                releaseSignal?.()
                releaseGate()
              }
            }
          }
        })
      })
      return this.#gate ? this.#gate.run(message, write, admission) : write()
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

  /** Starts an idle singleton synchronously; only an existing physical write creates a queue. */
  #flush(entries: readonly IQueuedEnvelope[]): void {
    this.#writing = true
    /** Cancellation/close failures remove only their own logical member before preparation. */
    const admitted = this.#admitBatch(entries, true)
    /** Transfer and opaque variation frames are boundaries, preserving their original ownership. */
    const groups: IQueuedEnvelope[][] = []
    /** The current portable run can share one encoded/protected representation. */
    let group: IQueuedEnvelope[] = []
    for (const entry of admitted) {
      if (entry.transfer?.length || entry.message.kind === RpcEnvelopeKind.variation) {
        if (group.length) groups.push(group)
        groups.push([entry])
        group = []
      } else {
        if (
          group.length &&
          group[0]!.message.data.route.receiverId !== entry.message.data.route.receiverId &&
          (readAuthenticationChallengePort(this.authentication)?.contextNeeded(group[0]!.message) ||
            readAuthenticationChallengePort(this.authentication)?.contextNeeded(entry.message))
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
        this.#finishWriting()
      }
    }
    this.#writeBatch(prepared, drain)
  }

  /** Releases physical ownership before caller continuation and drains exactly one ready snapshot. */
  #finishWriting(): void {
    this.#writing = false
    const queued = this.#queued
    this.#queued = []
    if (queued.length) this.#flush(queued)
  }

  /** Every supported cancellation/close is checked through the original operation/gate owners. */
  #admitBatch(entries: readonly IQueuedEnvelope[], refresh: boolean): IQueuedEnvelope[] {
    /** Rejected members cannot abort or reorder the survivors. */
    const admitted: IQueuedEnvelope[] = []
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

  /** Encodes the entire physical value once; only actual oversize results trigger member splitting. */
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
      let value = (this.#objectPort?.codec ?? this.components.codec).encode(
        physical as IRpcEnvelope
      )
      if (!this.#objectPort) this.assertProtocolEncodedType(value)
      if (
        !this.#fast ||
        this.authentication ||
        entries.length !== 1 ||
        !(
          (entries[0]!.message.kind === RpcEnvelopeKind.request &&
            entries[0]!.message.data.route.dispatchOnly !== true) ||
          entries[0]!.message.kind === RpcEnvelopeKind.response
        )
      ) {
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
                this.components.codec === identityCodecV1 &&
                value === physical
              ? ownedBatchByteUpperBound(entries)
              : undefined
      if (bound === undefined || bound > this.#physicalLimit) {
        /** Inconclusive/custom values keep the original exact sizing and split decision. */
        const measured = measureRpcPhysicalFrame(value)
        if (measured > this.#physicalLimit) return this.#splitBatch(entries)
        if (typeof value === 'string') bound = measured
      }
      return [{ entries, value, ...(typeof value === 'string' ? { byteUpperBound: bound } : {}) }]
    } catch (cause) {
      /** Existing native contract/authentication errors retain their original instances and causes. */
      const error =
        cause instanceof RpcAuthenticationError ||
        cause instanceof RpcLifecycleError ||
        cause instanceof RpcTransportError
          ? cause
          : new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
      for (const entry of entries) entry.reject(error)
      return []
    }
  }

  /** Count bisection uses only envelope boundaries, never per-member JSON size estimates. */
  #splitBatch(entries: IQueuedEnvelope[]): IPreparedBatch[] {
    if (entries.length === 1) {
      try {
        rejectRpcPhysicalFrameSize()
      } catch (cause) {
        throw new RpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
      }
    }
    /** Oversize frames recurse only until individually bounded semantic members remain. */
    const middle = Math.ceil(entries.length / 2)
    return [
      ...this.#prepareBatch(entries.slice(0, middle)),
      ...this.#prepareBatch(entries.slice(middle))
    ]
  }

  /** Sequential preparation/invocation supplies FIFO; no physical completion is awaited here. */
  #writeBatch(frames: readonly IPreparedBatch[], drain: IPhysicalDrain): void {
    for (let index = 0; index < frames.length; index += 1) {
      /** Remove only members whose existing operation has actually cancelled or closed. */
      const frame = frames[index]!
      const admitted = this.#admitBatch(frame.entries, false)
      if (!admitted.length) continue
      if (admitted.length !== frame.entries.length) {
        this.#writeBatch([...this.#prepareBatch(admitted), ...frames.slice(index + 1)], drain)
        return
      }
      if (this.authentication) {
        /** Protection and any membership rebuild finish before the next frame consumes a counter. */
        void this.#prepareTransportValue(
          frame.value,
          frame.entries[0]!.transfer,
          undefined,
          undefined,
          this.#frameContext(frame.entries[0]!.message)
        )
          .then((value) => {
            const current = this.#admitBatch(frame.entries, false)
            if (current.length !== frame.entries.length) {
              this.#writeBatch([...this.#prepareBatch(current), ...frames.slice(index + 1)], drain)
              return
            }
            /** Opaque object signers retain exact sizing; strings have no mutable business graph. */
            const bound =
              typeof value === 'string'
                ? value === frame.value
                  ? frame.byteUpperBound
                  : value.length * 3
                : undefined
            if (
              (bound === undefined || bound > this.#physicalLimit) &&
              measureRpcPhysicalFrame(value) > this.#physicalLimit
            ) {
              this.#writeBatch([...this.#splitBatch(current), ...frames.slice(index + 1)], drain)
              return
            }
            this.#invokeBatch(frame.entries, value, drain)
            this.#writeBatch(frames.slice(index + 1), drain)
          })
          .catch((error: unknown) => {
            for (const entry of frame.entries) entry.reject(error)
            this.#writeBatch(frames.slice(index + 1), drain)
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
        for (const entry of entries) entry.onStarted?.()
      },
      true
    )
    /** Both outcomes release busy identity before the logical member Promises settle. */
    const complete = () => {
      drain.pending -= 1
      if (!drain.preparing && drain.pending === 0) drain.finish()
    }
    void sent.then(
      () => {
        complete()
        for (const entry of entries) entry.resolve()
      },
      (error: unknown) => {
        complete()
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
    /** The canonical codec keeps first-user portability and existing source/code/cause boundaries. */
    let encoded: unknown
    try {
      encoded = (this.#objectPort?.codec ?? this.components.codec).encode(message)
      if (!this.#objectPort) this.assertProtocolEncodedType(encoded)
    } catch (cause) {
      throw new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
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
        immediate
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
    let encoded: unknown
    try {
      encoded = (this.#objectPort?.codec ?? this.components.codec).encode(message)
      if (!this.#objectPort) this.assertProtocolEncodedType(encoded)
    } catch (cause) {
      throw new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    let frames: readonly unknown[]
    try {
      frames = (this.#objectPort?.framer ?? this.components.framer).frame(encoded, {
        source: this.id,
        messageId: message.id
      })
    } catch (cause) {
      throw new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    this.#lifecycle?.assertActive(generation)
    if (hasTransfer && frames.length !== 1)
      throw new RpcSerializationError(RpcCoreErrorText.transferUnsupportedForChunking)
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
          true
        )
      }
      if (!this.authentication) {
        if (!this.#objectPort) this.assertTransportEncodedType(frames[0])
        return this.#sendPreparedTransport(
          frames[0],
          transfer,
          generation,
          () => {
            admission?.assertCanSend()
            onStarted?.()
          },
          true
        )
      }
      return this.#prepareTransportValue(
        frames[0],
        transfer,
        hasTransfer,
        generation,
        this.#frameContext(message)
      ).then(write)
    }
    return this.#prepareFrames(
      frames,
      transfer,
      hasTransfer,
      generation,
      this.authentication ? this.#frameContext(message) : undefined
    ).then((preparedFrames) => {
      this.#lifecycle?.assertActive(generation)
      return gated || admission !== undefined
        ? this.#sendPreparedFramesGated(preparedFrames, transfer, generation, admission, onStarted)
        : this.#sendPreparedFrames(preparedFrames, transfer, generation)
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
      throw new RpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
    }
  }

  /** Validates codec output before it reaches a typed transport boundary. */
  private assertProtocolEncodedType(value: unknown): void {
    const encodedType = this.components.codec.encodedType
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw new RpcSerializationError(RpcCoreErrorText.protocolEncodedType(encodedType))
  }

  /** Validates protected output against transport payload requirements. */
  private assertTransportEncodedType(value: unknown): void {
    const encodedType = this.#transportEncodedType
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw new RpcAuthenticationError(RpcCoreErrorText.protectedEncodedType(encodedType))
  }

  /** Captures one owned, immutable transfer-list snapshot before any encoding or framing work. */
  #snapshotTransfer(options: ISendOptions | undefined): readonly unknown[] | undefined {
    let transfer: unknown
    try {
      transfer = options?.transfer
    } catch (cause) {
      throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList, cause)
    }
    if (transfer === undefined) return undefined
    try {
      if (!Array.isArray(transfer))
        throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList)
      const transferLength = transfer.length
      if (!Number.isSafeInteger(transferLength))
        throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList)
      const snapshot: unknown[] = []
      for (let index = 0; index < transferLength; index += 1) snapshot.push(transfer[index])
      return Object.freeze(snapshot)
    } catch (cause) {
      if (cause instanceof RpcSerializationError) throw cause
      throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList, cause)
    }
  }

  /** Protects every frame before any transport send and preserves the first observed failure. */
  #prepareFrames(
    frames: readonly unknown[],
    transfer: readonly unknown[] | undefined,
    hasTransfer: boolean,
    generation: number | undefined,
    authenticationContext?: IRpcAuthenticationContext
  ): Promise<readonly unknown[]> {
    let hasFailure = false
    let firstFailure: unknown
    const preparations = frames.map((frame) =>
      this.#prepareTransportValue(
        frame,
        transfer,
        hasTransfer,
        generation,
        authenticationContext
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
    generation: number | undefined
  ): Promise<void> {
    let hasFailure = false
    let firstFailure: unknown
    const sends = frames.map((frame) =>
      this.#sendPreparedTransport(frame, transfer, generation).catch((error: unknown) => {
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
    onStarted?: () => void
  ): Promise<void> {
    let first = true
    for (const frame of frames) {
      const beforeSend = first
        ? () => {
            admission?.assertCanSend()
            onStarted?.()
          }
        : undefined
      first = false
      await this.#sendPreparedTransport(frame, transfer, generation, beforeSend)
    }
  }

  /** An absent protection resource needs only the original category and generation checks. */
  #unprotectedTransportValue(value: unknown, generation?: number): unknown {
    try {
      this.#lifecycle?.assertActive(generation)
      if (!this.#objectPort) this.assertTransportEncodedType(value)
      return value
    } catch (cause) {
      if (cause instanceof RpcLifecycleError) throw cause
      throw new RpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
    }
  }

  /** Normalizes synchronous and asynchronous transport failures without changing send ordering. */
  #prepareTransportValue(
    value: unknown,
    transfer?: readonly unknown[],
    hasTransfer = transfer !== undefined && transfer.length > 0,
    generation?: number,
    authenticationContext = this.#authenticationContext
  ): Promise<unknown> {
    if (this.authentication && hasTransfer)
      return Promise.reject(
        new RpcAuthenticationError(RpcCoreErrorText.transferUnsupportedWithAuthentication)
      )
    const authentication = this.authentication
    if (!authentication)
      return Promise.resolve().then(() => {
        return this.#unprotectedTransportValue(value, generation)
      })

    return Promise.resolve()
      .then(() => {
        this.#lifecycle?.assertActive(generation)
        return authentication.protect(value, authenticationContext)
      })
      .catch((cause) => {
        if (isAuthenticationCounterExhaustion(cause)) {
          this.#reportConfiguration?.(cause)
          throw cause
        }
        if (cause instanceof RpcAuthenticationError) throw cause
        if (cause instanceof RpcLifecycleError) throw cause
        throw new RpcAuthenticationError(RpcCoreErrorText.authenticationFailed, cause)
      })
      .then((protectedValue) => {
        try {
          this.#lifecycle?.assertActive(generation)
          this.assertTransportEncodedType(protectedValue)
          return protectedValue
        } catch (cause) {
          if (cause instanceof RpcAuthenticationError) throw cause
          if (cause instanceof RpcLifecycleError) throw cause
          throw new RpcAuthenticationError(
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
    immediate = false
  ): Promise<void> {
    return this.#writePreparedTransport({
      value,
      transfer,
      generation,
      beforeSend,
      immediate,
      admissionFailure: undefined
    })
  }

  /** Only a real write or the original deferred invocation suspends this stable owner method. */
  async #writePreparedTransport(record: IPhysicalWriteRecord): Promise<void> {
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
      /** The actual transport method keeps its receiver and remains adjacent to admission/start. */
      await (this.#objectPort
        ? this.#objectPort.send(record.value, { transfer: record.transfer })
        : this.transport.send(record.value, { transfer: record.transfer }))
      /** A late physical completion cannot commit across the captured endpoint generation. */
      this.#lifecycle?.assertActive(record.generation)
    } catch (cause) {
      if (cause === record.admissionFailure && (record.beforeSend || record.runtimeStart))
        throw cause
      if (cause instanceof RpcAuthenticationError) throw cause
      if (cause instanceof RpcLifecycleError) throw cause
      throw new RpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
    }
  }
}
