/** One physical connection owns codec stages, agreement, controls and terminal cleanup. */
import {
  deferred,
  raceWithAbort,
  withTimeout,
  type IAbortSignal,
  type IDeferred
} from '@migaia/utils/promise'
import { UtilsAbortError, UtilsTimeoutError, attachSecondaryErrors } from '@migaia/utils/error'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import {
  RpcProbeStage as S,
  RpcProbeDirection as D,
  RpcProbeKind,
  RpcProbeOutcome,
  rpcProbeEnvelopeFacts,
  RpcProbeLifecycle,
  RpcProbeObservationKind,
  RpcProbeAuthentication,
  rpcCarrierWriteFacts,
  type IRpcProbeObservation,
  type IRpcCarrierFrame,
  type IRpcCodecContext,
  type IRpcDispose,
  type IRpcEnvelopeContext,
  type IRpcFlowContext,
  type IRpcFramePayload,
  type IRpcFrameWriteOptions,
  type IRpcPreparedMessage,
  type IRpcPingOptions,
  type IRpcPrivateSession,
  type IRpcSessionSelection,
  type IRpcSessionView
} from '@migaia/rpc-contract/interfaces'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  normalizeRpcHandshake,
  normalizeRpcDirectory,
  serializeRpcWireError,
  deserializeRpcWireError,
  RpcWireKind as K,
  RpcWireHandshakeStep as H,
  RpcWireProfile,
  RpcWireVersion,
  RpcWireLimit,
  RpcWireJsonCodec,
  RpcWireControlOperation as C,
  type IRpcHandshake,
  type IRpcHello,
  type IRpcDirectory,
  type IRpcRoute,
  type IRpcControlFrame,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { RpcContractErrorCode, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  createContractError,
  RpcCoreErrorText,
  identifyRpcBoundaryFailure,
  RpcAuthenticationError,
  RpcLifecycleError,
  RpcSerializationError,
  tagRpcError
} from '@migaia/rpc-contract/errors'
import {
  createRpcAbortError,
  createRpcLifecycleError,
  createRpcProtocolError,
  createRpcSerializationError,
  createRpcTimeoutError,
  createRpcTransportError,
  isLocalRpcError
} from '../host/error-owner.js'
import { hostErrorWireMetadata } from '../host/error-wire-metadata.js'
import { SessionText } from './text.js'
import { carrierSizeBytes } from '../sdk/wire/probe-content.js'
import { isRpcCarrierAdmissionFailure } from '../sdk/carrier/admission.js'
import { RpcFlowPoint } from '../sdk/flow-pipelines.js'
import type { IRpcSessionOptions, IRpcSessionWriteOptions } from './types.js'

/** A live control record holds settlement only, never a business payload or request facade. */
type IControlPending = { completion: IDeferred<void>; signal: IAbortSignal }

/** Stateful media work remains here, outside the pure contract and outside business work tables. */
export class Session {
  /** Explicit collaborators own identity, indexing and actual business execution elsewhere. */
  readonly #options: IRpcSessionOptions
  /** All plugin and control work observes this connection's terminal signal. */
  readonly #controller = new AbortController()
  /** The original readiness Promise is published through the lifecycle handle. */
  readonly #ready = deferred<IRpcSessionView>()
  /** Every close path returns this same Promise, including a rejected cleanup. */
  readonly #closed = deferred<void>()
  /** Incoming hello waits only for the local offer's fields, never for its physical write. */
  readonly #offered = deferred<void>()
  /** The local offer exists only until agreement/retirement, releasing auth and directory snapshots. */
  #offer: IRpcHello | undefined
  /** The first admitted bootstrap identity cannot change between hello and accept. */
  #remoteId: string | undefined
  /** Acceptance becomes public only after both sides have admitted the connection. */
  #view: IRpcSessionView | undefined
  /** The responder retains its one reserved view until the initiator confirms local admission. */
  #candidate: IRpcSessionView | undefined
  /** Handshake verification alone may fill this output before accepted metadata becomes public. */
  readonly #handshakeResult: NonNullable<IRpcFlowContext['handshakeResult']> = {}
  /** A genuine remote rejection remains distinguishable from native startup or codec failure. */
  #handshakeFailure: IRpcPrivateSession['handshakeFailure']
  /** The subscription cleanup is invoked once, even when native closure reenters it. */
  #unsubscribe: IRpcDispose | undefined
  /** Raw native observation is removed by this same physical Session's cleanup owner. */
  #unobserve: IRpcDispose | undefined
  /** The original borrowed scheduler bounds this connection's one actual handshake attempt. */
  #handshakeTimer: Readonly<{ task: IScheduledTask; deadline: number }> | undefined
  /** Admission extends the original negotiation deadline once, never refreshing on notices. */
  #admissionDeadline: number | undefined
  /** An accepting failure joins the actual rejection write before physical close. */
  #reply: Promise<void> | undefined
  /** Carrier delivery order is preserved without a second receive buffer or shifted array. */
  #receiving: Promise<void> = Promise.resolve()
  /** Terminal transition synchronously stops all later writes and publication. */
  #closing = false
  /** Work callbacks and pending controls receive the same original terminal reason. */
  #reason: unknown
  /** Control correlation is independent of business CallTable records. */
  readonly #controls = new Map<string, IControlPending>()
  /** A connection-local serial cannot collide with another physical session's controls. */
  #controlSerial = 0
  /** Native transports receive only these three lifecycle operations. */
  readonly handle: IRpcPrivateSession

