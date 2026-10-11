import type { IRuntimeObjectConnection } from '@migaia/rpc-core/adapter'
import { IpcReporterContext } from '@migaia/rpc-core/adapter'
import { RpcPlatform } from '@migaia/rpc-core/transport-constants'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { RpcProcessErrorText } from './error-text.js'
import { attachIpcStderr } from './stderr.js'
import type { IProcessCommonOptions } from './types.js'

/** Open the held Core object connection with Process diagnostics and the original stderr owner. */
export function openProcessObjectChannel(
  connection: IRuntimeObjectConnection,
  options: IProcessCommonOptions
) {
  /** Core has already observed its real negotiation; Process supplies only ordinary presentation. */
  const channel = connection.open({
    ...options,
    platform: RpcPlatform.process,
    expectedStringText: RpcProcessErrorText.expectedString
  })
  try {
    /** Teardown removes this actual diagnostic subscription before the gated transport closes. */
    const unsubscribeStderr = attachIpcStderr(
      channel.log,
      options.ipc,
      options.report,
      channel.scheduler
    )
    channel.ownClose({ close: unsubscribeStderr })
    return channel
  } catch (primary) {
    /** Construction cleanup remains secondary and retains the original reporter failure owner. */
    const report = (error: unknown): void => {
      try {
        options.report(error)
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
    try {
      void channel.close().catch(report)
    } catch (cleanup) {
      report(cleanup)
    }
    throw primary
  }
}
