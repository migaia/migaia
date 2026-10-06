import { RpcMiddlewareErrorText } from './error-text.js'
import {
  RpcAuthenticationError,
  RpcConfigurationError,
  RpcError,
  RpcCoreErrorCode
} from '../errors.js'
import {
  authenticationReplaySession,
  authenticationCounterExhaustion,
  recordAuthenticationReplayBinding,
  registerAuthenticationCounterSetter,
  registerAuthenticationChallengePort,
  registerAuthenticationBinaryDigest,
  createRpcBackingDigest,
  authenticationFrameContext,
  readAuthenticationChallengeProof,
  consumedAuthenticationFrame,
  admitAuthenticationCounter,
  authenticationChallengeRejection,
  RpcAuthenticationControl,
  type IAuthenticationChallengeFields,
  type IAuthenticationChallengeSession
} from '../internal/authentication-replay.js'
import {
  createAuthenticationNonce,
  readAuthenticationEnvelope,
  RpcAuthenticationEnvelope,
  wrapAuthenticationEnvelope
} from './authentication-envelope.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'
import type {
  IRpcAuthenticationCapability,
  IRpcAuthenticationConfig,
  IRpcAuthenticationTransform,
  IRpcPlugin
} from '../typing.js'
import { RpcAuthenticationRejectionReason } from '../error-code.js'
import { RpcEnvelopeKind } from '../../contract/index.js'

/** Installs optional per-frame encryption and signing transforms. */
export const authentication = (config: IRpcAuthenticationConfig): IRpcPlugin => {
  const plugin: IRpcPlugin = {
    name: 'authentication',
    metadata: {
      claims: {
        routes: [],
        provides: [],
        consumes: [],
        publicKeys: [],
        exposedKeys: [],
        activator: false
      },
      sharedProvides: [RpcPortName.authentication]
    },
    install: () => ({
      extension: {},
      ports: { [RpcPortName.authentication]: createAuthenticationCapability(config) }
    })
  }
  return freezePlugin(plugin)
}

