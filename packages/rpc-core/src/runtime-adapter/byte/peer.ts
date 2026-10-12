import { RpcCodecId, RpcProtocol, type IRpcHandshakeOffer } from '@migaia/rpc-contract'
import { rpcByteRuntimeBootstrap } from '@migaia/rpc-contract/runtime'
import { createRuntimePeer } from '../../remote/runtime-api/peer.js'
import type { IRuntimePeerOptions, IRuntimePeer } from '../../remote/index.js'
import {
  withRuntimePreparationContext,
  type IRuntimePreparationContext
} from '../../remote/runtime-api/launch-context.js'
import { createRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { RuntimeApiErrorText } from '../../remote/runtime-api/constants.js'
import { defaultRpcId } from '../../core/internal/id.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { createRuntimeByteConnection } from './handshake.js'
import { readRuntimeByteBootstrapSnapshot } from './bootstrap.js'
import { deferRuntimeByteReceive } from './carrier.js'
import type { IRuntimeByteIO, IRuntimeByteDiagnostics, IRuntimeConnectionOptions } from './types.js'

/** Local presentation/configuration cannot supply decoded launch or accepted capability facts. */
export type IAdapterBytePeerOptions = Readonly<{
  runtime: string
  platform: IRuntimeConnectionOptions['platform']
  diagnostics: IRuntimeByteDiagnostics
  expectedStringText: string
  bootstrapInvalidText: string
}>

/** Compare the original string token's equal-length bytes without a differing-byte early exit. */
function sameToken(value: unknown, token: string): boolean {
  if (typeof value !== 'string') return false
  /** Authentication remains cold and never adds a scan to business dispatch. */
  const expected = new TextEncoder().encode(token)
  /** Only the original string token domain is accepted. */
  const actual = new TextEncoder().encode(value)
  if (expected.length !== actual.length) return false
  /** Accumulation preserves the original comparison's byte-position-independent work. */
  let difference = 0
  for (let index = 0; index < expected.length; index++)
    difference |= expected[index]! ^ actual[index]!
  return difference === 0
}

/** Core builds an automatic Peer only from its own first frame on the same actual byte resource. */
export async function createAdapterBytePeer(
  options: IRuntimePeerOptions,
  io: IRuntimeByteIO,
  local: IAdapterBytePeerOptions,
  preparation: IRuntimePreparationContext | undefined
): Promise<IRuntimePeer> {
  /** Default diagnostics retain the original options that carry Core preparation provenance. */
  const report = options.report ?? console.error
  try {
    /** Adapter-returned mutable bytes cannot replace the private snapshot taken during actual read. */
    const raw = readRuntimeByteBootstrapSnapshot(io)
    /** The canonical grammar preserves the original secret-safe failure boundary. */
    const received = rpcByteRuntimeBootstrap.read(raw)
    if (!received.valid)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, local.bootstrapInvalidText)
    /** Identity/generation stay provisional until the actual responder authenticates its parent. */
    const bootstrap = received.value
    deferRuntimeByteReceive(io)
    /** Only this private receiver supplies launch metadata to the Peer owner. */
    const peerOptions: IRuntimePeerOptions = {
      ...options,
      self: options.self ?? bootstrap.self,
      connect: async (context) => {
        if (
          options.self &&
          (options.self.name !== bootstrap.self.name ||
            options.self.instanceId !== bootstrap.self.instanceId)
        )
          throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
        /** Ordinary local protocol proposal names the actual roots installed by the endpoint. */
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
            report,
            ipc: { connectionId: defaultRpcId(), sessionId: defaultRpcId(), log: () => undefined }
          },
          local.diagnostics
        )
      }
    }
    return await withRuntimePreparationContext(peerOptions, preparation ?? {}, () =>
      createRuntimePeer(peerOptions, {
        bootstrap: io,
        generation: bootstrap.generation
      })
    )
  } catch (primary) {
    try {
      await io.close()
    } catch (cleanup) {
      try {
        report(cleanup)
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
    throw primary
  }
}
