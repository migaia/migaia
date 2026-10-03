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
  registerAuthenticationCounterSetter
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
  /** Signs the replay binding inside encryption while preserving transform value categories. */
  const protect: IRpcAuthenticationTransform = async (value, context) => {
    try {
      if (counter === RpcAuthenticationEnvelope.maximumCounter)
        throw authenticationCounterExhaustion()
      nonce ??= createAuthenticationNonce()
      /** Synchronous allocation prevents concurrent protection from selecting the same counter. */
      const bound = wrapAuthenticationEnvelope(value, nonce, ++counter)
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
      /** Pin the first verified nonce; a new nonce never allocates another window on this session. */
      let state = sessions.get(session)
      if (!state) {
        state = { nonce: envelope.nonce, high: 0n, bits: new BigUint64Array(1) }
        sessions.set(session, state)
      }
      if (state.nonce !== envelope.nonce)
        throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationReplayBindingInvalid)
      /** Counter grammar is validated before bounded uint64 arithmetic. */
      const sequence = BigInt(envelope.counter)
      if (sequence > state.high) {
        /** Advancing by at least 64 drops the old window rather than growing or waiting. */
        const advance = sequence - state.high
        state.bits[0] = (advance >= 64n ? 0n : state.bits[0]! << advance) | 1n
        state.high = sequence
      } else {
        /** Out-of-order verification accepts only a still-unseen bit in the fixed bitmap. */
        const distance = state.high - sequence
        if (distance >= 64n || (state.bits[0]! & (1n << distance)) !== 0n)
          throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationFrameReplayed)
        state.bits[0] = state.bits[0]! | (1n << distance)
      }
      recordAuthenticationReplayBinding(context)
      return envelope.payload
    } catch (error) {
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
  return capability
}
