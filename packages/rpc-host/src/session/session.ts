/** One physical connection owns codec stages, agreement, controls and terminal cleanup. */
import {
  deferred,
  raceWithAbort,
  withTimeout,
  type IAbortSignal,
  type IDeferred,
  type ITimeoutOperation
} from '@migaia/utils/promise'
import { UtilsAbortError, UtilsTimeoutError, attachSecondaryErrors } from '@migaia/utils/error'
import { inspectThenable, assimilateCapturedThen } from '@migaia/utils/function'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import {
  RpcProbeStage as S,
  RpcProbeDirection as D,
  RpcProbeKind,
  RpcProbeOutcome,
  rpcProbeEnvelopeFacts,
  RpcProbeLifecycle,
  rpcCarrierWriteFacts,
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
  type IRpcSessionView,
  type RpcSessionRetirement
} from '@migaia/rpc-contract/interfaces'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  normalizeRpcHandshake,
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
  RpcLifecycleError,
  RpcSerializationError,
  RPC_CONTRACT_SOURCE,
  safeRead
} from '@migaia/rpc-contract/errors'
import {
  createRpcError,
  createRpcAbortError,
  createRpcLifecycleError,
  createRpcProtocolError,
  createRpcSerializationError,
  createRpcTimeoutError,
  createRpcTransportError,
  isLocalRpcError
} from '../host/error-owner.js'
import {
  hostErrorWireMetadata,
  serializeHostHandshakeError,
  serializeHostWireError
} from '../host/error-wire-metadata.js'
import { SessionText } from './text.js'
import {
  createDirectorySnapshot,
  projectDirectory,
  sameDirectoryFingerprint,
  type IRpcDirectoryFingerprint
} from './view.js'
import { RpcSessionObservation } from '../sdk/carrier/observation.js'
import { portableBytes } from '../sdk/wire/portable-size.js'
import { rpcPortableBackingLength } from '@migaia/rpc-contract/portable'
import { isRpcCarrierAdmissionFailure } from '../sdk/carrier/admission.js'
import { RpcFlowPoint } from '../sdk/flow-pipelines.js'
import type { IRpcSessionOptions, IRpcSessionWriteOptions } from './types.js'
import { bindSessionCredentials, type ISessionCredentials } from './credentials.js'

/** A live control record holds settlement only, never a business payload or request facade. */
type IControlPending = { completion: IDeferred<void>; signal: IAbortSignal }

/** Prepared data and its codec context stay paired through the one original encoding path. */
type ISessionPreparation = Readonly<{ prepared: IRpcPreparedMessage; context: IRpcCodecContext }>
/** One physical frame lends its original logical emission prefix to every native next branch. */
type IIngressPrefix = { previous: Promise<void> }
/** One short-lived media job retains admission facts, never a second business call table. */
type ISessionWrite = {
  frame: IRpcSemanticFrame
  options?: IRpcSessionWriteOptions
  keepalive: boolean
  continuing: boolean
  bytes: number
  capture?: ISessionPreparation
}

/** Existing terminals and control exchanges can finish without admitting a new provider task. */
function isSessionReply(frame: IRpcSemanticFrame): boolean {
  return (
    frame.kind !== K.call &&
    frame.kind !== K.group &&
    frame.kind !== K.handshake &&
    frame.kind !== K.directory &&
    (frame.kind !== K.outcome || frame.operation === 'result')
  )
}

