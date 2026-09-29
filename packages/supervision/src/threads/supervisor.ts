import {
  CapabilityLevel,
  createSupervisor,
  SupervisionErrorCode,
  SupervisionErrorText
} from '../index.js'
import { createSupervisionError } from '../errors.js'
import { ThreadCapability, ThreadUnitKind } from './constants.js'
import { createThreadProfile, invalidThreadOption } from './profile.js'
import type { IThreadHandle, IThreadSupervisor, IThreadSupervisorOptions } from './types.js'

/** Rejects capability levels the thread profile cannot actually monitor. */
export function validateThreadCapabilities(
  capabilities: Readonly<Record<string, CapabilityLevel>>
): void {
  for (const capability of Object.values(ThreadCapability)) {
    /** Missing declarations are unsupported; only an explicit overclaim is invalid. */
    const level = capabilities[capability]
    if (
      level !== undefined &&
      level !== CapabilityLevel.enforced &&
      level !== CapabilityLevel.unsupported
    )
      invalidThreadOption('launcher.capabilities', TypeError, { capability })
  }
}

/** Admit thread-only policy, then delegate every lifecycle transition to core. */
export function createThreadSupervisor<THandle extends IThreadHandle>(
  options: IThreadSupervisorOptions<THandle>
): IThreadSupervisor<THandle> {
  validateThreadCapabilities(options.launcher.capabilities)
  if (
    options.launcher.capabilities[ThreadCapability.exitObservation] !== CapabilityLevel.enforced &&
    options.health === undefined
  )
    throw createSupervisionError(
      TypeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field: 'health', kind: ThreadUnitKind.thread } }
    )
  return createSupervisor({ ...options, profile: createThreadProfile<THandle>() })
}
