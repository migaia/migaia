/**
 * Own replay state for one installation; fixed hooks verify data and dispatch supplies business
 * completion. Native cancellation releases this state without owning Sessions or providers.
 */
import { raceWithAbort, type IAbortSignal } from '@migaia/utils/promise'
import { UtilsAbortError } from '@migaia/utils/error'
import type {
  IRpcFlowContext,
  IRpcEnvelopeContext,
  IRpcPreparedMessage,
  IRpcDispatchContext,
  IRpcAuthenticationRetain
} from '@migaia/rpc-contract/interfaces'
import {
  RpcProbeStage,
  RpcProbeAuthentication,
  RpcProbeDirection,
  RpcProbeObservationKind,
  RpcDispatchDrop
} from '@migaia/rpc-contract/interfaces'
import type {
  IRpcHandshake,
  IRpcPortableValue,
  IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { RpcWireHandshakeStep, RpcWireKind } from '@migaia/rpc-contract/protocol'
import {
  RpcAuthenticationError,
  RpcConfigurationError,
  RpcCoreErrorText,
  RpcProviderRejectionReason
} from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  createRpcAuthenticationError,
  createRpcConfigurationError,
  createRpcError,
  isLocalRpcError
} from '../../host/error-owner.ts'
import { registerLocalErrorWireSummary } from '../../host/error-wire-metadata.ts'
import { resolveAbortReason } from '../../host/abort-reason.ts'
import { splitRpcPreparedMetadata, joinRpcPreparedMetadata } from '../../sdk/carrier/prepared.ts'
import type { IRpcFlowInstallation, IRpcFlowSetupContext } from '../../sdk/types.ts'
import { RpcFlowPoint, type IRpcFlowStage } from '../../sdk/flow-pipelines.ts'
import { AuthenticationRepresentation } from './representation.ts'
import { RpcAuthenticationEnvelope as Format } from './constants.ts'
import { RpcAuthenticationText as Text } from './text.ts'
import {
  admitAuthenticationCounter,
  createAuthenticationNonce,
  readAuthenticationEnvelope,
  wrapAuthenticationEnvelope
} from './envelope.ts'
import { registerAuthenticationCounterSetter } from './counter.ts'
import type { IAuthenticationCounterWindow, IRpcAuthenticationOptions } from './types.ts'
import { RequestReplayLedger, type IRequestReplaySource } from './request-replay.ts'
import { readAuthenticationHandshake, wrapAuthenticationHandshake } from './handshake.ts'
import { readSessionCredentials, readSessionRetention } from '../../session/credentials.ts'
import { readAuthenticationRetain } from './config.ts'

/** Keep nonce, replay window and retirement subscription with their physical source. */
type IAuthenticationSource = IRequestReplaySource & {
  id: string
  signal: IAbortSignal
  /** Keep the connection's validated retention override with its source. */
  retain: IRpcAuthenticationRetain
  window?: IAuthenticationCounterWindow
  /** A rebuilt logical source must prove this receiver's new challenge before becoming ready. */
  challenge?: string
  /** Pin the peer challenge until the physical source retires. */
  remoteChallenge?: string
  abort(): void
}

/** Associate route-admitted envelope identity with its verified request counter. */
type IAuthenticationVerification = Readonly<{ source: IAuthenticationSource; counter: bigint }>

/** All transforms, outgoing sequence and inbound replay windows belong to this installed plugin. */
export class RpcAuthenticationFlow {
  /** Immutable callbacks were captured once by the canonical configuration reader. */
  readonly #config: IRpcAuthenticationOptions
  /** The existing replay wrapper preserves explicit string/byte transform categories. */
  readonly #representation: AuthenticationRepresentation
  /** One secure nonce belongs to this installation, independent from shared configuration identity. */
  #nonce: string | undefined
  /** Synchronous uint64 allocation is never rolled back after an asynchronous transform fails. */
  #counter = 0n
  /** Index nonce and 64-bit window by physical source, independently from peer discovery. */
  readonly #sources = new Map<string, IAuthenticationSource>()
  /** Give dispatch verified counters only through restored envelope identity. */
  readonly #verified = new WeakMap<object, IAuthenticationVerification>()
  /** Correlation replay retention is separate from signed-envelope nonce/counter admission. */
  readonly #requests: RequestReplayLedger
  /** Native setup cancellation owns all listener and replay-window cleanup for this installation. */
  readonly #signal: IAbortSignal
  /** Expose protection facts through the observer without exposing mutable replay state. */
  readonly #observe: IRpcFlowSetupContext['observe']
  /** Final cleanup prevents a late verifier from repinning a retired source window. */
  #closed = false
  /** Fixed hooks are the sole installed authentication behavior; host core imports no auth policy. */
  readonly value: IRpcFlowInstallation

