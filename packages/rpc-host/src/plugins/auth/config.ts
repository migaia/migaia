/**
 * Snapshots and validates authentication transform pairs, credentials and encoding options before
 * installation. Configuration failures use Host error ownership; nonce, replay and connection state
 * are allocated only by the installed authentication flow.
 */
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcError } from '../../host/error-owner.js'
import { RpcAuthenticationText as Text } from './text.js'
import type { IRpcAuthenticationOptions } from './types.js'
import { RpcAuthenticationEncoding as Encoding } from './constants.js'

/** Capture actual transform functions once, preserving the original unreadable getter cause. */
export function snapshotAuthenticationConfig(
  config: IRpcAuthenticationOptions
): IRpcAuthenticationOptions {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw createRpcError(RpcCoreErrorCode.invalidConfig, Text.authenticationDescriptorIsInvalid)
  /** Actual callbacks are captured before validation; later caller mutation cannot replace them. */
  let snapshot: IRpcAuthenticationOptions
  try {
    snapshot = {
      encrypt: config.encrypt,
      decrypt: config.decrypt,
      sign: config.sign,
      verify: config.verify,
      encodedType: config.encodedType,
      namespaces: config.namespaces,
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
