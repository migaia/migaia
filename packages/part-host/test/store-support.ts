import type { IPartHost, IResolvedNode } from '../src/index.ts'

/** Placeholder node for `state.resolve`. */
export const anyNode = {} as IResolvedNode

/** A promise the test settles by hand. */
export class Deferred<T> {
  /** The promise. */
  readonly promise: Promise<T>
  /** Settles with a value. */
  resolve!: (value: T) => void
  /** Settles with a failure. */
  reject!: (error: unknown) => void

  /** Creates an unsettled promise. */
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

/** A tracked reader: an effect that records each value its function reads. */
export class Tracked<T> {
  /** Values seen, one per run. */
  readonly values: T[] = []
  /** Effect handle. */
  readonly #dispose: () => void

  /** Starts an effect on the host runtime. */
  constructor(host: IPartHost, read: () => T) {
    /** Effect. */
    const effect = host.state.runtime.effect(() => {
      this.values.push(read())
    })
    this.#dispose = () => effect.dispose()
  }

  /** Latest value. */
  get last(): T {
    return this.values[this.values.length - 1] as T
  }

  /** Number of runs. */
  get runs(): number {
    return this.values.length
  }

  /** Stops tracking. */
  dispose(): void {
    this.#dispose()
  }
}

/** Binding-style tracked read of a state path (the node path of a renderer). */
export function bind(host: IPartHost, path: string): Tracked<unknown> {
  return new Tracked(host, () => host.state.resolve(anyNode, { $state: path }))
}

/** Tracked read of a derive. */
export function derive(host: IPartHost, id: string): Tracked<unknown> {
  return new Tracked(host, () => host.state.resolve(anyNode, { $derive: id }))
}

/** Lets queued microtasks and the runtime flush run. */
export async function settle(host: IPartHost, rounds = 3): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve()
    host.state.runtime.flush()
  }
}

/** Error code of a reported or thrown value. */
export function codeOf(value: unknown): unknown {
  return (value as { readonly code?: unknown } | null | undefined)?.code
}

/** Waits (macrotask by macrotask) until `condition` holds; fails after `limit` turns. */
export async function until(condition: () => boolean, limit = 200): Promise<void> {
  for (let turn = 0; turn < limit; turn += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(UNTIL_TIMEOUT_TEXT)
}

/** Failure text of `until`, shared by every test that waits on a condition. */
export const UNTIL_TIMEOUT_TEXT = 'condition not reached'

/** One recorded call of an asynchronous store, settled by the test. */
export type IAsyncCall = {
  readonly key: string
  readonly value?: unknown
  readonly deferred: Deferred<unknown>
}

/** Records every asynchronous store call. */
export class AsyncCalls {
  /** `create` calls. */
  readonly creates: Deferred<unknown>[] = []
  /** `get` calls. */
  readonly gets: IAsyncCall[] = []
  /** `set` calls. */
  readonly sets: IAsyncCall[] = []
  /** `has` calls. */
  readonly hases: IAsyncCall[] = []
  /** `dispose` calls by layer name, in call order. */
  readonly disposes: { readonly name: string; readonly deferred: Deferred<unknown> }[] = []

  /** Records a call and returns its promise. */
  push(list: IAsyncCall[], key: string, value?: unknown): Promise<unknown> {
    /** Settled by the test. */
    const deferred = new Deferred<unknown>()
    list.push({ key, value, deferred })
    return deferred.promise
  }

  /** Records a release of `name`. */
  release(name: string): Promise<unknown> {
    /** Settled by the test. */
    const deferred = new Deferred<unknown>()
    this.disposes.push({ name, deferred })
    return deferred.promise
  }
}
