import {
  createAdapterSourceConfigurationError,
  prepareAdapterPeer,
  validateAdapterPeerTimeout,
  validateAdapterPeerMethods,
  IpcReporterContext
} from '@migaia/rpc-core/adapter'
import { hostRethrowReporter } from '@migaia/utils/promise'
import type { IAdapterPeerPreparation } from '@migaia/rpc-core/adapter'
import type { IRuntimePeer, IRuntimePeerOptions } from '@migaia/rpc-core/remote'
import { RuntimePluginKey } from '@migaia/rpc-core/remote'
import { RpcPlatform } from '@migaia/rpc-core/transport-constants'
import { PROCESS_RUNTIME_API_ENV_VERSION } from './constants.js'
import { invalidProcessRuntimeBootstrap } from './runtime-bootstrap.js'
import { ProcessChannelDiagnostics } from './diagnostics.js'
import { RpcProcessErrorText } from './error-text.js'
import type { IProcessByteChannel } from './types.js'

/** A process owns one automatic stdio pair; failure never permits another physical reader. */
let claimed = false

/** Process discovers native resources; Core derives bootstrap/generation only from its actual read. */
export async function createAutomaticProcessPeer(
  options: IRuntimePeerOptions,
  platform: Readonly<{
    marker: string | undefined
    runtime: string
    open(): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>>
  }>,
  prepared?: IAdapterPeerPreparation
): Promise<IRuntimePeer> {
  if (prepared) validateAdapterPeerTimeout(options)
  /** The same genuine preparation view preserves the original Host and transfer policy. */
  const preparation =
    prepared ?? prepareAdapterPeer(options, RuntimePluginKey.process).withoutTransfer()
  if (platform.marker === undefined) return preparation.peer(options)
  if (platform.marker !== PROCESS_RUNTIME_API_ENV_VERSION || claimed)
    invalidProcessRuntimeBootstrap()
  if (options.spawn !== undefined || options.connect !== undefined || options.listen !== undefined)
    throw createAdapterSourceConfigurationError()
  validateAdapterPeerMethods(options.provide, options.contract)
  claimed = true
  /** Native acquisition has already driven Core's first-frame receiver on this exact I/O. */
  const opened = await platform.open()
  try {
    if (!opened.bootstrap) invalidProcessRuntimeBootstrap()
    return preparation.bytePeer(options, opened.channel, {
      runtime: platform.runtime,
      platform: RpcPlatform.process,
      diagnostics: ProcessChannelDiagnostics,
      expectedStringText: RpcProcessErrorText.expectedString,
      bootstrapInvalidText: RpcProcessErrorText.runtimeBootstrapInvalid
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
