import { createSupervisor } from '../index.js'
import { createThreadProfile } from './profile.js'
import type { IThreadHandle, IThreadSupervisor, IThreadSupervisorOptions } from './types.js'

/** Delegates all thread lifecycle transitions to the shared supervisor. */
export function createThreadSupervisor<THandle extends IThreadHandle>(
  options: IThreadSupervisorOptions<THandle>
): IThreadSupervisor<THandle> {
  return createSupervisor({ ...options, profile: createThreadProfile<THandle>() })
}
