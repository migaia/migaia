import { CapabilityLevel, StandardCapability } from '@migaia/supervision'
import { ProcessCapability, type IProcessLauncher } from '@migaia/supervision/process'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'

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

/** Reject direct launch as well as supervision admission until native handles are proven. */
export function createWindowsJobProcessLauncher(): IProcessLauncher {
  return Object.freeze({
    capabilities: WINDOWS_JOB_CAPABILITIES,
    async launch() {
      throw createProcessError(RpcProcessErrorCode.connectFailed)
    }
  })
}
