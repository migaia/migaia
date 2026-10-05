import { RuntimeSourceKind, RuntimeConnectionDirection } from '../remote/runtime-api/constants.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { RpcCoreErrorCode, RpcError } from '../core/errors.js'
import { defaultRpcId } from '../core/internal/id.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { compileRuntimeMethods } from '../remote/runtime-api/catalog.js'
import { RuntimeApiErrorText } from '../remote/runtime-api/constants.js'
import {
  createRuntimePeer,
  type IRuntimePeer,
  type IRuntimePeerOptions
} from '../remote/runtime-api/peer.js'
import { PROCESS_RUNTIME_API_ENV_VERSION } from './constants.js'
import { deferProcessByteReceive } from './channel.js'
import { createProcessTransport } from './handshake.js'
import { createNativeProcessOffer } from './offer.js'
import {
  decodeProcessRuntimeBootstrap,
  invalidProcessRuntimeBootstrap
} from './runtime-bootstrap.js'
import type { IProcessByteChannel } from './types.js'

/** A process owns one automatic stdio pair; failure never permits a second physical reader. */
let claimed = false

/** Compare all equal-length token bytes without an early differing-byte exit. */
function sameToken(value: unknown, token: string): boolean {
  if (typeof value !== 'string') return false
  /** Auth work is cold and never adds a scan to business dispatch. */
  const expected = new TextEncoder().encode(token)
  /** The verifier accepts the existing string token domain only. */
  const actual = new TextEncoder().encode(value)
  if (expected.length !== actual.length) return false
  /** Accumulation keeps the token comparison independent of a differing byte's position. */
  let difference = 0
  for (let index = 0; index < expected.length; index += 1)
    difference |= expected[index]! ^ actual[index]!
  return difference === 0
}

/** Adopt platform-owned stdio after explicit discovery, then authenticate token and parent route. */
export async function createAutomaticProcessPeer(
  options: IRuntimePeerOptions,
  platform: Readonly<{
    marker: string | undefined
    runtime: string
    open(): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>>
  }>
): Promise<IRuntimePeer> {
  if (platform.marker === undefined) return createRuntimePeer(options)
  if (platform.marker !== PROCESS_RUNTIME_API_ENV_VERSION || claimed)
    invalidProcessRuntimeBootstrap()
  if (options.spawn !== undefined || options.connect !== undefined || options.listen !== undefined)
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  // Reuse the method owner for admission before opening the sole process input reader.
  compileRuntimeMethods(options.provide, options.contract)
  claimed = true
  /** Bootstrap and hello share the original decoder and byte channel. */
  const opened = await platform.open()
  try {
    if (!opened.bootstrap) invalidProcessRuntimeBootstrap()
    /** Identity is still provisional until the original responder accepts its authenticated parent. */
    const bootstrap = decodeProcessRuntimeBootstrap(opened.bootstrap)
    deferProcessByteReceive(opened.channel)
    return await createRuntimePeer(options, {
      self: bootstrap.self,
      generation: bootstrap.generation,
      origin: { kind: RuntimeSourceKind.connect, direction: RuntimeConnectionDirection.spawnedBy },
      async source(context) {
        /** Override the legacy native offer's defaults with the endpoint's actual installed roots. */
        const offer = createNativeProcessOffer({
          peer: { id: context.self.instanceId, runtime: platform.runtime }
        })
        return createProcessTransport(opened.channel, {
          role: 'responder',
          peerId: bootstrap.parentInstanceId,
          offer: { ...offer, capabilities: context.capabilities },
          auth: {
            mode: 'required',
            verify(auth, peer) {
              if (!sameToken(auth, bootstrap.token) || peer.id !== bootstrap.parentInstanceId)
                invalidProcessRuntimeBootstrap()
            }
          },
          report: options.report,
          ipc: { connectionId: defaultRpcId(), sessionId: defaultRpcId(), log: () => undefined }
        })
      }
    })
  } catch (primary) {
    try {
      await opened.channel.close()
    } catch (cleanup) {
      try {
        options.report(cleanup)
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
    throw primary
  }
}
