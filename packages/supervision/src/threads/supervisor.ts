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

/**
 * Supervises a worker thread created by an application-supplied launcher, with the same budget,
 * restart, health and bounded-stop policy as other units.
 *
 * A thread shares its parent process: it cannot isolate crashes or limit CPU, so choose a process
 * when either is required. `limits.heapBytes` is accepted only when the launcher enforces heap
 * limits, and a launcher that cannot observe exit reliably must be paired with a `health` check.
 */
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
