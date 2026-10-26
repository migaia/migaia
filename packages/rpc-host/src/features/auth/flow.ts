/**
 * Owns one installed authentication flow's signed-counter windows and request-ID replay retention.
 * Fixed handshake/envelope hooks verify admitted data; dispatch borrows real business completion.
 * Native cancellation releases these records without owning Sessions, providers or outcome keys.
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
} from '../../host/error-owner.js'
import { registerLocalErrorWireSummary } from '../../host/error-wire-metadata.js'
import { splitRpcPreparedMetadata, joinRpcPreparedMetadata } from '../../sdk/carrier/prepared.js'
import type { IRpcFlowInstallation, IRpcFlowSetupContext } from '../../sdk/types.js'
import { RpcFlowPoint, type IRpcFlowStage } from '../../sdk/flow-pipelines.js'
import { AuthenticationRepresentation } from './representation.js'
import { RpcAuthenticationEnvelope as Format } from './constants.js'
import { RpcAuthenticationText as Text } from './text.js'
import {
  admitAuthenticationCounter,
  createAuthenticationNonce,
  readAuthenticationEnvelope,
  wrapAuthenticationEnvelope
} from './envelope.js'
import { registerAuthenticationCounterSetter } from './counter.js'
import type { IAuthenticationCounterWindow, IRpcAuthenticationOptions } from './types.js'
import { RequestReplayLedger, type IRequestReplaySource } from './request-replay.js'
import { readAuthenticationHandshake, wrapAuthenticationHandshake } from './handshake.js'
import { readSessionCredentials, readSessionRetention } from '../../session/credentials.js'
import { readAuthenticationRetain } from './config.js'

/** One original physical source owns its pinned nonce/window and exact retirement receipt. */
type IAuthenticationSource = IRequestReplaySource & {
  id: string
  signal: IAbortSignal
  /** This exact physical source keeps its validated connection-over-auth completed-ID policy. */
  retain: IRpcAuthenticationRetain
  window?: IAuthenticationCounterWindow
  /** A rebuilt logical source must prove this receiver's new challenge before becoming ready. */
  challenge?: string
  /** The peer's signed challenge is pinned until this exact physical source retires. */
  remoteChallenge?: string
  abort(): void
}