/** Stateful media work remains here, outside the pure contract and outside business work tables. */
export class Session {
  /** Explicit collaborators own identity, indexing and actual business execution elsewhere. */
  readonly #options: IRpcSessionOptions
  /** Readonly stage projection borrows this Session's facts without owning media or cleanup. */
  readonly #observation: RpcSessionObservation
  /** Native secrets belong to this physical connection and are cleared on retirement. */
  readonly #credentials: ISessionCredentials
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
  /** Equal catalogs need no repeat write; peer identity applies split horizon across carriers. */
  #directoryFingerprint: IRpcDirectoryFingerprint | undefined
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
  /** Only actual codec/authentication work occupies the original three receive verification slots. */
  #verifying = 0
  /** FIFO admission wakes one arrival at a time without copying a queue or waking every waiter. */
  #verificationAdmission: Promise<void> = Promise.resolve()
  /** Only the head admission waits for a released slot; later arrivals wait on its original tail. */
  #verificationAvailable: (() => void) | undefined
  /** Terminal transition synchronously stops all later writes and publication. */
  #closing = false
  /** The final close seals further writes only after all admitted closing work has drained. */
  #ending = false
  /** A queued admitted wire close takes precedence over a following native EOF fallback. */
  #receivedClose: false | Readonly<{ reason: unknown }> = false
  /** Only an initial native fallback may later yield to its already-queued complete close reason. */
  #physicalFailure = false
  /** Closing writes enter this one FIFO before asynchronous codec preparation can reorder them. */
  #writing: Promise<void> = Promise.resolve()
  /** Only in-flight closing keepalive semantic bytes consume the physical Session quota. */
  #keepaliveBytes = 0
  /** Work callbacks and pending controls receive the same original terminal reason. */
  #reason: unknown
  /** Final abort publishes one shared immutable error after the native terminal reason is selected. */
  #closeError: unknown
  /** Control correlation is independent of business CallTable records. */
  readonly #controls = new Map<string, IControlPending>()
  /** A connection-local serial cannot collide with another physical session's controls. */
  #controlSerial = 0
  /** Native transports receive only these three lifecycle operations. */
  readonly handle: IRpcPrivateSession

