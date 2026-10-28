import { PROCESS_KIND } from './text.ts'
import { ExitReason } from '../index.ts'
import type { IUnitProfile } from '../index.ts'
import { processRequirements } from './capabilities.ts'
import { validateProcessSpec } from './spec.ts'
import type {
  IProcessExitStatus,
  IProcessHandle,
  IProcessLaunchContext,
  IProcessSpec
} from './types.ts'

/** Supplies the process-specific exit and termination rules to the shared supervisor. */
export function createProcessProfile<THandle extends IProcessHandle>(
  launchContext: IUnitProfile<
    IProcessSpec,
    THandle,
    IProcessExitStatus,
    IProcessLaunchContext
  >['launchContext']
): IUnitProfile<IProcessSpec, THandle, IProcessExitStatus, IProcessLaunchContext> {
  return {
    kind: PROCESS_KIND,
    gracefulTermination: true,
    requirements: processRequirements,
    validateSpec: validateProcessSpec,
    launchContext,
    terminate: (handle, mode) => handle.terminate(mode),
    exitStatus: (status) => ({ code: status.code, signal: status.signal }),
    classifyExit: (status) => ({
      reason: status.code === 0 && status.signal === null ? ExitReason.exited : ExitReason.crashed,
      detail: { code: status.code, signal: status.signal }
    })
  }
}
