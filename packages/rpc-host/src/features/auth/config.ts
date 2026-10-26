/**
 * Validate configuration before installation; each installed flow owns its nonce, replay and
 * connection state.
 */
import type { IRpcAuthenticationRetain } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcError } from '../../host/error-owner.js'
import { RpcAuthenticationText as Text } from './text.js'
import type { IRpcAuthenticationOptions } from './types.js'
import { RpcAuthenticationEncoding as Encoding } from './constants.js'

/** Default omitted retention to false, then validate the auth or physical-connection policy. */
export function readAuthenticationRetain(
  value: unknown = false,
  signed: boolean
): IRpcAuthenticationRetain {
  if (
    value !== false &&
    value !== 'window' &&
    !(typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, Text.authenticationRetainIsInvalid)
  if (value === 'window' && !signed)
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      Text.authenticationWindowRetentionRequiresSigning
    )
  return value
}

/** Snapshot transforms once so unreadable getters retain their failure cause. */
export function snapshotAuthenticationConfig(
  config: IRpcAuthenticationOptions
): IRpcAuthenticationOptions {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw createRpcError(RpcCoreErrorCode.invalidConfig, Text.authenticationDescriptorIsInvalid)
  /** Capture callbacks before validation so caller mutation cannot replace them later. */
  let snapshot: IRpcAuthenticationOptions
  try {
    snapshot = {
      encrypt: config.encrypt,
      decrypt: config.decrypt,
      sign: config.sign,
      verify: config.verify,
      encodedType: config.encodedType,
      retain: config.retain,
      maxReplayEntriesPerPeer: config.maxReplayEntriesPerPeer,
      onRejected: config.onRejected,
      credentials: config.credentials,
      verifyCredentials: config.verifyCredentials
    }
  } catch (error) {
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      Text.authenticationDescriptorIsUnreadable,
      error
    )
  }
  for (const [name, transform] of Object.entries({
    encrypt: snapshot.encrypt,
    decrypt: snapshot.decrypt,
    sign: snapshot.sign,
    verify: snapshot.verify,
    verifyCredentials: snapshot.verifyCredentials
  }))
    if (transform !== undefined && typeof transform !== 'function')
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        Text.authenticationTransformInvalid(name)
      )
  if (!!snapshot.encrypt !== !!snapshot.decrypt)
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      Text.authenticationEncryptDecryptMustBeConfiguredTogether
    )
  if (!!snapshot.sign !== !!snapshot.verify)
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      Text.authenticationSignVerifyMustBeConfiguredTogether
    )
  if (snapshot.encrypt && !snapshot.sign)
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      Text.authenticationEncryptionRequiresSigning
    )
  readAuthenticationRetain(snapshot.retain, !!snapshot.sign)
  if (!snapshot.sign && !snapshot.verifyCredentials && snapshot.credentials === undefined)
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      Text.authenticationRequiresEncryptionOrSigningTransforms
    )
  if (snapshot.encodedType !== undefined && !Object.values(Encoding).includes(snapshot.encodedType))
    throw createRpcError(RpcCoreErrorCode.invalidConfig, Text.authenticationEncodedTypeIsInvalid)
  if (
    snapshot.maxReplayEntriesPerPeer !== undefined &&
    (!Number.isSafeInteger(snapshot.maxReplayEntriesPerPeer) ||
      snapshot.maxReplayEntriesPerPeer < 1)
  )
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.requestReplayLimitsMustBePositiveSafeIntegers
    )
  if (snapshot.onRejected !== undefined && typeof snapshot.onRejected !== 'function')
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.providerAdmissionObserverMustBeAFunction
    )
  return Object.freeze(snapshot)
}