  /** Allocate terminal/readiness identity before any listener can reenter this owner. */
  constructor(options: IRpcSessionOptions) {
    /** Retained lifecycle collaborators never retain the original secret-bearing context. */
    const { connection, ...collaborators } = options
    this.#options = collaborators
    this.#observation = new RpcSessionObservation({
      namespace: collaborators.namespace,
      carrierId: collaborators.carrier.id,
      view: () => this.#view,
      mediaFacts: () => this.#options.carrier.observation?.facts,
      descriptorFacts: () => ({
        ...this.#options.flow.facts(this.#options.namespace).observationFacts,
        endpointId: this.#options.self().instanceId
      }),
      emit: collaborators.flow.observe && ((event) => this.#options.flow.observe?.(event))
    })
    this.#credentials = { value: connection?.credentials, retain: connection?.retain }
    bindSessionCredentials(this.#handshakeResult, this.#credentials)
    this.#handshakeResult.authentication = connection?.authentication
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
      canKeepalive: () => this.canKeepalive(),
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

  /** Closing admission borrows the actual carrier capability and this Session's final write seal. */
  canKeepalive(): boolean {
    return (
      this.#closing &&
      this.#options.carrier.closingWrites === true &&
      !this.#ending &&
      !this.#controller.signal.aborted
    )
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
      if (this.#options.flow.facts(this.#options.namespace).observing)
        this.#unobserve = this.#options.carrier.observation?.subscribe((event) =>
          this.#observation.carrier(event)
        )
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
      void this.#close(error, false, false, true)
      return
    }
    if (!this.#closing) {
      this.#observation.lifecycle(RpcProbeLifecycle.handshake)
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
        SessionText.handshakeScheduleFailed
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

  /** Clear the original scheduler receipt before cancellation can reenter this Session. */
  #cancelHandshakeTimer(): void {
    /** Only the original scheduled receipt is ever cancelled, at accepted readiness or retirement. */
    const timer = this.#handshakeTimer
    this.#handshakeTimer = undefined
    timer?.task.cancel()
  }

  /** Reject unsupported native transfer presence without reading caller getters or payload data. */
  assertTransfer(options?: object): void {
    if (!options || !Object.hasOwn(options, 'transfer')) return
    /** Selected flow restrictions narrow actual native capability before caller getters run. */
    const facts = this.#options.flow.facts(this.#options.namespace)
    if (facts.nativeBinary === false)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    this.#options.carrier.assertTransfer(facts.transferRequiresIntegrity)
  }

  /** Freeze closing admission and FIFO position before asynchronous preparation can complete. */
  send(frame: IRpcSemanticFrame, options?: IRpcSessionWriteOptions): Promise<void> {
    /** Open keepalive flags remain ordinary even when later codec work resumes during closing. */
    const keepalive = this.canKeepalive() && options?.keepalive === true
    /** All callbacks borrow one explicit operation context rather than parallel captured locals. */
    const job: ISessionWrite = {
      frame,
      options,
      keepalive,
      continuing: keepalive || isSessionReply(frame),
      bytes: 0
    }
    if (!keepalive) return this.#sendJob(job)
    /** Reserve FIFO order now; early capture/quota rejection never overtakes an older write. */
    const previous = this.#writing
    const writing = this.#captureKeepalive(job)
      .then(() => previous.then(() => this.#sendJob(job)))
      .finally(() => {
        this.#keepaliveBytes -= job.bytes
      })
    // The returned write owns its rejection; the FIFO tail only releases the next queued write.
    this.#writing = previous.then(() => writing).catch(() => undefined)
    return writing
  }

  /** Capture once before the queue, then charge prepared metadata plus actual native backings. */
  async #captureKeepalive(job: ISessionWrite): Promise<void> {
    await this.#controlled(async () => {
      this.#assertOpen(true)
      const transfer = this.#snapshotTransfer(job.options)
      job.options = {
        signal: job.options?.signal,
        transfer,
        keepalive: true,
        sendClass: job.options?.sendClass,
        trace: job.options?.trace,
        onWriteStart: job.options?.onWriteStart
      }
      const context = this.#codecContext(false, job.options)
      this.#observation.media(S.envelope, D.outbound, job.frame, job.frame)
      const prepared = await this.#options.carrier.codec.prepare(job.frame, context)
      this.#assertOpen(true)
      job.capture = { prepared, context }
    }, job.options?.signal)
    const available =
      (this.#options.keepalive?.maxBytes ?? SessionText.defaultKeepaliveBytes) -
      this.#keepaliveBytes
    const prepared = job.capture!.prepared
    let bytes = portableBytes(
      (prepared.manifest ?? prepared.message) as Parameters<typeof portableBytes>[0],
      available
    )
    for (const backing of prepared.sidecars) {
      if (bytes > available) break
      bytes += rpcPortableBackingLength(backing)
    }
    if (bytes > available)
      throw createRpcError(
        RpcCoreErrorCode.keepaliveQuotaExceeded,
        RpcCoreErrorText.keepaliveQuotaExceeded
      )
    job.bytes = bytes
    this.#keepaliveBytes += bytes
  }

  /** The original controlled write consumes the same preparation without recapturing queued data. */
  #sendJob(job: ISessionWrite): Promise<void> {
    return this.#controlled(async ({ signal }) => {
      this.#assertOpen(job.continuing)
      const transfer = job.capture ? job.options?.transfer : this.#snapshotTransfer(job.options)
      if (!this.#view) await this.#ready.promise
      await this.#encode(
        job.frame,
        {
          signal,
          transfer,
          keepalive: job.keepalive,
          sendClass: job.options?.sendClass,
          trace: job.options?.trace,
          onWriteStart: job.options?.onWriteStart
        },
        false,
        job.continuing,
        job.capture
      )
    }, job.options?.signal)
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

  /** Share native cancellation and error translation across media writes and health controls. */
  #controlled(
    operation: ITimeoutOperation<void>,
    signal?: IAbortSignal,
    timeoutMs?: number | false,
    connectionAbort = true
  ): Promise<void> {
    const controls = {
      /** Controls already settle through their completion table; only writes need this second race. */
      signals: connectionAbort
        ? signal
          ? [this.#controller.signal, signal]
          : [this.#controller.signal]
        : signal
          ? [signal]
          : [],
      report: this.#options.report
    }
    return (
      timeoutMs === undefined || timeoutMs === false
        ? raceWithAbort(operation, controls)
        : withTimeout(operation, {
            ...controls,
            timeoutMs,
            scheduler: this.#options.scheduler,
            zeroTimeoutBehavior: 'start'
          })
    ).catch((error) => {
      throw this.#controlError(error)
    })
  }

  /** Health controls use the same abort/error owner plus their own bounded timer and id cleanup. */
  ping(options?: IRpcPingOptions): Promise<void> {
    /** Allocate correlation before reading caller options, preserving the original entry order. */
    const id = String(++this.#controlSerial)
    /** Timeout precedes signal getter observation even though both share the controlled owner. */
    const timeoutMs = options?.timeoutMs ?? this.#options.controlTimeoutMs
    return this.#controlled(
      ({ signal }) => this.#ping(id, signal),
      options?.signal,
      timeoutMs,
      false
    )
      .catch((error) => {
        const pending = this.#controls.get(id)
        pending?.completion.reject(pending.signal.reason ?? error)
        /** Already-pending controls retain the selected close reason, not its abort wrapper. */
        throw this.#controller.signal.aborted ? this.#reason : error
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
    /** Public and private native paths borrow the table's same namespace preparation. */
    const peerId = this.#view!.peerId
    /** Direct Session fixtures can still supply their existing standalone directory port. */
    const snapshot =
      this.#options.directorySnapshot?.() ??
      createDirectorySnapshot(this.#options.directory(peerId))
    /** Keep receiver selection with the shared metadata, including the initial unidentified hello. */
    const fingerprint = { snapshot, peerId }
    /** An unchanged visible directory may still release an older namespace snapshot. */
    const previous = this.#directoryFingerprint
    this.#directoryFingerprint = fingerprint
    if (previous && sameDirectoryFingerprint(previous, fingerprint)) return
    /** Only changed wire output allocates the recipient's method vector. */
    const directory = projectDirectory(snapshot, peerId)
    try {
      await this.send({
        profile: RpcWireProfile,
        kind: K.directory,
        id: String(++this.#controlSerial),
        route: this.#route(),
        directory
      })
    } catch (error) {
      if (
        this.#directoryFingerprint &&
        sameDirectoryFingerprint(this.#directoryFingerprint, fingerprint)
      )
        this.#directoryFingerprint = undefined
      throw error
    }
  }

  /** Explicit lifecycle close retains its original reason and public Promise identity. */
  readonly close = (reason?: unknown, kind?: RpcSessionRetirement): Promise<void> =>
    this.#close(
      kind && this.#options.carrier.mapRetirement
        ? this.#options.carrier.mapRetirement(kind, reason)
        : reason
    )

  /** The physical ingress fact survives retirement without changing shared native error identity. */
  #close(
    reason?: unknown,
    physicalFailure = false,
    closeFrame = false,
    skipReceiving = physicalFailure || closeFrame
  ): Promise<void> {
    if (closeFrame) {
      this.#receivedClose = {
        reason: reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
      }
      reason = this.#receivedClose.reason
      if (this.#closing && this.#physicalFailure) this.#refineCloseReason(reason)
    }
    if (this.#closing) return this.#closed.promise
    this.#closing = true
    this.#physicalFailure = physicalFailure
    this.#reason = reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    this.#observation.lifecycle(RpcProbeLifecycle.closing, this.#reason)
    this.#cancelHandshakeTimer()
    this.#ready.reject(this.#reason)
    this.#offered.reject(this.#reason)
    this.#offer = undefined
    this.#remoteId = undefined
    this.#candidate = undefined
    this.#admissionDeadline = undefined
    this.#handshakeResult.authentication = undefined
    this.#credentials.value = undefined
    this.#credentials.retain = undefined
    void this.#finishClose(physicalFailure, skipReceiving).then(
      this.#closed.resolve,
      this.#closed.reject
    )
    return this.#closed.promise
  }

  /** Select the terminal reason without mutating errors already delivered during closing. */
  #refineCloseReason(reason: unknown): void {
    this.#reason = reason
  }

  /** One budget bounds native reason selection, application hooks, FIFO writes and final close. */
  async #finishClose(physicalFailure: boolean, skipReceiving: boolean): Promise<void> {
    if (
      (this.#view && this.#options.carrier.closingWrites) ||
      (physicalFailure && this.#options.carrier.terminalReason)
    ) {
      try {
        await withTimeout(
          async ({ signal }) => {
            if (physicalFailure) await this.#receiving
            if (physicalFailure && !this.#receivedClose && this.#options.carrier.terminalReason) {
              const reason = await this.#options.carrier.terminalReason()
              if (!signal.aborted && reason !== undefined) this.#refineCloseReason(reason)
            }
            if (signal.aborted) return
            if (this.#view && this.#options.carrier.closingWrites) {
              try {
                await this.#options.closing?.(this.#view, this.#reason)
              } catch (error) {
                this.#options.report(error)
              }
              await this.#writing
              this.#ending = true
              if (!physicalFailure && !this.#receivedClose && !signal.aborted)
                await this.#encode(
                  {
                    ...this.#control(C.close, String(++this.#controlSerial)),
                    reason: serializeHostWireError(this.#reason, { report: this.#options.report })
                  },
                  { signal, keepalive: true },
                  false,
                  true
                )
            }
          },
          {
            timeoutMs: this.#options.keepalive?.timeoutMs ?? SessionText.defaultKeepaliveTimeoutMs,
            scheduler: this.#options.scheduler,
            report: this.#options.report
          }
        )
      } catch (error) {
        this.#options.report(
          attachSecondaryErrors(
            createRpcLifecycleError(RpcCoreErrorText.endpointDisposed, this.#reason),
            [error]
          )
        )
      }
    }
    this.#ending = true
    try {
      this.#options.retire(
        this.#view,
        this.#reason,
        physicalFailure && !this.#receivedClose,
        this.#receivedClose || undefined
      )
    } catch (error) {
      this.#options.report(error)
    }
    /** Terminal selection is complete; this one immutable error becomes the shared abort reason. */
    this.#closeError = this.#controlError(this.#reason)
    this.#controller.abort(this.#closeError)
    for (const pending of this.#controls.values()) pending.completion.reject(this.#reason)
    this.#controls.clear()
    const remove = this.#unsubscribe
    this.#unsubscribe = undefined
    await this.#writing
    await this.#cleanup(remove, skipReceiving)
  }

  /** Physical close settles queued writes before joining the reply; ingress never waits on itself. */
  async #cleanup(remove: IRpcDispose | undefined, skipReceiving: boolean): Promise<void> {
    /** Keep all original cleanup values reachable if multiple native releases fail. */
    const failures: unknown[] = []
    // These two carrier releases remain supported cleanup boundaries in their original order.
    for (const release of [() => remove?.(), () => this.#options.carrier.close(this.#reason)]) {
      try {
        await release()
      } catch (error) {
        failures.push(error)
        this.#options.report(error)
      }
    }
    /** Native observation removal is an infallible unsubscribe, after critical physical cleanup. */
    const unobserve = this.#unobserve
    this.#unobserve = undefined
    await unobserve?.()
    try {
      await this.#reply
    } catch (error) {
      if (error !== this.#reason && error !== this.#closeError) this.#options.report(error)
    }
    /** External close joins admitted ingress before its native stage owner is revoked. */
    if (!skipReceiving) await this.#receiving
    this.#view = undefined
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
    const peerId = this.#remoteId ?? this.#options.expectedPeerId
    /** The selected peer can be unknown on the first hello and known on later announcements. */
    const snapshot =
      this.#options.directorySnapshot?.() ??
      createDirectorySnapshot(this.#options.directory(peerId))
    /** Handshake output uses the same split-horizon projection as directory frames. */
    const directory = projectDirectory(snapshot, peerId)
    this.#directoryFingerprint = { snapshot, peerId }
    /** Installed flow handlers, rather than user metadata, supply extension authority. */
    const hello: IRpcHello = {
      profile: RpcWireProfile,
      kind: K.handshake,
      step: H.hello,
      versions: [RpcWireVersion],
      codecs: this.#options.carrier.codecs,
      extensions: this.#options.flow.facts(this.#options.namespace).extensions,
      requiredExtensions: this.#options.flow.facts(this.#options.namespace).required,
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
    if (this.#controller.signal.aborted) return
    this.#observation.media(S.frame, D.inbound, frame)
    /** Accepted frames may verify together; bootstrap still uses its original serial agreement. */
    const previous = this.#receiving
    /** Parallel logical next calls from this same physical input reserve their own arrival order. */
    const ingress = { previous }
    /** The original physical prefix remains joined even when an authenticated control bypasses it. */
    const receiving = (
      this.#view
        ? this.#receiveFrame(frame, ingress)
        : previous.then(() => this.#receiveFrame(frame, ingress))
    ).catch((error) => this.#fail(error, true))
    this.#receiving = previous.then(() => receiving)
  }

  /** Process one admitted ingress slot through its actual accepted or bootstrap codec boundary. */
  async #receiveFrame(frame: IRpcCarrierFrame, ingress: IIngressPrefix): Promise<void> {
    this.#assertOpen(true, true)
    if (this.#view)
      await this.#options
        .pipelines()
        .pipeline(RpcFlowPoint.frameInbound, this.#options.namespace)
        .run({ frame, context: this.#context('inbound') }, async (payload) =>
          this.#decode(payload.frame, ingress)
        )
    else await this.#decode(frame, ingress)
  }

  /** Reserve logical emission order; the original native next Promise still owns every failure. */
  #decode(frame: IRpcCarrierFrame, ingress: IIngressPrefix): Promise<void> {
    /** The verification admission await precedes any user codec/hook and possible reentry. */
    const previous = ingress.previous
    const decoding = this.#decodeMessage(frame, previous)
    /** A failed member releases ordering without handling its caller's original native next error. */
    ingress.previous = previous
      .then(() => decoding)
      .then(
        () => undefined,
        () => undefined
      )
    return decoding
  }

  /** Reserve one slot in O(1); the same Session tail gives every queued arrival one FIFO wakeup. */
  async #enterVerification(): Promise<boolean> {
    /** Only this compact receipt, never a frame, is retained by admission successors. */
    const admitted = deferred<void>()
    /** Publish this position before suspending so reentrant arrivals cannot overtake it. */
    const previous = this.#verificationAdmission
    this.#verificationAdmission = admitted.promise
    try {
      await previous
      if (this.#verifying === SessionText.maximumConcurrentVerifications)
        await new Promise<void>((resolve) => {
          this.#verificationAvailable = resolve
        })
      if (this.#controller.signal.aborted) return false
      this.#verifying += 1
      return true
    } finally {
      admitted.resolve()
    }
  }

  /** Decode protected metadata, authenticate it, then restore original admitted binary values. */
  async #decodeMessage(frame: IRpcCarrierFrame, previous: Promise<void>): Promise<void> {
    if (!(await this.#enterVerification())) return
    /** Envelope hooks may reject before native business values become observable. */
    let message: IRpcSemanticFrame | undefined
    try {
      /** The physical codec owns the canonical semantic parser; no second walker runs here. */
      const context = this.#codecContext(!this.#view)
      this.#observation.media(S.encoded, D.inbound, frame.data)
      /** Four-stage media boundary leaves protected metadata visible before restoration. */
      const decoded = await this.#options.carrier.codec.decode(frame, context)
      /** Only a restored, route-admitted frame can authorize correlated failure settlement. */
      let admitted: IRpcSemanticFrame | undefined
      /** Auth joins the original cached native integrity result before committing replay state. */
      const envelopeContext: IRpcEnvelopeContext = {
        ...this.#context('inbound'),
        restore: async (prepared) => {
          /** Accepted-channel grammar failures retain the receiving endpoint's protocol family. */
          let message: IRpcSemanticFrame
          try {
            message = await this.#options.carrier.codec.restore(prepared, context)
          } catch (error) {
            if (
              this.#view &&
              error instanceof TypeError &&
              safeRead(error, 'source') === RPC_CONTRACT_SOURCE &&
              safeRead(error, 'code') === RpcContractErrorCode.invalidEnvelope
            )
              throw createRpcProtocolError(error.message, error)
            throw error
          }
          if (!this.#admitRoute(message)) return undefined
          admitted = message
          if (this.#closing && this.#view && !isSessionReply(message))
            throw this.#controlError(this.#reason)
          return message
        }
      }
      try {
        await this.#options
          .pipelines()
          .pipeline(RpcFlowPoint.envelopeInbound, this.#options.namespace)
          .run({ prepared: decoded, context: envelopeContext }, async (payload) => {
            /** Codec restore returns a frame admitted through the sole pure wire grammar. */
            message = await payload.context.restore(payload.prepared)
          })
      } catch (error) {
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
    } finally {
      this.#verifying -= 1
      /** Wake only the original head waiter; native Promise resolution cannot synchronously reenter. */
      const available = this.#verificationAvailable
      this.#verificationAvailable = undefined
      available?.()
    }
    if (message === undefined) return
    /** Only authenticated control identity may bypass earlier business verification/delivery. */
    if (message.kind !== K.handshake && message.kind !== K.control && message.kind !== K.cancel)
      await previous
    if (this.#controller.signal.aborted) return
    this.#assertOpen(true, true)
    this.#observation.media(S.envelope, D.inbound, message, message)
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
      this.#observation.event({
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
    /** A reused native port can still deliver the previous host's terminal frame. */
    if (message.route.receiverId !== this.#options.self().instanceId) return false
    if (!this.#view)
      throw createContractError(
        RpcContractErrorCode.handshakeInvalid,
        undefined,
        hostErrorWireMetadata
      )
    return message.route.senderId === this.#view.peerId
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
    /** Deterministic role changes confirmation, never the canonical validation or source owner. */
    const responder = offer.peer.id > remote.peer.id
    const accepted =
      remote.step === H.hello
        ? acceptRpcHandshake(
            responder ? remote : offer,
            responder ? offer : remote,
            hostErrorWireMetadata
          )
        : completeRpcHandshake(offer, remote, hostErrorWireMetadata)
    if (remote.step === H.hello && !responder) return
    if (remote.step === H.accept && responder) {
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
    const view = await this.#options.admit(
      remote.step === H.hello ? remote.directory : accepted.directory,
      accepted.codec,
      accepted.extensions,
      this.#authentication()
    )
    this.#assertOpen()
    /** Raise the native cap before sending accept, so a coalesced confirmation/business frame fits. */
    this.#options.carrier.setInboundFrameLimit?.(this.#options.maxFrameBytes)
    if (responder) this.#candidate = view
    this.#reply = this.#writeHandshake(
      responder
        ? accepted
        : {
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
          }
    )
    await this.#reply
    if (!responder) this.#publish(view)
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
      this.#observation.describe()
      this.#assertOpen()
    }
    this.#ready.resolve(view)
    this.#options.changed?.()
    if (first) this.#observation.lifecycle(RpcProbeLifecycle.ready)
  }

  /**
   * Cold directory updates reuse the same admission/index owner and cannot change physical
   * identity.
   */
  async #directory(value: IRpcDirectory): Promise<void> {
    if (value.self.instanceId !== this.#view!.peerId)
      throw createRpcProtocolError(SessionText.identityMismatch)
    /** Preserve selected codec/extensions across descriptive method or display-name updates. */
    const view = await this.#options.admit(
      value,
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
    bootstrap: boolean,
    continuing = false,
    capture?: ISessionPreparation
  ): Promise<void> {
    const final = message.kind === K.control && message.operation === C.close
    this.#assertOpen(continuing, final)
    /** Derive header-only native admission facts before the selected codec makes frames opaque. */
    options = { ...options, ...rpcCarrierWriteFacts(message) }
    /** Bootstrap always uses common JSON and has no native transfer permission. */
    const context = capture?.context ?? this.#codecContext(bootstrap, options)
    if (!capture) this.#observation.media(S.envelope, D.outbound, message, message)
    /** Closing quota already owns this exact preparation; ordinary traffic captures here once. */
    const captured =
      capture?.prepared ?? (await this.#options.carrier.codec.prepare(message, context))
    /** Auth/schema plugins see prepared metadata outside physical codec execution. */
    /** Only a native terminal may publish transformed metadata to physical encoding. */
    let prepared: IRpcPreparedMessage | undefined
    await this.#options
      .pipelines()
      .pipeline(RpcFlowPoint.envelopeOutbound, this.#options.namespace)
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
    /** Explicit grants retain native handoff even when the codec metadata does not reference them. */
    this.#observation.media(S.encoded, D.outbound, encoded.data, message, options.transfer)
    this.#assertOpen(continuing, final)
    /** A single logical reservation belongs to this whole run, including all native next branches. */
    const admission = this.#options.carrier.reserveWrite?.(options)
    /** This write borrows the prepared operation's exact options, message and bootstrap boundary. */
    const writeContext = {
      options: { ...options, admission, ...(options?.keepalive ? { closing: true as const } : {}) },
      message,
      bootstrap,
      continuing,
      final
    }
    /** The continuation is the sole physical handoff point, including optional chunk/batch output. */
    const write = async (payload: IRpcFramePayload): Promise<void> => {
      /** Replacement frame payloads carry the matching physical options through every branch. */
      const { frame, write: physical = writeContext.options } = payload
      this.#assertOpen(writeContext.continuing, writeContext.final)
      /** A batch may clear only its first logical signal, never the held Session's terminal fence. */
      const signal = physical?.signal === false ? this.#controller.signal : physical?.signal
      this.#observation.media(S.frame, D.outbound, frame, writeContext.message, physical?.transfer)
      this.#assertOpen(writeContext.continuing, writeContext.final)
      if (signal?.aborted) throw signal.reason
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
      else
        await this.#options
          .pipelines()
          .pipeline(RpcFlowPoint.frameOutbound, this.#options.namespace)
          .run(payload, write)
    } finally {
      admission?.release()
    }
    if (message.kind === K.control)
      this.#observation.event({
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
          /** Void callbacks retain their synchronous handoff; only actual async sealing waits. */
          const result: unknown = options.onWriteStart!()
          /** Inspect once so a user then getter cannot replace its original failure. */
          const inspection = inspectThenable(result)
          if ('error' in inspection) throw inspection.error
          if (inspection.then)
            return assimilateCapturedThen<void>(inspection.then, result).catch((error) => {
              admission = { error }
              throw error
            })
        } catch (error) {
          admission = { error }
          throw error
        }
      })
    try {
      await this.#options.carrier.write(frame, { ...options, onWriteStart })
    } catch (cause) {
      if (admission) throw admission.error
      if (
        bootstrap ||
        (isRpcCarrierAdmissionFailure(cause) &&
          safeRead(cause, 'code') !== RpcContractErrorCode.frameLimitExceeded) ||
        isLocalRpcError(cause, RpcLifecycleError)
      )
        throw cause
      throw createRpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
    }
  }

  /** Negotiated facts are borrowed; arbitrary caller options cannot grant native binary support. */
  #codecContext(bootstrap: boolean, options?: IRpcSessionWriteOptions): IRpcCodecContext {
    return {
      codec: bootstrap ? RpcWireJsonCodec : this.#view!.codec,
      nativeBinary:
        !bootstrap &&
        this.#options.carrier.nativeBinary &&
        this.#options.flow.facts(this.#options.namespace).nativeBinary !== false,
      transferRequiresIntegrity:
        !bootstrap &&
        this.#options.flow.facts(this.#options.namespace).transferRequiresIntegrity === true,
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
        direction === 'outbound' ? RpcFlowPoint.handshakeOutbound : RpcFlowPoint.handshakeInbound,
        this.#options.namespace
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
    if (frame.operation === C.close) {
      void this.#close(
        frame.reason && deserializeRpcWireError(frame.reason, hostErrorWireMetadata),
        false,
        true
      )
      return
    }
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
    this.#assertOpen(true, true)
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
    if (this.#closing) {
      if (this.#controller.signal.aborted) return this.#closeError
      return this.#options.carrier.closingWrites
        ? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed, this.#reason)
        : this.#reason
    }
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
      if (
        error !== this.#reason &&
        error !== this.#closeError &&
        safeRead(error, 'cause') !== this.#reason
      )
        this.#options.report(error)
      return
    }
    /** Provider cancellation keeps the original typed reason beside its public protocol report. */
    const reported =
      this.#view &&
      error instanceof TypeError &&
      safeRead(error, 'source') === RPC_CONTRACT_SOURCE &&
      safeRead(error, 'code') === RpcContractErrorCode.invalidWireError
        ? createRpcProtocolError(error.message, error)
        : error
    this.#options.report(reported)
    if (reject && !this.#view && this.#offer) {
      this.#reply = this.#writeHandshake({
        profile: RpcWireProfile,
        kind: K.handshake,
        step: H.reject,
        error: serializeHostHandshakeError(error, { report: this.#options.report })
      })
      try {
        await this.#reply
      } catch (failure) {
        this.#options.report(failure)
      }
    }
    // Ingress never joins its own close: the same bounded close may wait for this receive tail.
    void this.#close(error, false, false, true).catch(this.#options.report)
  }

  /** Every asynchronous codec/hook continuation checks this before publication or physical write. */
  #assertOpen(continuing = false, final = false): void {
    if (
      this.#controller.signal.aborted ||
      (this.#closing && !continuing) ||
      (this.#ending && !final)
    )
      throw this.#controlError(this.#reason)
  }
}
