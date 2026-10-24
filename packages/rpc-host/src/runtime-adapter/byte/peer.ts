import {
  holdAdapterByteBootstrapSource,
  readAdapterByteBootstrapSource,
  openAdapterByteBootstrapSource
} from './bootstrap-source.js'
import { createRuntimePeer } from '../../remote/runtime-api/peer.js'
import type { IRuntimePeerOptions, IRuntimePeer } from '../../remote/runtime-api/peer.js'
import {
  withRuntimePreparationContext,
  type IRuntimePreparationContext
} from '../../remote/runtime-api/launch-context.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IRuntimeByteIO, IRuntimeByteDiagnostics, IRuntimeConnectionOptions } from './types.js'
import { defaultRpcReporter } from '../../core/default-reporter.js'

/** Local presentation/configuration cannot supply decoded launch or accepted capability facts. */
export type IAdapterBytePeerOptions = Readonly<{
  runtime: string
  platform: IRuntimeConnectionOptions['platform']
  diagnostics: IRuntimeByteDiagnostics
  expectedStringText: string
  bootstrapInvalidText: string
  /** Process-owned features configure only the existing physical gate and diagnostic observer. */
  ipc?: Partial<
    Pick<IRuntimeConnectionOptions['ipc'], 'maxPendingData' | 'maxPendingControl' | 'log'>
  >
}>

/** Core builds an automatic Peer only from its own first frame on the same actual byte resource. */
export async function createAdapterBytePeer(
  options: IRuntimePeerOptions,
  io: IRuntimeByteIO,
  local: IAdapterBytePeerOptions,
  preparation: IRuntimePreparationContext | undefined
): Promise<IRuntimePeer> {
  /** Default diagnostics retain the original options that carry Core preparation provenance. */
  const report = options.report ?? defaultRpcReporter
  try {
    /** The old Peer path shares the same real first-frame qualification as the host path. */
    const source = holdAdapterByteBootstrapSource(io, local)
    /** Only the qualified snapshot supplies provisional native launch metadata. */
    const bootstrap = readAdapterByteBootstrapSource(source).bootstrap
    /** Ordinary Peer construction retains its original options and generation source. */
    const peerOptions: IRuntimePeerOptions = {
      ...options,
      self: options.self ?? bootstrap.self,
      connect: (context) =>
        openAdapterByteBootstrapSource(source, {
          ...context,
          connectTimeoutMs: preparation?.connectTimeoutMs,
          report
        })
    }
    return await withRuntimePreparationContext(peerOptions, preparation ?? {}, () =>
      createRuntimePeer(peerOptions, { bootstrap: io, generation: bootstrap.generation })
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