/** Route-admitted native envelope identity carries only its original verified window counter. */
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
  /** Actual physical ids index one existing nonce/64-bit window, without discovery/challenge tables. */
  readonly #sources = new Map<string, IAuthenticationSource>()
  /** Only original restored envelope identities can lend verified counters to dispatch. */
  readonly #verified = new WeakMap<object, IAuthenticationVerification>()
  /** Correlation replay retention is separate from signed-envelope nonce/counter admission. */
  readonly #requests: RequestReplayLedger
  /** Native setup cancellation owns all listener and replay-window cleanup for this installation. */
  readonly #signal: IAbortSignal
  /** Actual protection facts use the one readonly observer path without exposing replay state. */
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
      /** Encryption includes binary bytes only through the codec's original inline preparation. */
      nativeBinary: config.encrypt ? false : undefined,
      /** Transfer preflight borrows this installed integrity policy before reading caller options. */
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
            /** Close releases this native traversal while the original job reports late results. */
            if (error instanceof UtilsAbortError && payload.context.signal.aborted) return
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

  /** Keep an admitted request ID until actual business/stream completion and bounded retention. */
  readonly #dispatch: IRpcFlowStage<'dispatchInbound'> = async (payload, next) => {
    const { context } = payload
    this.#assert(context)
    /** Only the existing accepted physical source owns this correlation and its retirement. */
    const source = this.#source(context)
    /** Consume this exact verified envelope proof without retaining completed business frames. */
    const verified = this.#verified.get(context.envelope)
    this.#verified.delete(context.envelope)
    /** Quota identity comes from actual business admission, after handshake publishes the peer. */
    const peerKey = context.session?.peerId ?? context.carrierId
    /** The admitted caller stays distinct from the immediate physical source and public task ID. */
    const key = JSON.stringify([
      context.carrierId,
      context.envelope.route.senderId,
      context.envelope.id
    ])
    /** Lazy expiry uses the same monotonic clock for admission and actual completion. */
    const now = performance.now()
    if (this.#requests.has(key, now)) {
      payload.outcome.value = RpcDispatchDrop
      return
    }
    /** Original entry identity prevents late completion from touching a reused correlation. */
    if (source.retain === 'window' && verified?.source !== source)
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
    const entry = this.#requests.admit(source, peerKey, key, now, source.retain, verified?.counter)
    if (!entry) {
      void this.#notify(context, peerKey, key)
      /**
       * Local capacity diagnostics retain their detail; this exact refusal has the original wire
       * summary.
       */
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

  /** Replay refusal preserves the original local observer contract without changing its reply. */
  async #notify(context: IRpcDispatchContext, peerKey: string, key: string): Promise<void> {
    /** A lexical callback keeps the configured observer's original undefined receiver. */
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

  /**
   * Native credentials are checked only by the real handshake verifier; no principal grants
   * dispatch.
   */
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
    /** Undefined alone falls back; false and invalid runtime values retain their original meaning. */
    const connectedRetain = readSessionRetention(context)
    source.retain = readAuthenticationRetain(
      connectedRetain !== undefined
        ? connectedRetain
        : this.#config.retain === undefined
          ? false
          : this.#config.retain,
      !!this.#config.sign
    )
    try {
      if (context.direction === 'outbound') {
        /** One captured resolver borrows the native owner's exact connection-local token. */
        const configured = this.#config.credentials
        /** Static credentials retain their original value; resolver completion cannot outlive close. */
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
      /** Credentials-only native authentication retains its original literal auth representation. */
      const credentials = this.#config.verify
        ? this.#handshakeCredentials(frame.auth, frame.step, context)
        : frame.auth
      /** Only an explicit verifier result can grant a principal; wire identity never supplies it. */
      const verified = await this.#config.verifyCredentials?.(credentials, frame.peer, context)
      this.#assert(context)
      if (verified !== null && typeof verified === 'object' && !Array.isArray(verified)) {
        /** Formerly ignored primitive returns retain their original non-authoritative meaning. */
        const principalId = (verified as { principalId?: unknown }).principalId
        if (typeof principalId === 'string' && principalId.length > 0 && context.handshakeResult)
          context.handshakeResult.authentication = { principalId }
      }
      return frame
    } catch (error) {
      /** Local diagnostics retain the verifier failure; outbound presentation owns redaction. */
      throw createRpcAuthenticationError(Text.inboundFrameAuthenticationFailed, error)
    }
  }

  /** A signed accept must echo this exact receiver's challenge, not a prior source's valid packet. */
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

  /**
   * Allocate replay binding before encryption, then sign the entire original metadata/manifest
   * once.
   */
  readonly #protectEnvelope = async (
    value: IRpcPreparedMessage,
    context: IRpcEnvelopeContext
  ): Promise<IRpcPreparedMessage> => {
    this.#assert(context)
    if (!this.#config.sign) return value
    try {
      if (this.#counter === Format.maximumCounter) {
        /** Exhaustion reports the same original failure rejected by this actual outbound stage. */
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
      /** Preserve original encrypt-before-sign order without lending the mutable owner as receiver. */
      const encrypted = this.#config.encrypt
        ? await (0, this.#config.encrypt)(bound, context)
        : bound
      /** The exact configured callback is held across suspension independently from caller mutation. */
      const sign = this.#config.sign
      const protectedValue = await sign(encrypted, context)
      this.#assert(context)
      /** The actual protected representation is observed before any physical transfer may detach it. */
      const prepared = {
        message: this.#representation.pack(protectedValue),
        sidecars: value.sidecars
      }
      this.#protected(context, prepared.message)
      return prepared
    } catch (error) {
      if (
        isLocalRpcError(error, RpcAuthenticationError) ||
        isLocalRpcError(error, RpcConfigurationError)
      )
        throw error
      throw createRpcAuthenticationError(Text.outboundFrameAuthenticationFailed, error)
    }
  }

  /** Borrow Session cancellation without retaining the native stage lease for a user verifier. */
  #restoreEnvelope(
    value: IRpcPreparedMessage,
    context: IRpcEnvelopeContext
  ): Promise<IRpcPreparedMessage> {
    /** The same restore job owns late classification; its original context retains the signal. */
    const input = { value, context }
    if (!this.#config.verify) return this.#restoreEnvelopeJob(input)
    return raceWithAbort(() => this.#restoreEnvelopeJob(input), {
      signal: context.signal,
      /** Late local verifier failures retain their original identity in every handshake state. */
      report: context.report
    })
  }

  /** Verify/decrypt and restore once; late completion still crosses the original abort checks. */
  async #restoreEnvelopeJob(input: {
    value: IRpcPreparedMessage
    context: IRpcEnvelopeContext
  }): Promise<IRpcPreparedMessage> {
    const { value, context } = input
    this.#assert(context)
    if (!this.#config.verify) return value
    this.#protected(context, value.message)
    /** Capture actual physical ownership before any asynchronous user verifier can suspend. */
    const source = this.#source(context)
    /** Only the actual cached restore's native failure keeps its original classification. */
    let validationFailure: unknown
    /** A supported thrown undefined must remain distinct from no integrity failure. */
    let validationFailed = false
    try {
      /** Signature verification precedes decryption exactly as in the original middleware. */
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
      if (this.#sources.get(source.id) !== source || source.signal.aborted)
        throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
      /** One original nonce and one counter bind the complete prepared native metadata. */
      const envelope = readAuthenticationEnvelope(this.#representation.plaintext(decrypted))
      /**
       * This same root identity will be returned to Session, which reuses its cached restore
       * Promise.
       */
      const inner = splitRpcPreparedMetadata(
        this.#representation.metadata(envelope.payload),
        value.sidecars
      )
      /** Session returns its original grammar-, integrity- and route-admitted envelope identity. */
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
      if (this.#sources.get(source.id) !== source || source.signal.aborted)
        throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
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
      if (isLocalRpcError(error, RpcAuthenticationError)) throw error
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
      retain: this.#config.retain === undefined ? false : this.#config.retain,
      abort: () => undefined
    }
    /** The record carries its compact id so this callback captures only its explicit owner/record. */
    const record = source
    record.abort = () => {
      this.#retire(record)
    }
    this.#sources.set(record.id, record)
    record.signal.addEventListener('abort', record.abort, { once: true })
    if (record.signal.aborted) record.abort()
    return record
  }

  /** Check the real operation/connection lifetime after every asynchronous authentication phase. */
  #assert(context: IRpcFlowContext): void {
    if (this.#closed || context.signal.aborted || context.connectionSignal?.aborted)
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
  }
  /** Observe actual sign/verify inputs without inferring protection from an opaque object's shape. */
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
        // Authentication bootstrap inputs may contain the native connection's original secret.
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
  /** Native rollback/final close revokes every original source receipt without a second state table. */
  readonly close = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#signal.removeEventListener('abort', this.close)
    for (const source of this.#sources.values()) this.#retire(source)
  }
}
