import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { RpcProcessErrorText } from '../error-text.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { CapabilityLevel, StandardCapability } from '@migaia/supervision'
import { ProcessCapability, type IProcessLauncher } from '@migaia/supervision/process'
import { RpcProcessErrorCode } from '../error-code.js'

/** No Windows Job path is declared enforced without a real CreateProcessW/Assign fixture. */
const WINDOWS_JOB_CAPABILITIES = Object.freeze({
  [StandardCapability.termination]: CapabilityLevel.unsupported,
  [StandardCapability.faultIsolation]: CapabilityLevel.unsupported,
  [ProcessCapability.memoryLimit]: CapabilityLevel.unsupported,
  [ProcessCapability.cpuTimeLimit]: CapabilityLevel.unsupported,
  [ProcessCapability.permissions]: CapabilityLevel.unsupported,
  [ProcessCapability.bootstrapStdin]: CapabilityLevel.unsupported,
  [ProcessCapability.bootstrapFd]: CapabilityLevel.unsupported
})

/**
 * Return an explicitly unsupported Windows Job launcher, not a native isolation guarantee. Every
 * capability is unsupported and direct launch rejects PROCESS_CHANNEL_CONNECT_FAILED. Select an
 * implemented launcher instead; creating this object does not load koffi or create native handles.
 */
export function createWindowsJobProcessLauncher(): IProcessLauncher {
  return Object.freeze({
    capabilities: WINDOWS_JOB_CAPABILITIES,
    async launch() {
      throw attachErrorIdentity(new Error(RpcProcessErrorText.connectFailed), {
        source: RPC_PROCESS_ERROR_SOURCE,
        code: RpcProcessErrorCode.connectFailed
      })
    }
  })
}
