import type { IPartHost } from '../src/index.ts'

/** A promise whose settlement the test controls. */
export class Deferred<T> {
  /** The promise. */
  readonly promise: Promise<T>
  /** Resolves the promise. */
  resolve!: (value: T) => void
  /** Rejects the promise. */
  reject!: (error: unknown) => void

  /** Creates a pending promise. */
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

/** One recorded call of a test load function. */
export type ILoadCall = {
  readonly params: unknown
  readonly signal: { readonly aborted: boolean }
  readonly result: Deferred<unknown>
}

/** Load function whose calls are recorded and settled by the test. */
export class ControlledLoad {
  /** Calls in order. */
  readonly calls: ILoadCall[] = []

  /** The load function to give to `defineResource`. */
  readonly load = (
    params: unknown,
    context: { readonly signal: { readonly aborted: boolean } }
  ) => {
    /** Result of this call. */
    const result = new Deferred<unknown>()
    this.calls.push({ params, signal: context.signal, result })
    return result.promise
  }

  /** The latest call. */
  last(): ILoadCall {
    return this.calls[this.calls.length - 1] as ILoadCall
  }
}

/** Lets promise callbacks and scheduled reactive effects run. */
export async function settle(host: IPartHost): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    host.state.runtime.flush()
  }
}
