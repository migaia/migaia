import type { IUnitHandle, IUnitLauncher } from '../../src/index.js'

/** Externally settled promise for deterministic launch and exit ordering. */
export function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** Exit status produced by the memory unit. */
export type IMemoryExit = { readonly outcome: 'fulfilled' | 'rejected'; readonly error?: unknown }
/** In-memory handle whose exit is controlled by the test. */
export type IMemoryHandle = IUnitHandle<IMemoryExit> & {
  readonly exit: (status: IMemoryExit) => void
  readonly termination: Array<'graceful' | 'force'>
}
/** One launch queue with independent handles and an observable launch count. */
export function createMemoryLauncher(): IUnitLauncher<string, IMemoryHandle> & {
  readonly launched: IMemoryHandle[]
} {
  const launched: IMemoryHandle[] = []
  return {
    capabilities: { termination: 'enforced', 'fault-isolation': 'enforced' },
    launched,
    async launch() {
      const exited = deferred<IMemoryExit>()
      const handle: IMemoryHandle = {
        identity: { fingerprint: `memory:${launched.length + 1}` },
        exited: exited.promise,
        exit: exited.resolve,
        termination: []
      }
      launched.push(handle)
      return handle
    }
  }
}