  /** Allocate terminal/readiness identity before any listener can reenter this owner. */
  constructor(options: IRpcSessionOptions) {
    this.#options = options
    /** The readonly handle getter borrows only this Session's actual readiness-failure fact. */
    const handshakeFailure = () => this.#handshakeFailure
    this.handle = Object.freeze({
      get handshakeFailure() {
        return handshakeFailure()
      },
      carrierId: options.carrier.id,
      ready: this.#ready.promise,
      closed: this.#closed.promise,
      close: this.close,
      current: () => this.current(),
      send: (frame, writeOptions) => this.send(frame, writeOptions),
      assertTransfer: (writeOptions) => this.assertTransfer(writeOptions),
      ping: (pingOptions) => this.ping(pingOptions),
      drain: this.#drainTracked,
      announceDirectory: () => this.announceDirectory(),
      track: options.track
    })
    // Mark internally owned promises handled while preserving their original public rejection.
    void this.#ready.promise.catch(() => undefined)
    void this.#closed.promise.catch(() => undefined)
    void this.#offered.promise.catch(() => undefined)
  }

  /** Native grace tracks real business completion with the existing host drain owner. */
  readonly #drainTracked = (remainingMs: number): Promise<void> =>
    this.#closing
      ? Promise.resolve()
      : this.#options.draining(remainingMs, (budget) => this.drain(budget))

  /** Table admission checks terminal state again after every awaited same-name probe. */
  get closing(): boolean {
    return this.#closing
  }