/** Validates one immutable authentication snapshot and creates its complete typed port. */
function createAuthenticationCapability(
  config: IRpcAuthenticationConfig
): IRpcAuthenticationCapability {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.authenticationDescriptorIsInvalid
    )
  let encrypt: IRpcAuthenticationTransform | undefined
  let decrypt: IRpcAuthenticationTransform | undefined
  let sign: IRpcAuthenticationTransform | undefined
  let verify: IRpcAuthenticationTransform | undefined
  let encodedType: IRpcAuthenticationConfig['encodedType']
  try {
    ;({ encrypt, decrypt, sign, verify, encodedType } = config)
  } catch (error) {
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.authenticationDescriptorIsUnreadable,
      error
    )
  }
  for (const [name, transform] of Object.entries({ encrypt, decrypt, sign, verify }))
    if (transform !== undefined && typeof transform !== 'function')
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcMiddlewareErrorText.authenticationTransformInvalid(name)
      )
  if (!!encrypt !== !!decrypt)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.authenticationEncryptDecryptMustBeConfiguredTogether
    )
  if (!!sign !== !!verify)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.authenticationSignVerifyMustBeConfiguredTogether
    )
  if (encrypt && !sign)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.authenticationEncryptionRequiresSigning
    )
  if (!encrypt && !sign)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.authenticationRequiresEncryptionOrSigningTransforms
    )
  if (encodedType !== undefined && !['any', 'string', 'uint8array'].includes(encodedType))
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.authenticationEncodedTypeIsInvalid
    )

  /** Each installed endpoint owns a nonce, independent of shared plugin configuration identity. */
  let nonce: string | undefined
  /** Sequence allocation happens before async transforms and is never rolled back or reused. */
  let counter = 0n
  /** Exactly one nonce and uint64 bitmap are retained per receiver-owned physical session. */
  const sessions = new WeakMap<object, { nonce: string; high: bigint; bits: BigUint64Array }>()
  /** Receiver-issued freshness has exactly 64 live slots; eviction never reconstructs an old window. */
  const challenges = new Map<string, IAuthenticationChallengeSession>()
  /** New sessions enter the queue head; business hits never change insertion order. */
  let head: IAuthenticationChallengeSession | undefined
  /** The tail wraps the hand back to the oldest remaining session after the newest entry. */
  let tail: IAuthenticationChallengeSession | undefined
  /** The eviction hand grants one second chance per verified business visit. */
  let hand: IAuthenticationChallengeSession | undefined
  /** Reverse lookup indexes the same 64 resident slots, never another set of sessions. */
  const replies = new Map<
    string,
    { nonce: string; state: NonNullable<ReturnType<typeof challenges.get>> }
  >()
  /** Existing admitted discovery/peer identities own the directional outgoing challenge cache. */
  const outgoing = new Map<
    string,
    { receiverId: string; nonce: string; challenge?: string; targetId?: string }
  >()
  /** Discovery hits retain freshness without marking visited; insertion advances the SIEVE hand. */
  const issue = (senderNonce: string): string => {
    const resident = challenges.get(senderNonce)
    if (resident) return resident.challenge
    /** Allocate freshness before eviction so entropy failure cannot erase a resident session. */
    const state: IAuthenticationChallengeSession = {
      nonce: senderNonce,
      challenge: createAuthenticationNonce(),
      high: 0n,
      bits: new BigUint64Array(1),
      visited: false
    }
    if (challenges.size === 64) {
      /** Clearing visited guarantees a victim after at most one complete hand sweep. */
      let victim = hand!
      while (victim.visited) {
        victim.visited = false
        victim = victim.newer ?? tail!
      }
      if (victim.older) victim.older.newer = victim.newer
      else tail = victim.newer
      if (victim.newer) victim.newer.older = victim.older
      else head = victim.older
      hand = victim.newer ?? tail
      if (victim.replyReceiverId && replies.get(victim.replyReceiverId)?.state === victim)
        replies.delete(victim.replyReceiverId)
      challenges.delete(victim.nonce)
    }
    state.older = head
    if (head) head.newer = state
    head = state
    tail ??= state
    hand ??= tail
    challenges.set(senderNonce, state)
    return state.challenge
  }
  /** Registers the receiver freshness only after original discovery or semantic identity admission. */
  const remember = (
    receiverId: string,
    senderNonce: string,
    challenge: string,
    reverse = false,
    targetId?: string
  ): void => {
    if (reverse) {
      const state = challenges.get(senderNonce)
      if (!state) return
      if (state.replyReceiverId !== undefined && state.replyReceiverId !== receiverId)
        throw authenticationChallengeRejection(RpcAuthenticationRejectionReason.challengeInvalid)
      state.replyReceiverId = receiverId
      state.replyChallenge = challenge
      state.replyTargetId = targetId
      replies.set(receiverId, { nonce: senderNonce, state })
      return
    }
    outgoing.set(receiverId, { receiverId, nonce: senderNonce, challenge, targetId })
  }
  /** Only admitted discovery records and resident reverse slots can provide a send challenge. */
  const outgoingFor = (receiverId: string, logical = false) => {
    if (logical) {
      /** Unaddressed stream frames may select only one originally admitted logical destination. */
      let selected: { receiverId: string; nonce: string; challenge?: string } | undefined
      for (const entry of outgoing.values()) {
        if (entry.targetId !== receiverId) continue
        if (selected && selected.receiverId !== entry.receiverId) return undefined
        selected = entry
      }
      for (const [id, reply] of replies) {
        if (reply.state.replyTargetId !== receiverId) continue
        if (selected && selected.receiverId !== id) return undefined
        selected ??= { receiverId: id, nonce: reply.nonce, challenge: reply.state.replyChallenge }
      }
      return selected
    }
    const discovered = outgoing.get(receiverId)
    if (discovered) return discovered
    const reply = replies.get(receiverId)
    return reply
      ? { receiverId, nonce: reply.nonce, challenge: reply.state.replyChallenge }
      : undefined
  }
  /** Both semantic profiles use the same resident receiver challenge and reverse reply facts. */
  const outboundFields = (
    remote: ReturnType<typeof outgoingFor>,
    receiverId: string | undefined
  ): IAuthenticationChallengeFields | undefined => {
    if (!remote) return undefined
    if (!remote.challenge)
      throw authenticationChallengeRejection(RpcAuthenticationRejectionReason.challengeInvalid)
    return {
      challenge: remote.challenge,
      receiverId: remote.receiverId,
      replyChallenge: issue(remote.nonce),
      replyReceiverId: receiverId
    }
  }
  /** A signed failure has no business settlement authority and only invalidates this cached value. */
  const forget = (receiverId: string, senderNonce: string): void => {
    if (senderNonce !== nonce) return
    const existing = outgoing.get(receiverId)
    if (existing) existing.challenge = undefined
    const reply = replies.get(receiverId)
    if (reply) reply.state.replyChallenge = undefined
  }
  /** Signs the replay binding inside encryption while preserving transform value categories. */
  const protect: IRpcAuthenticationTransform = async (value, context) => {
    try {
      if (counter === RpcAuthenticationEnvelope.maximumCounter)
        throw authenticationCounterExhaustion()
      nonce ??= createAuthenticationNonce()
      /** Synchronous allocation prevents concurrent protection from selecting the same counter. */
      const facts = authenticationFrameContext(context)
      /** Semantic facts come from the original sender, never a caller-visible context property. */
      const frame = facts?.frame
      let fields: IAuthenticationChallengeFields | undefined = facts?.fields
      if (!fields && facts?.runtimeRoute)
        fields = outboundFields(outgoingFor(facts.runtimeRoute.receiverId), facts.receiverId)
      if (!fields && frame) {
        const response = readAuthenticationChallengeProof(frame.data)
        if (response?.control === RpcAuthenticationControl.response)
          fields = {
            control: response.control,
            challenge: response.challenge,
            echoNonce: response.echoNonce,
            receiverId: response.receiverId
          }
        else {
          const receiverId = frame.data.route.receiverId
          const remote =
            receiverId !== undefined
              ? outgoingFor(receiverId)
              : frame.kind === RpcEnvelopeKind.stream
                ? outgoingFor(frame.data.route.targetId, true)
                : undefined
          fields = outboundFields(remote, facts!.receiverId)
        }
      }
      const bound = wrapAuthenticationEnvelope(value, nonce, ++counter, fields)
      /** Existing encrypt-before-sign order now covers the binding and original payload together. */
      const encrypted = encrypt ? await encrypt(bound, context) : bound
      return await sign!(encrypted, context)
    } catch (error) {
      if (error instanceof RpcAuthenticationError || error instanceof RpcConfigurationError)
        throw error
      throw new RpcAuthenticationError(
        RpcMiddlewareErrorText.outboundFrameAuthenticationFailed,
        error
      )
    }
  }
  /** Verifies/decrypts once, then admits unseen counters within a fixed 64-slot completion window. */
  const unprotect: IRpcAuthenticationTransform = async (value, context) => {
    /**
     * Only a failure from the installed private final validator may keep its grammar
     * classification.
     */
    let binaryFailure: unknown
    /** Throwing undefined cannot be confused with the absence of a validation failure. */
    let binaryFailed = false
    try {
      const verified = verify ? await verify(value, context) : value
      /** Parse only after decryption, so no unsigned outer field can influence replay state. */
      const decrypted = decrypt ? await decrypt(verified, context) : verified
      /** Old format, malformed binding and missing physical proof all fail before dispatch. */
      const envelope = readAuthenticationEnvelope(decrypted)
      /** Async verification cannot commit against a retired receiver generation. */
      const session = authenticationReplaySession(context)
      if (!session)
        throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationReplayBindingInvalid)
      /** Native integrity must finish before nonce pinning or any counter bitmap mutation. */
      const frameContext = authenticationFrameContext(context)
      const binary = frameContext?.binary
      if (binary) {
        try {
          binary.result = await binary.validate(envelope.payload)
        } catch (failure) {
          binaryFailure = failure
          binaryFailed = true
          throw failure
        }
        if (authenticationReplaySession(context) !== session)
          throw new RpcAuthenticationError(
            RpcMiddlewareErrorText.authenticationReplayBindingInvalid
          )
      }
      const facts = frameContext?.challenge
      if (facts) {
        if (envelope.control === RpcAuthenticationControl.unknown) {
          if (
            typeof envelope.echoNonce !== 'string' ||
            !/^[0-9a-f]{32}$/u.test(envelope.echoNonce) ||
            typeof envelope.receiverId !== 'string'
          )
            throw authenticationChallengeRejection(
              RpcAuthenticationRejectionReason.challengeInvalid
            )
          forget(envelope.receiverId, envelope.echoNonce)
          return consumedAuthenticationFrame
        }
        if (envelope.control === RpcAuthenticationControl.response) {
          if (envelope.echoNonce !== nonce) return consumedAuthenticationFrame
          if (
            typeof envelope.challenge !== 'string' ||
            !/^[0-9a-f]{32}$/u.test(envelope.challenge) ||
            typeof envelope.receiverId !== 'string'
          )
            throw authenticationChallengeRejection(
              RpcAuthenticationRejectionReason.challengeInvalid
            )
          recordAuthenticationReplayBinding(context, envelope)
          return envelope.payload
        }
        if (envelope.challenge !== undefined) {
          if (
            typeof envelope.challenge !== 'string' ||
            !/^[0-9a-f]{32}$/u.test(envelope.challenge) ||
            typeof envelope.receiverId !== 'string' ||
            typeof envelope.replyChallenge !== 'string' ||
            !/^[0-9a-f]{32}$/u.test(envelope.replyChallenge) ||
            typeof envelope.replyReceiverId !== 'string'
          )
            throw authenticationChallengeRejection(
              RpcAuthenticationRejectionReason.challengeInvalid
            )
          if (envelope.receiverId !== facts.receiverId) return consumedAuthenticationFrame
          const state = challenges.get(envelope.nonce)
          if (!state || state.challenge !== envelope.challenge) {
            await facts.unknown(envelope.nonce, envelope.counter)
            throw authenticationChallengeRejection(RpcAuthenticationRejectionReason.sessionUnknown)
          }
          admitAuthenticationCounter(state, BigInt(envelope.counter))
          state.visited = true
          recordAuthenticationReplayBinding(context, envelope)
          return envelope.payload
        }
        /**
         * Original sourceful wire shape is unchanged; source-less discovery is checked after
         * deframe.
         */
        recordAuthenticationReplayBinding(context, {
          ...envelope,
          control: RpcAuthenticationControl.query
        })
        return envelope.payload
      }
      /** Pin the first verified nonce; a new nonce never allocates another window on this session. */
      let state = sessions.get(session)
      if (!state) {
        state = { nonce: envelope.nonce, high: 0n, bits: new BigUint64Array(1) }
        sessions.set(session, state)
      }
      if (state.nonce !== envelope.nonce)
        throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationReplayBindingInvalid)
      /** Counter grammar is validated before bounded uint64 arithmetic. */
      admitAuthenticationCounter(state, BigInt(envelope.counter))
      recordAuthenticationReplayBinding(context)
      return envelope.payload
    } catch (error) {
      if (binaryFailed && error === binaryFailure) throw error
      if (error instanceof RpcAuthenticationError) throw error
      throw new RpcAuthenticationError(
        RpcMiddlewareErrorText.inboundFrameAuthenticationFailed,
        error
      )
    }
  }
  /** Test counter access stays private to this exact capability and never enters public exports. */
  const capability: IRpcAuthenticationCapability = Object.freeze({
    enabled: true as const,
    encodedType: encodedType ?? 'any',
    protect,
    unprotect
  })
  registerAuthenticationCounterSetter(capability, (value) => {
    counter = value
  })
  /**
   * Only the original immutable snapshot proves encrypt is absent; unknown capabilities never
   * qualify.
   */
  if (
    encrypt === undefined &&
    sign &&
    verify &&
    (encodedType === undefined || encodedType === 'any')
  ) {
    /** A native digest owns no state and grants no authority beyond this admitted capability. */
    const digest = createRpcBackingDigest()
    if (digest) registerAuthenticationBinaryDigest(capability, digest)
  }
  registerAuthenticationChallengePort(capability, {
    contextNeeded: (frame) => {
      if (
        readAuthenticationChallengeProof(frame.data)?.control === RpcAuthenticationControl.response
      )
        return true
      const receiverId = frame.data.route.receiverId
      return receiverId !== undefined
        ? outgoingFor(receiverId) !== undefined
        : frame.kind === RpcEnvelopeKind.stream &&
            outgoingFor(frame.data.route.targetId, true) !== undefined
    },
    issue,
    remember,
    forget,
    release: (receiverId) => {
      outgoing.delete(receiverId)
    },
    needed: (receiverId) => {
      const entry = outgoingFor(receiverId)
      return entry !== undefined && entry.challenge === undefined
    },
    outgoing: (receiverId) => {
      const entry = outgoingFor(receiverId)
      return entry?.challenge ? { nonce: entry.nonce, challenge: entry.challenge } : undefined
    }
  })
  return capability
}
