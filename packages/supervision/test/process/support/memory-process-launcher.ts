import type { CapabilityLevel } from '../../../src/constants.js'
import {
  StderrMode,
  StdinMode,
  StdoutMode,
  type IProcessHandle,
  type IProcessLauncher,
  type IProcessSpec,
  type IProcessExitStatus,
  type IProcessLaunchContext,
  type IProcessUsage
} from '../../../src/process/index.js'

/** Test-only handle with explicit exit and output controls. */
export type IMemoryProcessHandle = IProcessHandle & {
  readonly terminations: Array<'graceful' | 'force'>
  complete(status?: IProcessExitStatus): void
  emit(stream: 'stdout' | 'stderr', chunk: Uint8Array): void
  setUsage(sample: () => Promise<IProcessUsage>): void
}
/** Test-only launcher with observations of every launched specification. */
export type IMemoryProcessLauncher = IProcessLauncher<IMemoryProcessHandle> & {
  readonly handles: IMemoryProcessHandle[]
  readonly specs: IProcessSpec[]
}

/** Returns a valid baseline specification with no secret carrier. */
export function processSpec(): IProcessSpec {
  return {
    command: '/bin/echo',
    args: ['ok'],
    env: { inherit: [], set: {} },
    stdio: { stdin: StdinMode.ignore, stdout: StdoutMode.drain, stderr: StderrMode.drain }
  }
}

/** Creates deterministic handles; forced termination normally settles their exit. */
export function memoryProcessLauncher(
  capabilities: Readonly<Record<string, CapabilityLevel>> = {
    termination: 'enforced',
    'fault-isolation': 'enforced'
  },
  autoExit = true
): IMemoryProcessLauncher {
  const handles: IMemoryProcessHandle[] = []
  const specs: IProcessSpec[] = []
  return {
    capabilities,
    handles,
    specs,
    async launch(spec: IProcessSpec, context: IProcessLaunchContext) {
      specs.push(spec)
      let complete: (status: IProcessExitStatus) => void = () => undefined
      const exited = new Promise<IProcessExitStatus>((resolve) => {
        complete = resolve
      })
      const terminations: Array<'graceful' | 'force'> = []
      let sample = async (): Promise<IProcessUsage> => ({})
      let settled = false
      const handle: IMemoryProcessHandle = {
        identity: { fingerprint: `fingerprint-${handles.length + 1}`, pid: 100 },
        exited,
        terminations,
        terminate(mode) {
          terminations.push(mode)
          if (autoExit) handle.complete({ code: null, signal: 'SIGTERM' })
        },
        complete(status = { code: 0, signal: null }) {
          if (settled) return
          settled = true
          complete(status)
        },
        emit(stream, chunk) {
          context.output(stream, chunk)
        },
        setUsage(next) {
          sample = next
        },
        sampleUsage: () => sample()
      }
      handles.push(handle)
      return handle
    },
    probe: async () => 'gone',
    terminateRecord: async () => undefined
  }
}
