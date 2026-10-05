import {
  selectedJsonObjectPort,
  jsonObjectCandidate,
  type IRpcJsonObjectPort
} from './json-object-port.js'
import {
  isAuthenticationCounterExhaustion,
  bindAuthenticationOutboundFrame,
  readAuthenticationChallengePort
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
import { RpcBatchPhysical } from '../../contract/wire-constants.js'
import {
  measureRpcPhysicalFrame,
  assertRpcPhysicalFrameSize,
  rejectRpcPhysicalFrameSize
} from '../../contract/batch-frame.js'
import { resolveAbortReason } from './async-control.js'
import { isOutboundEnvelope, outboundJsonByteUpperBound } from './outbound-envelope.js'
import type { IAuthenticationChallengeFields } from './authentication-replay.js'
import {
  normalizeRuntimeEnvelope,
  runtimeOperationCapabilities,
  wrapRuntimeCarrier
} from '../../contract/runtime-api/index.js'
import { RpcRuntimeKind } from '../../contract/runtime-api/constants.js'
import type { IRpcRuntimeEnvelope } from '../../contract/runtime-api/types.js'
import { readRpcSingleFrameFacts } from '../../contract/framing/reassembler.js'

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
type IPreparedBatch = Readonly<{ entries: IQueuedEnvelope[]; value: unknown }>

/** The sender becomes idle in the same reaction as its final actual host-write settlement. */
type IPhysicalDrain = { pending: number; preparing: boolean; finish(): void }

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
    receiverId = id
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
  async sendRuntime(
    message: IRpcRuntimeEnvelope,
    capabilities: readonly string[],
    admission?: IRpcOutboundAdmission,
    onStarted?: () => void,
    onPrepared?: () => Promise<void>
  ): Promise<void> {
    /** All permission-bearing fields are snapshotted before any async signature or gate handoff. */
    const envelope = normalizeRuntimeEnvelope(message)
    /** These labels come from the accepted channel intersection, never from one-sided offers. */
    const required = runtimeOperationCapabilities(
      envelope.task.mode,
      'options' in envelope ? envelope.options : {}
    )
    if (
      required.some((capability) => !capabilities.includes(capability)) ||
      (this.#bridge && envelope.kind === RpcRuntimeKind.group)
    )
      throw new RpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** The selected private/public frame pair must have actual first-party whole-accept facts. */
    const framer = this.#objectPort?.framer ?? this.components.framer
    /** No opaque callable is invoked merely to guess whether it fragments. */
    const facts = readRpcSingleFrameFacts(framer.accept, framer.frame)
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
    const write = async (): Promise<void> => {
      this.#lifecycle?.assertActive(generation)
      admission?.assertCanSend()
      /** Codec descriptors encode data; this independent normalized union is never a legacy wrapper. */
      let encoded: unknown
      try {
        encoded = (this.#objectPort?.codec ?? this.components.codec).encode(
          envelope as unknown as IRpcEnvelope
        )
        if (!this.#objectPort) this.assertProtocolEncodedType(encoded)
      } catch (cause) {
        throw new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
      }
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
      bindAuthenticationOutboundFrame(
        context,
        undefined,
        this.#receiverId,
        undefined,
        envelope.route
      )
      /** Complete protection and selector construction precede the sole physical write. */
      const protectedValue = await this.#prepareTransportValue(
        frames[0],
        undefined,
        false,
        generation,
        context
      )
      /** Selector overhead is charged after auth, without splitting or re-signing this frame. */
      const carrier = wrapRuntimeCarrier(protectedValue)
      assertRpcPhysicalFrameSize(carrier, limit)
      /** The original result owner can seal only this fully valid frame, before physical commit. */
      await onPrepared?.()
      return this.#sendPreparedTransport(
        carrier,
        undefined,
        generation,
        () => {
          admission?.assertCanSend()
          onStarted?.()
        },
        true
      )
    }
    return this.#gate ? this.#gate.run(envelope, write, admission) : write()
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
      const bound = entries.length === 1 ? outboundJsonByteUpperBound(value) : undefined
      if (
        (bound === undefined || bound > this.#physicalLimit) &&
        measureRpcPhysicalFrame(value) > this.#physicalLimit
      )
        return this.#splitBatch(entries)
      return [{ entries, value }]
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
            if (measureRpcPhysicalFrame(value) > this.#physicalLimit) {
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
        try {
          this.#lifecycle?.assertActive(generation)
          if (!this.#objectPort) this.assertTransportEncodedType(value)
          return value
        } catch (cause) {
          if (cause instanceof RpcLifecycleError) throw cause
          throw new RpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
        }
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

  /** Sends a fully prepared value while preserving the transport method receiver. */
  #sendPreparedTransport(
    value: unknown,
    transfer: readonly unknown[] | undefined,
    generation: number | undefined,
    beforeSend?: () => void,
    immediate = false
  ): Promise<void> {
    let admissionFailure: unknown
    /** Batch FIFO is the synchronous invocation sequence, never chained physical completions. */
    const write = () => {
      this.#lifecycle?.assertActive(generation)
      try {
        beforeSend?.()
      } catch (error) {
        admissionFailure = error
        throw error
      }
      return this.#objectPort
        ? this.#objectPort.send(value, { transfer })
        : this.transport.send(value, { transfer })
    }
    /** Synchronous host exceptions still use the same asynchronous boundary classification. */
    let result: void | Promise<void>
    if (immediate) {
      try {
        result = write()
      } catch (error) {
        result = Promise.reject(error)
      }
    } else result = Promise.resolve().then(write)
    return Promise.resolve(result)
      .then(() => {
        this.#lifecycle?.assertActive(generation)
      })
      .then(() => undefined)
      .catch((cause) => {
        if (cause === admissionFailure && beforeSend) throw cause
        if (cause instanceof RpcAuthenticationError) throw cause
        if (cause instanceof RpcLifecycleError) throw cause
        throw new RpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
      })
  }
}