  /** Candidate name probes borrow this existing lifetime rather than outliving a retired source. */
  get signal(): IAbortSignal {
    return this.#controller.signal
  }
  /** Native owners borrow only committed metadata and their own exact media lookup source. */
  current(): IRpcSessionSelection | undefined {
    return this.#view && !this.#closing
      ? { carrierId: this.#options.carrier.id, view: this.#view, source: this.#options.source }
      : undefined
  }

  /** Subscribe first; early EOF/error owns rollback even while outbound handshake hooks await. */
  start(): void {
    try {
      /** Subscribe before handshake traffic; the native owner supplies raw facts before any decode. */
      if (this.#options.flow.observing?.(this.#options.namespace))
        this.#unobserve = this.#options.carrier.observation?.subscribe((event) => {
          this.#observe({
            ...event,
            stage: S.carrier,
            carrier: this.#options.carrier.observation!.facts.platform
          })
        })
      /** Native callbacks capture only this resource owner, never a host/runtime facade. */
      const remove = this.#options.carrier.subscribe({
        frame: this.#onFrame,
        close: (reason) => {
          void this.#close(reason, true)
        },
        error: (error) => {
          this.#options.report(error)
          void this.#close(error, true)
        }
      })
      if (this.#closing) void Promise.resolve(remove()).catch(this.#options.report)
      else this.#unsubscribe = remove
    } catch (error) {
      this.#options.report(error)
      void this.#close(error, true)
      return
    }
    if (!this.#closing) {
      this.#lifecycle(RpcProbeLifecycle.handshake)
      if (this.#closing) return
      try {
        this.#scheduleHandshake(
          this.#options.handshakeTimeoutMs ?? SessionText.defaultHandshakeTimeoutMs
        )
      } catch (error) {
        void this.#fail(error, false)
        return
      }
      void this.#hello().catch((error) => this.#fail(error, false))
    }
  }

  /** A silent peer retires this exact source through its existing readiness/physical cleanup owner. */
  readonly #handshakeExpired = (): void => {
    this.#handshakeTimer = undefined
    void this.#fail(createRpcTimeoutError(), false)
  }

  /** Every handshake phase reuses this one timer slot and the same scheduler failure identity. */
  #scheduleHandshake(remainingMs: number): void {
    try {
      this.#handshakeTimer = {
        deadline: this.#options.scheduler.now() + remainingMs,
        task: this.#options.scheduler.schedule(this.#handshakeExpired, remainingMs)
      }
    } catch (error) {
      throw identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.internal,
        RpcCoreErrorText.endpointDisposalCleanupFailed
      )
    }
  }

  /** Table starts the original peer probe before this candidate schedules its phase expiry. */
  beginAdmission(timeoutMs: number): number {
    if (this.#view) return timeoutMs
    this.#assertOpen()
    if (this.#admissionDeadline === undefined) {
      /** Final acceptance keeps only the unspent original negotiation budget after this probe. */
      const now = this.#options.scheduler.now()
      this.#admissionDeadline = Math.min(
        (this.#handshakeTimer?.deadline ?? now) + timeoutMs,
        now + RpcWireLimit.maxDurationMs
      )
    }
    this.#cancelHandshakeTimer()
    return Math.min(timeoutMs, this.#remainingAdmission())
  }

  /** An already ready directory update does not reopen handshake or emit another pending notice. */
  announceAdmission(): Promise<void> {
    if (this.#view) return Promise.resolve()
    this.#scheduleHandshake(this.#remainingAdmission())
    return this.#writeHandshake({
      profile: RpcWireProfile,
      kind: K.handshake,
      step: H.pending,
      peer: this.#offer!.peer,
      remainingMs: this.#remainingAdmission()
    })
  }

  /** Duration is sampled from the original admission deadline immediately before actual notice. */
  #remainingAdmission(): number {
    return Math.max(0, this.#admissionDeadline! - this.#options.scheduler.now())
  }

  /** Take ownership before native cancellation so a thrown cleanup cannot cause a second attempt. */
  #cancelHandshakeTimer(): void {
    /** Only the original scheduled receipt is ever cancelled, at accepted readiness or retirement. */
    const timer = this.#handshakeTimer
    this.#handshakeTimer = undefined
    try {
      timer?.task.cancel()
    } catch (error) {
      throw identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.internal,
        RpcCoreErrorText.endpointDisposalCleanupFailed
      )
    }
  }

  /** Reject unsupported native transfer presence without reading caller getters or payload data. */
  assertTransfer(options?: object): void {
    if (options && Object.hasOwn(options, 'transfer')) {
      /** Native policy borrows actual installed signing, before any caller transfer getter is read. */
      const authentication = this.#options.flow.observationFacts?.(
        this.#options.namespace
      )?.authentication
      this.#options.carrier.assertTransfer(
        authentication === RpcProbeAuthentication.sign ||
          authentication === RpcProbeAuthentication.encryptSign
      )
    }
  }

  /** Business send observes readiness, caller cancellation and connection closure before IO. */
  send(frame: IRpcSemanticFrame, options?: IRpcSessionWriteOptions): Promise<void> {
    /** Utils owns abort listener cleanup and late failure observation for this operation. */
    const signals = options?.signal
      ? [this.#controller.signal, options.signal]
      : [this.#controller.signal]
    return raceWithAbort(
      async ({ signal }) => {
        this.#assertOpen()
        /**
         * Sender ownership begins before readiness, codec digest, authentication or frame gates
         * yield.
         */
        const transfer = this.#snapshotTransfer(options)
        if (!this.#view) await this.#ready.promise
        this.#assertOpen()
        await this.#encode(
          frame,
          transfer === undefined
            ? { ...options, signal }
            : {
                sendClass: options?.sendClass,
                trace: options?.trace,
                transfer,
                signal,
                onWriteStart: options?.onWriteStart
              },
          false
        )
      },
      { signals, report: this.#options.report }
    ).catch((error) => {
      throw this.#controlError(error)
    })
  }

  /** Capture the original sender's shallow immutable list without iterating or cloning its backings. */
  #snapshotTransfer(
    options: IRpcSessionWriteOptions | undefined
  ): readonly ArrayBuffer[] | undefined {
    /** Read caller transfer permission once under its existing serialization error boundary. */
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
      /** A proxy length is observed once, before any indexed backing or asynchronous operation. */
      const length = transfer.length
      if (!Number.isSafeInteger(length))
        throw createRpcSerializationError(RpcCoreErrorText.invalidTransferList)
      /** Only the list is owned; every native backing retains its exact original identity. */
      const snapshot: ArrayBuffer[] = []
      for (let index = 0; index < length; index += 1) snapshot.push(transfer[index])
      return Object.freeze(snapshot)
    } catch (cause) {
      if (isLocalRpcError(cause, RpcSerializationError)) throw cause
      throw createRpcSerializationError(RpcCoreErrorText.invalidTransferList, cause)
    }
  }

  /**
   * A bounded health control uses utils' existing timer/abort owner, not a business timeout
   * feature.
   */
  ping(options?: IRpcPingOptions): Promise<void> {
    /** Id membership stays local to this physical carrier's control table. */
    const id = String(++this.#controlSerial)
    /** Caller false leaves native supervisor grace as the only deadline. */
    const timeoutMs = options?.timeoutMs ?? this.#options.controlTimeoutMs
    /** One cleanup path removes both timer/listeners and the control record. */
    const signals = options?.signal
      ? [this.#controller.signal, options.signal]
      : [this.#controller.signal]
    /** A lazy operation prevents physical ping after an already-aborted caller signal. */
    const operation = ({ signal }: { signal: IAbortSignal }): Promise<void> =>
      this.#ping(id, signal)
    /** Both APIs use the same generic abort owner and report original late rejection values. */
    const result =
      timeoutMs === false
        ? raceWithAbort(operation, { signals, report: this.#options.report })
        : withTimeout(operation, {
            timeoutMs,
            signals,
            scheduler: this.#options.scheduler,
            report: this.#options.report,
            zeroTimeoutBehavior: 'start'
          })
    return result
      .catch((error) => {
        /** Settle a timeout loser so no deferred/promise observer is retained after its map entry. */
        const pending = this.#controls.get(id)
        pending?.completion.reject(pending.signal.reason ?? error)
        throw this.#controlError(error)
      })
      .finally(() => {
        this.#controls.delete(id)
      })
  }

  /** Drain sends the original remaining budget; incoming drain stays a work-owner lifecycle event. */
  async drain(remainingMs: number): Promise<void> {
    await this.#ready.promise
    if (this.#closing) return
    /** The canonical new route validator owns finite/nonnegative duration admission. */
    const frame = this.#control(C.drain, String(++this.#controlSerial))
    await this.send({ ...frame, route: { ...frame.route, remainingMs } })
  }

  /** Announce the actual current provider catalog through this accepted source and codec. */
  async announceDirectory(): Promise<void> {
    await this.#ready.promise
    await this.send({
      profile: RpcWireProfile,
      kind: K.directory,
      id: String(++this.#controlSerial),
      route: this.#route(),
      directory: this.#options.directory()
    })
  }

  /** Explicit lifecycle close retains its original reason and public Promise identity. */
  readonly close = (reason?: unknown): Promise<void> => this.#close(reason)

  /** The physical ingress fact survives retirement without changing shared native error identity. */
  #close(reason?: unknown, physicalFailure = false): Promise<void> {
    if (this.#closing) return this.#closed.promise
    this.#closing = true
    this.#reason = reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    this.#lifecycle(RpcProbeLifecycle.closing, this.#reason)
    /** Timer cleanup remains secondary to an already selected abort/EOF/deadline primary. */
    const timerFailures: unknown[] = []
    try {
      this.#cancelHandshakeTimer()
    } catch (error) {
      timerFailures.push(error)
      this.#options.report(error)
    }
    this.#ready.reject(this.#reason)
    this.#offered.reject(this.#reason)
    this.#offer = undefined
    this.#remoteId = undefined
    this.#candidate = undefined
    this.#admissionDeadline = undefined
    this.#handshakeResult.authentication = undefined
    try {
      this.#options.retire(this.#view, this.#reason, physicalFailure)
    } catch (error) {
      this.#options.report(error)
    }
    this.#controller.abort(this.#reason)
    for (const pending of this.#controls.values()) pending.completion.reject(this.#reason)
    this.#controls.clear()
    /** Listener cleanup cannot replace the primary reason or prevent physical close. */
    const remove = this.#unsubscribe
    this.#unsubscribe = undefined
    void this.#cleanup(remove, timerFailures, physicalFailure).then(
      this.#closed.resolve,
      this.#closed.reject
    )
    return this.#closed.promise
  }

  /** Physical close settles queued writes before joining the reply; ingress never waits on itself. */
  async #cleanup(
    remove: IRpcDispose | undefined,
    timerFailures: unknown[],
    physicalFailure: boolean
  ): Promise<void> {
    /** Keep all original cleanup values reachable if multiple native releases fail. */
    const failures: unknown[] = [...timerFailures]
    try {
      await remove?.()
    } catch (error) {
      failures.push(error)
      this.#options.report(error)
    }
    try {
      await this.#options.carrier.close(this.#reason)
    } catch (error) {
      failures.push(error)
      this.#options.report(error)
    }
    /** Physical-close failures precede observation cleanup, preserving original failure order. */
    const unobserve = this.#unobserve
    this.#unobserve = undefined
    try {
      await unobserve?.()
    } catch (error) {
      failures.push(error)
      this.#options.report(error)
    }
    try {
      await this.#reply
    } catch (error) {
      if (error !== this.#reason) this.#options.report(error)
    }
    /** External close joins admitted ingress before its native stage owner is revoked. */
    if (!physicalFailure) await this.#receiving
    this.#view = undefined
    if (timerFailures.length)
      throw tagRpcError(
        new AggregateError(
          [this.#reason, ...failures],
          RpcCoreErrorText.endpointDisposalCleanupFailed
        ),
        RpcCoreErrorCode.internal
      )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw attachSecondaryErrors(
        createRpcLifecycleError(RpcCoreErrorText.endpointDisposalCleanupFailed, this.#reason),
        failures
      )
  }

  /** Register the local immutable offer before a peer's hello can choose its deterministic role. */
  async #hello(): Promise<void> {
    /** Identity is owned globally; a carrier never invents one local self per namespace. */
    const directory = this.#options.directory()
    /** Installed flow handlers, rather than user metadata, supply extension authority. */
    const hello: IRpcHello = {
      profile: RpcWireProfile,
      kind: K.handshake,
      step: H.hello,
      versions: [RpcWireVersion],
      codecs: this.#options.carrier.codecs,
      extensions: this.#options.flow.extensions(this.#options.namespace),
      requiredExtensions: this.#options.flow.requiredExtensions(this.#options.namespace),
      peer: { id: this.#options.self().instanceId, runtime: 'javascript' },
      directory
    }
    /** Handshake hooks are installed cold and can attach or validate auth-owned fields. */
    const selected = await this.#transformHandshake(hello, 'outbound')
    if (selected.step !== H.hello) throw createRpcProtocolError(SessionText.handshakeUnexpected)
    this.#assertOpen()
    this.#offer = selected
    this.#offered.resolve()
    await this.#encode(selected, undefined, true)
  }

  /**
   * A fulfilled tail retains no payload queue; every received physical frame has one processing
   * slot.
   */
  readonly #onFrame = (frame: IRpcCarrierFrame): void => {
    if (this.#closing) return
    this.#media(S.frame, D.inbound, frame.data)
    this.#receiving = this.#receiving
      .then(() => this.#receiveFrame(frame))
      .catch((error) => {
        /** A forged authenticated frame cannot evict an already accepted legitimate source. */
        if (this.#view && isLocalRpcError(error, RpcAuthenticationError))
          this.#options.report(error)
        else return this.#fail(error, true)
      })
  }

  /** Process one admitted ingress slot through its actual accepted or bootstrap codec boundary. */
  async #receiveFrame(frame: IRpcCarrierFrame): Promise<void> {
    this.#assertOpen()
    if (this.#view)
      await this.#options
        .pipelines()
        .pipeline(RpcFlowPoint.frameInbound)
        .run({ frame, context: this.#context('inbound') }, async (payload) =>
          this.#decode(payload.frame)
        )
    else await this.#decode(frame)
  }

  /** Decode protected metadata, authenticate it, then restore original admitted binary values. */
  readonly #decode = async (frame: IRpcCarrierFrame): Promise<void> => {
    /** The physical codec owns the canonical semantic parser; no second business walker runs here. */
    const context = this.#codecContext(!this.#view)
    this.#media(S.encoded, D.inbound, frame.data)
    /** Four-stage media boundary leaves protected metadata visible before restoration. */
    const decoded = await this.#options.carrier.codec.decode(frame, context)
    /** Only actual codec admission can authorize correlation after an optional hook fails. */
    const operation = {
      owner: this,
      codec: context,
      admitted: undefined as IRpcSemanticFrame | undefined
    }
    /** Auth can join native integrity before committing replay state; codec owns its one result. */
    const envelopeContext: IRpcEnvelopeContext = {
      ...this.#context('inbound'),
      restore: async (prepared) => {
        const message = await operation.owner.#options.carrier.codec.restore(
          prepared,
          operation.codec
        )
        if (!operation.owner.#admitRoute(message)) return undefined
        operation.admitted = message
        return message
      }
    }
    /** Envelope hooks may reject before native business values become observable. */
    let message: IRpcSemanticFrame | undefined
    try {
      await this.#options
        .pipelines()
        .pipeline(RpcFlowPoint.envelopeInbound)
        .run({ prepared: decoded, context: envelopeContext }, async (payload) => {
          /** Codec restore returns a frame admitted through the sole pure wire grammar. */
          message = await payload.context.restore(payload.prepared)
        })
    } catch (error) {
      const admitted = operation.admitted
      if (
        !admitted ||
        admitted.kind === K.handshake ||
        admitted.kind === K.control ||
        admitted.kind === K.directory ||
        !this.#view ||
        !this.#options.rejected
      )
        throw error
      this.#options.rejected(this.#view, admitted, error)
      return
    }
    if (message === undefined) return
    this.#assertOpen()
    this.#media(S.envelope, D.inbound, message, message)
    if (message.kind === K.handshake) {
      await this.#handshake(message)
      return
    }
    if (!this.#view)
      throw createContractError(
        RpcContractErrorCode.handshakeInvalid,
        undefined,
        hostErrorWireMetadata
      )
    if (message.kind === K.directory) {
      await this.#directory(message.directory)
      return
    }
    if (message.kind === K.control)
      this.#observe({
        ...rpcProbeEnvelopeFacts(message),
        stage: S.message,
        direction: D.inbound,
        kind: RpcProbeKind.control,
        outcome: RpcProbeOutcome.received,
        variation: message.operation
      })
    if (message.kind === K.control && message.operation !== C.drain) {
      await this.#receiveControl(message)
      return
    }
    await this.#options.receive(this.#view, message)
  }

  /** Return false for foreign-source metadata without retiring the genuine native connection. */
  #admitRoute(message: IRpcSemanticFrame): boolean {
    if (message.kind === K.handshake) return true
    if (!this.#view)
      throw createContractError(
        RpcContractErrorCode.handshakeInvalid,
        undefined,
        hostErrorWireMetadata
      )
    return (
      message.route.senderId === this.#view.peerId &&
      message.route.receiverId === this.#options.self().instanceId
    )
  }

  /** Bilateral accepts confirm both admission decisions before either side reports readiness. */
  async #handshake(message: IRpcHandshake): Promise<void> {
    /** Hooks see a pure-admitted handshake before any accepted identity can be indexed. */
    const remote = await this.#transformHandshake(message, 'inbound')
    if (remote.step === H.reject) {
      /** Native startup consumes only this received rejection's original restored error. */
      const error = deserializeRpcWireError(remote.error, hostErrorWireMetadata)
      this.#handshakeFailure = Object.freeze({ phase: 'handshake', error })
      void this.close(error)
      return
    }
    if (this.#view) throw createRpcProtocolError(SessionText.handshakeUnexpected)
    if (remote.step === H.pending && this.#remoteId === undefined)
      throw createRpcProtocolError(SessionText.handshakeUnexpected)
    if (this.#options.expectedPeerId && remote.peer.id !== this.#options.expectedPeerId)
      throw createRpcProtocolError(SessionText.identityMismatch)
    if (this.#remoteId !== undefined && this.#remoteId !== remote.peer.id)
      throw createRpcProtocolError(SessionText.identityMismatch)
    this.#remoteId = remote.peer.id
    await this.#offered.promise
    this.#assertOpen()
    /** The original local offer is retained only while negotiation can still complete. */
    const offer = this.#offer!
    if (remote.peer.id === offer.peer.id)
      throw createContractError(
        RpcContractErrorCode.handshakeInvalid,
        undefined,
        hostErrorWireMetadata
      )
    if (remote.step === H.pending) {
      /** The sender already included its remaining negotiation and one admission budget. */
      const deadline = this.#options.scheduler.now() + remote.remainingMs
      this.#admissionDeadline = Math.min(this.#admissionDeadline ?? deadline, deadline)
      this.#cancelHandshakeTimer()
      this.#scheduleHandshake(this.#remainingAdmission())
      return
    }
    if (remote.step === H.hello) {
      if (offer.peer.id < remote.peer.id) {
        /** A later pending notice cannot bypass actual common codec/extension negotiation. */
        acceptRpcHandshake(offer, remote, hostErrorWireMetadata)
        return
      }
      /** The larger id is responder; codec preference remains the initiating offer's order. */
      const accept = acceptRpcHandshake(remote, offer, hostErrorWireMetadata)
      /** Name arbitration precedes any accepting wire reply or published identity. */
      const view = await this.#options.admit(
        remote.directory,
        accept.codec,
        accept.extensions,
        this.#authentication()
      )
      this.#assertOpen()
      this.#candidate = view
      this.#reply = this.#writeHandshake(accept)
      await this.#reply
    } else {
      /** Both accept directions validate against this side's actual immutable offer. */
      const accepted = completeRpcHandshake(offer, remote, hostErrorWireMetadata)
      if (offer.peer.id > remote.peer.id) {
        /** The same reserved identity is published once, without repeating name arbitration. */
        const view = this.#candidate
        if (
          !view ||
          view.codec !== accepted.codec ||
          view.extensions.size !== accepted.extensions.length ||
          accepted.extensions.some((extension) => !view.extensions.has(extension))
        )
          throw createRpcProtocolError(SessionText.handshakeUnexpected)
        this.#publish(view)
        return
      }
      /** Initiator admission can still reject a live same-name peer after the first accept. */
      const view = await this.#options.admit(
        accepted.directory,
        accepted.codec,
        accepted.extensions,
        this.#authentication()
      )
      this.#assertOpen()
      /** The existing accept grammar carries this confirmation; no new frame or timer is needed. */
      this.#reply = this.#writeHandshake({
        profile: RpcWireProfile,
        kind: K.handshake,
        step: H.accept,
        major: accepted.major,
        minor: accepted.minor,
        codec: accepted.codec,
        extensions: accepted.extensions,
        peer: offer.peer,
        directory: offer.directory,
        ...(offer.auth === undefined ? {} : { auth: offer.auth })
      })
      await this.#reply
      this.#publish(view)
    }
  }

  /** Ready is fulfilled only after the table's exact reserved view has become selectable. */
  #publish(view: IRpcSessionView): void {
    this.#assertOpen()
    /** Directory refresh is descriptive and cannot emit a second readiness transition. */
    const first = !this.#view
    if (first) this.#cancelHandshakeTimer()
    this.#options.publish(view)
    this.#assertOpen()
    this.#view = view
    this.#candidate = undefined
    this.#admissionDeadline = undefined
    this.#offer = undefined
    this.#remoteId = undefined
    if (first) {
      this.#describe()
      this.#assertOpen()
    }
    this.#ready.resolve(view)
    this.#options.changed?.()
    if (first) this.#lifecycle(RpcProbeLifecycle.ready)
  }

  /**
   * Cold directory updates reuse the same admission/index owner and cannot change physical
   * identity.
   */
  async #directory(value: IRpcDirectory): Promise<void> {
    /** Schema3 has one pure directory validator and method lookup is recompiled once per update. */
    const directory = normalizeRpcDirectory(value, hostErrorWireMetadata)
    if (directory.self.instanceId !== this.#view!.peerId)
      throw createRpcProtocolError(SessionText.identityMismatch)
    /** Preserve selected codec/extensions across descriptive method or display-name updates. */
    const view = await this.#options.admit(
      directory,
      this.#view!.codec,
      [...this.#view!.extensions],
      this.#view!.authentication
    )
    this.#publish(view)
  }

  /** Prepare/encode remain on the actual carrier, with hooks at the specified metadata/frame seams. */
  async #encode(
    message: IRpcSemanticFrame,
    options: IRpcSessionWriteOptions | undefined,
    bootstrap: boolean
  ): Promise<void> {
    this.#assertOpen()
    /** Derive header-only native admission facts before the selected codec makes frames opaque. */
    options = { ...options, ...rpcCarrierWriteFacts(message) }
    /** Bootstrap always uses common JSON and has no native transfer permission. */
    const context = this.#codecContext(bootstrap, options)
    this.#media(S.envelope, D.outbound, message, message)
    /** Binary capture occurs once before outbound envelope authentication. */
    const captured = await this.#options.carrier.codec.prepare(message, context)
    /** Auth/schema plugins see prepared metadata outside physical codec execution. */
    /** Only a native terminal may publish transformed metadata to physical encoding. */
    let prepared: IRpcPreparedMessage | undefined
    await this.#options
      .pipelines()
      .pipeline(RpcFlowPoint.envelopeOutbound)
      .run(
        {
          prepared: captured,
          context: {
            ...this.#context('outbound', options?.signal),
            restore: (value) => this.#options.carrier.codec.restore(value, context)
          }
        },
        async (payload) => {
          prepared = payload.prepared
        }
      )
    if (prepared === undefined) return
    /** Encoding owns its original serialization failure; prepare and authentication stay outside. */
    let encoded: IRpcCarrierFrame
    try {
      encoded = await this.#options.carrier.codec.encode(prepared, context)
    } catch (cause) {
      if (bootstrap) throw cause
      throw createRpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    this.#media(S.encoded, D.outbound, encoded.data, message, options?.transfer)
    this.#assertOpen()
    /** A single logical reservation belongs to this whole run, including all native next branches. */
    const admission = this.#options.carrier.reserveWrite?.(options)
    /** This write borrows the prepared operation's exact options, message and bootstrap boundary. */
    const writeContext = { options: { ...options, admission }, message, bootstrap }
    /** The continuation is the sole physical handoff point, including optional chunk/batch output. */
    const write = async (payload: IRpcFramePayload): Promise<void> => {
      /** Replacement frame payloads carry the matching physical options through every branch. */
      const { frame, write: physical = writeContext.options } = payload
      this.#assertOpen()
      /** A batch may clear only its first logical signal, never the held Session's terminal fence. */
      const signal = physical?.signal === false ? this.#controller.signal : physical?.signal
      this.#media(S.frame, D.outbound, frame.data, writeContext.message, physical?.transfer)
      this.#assertOpen()
      if (signal?.aborted) throw createRpcAbortError(undefined, undefined, signal.reason)
      await this.#write(
        frame,
        {
          sendClass: physical?.sendClass ?? writeContext.options?.sendClass,
          trace: physical?.trace ?? writeContext.options?.trace,
          signal: signal ?? this.#controller.signal,
          transfer: physical?.transfer,
          onWriteStart: physical?.onWriteStart,
          admission: physical?.admission
        },
        writeContext.bootstrap
      )
    }
    try {
      /** Each physical descendant borrows the same reservation without releasing it early. */
      const physical: IRpcFrameWriteOptions = writeContext.options
      const payload: IRpcFramePayload = {
        frame: encoded,
        context: {
          ...this.#context('outbound', options?.signal),
          connectionSignal: this.#controller.signal
        },
        write: physical
      }
      if (bootstrap) await write(payload)
      else await this.#options.pipelines().pipeline(RpcFlowPoint.frameOutbound).run(payload, write)
    } finally {
      admission?.release()
    }
    if (message.kind === K.control)
      this.#observe({
        ...rpcProbeEnvelopeFacts(message),
        stage: S.message,
        direction: D.outbound,
        kind: RpcProbeKind.control,
        outcome: RpcProbeOutcome.sent,
        variation: message.operation
      })
  }

  /** Physical business failure keeps the original transport cause; local admission remains exact. */
  async #write(
    frame: IRpcCarrierFrame,
    options: IRpcSessionWriteOptions,
    bootstrap: boolean
  ): Promise<void> {
    /** A sentinel preserves even an admission callback throwing undefined without tagging it IO. */
    let admission: { error: unknown } | undefined
    /** The native IO alone invokes this at actual handoff, after its queue admission. */
    const onWriteStart =
      options.onWriteStart &&
      (() => {
        try {
          options.onWriteStart!()
        } catch (error) {
          admission = { error }
          throw error
        }
      })
    try {
      await this.#options.carrier.write(frame, { ...options, onWriteStart })
    } catch (cause) {
      if (
        bootstrap ||
        isRpcCarrierAdmissionFailure(cause) ||
        (admission && cause === admission.error) ||
        isLocalRpcError(cause, RpcAuthenticationError) ||
        isLocalRpcError(cause, RpcLifecycleError)
      )
        throw cause
      throw createRpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
    }
  }

  /** One successful physical publication describes only acquired native and installed flow facts. */
  #describe(): void {
    /** A carrier without acquired observation metadata cannot claim a guessed platform. */
    const observation = this.#options.carrier.observation
    if (!observation) return
    /** Authentication mode comes from the real selected installation, never a plugin name or frame. */
    const authentication =
      this.#options.flow.observationFacts?.(this.#options.namespace)?.authentication ??
      RpcProbeAuthentication.none
    this.#options.flow.observe?.({
      kind: RpcProbeObservationKind.descriptor,
      namespace: this.#options.namespace,
      carrierId: this.#options.carrier.id,
      peerId: this.#view?.peerId,
      data: Object.freeze({
        ...observation.facts,
        endpointId: this.#options.self().instanceId,
        namespace: this.#options.namespace,
        carrierId: this.#options.carrier.id,
        authentication,
        carrier: observation.facts.platform,
        stageMask:
          (1 << S.peer) |
          (1 << S.message) |
          (1 << S.envelope) |
          (1 << S.encoded) |
          (1 << S.frame) |
          (1 << S.carrier) |
          (1 << S.forward) |
          (authentication === RpcProbeAuthentication.none ? 0 : 1 << S.protected)
      })
    })
  }

  /** Publish only borrowed stage facts; the observer cannot replace a continuation or frame. */
  #observe(data: IRpcProbeObservation): void {
    this.#options.flow.observe?.({
      kind: RpcProbeObservationKind.event,
      namespace: this.#options.namespace,
      carrierId: this.#options.carrier.id,
      peerId: this.#view?.peerId,
      id: data.messageId,
      data
    })
  }

  /** Only real connection transitions produce the existing public lifecycle names. */
  #lifecycle(lifecycle: string, error?: unknown): void {
    this.#observe({
      stage: S.peer,
      kind: RpcProbeKind.lifecycle,
      peerId: this.#view?.peerId,
      lifecycle,
      error
    })
  }

  /** Opaque physical input has no fabricated task identity before the one codec admits it. */
  #media(
    stage: number,
    direction: number,
    content: unknown,
    message?: IRpcSemanticFrame,
    transfer?: readonly ArrayBuffer[]
  ): void {
    /** Admitted semantic routes may annotate outbound media and restored inbound envelopes only. */
    const routed = message && message.kind !== K.handshake ? message : undefined
    this.#observe({
      stage,
      direction,
      messageId: routed?.id,
      method: message && 'task' in message ? message.task.method : undefined,
      senderId: routed?.route.senderId,
      targetId: routed?.route.targetId,
      receiverId: routed?.route.receiverId,
      peerId: this.#view?.peerId,
      sizeBytes: stage === S.envelope ? -1 : carrierSizeBytes(content),
      content,
      transfer
    })
  }

  /** Negotiated facts are borrowed; arbitrary caller options cannot grant native binary support. */
  #codecContext(bootstrap: boolean, options?: IRpcSessionWriteOptions): IRpcCodecContext {
    return {
      codec: bootstrap ? RpcWireJsonCodec : this.#view!.codec,
      nativeBinary: !bootstrap && this.#options.carrier.nativeBinary,
      errorMetadata: hostErrorWireMetadata,
      maxFrameBytes: bootstrap
        ? Math.min(SessionText.handshakeMaxFrameBytes, this.#options.maxFrameBytes)
        : this.#options.maxFrameBytes,
      ...(options?.transfer ? { transfer: options.transfer } : {})
    }
  }

  /** Context identity always comes from the held physical source, not inbound business metadata. */
  #context(direction: IRpcFlowContext['direction'], signal?: IAbortSignal): IRpcFlowContext {
    return {
      namespace: this.#options.namespace,
      carrierId: this.#options.carrier.id,
      session: this.#view,
      exclusive: this.#options.isExclusive?.(),
      direction,
      signal: signal ?? this.#controller.signal,
      report: this.#options.report
    }
  }

  /** The verifier output slot exists only at the already-declared handshake intervention point. */
  #handshakeContext(direction: IRpcFlowContext['direction']): IRpcFlowContext {
    return { ...this.#context(direction), handshakeResult: this.#handshakeResult }
  }

  /** Freeze verified identity with the acquired Session id before Table publication can observe it. */
  #authentication(): IRpcSessionView['authentication'] {
    /** Void legacy verifiers cannot create an authenticated principal. */
    const authentication = this.#handshakeResult.authentication
    return (
      authentication &&
      Object.freeze({
        principalId: authentication.principalId,
        sessionId: this.#options.sessionId ?? this.#options.carrier.id
      })
    )
  }

  /** Outbound accept/reject hooks use the same bootstrap codec without a second agreement layer. */
  async #writeHandshake(message: IRpcHandshake): Promise<void> {
    /** Actual handshake plugins may attach rejection/auth data before semantic encoding. */
    const prepared = await this.#transformHandshake(message, 'outbound')
    this.#assertOpen()
    const selected = normalizeRpcHandshake(
      prepared.step === H.pending
        ? { ...prepared, remainingMs: this.#remainingAdmission() }
        : prepared,
      hostErrorWireMetadata
    )
    await this.#encode(selected, undefined, true)
  }

  /** Captures only the native terminal's transformed handshake before pure grammar admission. */
  async #transformHandshake(
    handshake: IRpcHandshake,
    direction: IRpcFlowContext['direction']
  ): Promise<IRpcHandshake> {
    /** A swallowed continuation has no admitted handshake to publish or encode. */
    let selected: IRpcHandshake | undefined
    await this.#options
      .pipelines()
      .pipeline(
        direction === 'outbound' ? RpcFlowPoint.handshakeOutbound : RpcFlowPoint.handshakeInbound
      )
      .run({ handshake, context: this.#handshakeContext(direction) }, async (payload) => {
        selected = payload.handshake
      })
    return normalizeRpcHandshake(selected, hostErrorWireMetadata)
  }

  /** Register control correlation before sending so a synchronous remote pong cannot be lost. */
  #ping(id: string, signal: IAbortSignal): Promise<void> {
    /** The pending Promise is released on pong, source retirement, deadline or caller abort. */
    const completion = deferred<void>()
    this.#controls.set(id, { completion, signal })
    void this.#writePing(id, signal).catch(completion.reject)
    return completion.promise
  }

  /** Publish settlement before waiting for readiness, so close/deadline cannot orphan a rejection. */
  async #writePing(id: string, signal: IAbortSignal): Promise<void> {
    await this.#ready.promise
    this.#assertOpen()
    if (signal.aborted) throw signal.reason
    await this.send(this.#control(C.ping, id), { signal })
  }

  /** Ping and pong are Session controls; drain is delivered to the host work lifecycle port. */
  async #receiveControl(frame: IRpcControlFrame): Promise<void> {
    if (frame.operation === C.ping) {
      await this.send(this.#control(C.pong, frame.id))
      return
    }
    /** Late/foreign control ids have no pending operation to settle. */
    const pending = this.#controls.get(frame.id)
    if (!pending) return
    this.#controls.delete(frame.id)
    if (frame.reason)
      pending.completion.reject(deserializeRpcWireError(frame.reason, hostErrorWireMetadata))
    else pending.completion.resolve()
  }

  /** Lifecycle route timestamps are diagnostics; duration clocks remain on the scheduler. */
  #control(operation: IRpcControlFrame['operation'], id: string): IRpcControlFrame {
    return { profile: RpcWireProfile, kind: K.control, id, operation, route: this.#route() }
  }

  /** Controls and catalog announcements share the same actual direct physical-hop route. */
  #route(): IRpcRoute {
    this.#assertOpen()
    /** Global local self remains stable across all namespaces and native carriers. */
    const self = this.#options.self()
    return {
      applicationVersion: RpcWireProfile,
      senderId: self.instanceId,
      receiverId: this.#view!.peerId,
      targetId: this.#view!.peerId,
      sentAt: this.#options.timestamp()
    }
  }

  /** Translate only utils-owned control wrappers while retaining the original reason/cause. */
  #controlError(error: unknown): unknown {
    if (this.#closing) return this.#reason
    if (error instanceof UtilsAbortError)
      return createRpcAbortError(undefined, undefined, error.cause)
    if (error instanceof UtilsTimeoutError) {
      /** Native TimeoutError remains the public family; the generic timer failure remains reachable. */
      const timeout = createRpcTimeoutError()
      Object.defineProperty(timeout, 'cause', { value: error, configurable: true })
      return timeout
    }
    return error
  }

  /** A failing unaccepted candidate emits its coded reject before releasing the physical source. */
  async #fail(error: unknown, reject: boolean): Promise<void> {
    if (this.#closing) {
      if (error !== this.#reason) this.#options.report(error)
      return
    }
    this.#options.report(error)
    if (reject && !this.#view && this.#offer) {
      this.#reply = this.#writeHandshake({
        profile: RpcWireProfile,
        kind: K.handshake,
        step: H.reject,
        error: serializeRpcWireError(error, { report: this.#options.report }, hostErrorWireMetadata)
      })
      try {
        await this.#reply
      } catch (failure) {
        this.#options.report(failure)
      }
    }
    try {
      await this.#close(error, true)
    } catch (failure) {
      this.#options.report(failure)
    }
  }

  /** Every asynchronous codec/hook continuation checks this before publication or physical write. */
  #assertOpen(): void {
    if (this.#closing) throw this.#reason
  }
}
