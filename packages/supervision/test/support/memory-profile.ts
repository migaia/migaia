import type { IUnitProfile } from '../../src/index.js'
import type { IMemoryExit, IMemoryHandle } from './memory-launcher.js'

/** Profile whose termination calls are visible to memory tests. */
export function createMemoryProfile(
  options: { readonly gracefulTermination?: boolean; readonly autoExitOnTerminate?: boolean } = {}
): IUnitProfile<string, IMemoryHandle, IMemoryExit> {
  return {
    kind: 'memory',
    gracefulTermination: options.gracefulTermination ?? false,
    requirements: () => ['termination'],
    validateSpec: () => undefined,
    terminate(handle, mode) {
      handle.termination.push(mode)
      if (options.autoExitOnTerminate) handle.exit({ outcome: 'fulfilled' })
    },
    classifyExit(status) {
      return status.outcome === 'fulfilled'
        ? { reason: 'exited' }
        : { reason: 'crashed', cause: status.error }
    }
  }
}
