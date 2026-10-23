import type { IRuntimeConnectionOptions } from '@migaia/rpc-host/plugin'
import { RpcPlatform } from '@migaia/rpc-host/plugin'
import { RpcProcessErrorText } from './error-text.js'
import type { IProcessCommonOptions } from './types.js'

/** Project only ordinary connection fields; declarations and caller claim fields never enter Core. */
export function processConnectionOptions(
  options: IProcessCommonOptions
): IRuntimeConnectionOptions {
  return {
    platform: RpcPlatform.process,
    expectedStringText: RpcProcessErrorText.expectedString,
    get peerId() {
      return options.peerId
    },
    get report() {
      return options.report
    },
    get signal() {
      return options.signal
    },
    get scheduler() {
      return options.scheduler
    },
    get handshakeTimeoutMs() {
      return options.handshakeTimeoutMs
    },
    get ipc() {
      return options.ipc
    }
  }
}
