/**
 * Encodes only signed-handshake freshness metadata. The installed Auth source record owns each
 * challenge; this module validates known fields without discovery state or another handshake.
 */
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import { createRpcAuthenticationError } from '../../host/error-owner.js'
import { RpcAuthenticationHandshake as Format } from './constants.js'
import { isAuthenticationNonce } from './envelope.js'
import { RpcAuthenticationText as Text } from './text.js'
import type { IAuthenticationHandshake } from './types.js'

/** Bind the original configured credentials to this source's receiver challenge and current echo. */
export function wrapAuthenticationHandshake(
  credentials: IRpcPortableValue | undefined,
  challenge: string,
  replyChallenge: string | undefined
): IAuthenticationHandshake {
  return {
    authentication: Format.kind,
    version: Format.version,
    challenge,
    ...(replyChallenge === undefined ? {} : { replyChallenge }),
    ...(credentials === undefined ? {} : { credentials })
  }
}

/** Read the signed auth wrapper once; unknown fields never create freshness or credential facts. */
export function readAuthenticationHandshake(value: unknown): IAuthenticationHandshake {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
  /** Only these signed known fields participate in receiver freshness admission. */
  const { authentication, version, challenge, replyChallenge } = value as IAuthenticationHandshake
  if (
    authentication !== Format.kind ||
    version !== Format.version ||
    !isAuthenticationNonce(challenge) ||
    (replyChallenge !== undefined && !isAuthenticationNonce(replyChallenge))
  )
    throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
  return value as IAuthenticationHandshake
}