  /** Capture transforms and the one bounded request ledger without a Peer or native clock. */
  constructor(
    config: IRpcAuthenticationOptions,
    signal: IAbortSignal,
    observe?: IRpcFlowSetupContext['observe']
  ) {
    this.#config = config
    this.#signal = signal
    this.#observe = observe
    this.#requests = new RequestReplayLedger(config.maxReplayEntriesPerPeer)
    this.#representation = new AuthenticationRepresentation(config.encodedType)
    this.value = {
      /** Let the codec inline binary bytes before encryption. */
      nativeBinary: config.encrypt ? false : undefined,
      /** Apply installed integrity policy before inspecting caller transfer options. */
      ...(config.sign ? { transferRequiresIntegrity: true as const } : {}),
      observationFacts: {
        authentication: config.encrypt
          ? RpcProbeAuthentication.encryptSign
          : config.sign
            ? RpcProbeAuthentication.sign
            : RpcProbeAuthentication.none
      },
      stages: {
        [RpcFlowPoint.handshakeOutbound]: this.#handshake,
        [RpcFlowPoint.handshakeInbound]: this.#handshake,
        [RpcFlowPoint.envelopeOutbound]: async (payload, next) => {
          const prepared = await this.#protectEnvelope(payload.prepared, payload.context)
          await next({ ...payload, prepared })
        },
        [RpcFlowPoint.envelopeInbound]: async (payload, next) => {
          /** Only this feature's restoration failure may drop a forged accepted-source frame. */
          let prepared: IRpcPreparedMessage
          try {
            prepared = await this.#restoreEnvelope(payload.prepared, payload.context)
          } catch (error) {
            /** Release traversal on close while the restore job observes late results. */
            if (this.#acknowledgesCancellation(error, payload.context)) return
            if (payload.context.session && isLocalRpcError(error, RpcAuthenticationError)) {
              payload.context.report(error)
              return
            }
            throw error
          }
          await next({ ...payload, prepared })
        },
        [RpcFlowPoint.dispatchInbound]: this.#dispatch
      },
      dispose: this.close
    }
    registerAuthenticationCounterSetter(this.value, (counter) => {
      this.#counter = counter
    })
    signal.addEventListener('abort', this.close, { once: true })
    if (signal.aborted) this.close()
  }

  /** Deduplicate admitted IDs through business or stream completion and selected retention. */
  readonly #dispatch: IRpcFlowStage<'dispatchInbound'> = async (payload, next) => {
    const { context } = payload
    this.#assert(context)
    /** Attach correlation cleanup to the accepted physical source. */
    const source = this.#source(context)
    /** Consume the verified envelope proof without retaining completed frames. */
    const verified = this.#verified.get(context.envelope)
    this.#verified.delete(context.envelope)
    /** Use the peer admitted by handshake for replay quota identity. */
    const peerKey = context.session?.peerId ?? context.carrierId
    /** The admitted caller stays distinct from the immediate physical source and public task ID. */
    const key = JSON.stringify([
      context.carrierId,
      context.envelope.route.senderId,
      context.envelope.id
    ])
    /** Use one monotonic clock for admission and completion expiry. */
    const now = performance.now()
    if (this.#requests.has(key, now)) {
      payload.outcome.value = RpcDispatchDrop
      return
    }
    /** Window retention requires proof from this physical source. */
    if (source.retain === 'window' && verified?.source !== source)
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
    const entry = this.#requests.admit(source, peerKey, key, now, source.retain, verified?.counter)
    if (!entry) {
      void this.#notify(context, peerKey, key)
      /** Keep detailed local capacity diagnostics while using the safe wire summary. */
      const error = createRpcError(
        RpcCoreErrorCode.overloaded,
        RpcCoreErrorText.requestReplayLedgerIsFull
      )
      registerLocalErrorWireSummary(
        error,
        RpcCoreErrorCode.overloaded,
        RpcCoreErrorText.providerFailed,
        { preserveSerializedError: true }
      )
      throw error
    }
    void context.completion
      .then(() => this.#requests.settle(key, entry, performance.now()))
      .catch(context.report)
    return next(payload)
  }

  /** Notify the local rejection observer without changing the wire reply. */
  async #notify(context: IRpcDispatchContext, peerKey: string, key: string): Promise<void> {
    /** Invoke the rejection observer without a receiver. */
    const observer = this.#config.onRejected
    if (!observer) return
    try {
      await observer(
        Object.freeze({
          verifiedPeerKey: peerKey,
          controllerKey: key,
          method: context.envelope.task.method ?? context.envelope.kind,
          reason:
            context.envelope.kind === RpcWireKind.group
              ? RpcProviderRejectionReason.groupReplayFull
              : RpcProviderRejectionReason.replayLedgerFull
        })
      )
    } catch (cause) {
      context.report(
        createRpcError(
          RpcCoreErrorCode.internal,
          RpcCoreErrorText.providerAdmissionObserverFailed,
          cause
        )
      )
    }
  }

