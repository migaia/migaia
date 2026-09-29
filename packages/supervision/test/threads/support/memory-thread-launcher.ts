import type { CapabilityLevel, ILaunchContext } from '../../../src/index.js'
import type {
  IThreadExitStatus,
  IThreadHandle,
  IThreadLauncher,
  IThreadSpec
} from '../../../src/threads/index.js'

/** Controllable thread handle that exposes termination and actual exit separately. */
export type IMemoryThreadHandle = IThreadHandle & {
  readonly terminations: number
  readonly alive: boolean
  complete(status?: IThreadExitStatus): void
  failTermination(error: unknown): void
}

/** Records launch inputs and exposes each simulated thread to the test. */
export type IMemoryThreadLauncher = IThreadLauncher<IMemoryThreadHandle> & {
  readonly handles: IMemoryThreadHandle[]
  readonly specs: IThreadSpec[]
  readonly contexts: ILaunchContext[]
  readonly events: string[]
  autoExit: boolean
  launchFailure?: unknown
}

/** Valid baseline thread specification. */
export function threadSpec(): IThreadSpec {
  return { entry: './unit.js' }
}

/** Allows the supervisor's queued microtasks to settle after manual-clock changes. */
export async function settle(): Promise<void> {
  for (let index = 0; index < 100; index++) await Promise.resolve()
}

/** Creates a launcher whose exit promise can be settled only by the test or termination. */
export function memoryThreadLauncher(
  capabilities: Readonly<Record<string, CapabilityLevel>> = {
    termination: 'enforced',
    'fault-isolation': 'unsupported',
    'heap-limit': 'enforced',
    'exit-observation': 'enforced'
  },
  autoExit = true
): IMemoryThreadLauncher {
  const handles: IMemoryThreadHandle[] = []
  const specs: IThreadSpec[] = []
  const contexts: ILaunchContext[] = []
  const events: string[] = []
  /** Shared launcher state read by each generated handle. */
  const launcher: IMemoryThreadLauncher = {
    capabilities,
    handles,
    specs,
    contexts,
    events,
    autoExit,
    async launch(spec, context) {
      specs.push(spec)
      contexts.push(context)
      events.push('launch')
      if (launcher.launchFailure !== undefined) throw launcher.launchFailure
      let resolveExit: (status: IThreadExitStatus) => void = () => undefined
      const exited = new Promise<IThreadExitStatus>((resolve) => {
        resolveExit = resolve
      })
      let terminations = 0
      let terminationError: unknown
      let settled = false
      const handle: IMemoryThreadHandle = {
        identity: { fingerprint: `thread-${handles.length + 1}`, threadId: handles.length + 1 },
        exited,
        get terminations() {
          return terminations
        },
        get alive() {
          return !settled
        },
        terminate() {
          terminations++
          events.push('terminate')
          if (terminationError !== undefined) throw terminationError
          if (launcher.autoExit) handle.complete({ code: null })
        },
        complete(status = { code: 0 }) {
          if (settled) return
          settled = true
          events.push('exited')
          resolveExit(status)
        },
        failTermination(error) {
          terminationError = error
        }
      }
      handles.push(handle)
      return handle
    }
  }
  return launcher
}
