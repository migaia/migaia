import type { IUnitProfile } from '../index.js'
import { processRequirements } from './capabilities.js'
import { validateProcessSpec } from './spec.js'
import type {
  IProcessExitStatus,
  IProcessHandle,
  IProcessLaunchContext,
  IProcessSpec
} from './types.js'

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
    kind: 'process',
    gracefulTermination: true,
    requirements: processRequirements,
    validateSpec: validateProcessSpec,
    launchContext,
    terminate: (handle, mode) => handle.terminate(mode),
    classifyExit: (status) => ({
      reason: status.code === 0 && status.signal === null ? 'exited' : 'crashed',
      detail: { code: status.code, signal: status.signal }
    })
  }
}