  /** Check credentials during handshake; principal identity alone does not authorize dispatch. */
  readonly #handshake: IRpcFlowStage<'handshakeOutbound'> = async (payload, next) => {
    /** Only the authentication transform is classified as an authentication failure. */
    const handshake = await this.#transformHandshake(payload.handshake, payload.context)
    await next({ ...payload, handshake })
  }

  /** Transform credentials before native continuation so downstream errors keep their identity. */
  async #transformHandshake(
    frame: IRpcHandshake,
    context: IRpcFlowContext
  ): Promise<IRpcHandshake> {
    this.#assert(context)
    if (frame.step === RpcWireHandshakeStep.reject) return frame
    /** Local configuration admission must remain outside the credential-failure privacy boundary. */
    const source = this.#source(context)
    /** Only undefined selects fallback; false and invalid values must reach policy validation. */
    const connectedRetain = readSessionRetention(context)
    source.retain = readAuthenticationRetain(
      connectedRetain !== undefined ? connectedRetain : this.#config.retain,
      !!this.#config.sign
    )
    try {
      if (context.direction === 'outbound') {
        /** Give the captured resolver its connection-local credentials. */
        const configured = this.#config.credentials
        /** Keep static credentials unchanged and cancel resolver waiting on close. */
        const credentials =
          typeof configured === 'function'
            ? await configured({ ...context, credentials: readSessionCredentials(context) })
            : configured
        this.#assert(context)
        if (!this.#config.sign)
          return credentials === undefined ? frame : { ...frame, auth: credentials }
        /** The same source record owns both replay admission and handshake freshness. */
        source.challenge ??= createAuthenticationNonce()
        return {
          ...frame,
          auth: wrapAuthenticationHandshake(credentials, source.challenge, source.remoteChallenge)
        }
      }
      /** Leave credentials-only handshake auth unwrapped. */
      const credentials = this.#config.verify
        ? this.#handshakeCredentials(frame.auth, frame.step, context)
        : frame.auth
      /** Keep the verifier receiver-free like the other authentication callbacks. */
      const verifyCredentials = this.#config.verifyCredentials
      /** Only an explicit verifier result can grant a principal; wire identity never supplies it. */
      const verified = await verifyCredentials?.(credentials, frame.peer, context)
      this.#assert(context)
      if (verified !== null && typeof verified === 'object' && !Array.isArray(verified)) {
        /** Ignore primitive verifier returns; they do not grant principal identity. */
        const principalId = (verified as { principalId?: unknown }).principalId
        if (typeof principalId === 'string' && principalId.length > 0 && context.handshakeResult)
          context.handshakeResult.authentication = { principalId }
      }
      return frame
    } catch (error) {
      if (this.#acknowledgesCancellation(error, context)) throw error
      /** Local diagnostics retain the verifier failure; outbound presentation owns redaction. */
      throw createRpcAuthenticationError(Text.inboundFrameAuthenticationFailed, error)
    }
  }

  /** Require the current receiver challenge to prevent reuse of a prior source's signed accept. */
  #handshakeCredentials(
    auth: IRpcPortableValue | undefined,
    step: IRpcHandshake['step'],
    context: IRpcFlowContext
  ): IRpcPortableValue | undefined {
    /** The source already owns its nonce window and cancellation remover. */
    const source = this.#source(context)
    source.challenge ??= createAuthenticationNonce()
    /** Verification of the outer signed envelope precedes this hook and its private auth fields. */
    const binding = readAuthenticationHandshake(auth)
    if (
      (source.remoteChallenge !== undefined && source.remoteChallenge !== binding.challenge) ||
      (binding.replyChallenge !== undefined && binding.replyChallenge !== source.challenge) ||
      (step === RpcWireHandshakeStep.accept && binding.replyChallenge !== source.challenge)
    )
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
    source.remoteChallenge = binding.challenge
    return binding.credentials
  }

  /** Allocate the replay binding before encryption and sign the complete metadata and manifest. */
  readonly #protectEnvelope = async (
    value: IRpcPreparedMessage,
    context: IRpcEnvelopeContext
  ): Promise<IRpcPreparedMessage> => {
    this.#assert(context)
    if (!this.#config.sign) return value
    try {
      if (this.#counter === Format.maximumCounter) {
        /** Report the same exhaustion error that rejects the outbound stage. */
        const error = createRpcConfigurationError(Text.authenticationCounterExhausted)
        context.report(error)
        throw error
      }
      this.#nonce ??= createAuthenticationNonce()
      /** The complete native backing digest/length manifest stays inside both transforms. */
      const bound = this.#representation.bound(
        wrapAuthenticationEnvelope(joinRpcPreparedMetadata(value), this.#nonce, ++this.#counter),
        !this.#config.encrypt
      )
      /** Encrypt before signing and invoke callbacks without the mutable owner as receiver. */
      const encrypted = this.#config.encrypt
        ? await (0, this.#config.encrypt)(bound, context)
        : bound
      /** Hold the captured callback across suspension so caller mutation cannot replace it. */
      const sign = this.#config.sign
      const protectedValue = await sign(encrypted, context)
      this.#assert(context)
      /** Observe the protected representation before transfer can detach it. */
      const prepared = {
        message: this.#representation.pack(protectedValue),
        sidecars: value.sidecars
      }
      this.#protected(context, prepared.message)
      return prepared
    } catch (error) {
      if (
        this.#acknowledgesCancellation(error, context) ||
        isLocalRpcError(error, RpcAuthenticationError) ||
        isLocalRpcError(error, RpcConfigurationError)
      )
        throw error
      throw createRpcAuthenticationError(Text.outboundFrameAuthenticationFailed, error)
    }
  }

  /** Release the native stage lease when Session cancellation ends verifier waiting. */
  #restoreEnvelope(
    value: IRpcPreparedMessage,
    context: IRpcEnvelopeContext
  ): Promise<IRpcPreparedMessage> {
    /** Classify late restore results with the job's cancellation signal. */
    const input = { value, context }
    if (!this.#config.verify) return this.#restoreEnvelopeJob(input)
    return raceWithAbort(() => this.#restoreEnvelopeJob(input), {
      signal: context.signal,
      /** Report late verifier failures without replacing their identity. */
      report: (error) => {
        if (!this.#acknowledgesCancellation(error, context)) context.report(error)
      }
    })
  }

  /** Verify, decrypt and restore once, then recheck cancellation before using late completion. */
  async #restoreEnvelopeJob(input: {
    value: IRpcPreparedMessage
    context: IRpcEnvelopeContext
  }): Promise<IRpcPreparedMessage> {
    const { value, context } = input
    this.#assert(context)
    if (!this.#config.verify) return value
    this.#protected(context, value.message)
    /** Capture physical source identity before the user verifier can suspend. */
    const source = this.#source(context)
    /** Preserve native failure classification only for the cached restore failure. */
    let validationFailure: unknown
    /** A supported thrown undefined must remain distinct from no integrity failure. */
    let validationFailed = false
    try {
      /** Verify the signature before decrypting its protected payload. */
      const verified = await (0, this.#config.verify)(
        this.#representation.unpack(value.message),
        context
      )
      this.#assert(context)
      /** Decrypted replay fields remain untrusted until their existing binding grammar passes. */
      const decrypted = this.#config.decrypt
        ? await (0, this.#config.decrypt)(verified, context)
        : verified
      this.#assert(context)
      this.#assertSource(source)
      /** Bind the complete prepared metadata to one nonce and counter. */
      const envelope = readAuthenticationEnvelope(this.#representation.plaintext(decrypted))
      /** Keep root identity stable so Session reuses the cached restore Promise. */
      const inner = splitRpcPreparedMetadata(
        this.#representation.metadata(envelope.payload),
        value.sidecars
      )
      /**
       * Accept only the envelope identity admitted by Session grammar, integrity and routing
       * checks.
       */
      let restored: IRpcSemanticFrame | undefined
      try {
        restored = await context.restore(inner)
        if (restored === undefined) return inner
      } catch (error) {
        validationFailed = true
        validationFailure = error
        throw error
      }
      this.#assert(context)
      this.#assertSource(source)
      source.window ??= { nonce: envelope.nonce, high: 0n, bits: new BigUint64Array(1) }
      if (source.window.nonce !== envelope.nonce)
        throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
      /** This request counter is captured before later verified envelopes can advance the window. */
      const counter = BigInt(envelope.counter)
      admitAuthenticationCounter(source.window, counter)
      if (source.retain === 'window') {
        this.#requests.advanceWindow(source)
        if (
          restored.kind === RpcWireKind.call ||
          restored.kind === RpcWireKind.group ||
          restored.kind === RpcWireKind.outcome
        )
          this.#verified.set(restored, { source, counter })
      }
      return inner
    } catch (error) {
      if (validationFailed && error === validationFailure) throw error
      if (
        this.#acknowledgesCancellation(error, context) ||
        isLocalRpcError(error, RpcAuthenticationError)
      )
        throw error
      throw createRpcAuthenticationError(Text.inboundFrameAuthenticationFailed, error)
    }
  }

  /** Accepted physical lifecycle owns one replay state and remover, never caller-visible metadata. */
  #source(context: IRpcFlowContext): IAuthenticationSource {
    /** Source identity is supplied by Session before looking at signed or business fields. */
    let source = this.#sources.get(context.carrierId)
    if (source) return source
    source = {
      id: context.carrierId,
      replayKeys: new Set(),
      signal: context.connectionSignal ?? context.signal,
      retain: readAuthenticationRetain(this.#config.retain, !!this.#config.sign),
      abort: () => undefined
    }
    /** The record carries its compact id so this callback captures only its explicit owner/record. */
    const record = source
    Object.assign(record, {
      abort: () => {
        this.#retire(record)
      }
    })
    this.#sources.set(record.id, record)
    record.signal.addEventListener('abort', record.abort, { once: true })
    if (record.signal.aborted) record.abort()
    return record
  }

  /** Reject a retired or replaced source before applying its replay state. */
  #assertSource(source: IAuthenticationSource): void {
    if (this.#sources.get(source.id) !== source || source.signal.aborted)
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
  }

  /** Check the real operation/connection lifetime after every asynchronous authentication phase. */
  #assert(context: IRpcFlowContext): void {
    /** Prefer the cancelled operation or connection reason over the installation fallback. */
    const signal = context.signal.aborted
      ? context.signal
      : context.connectionSignal?.aborted
        ? context.connectionSignal
        : this.#signal
    if (this.#closed || signal.aborted) throw new UtilsAbortError(resolveAbortReason(signal))
  }
  /** Only this job's cancellation reasons distinguish retirement from an unrelated verifier error. */
  #acknowledgesCancellation(error: unknown, context: IRpcFlowContext): boolean {
    if (!(error instanceof UtilsAbortError)) return false
    return (
      (context.signal.aborted && Object.is(error.cause, resolveAbortReason(context.signal))) ||
      (context.connectionSignal?.aborted === true &&
        Object.is(error.cause, resolveAbortReason(context.connectionSignal))) ||
      (this.#closed && Object.is(error.cause, resolveAbortReason(this.#signal)))
    )
  }
  /** Observe transform inputs without inferring protection from opaque object shape. */
  #protected(context: IRpcFlowContext, content: unknown): void {
    this.#observe?.({
      kind: RpcProbeObservationKind.event,
      namespace: context.namespace,
      carrierId: context.carrierId,
      peerId: context.session?.peerId,
      data: {
        stage: RpcProbeStage.protected,
        direction:
          context.direction === 'outbound' ? RpcProbeDirection.outbound : RpcProbeDirection.inbound,
        peerId: context.session?.peerId,
        // Bootstrap input may contain the connection secret.
        content: context.session ? content : undefined
      }
    })
  }
  /** Retire only this source and drop its pinned nonce/bitmap before late verification can return. */
  #retire(source: IAuthenticationSource): void {
    if (this.#sources.get(source.id) !== source) return
    this.#sources.delete(source.id)
    this.#requests.retire(source)
    source.signal.removeEventListener('abort', source.abort)
  }
  /** Revoke source subscriptions on rollback or final close without another state table. */
  readonly close = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#signal.removeEventListener('abort', this.close)
    for (const source of this.#sources.values()) this.#retire(source)
  }
}
