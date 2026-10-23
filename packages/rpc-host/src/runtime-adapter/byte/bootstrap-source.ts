import { RpcCodecId, RpcProtocol, type IRpcHandshakeOffer } from '@migaia/rpc-contract'
import { rpcByteRuntimeBootstrap } from '@migaia/rpc-contract/runtime'
import { createRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { RuntimeApiErrorText } from '../../remote/runtime-api/constants.js'
import { defaultRpcId } from '../../core/internal/id.js'
import { createRuntimeByteConnection } from './handshake.js'
import { readRuntimeByteBootstrapSnapshot } from './bootstrap.js'
import { deferRuntimeByteReceive } from './carrier.js'
import type { IRuntimeByteIO } from './types.js'
import type { IAdapterBytePeerOptions } from './peer.js'
import type { IAdapterDeploymentContext } from '../deployment.js'

/** Only a held byte resource whose real first frame was received can supply bootstrap authority. */
declare const adapterByteBootstrapIdentity: unique symbol
export type IAdapterByteBootstrapSource = Readonly<{ [adapterByteBootstrapIdentity]: true }>

/** The original grammar supplies the exact admitted payload, never a caller-provided identity DTO. */
type IBootstrap = Extract<ReturnType<typeof rpcByteRuntimeBootstrap.read>, { valid: true }>['value']
/** This receipt retains the original physical resource and secret-safe local diagnostic policy. */
type IBootstrapSource = Readonly<{
  io: IRuntimeByteIO
  local: IAdapterBytePeerOptions
  bootstrap: IBootstrap
}>
/** Opaque tokens cannot be copied to substitute another resource's first-frame snapshot. */
const sources = new WeakMap<object, IBootstrapSource>()

/** Hold the original private first-frame snapshot without opening an endpoint or another reader. */
export function holdAdapterByteBootstrapSource(
  io: IRuntimeByteIO,
  local: IAdapterBytePeerOptions
): IAdapterByteBootstrapSource {
  /** Only the original byte receiver's saved bytes enter the canonical closed grammar. */
  const received = rpcByteRuntimeBootstrap.read(readRuntimeByteBootstrapSnapshot(io))
  if (!received.valid)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, local.bootstrapInvalidText)
  deferRuntimeByteReceive(io)
  /** The empty token carries no caller-visible authority fields that can be copied. */
  const token = Object.freeze({}) as IAdapterByteBootstrapSource
  sources.set(token, { io, local, bootstrap: received.value })
  return token
}

/** Host and the original private Peer path borrow the same actual resource receipt. */
export function readAdapterByteBootstrapSource(
  token: IAdapterByteBootstrapSource
): IBootstrapSource {
  /** Only this module's exact token can reveal its held native resource to internal consumers. */
  const source = sources.get(token)
  if (!source)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  return source
}

/** Compare the original string credential without a differing-byte early exit or diagnostic echo. */
function sameToken(value: unknown, token: string): boolean {
  if (typeof value !== 'string') return false
  /** Original credential bytes are used only for this local constant-work comparison. */
  const expected = new TextEncoder().encode(token)
  /** Candidate bytes remain local and are never included in errors or metadata. */
  const actual = new TextEncoder().encode(value)
  if (expected.length !== actual.length) return false
  /** Accumulated byte differences avoid a credential-dependent early return. */
  let difference = 0
  for (let index = 0; index < expected.length; index++)
    difference |= expected[index]! ^ actual[index]!
  return difference === 0
}

/** Open the original responder handshake after the host adopts this real bootstrap identity. */
export function openAdapterByteBootstrapSource(
  token: IAdapterByteBootstrapSource,
  context: IAdapterDeploymentContext
) {
  const { io, local, bootstrap } = readAdapterByteBootstrapSource(token)
  if (
    context.self.name !== bootstrap.self.name ||
    context.self.instanceId !== bootstrap.self.instanceId
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
  /** The actual endpoint proposal and received child identity form the original responder hello. */
  const offer: IRpcHandshakeOffer = {
    versions: Object.freeze([
      Object.freeze({ major: RpcProtocol.major, minor: RpcProtocol.minor })
    ]),
    codecs: Object.freeze([RpcCodecId.json]),
    capabilities: context.capabilities,
    peer: Object.freeze({ id: context.self.instanceId, runtime: local.runtime })
  }
  return createRuntimeByteConnection(
    io,
    {
      role: 'responder',
      handshakeTimeoutMs: context.connectTimeoutMs,
      signal: context.signal,
      platform: local.platform,
      expectedStringText: local.expectedStringText,
      peerId: bootstrap.parentInstanceId,
      offer,
      auth: {
        mode: 'required',
        verify(auth, peer) {
          if (!sameToken(auth, bootstrap.token) || peer.id !== bootstrap.parentInstanceId)
            throw createRpcError(RpcCoreErrorCode.invalidConfig, local.bootstrapInvalidText)
        }
      },
      report: context.report,
      ipc: {
        connectionId: defaultRpcId(),
        sessionId: defaultRpcId(),
        log: () => undefined,
        ...local.ipc
      }
    },
    local.diagnostics
  )
}
