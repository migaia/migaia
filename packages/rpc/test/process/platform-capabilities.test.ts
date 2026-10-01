import { describe, expect, it } from 'vitest'
import { CapabilityLevel, StandardCapability } from '@migaia/supervision'
import { ProcessCapability } from '@migaia/supervision/process'
import { createElectronUtilityProcessLauncher } from '../../src/process/adapters/electron-utility-process.js'
import { createWindowsJobProcessLauncher } from '../../src/process/adapters/windows-job.js'

/** The seven supervision keys are the complete admission vocabulary. */
const capabilityKeys = [
  StandardCapability.termination,
  StandardCapability.faultIsolation,
  ProcessCapability.memoryLimit,
  ProcessCapability.cpuTimeLimit,
  ProcessCapability.permissions,
  ProcessCapability.bootstrapStdin,
  ProcessCapability.bootstrapFd
].sort()

describe('unverified platform launchers', () => {
  it('[A9] Electron cannot claim tree termination or secret bootstrap', () => {
    const capabilities = createElectronUtilityProcessLauncher().capabilities
    expect(Object.keys(capabilities).sort()).toEqual(capabilityKeys)
    expect(capabilities[StandardCapability.termination]).toBe(CapabilityLevel.unsupported)
    expect(capabilities[StandardCapability.faultIsolation]).toBe(CapabilityLevel.enforced)
    expect(capabilities[ProcessCapability.bootstrapStdin]).toBe(CapabilityLevel.unsupported)
    expect(capabilities[ProcessCapability.bootstrapFd]).toBe(CapabilityLevel.unsupported)
  })

  it('[A9] Windows Job remains entirely unsupported without a native fixture', () => {
    const capabilities = createWindowsJobProcessLauncher().capabilities
    expect(Object.keys(capabilities).sort()).toEqual(capabilityKeys)
    expect(Object.values(capabilities)).toEqual(
      Array.from({ length: capabilityKeys.length }, () => CapabilityLevel.unsupported)
    )
  })
})
