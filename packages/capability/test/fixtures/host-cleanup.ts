/** Host cleanup fixtures own release effects, controlled failures and reentry observations. */
import type {
  ICapabilityEnableResult,
  ICapabilityHandle,
  ICapabilityHost
} from '../../src/index.ts'
import { handleOf } from './capability-host.ts'
import { vi } from 'vitest'

/** A handle fixture with no cleanup effects. */
export function ignoreHostCleanup(): void {}

/** Build the same fresh mocked handle only if a registration actually activates. */
export async function activateHostHandle(): Promise<ICapabilityHandle> {
  return handleOf()
}

/** Lazy import fixture creates its install callback at module scope rather than inside a mock. */
export async function loadCapabilityModule(): Promise<{ install(): ICapabilityHandle }> {
  return { install: installCapabilityHandle }
}

/** Every installation still creates a distinct disposer mock and handle. */
function installCapabilityHandle(): ICapabilityHandle {
  return { dispose: vi.fn() }
}

/** Owns one cleanup's ordered effect and optional exact or release-time failure. */
export class RecordedCapabilityRelease {
  /** Existing test-owned array observes physical disposal order. */
  readonly #order: string[]
  /** Exact resource identity appended by the disposer. */
  readonly #name: string
  /** Existing failure identity is thrown only when physical release runs. */
  readonly #failure: unknown
  /** Message-based failures are constructed at release time, matching their original fixture. */
  readonly #failureMessage: string | undefined
  /** Capture the release observation and its optional failure without executing cleanup. */
  constructor(order: string[], name: string, failure?: unknown, failureMessage?: string) {
    this.#order = order
    this.#name = name
    this.#failure = failure
    this.#failureMessage = failureMessage
  }
  /** Record once per actual invocation, then retain the original fixture's throw behavior. */
  readonly dispose = (): void => {
    this.#order.push(this.#name)
    if (this.#failureMessage !== undefined) throw new Error(this.#failureMessage)
    if (this.#failure !== undefined) throw this.#failure
  }
}

/** Owns the original asynchronous cleanup continuation and its test observation. */
export class AsyncCapabilityRelease {
  /** Test callback observes completion after the original Promise continuation. */
  readonly #completed: () => void
  /** Capture the completion observation without running it. */
  constructor(completed: () => void) {
    this.#completed = completed
  }
  /** Preserve one asynchronous turn before publishing the release effect. */
  readonly dispose = async (): Promise<void> => {
    await Promise.resolve()
    this.#completed()
  }
}

/** Exact rejected-cleanup fixture retains error identity and asynchronous method behavior. */
export class RejectedCapabilityRelease {
  /** Original cleanup error reaches the host's report channel unchanged. */
  readonly #failure: unknown
  /** Capture a failure without rejecting until cleanup is invoked. */
  constructor(failure: unknown) {
    this.#failure = failure
  }
  /** Reject only on the host's actual physical cleanup call. */
  readonly dispose = async (): Promise<void> => {
    throw this.#failure
  }
}

/** Owns the mutation attempts performed during the original disposer reentry window. */
export class ReentrantCapabilityRelease {
  /** Host instance is captured after construction and observed only during cleanup. */
  readonly #host: ICapabilityHost<undefined>
  /** Test-owned failures retain the original mutation-attempt order. */
  readonly #errors: unknown[]
  /** Test variables retain the exact disable and enable promises returned during cleanup. */
  readonly #pending: (disable: Promise<boolean>, enable: Promise<ICapabilityEnableResult>) => void
  /** Capture all observations before registration without opening a transition. */
  constructor(
    host: ICapabilityHost<undefined>,
    errors: unknown[],
    pending: (disable: Promise<boolean>, enable: Promise<ICapabilityEnableResult>) => void
  ) {
    this.#host = host
    this.#errors = errors
    this.#pending = pending
  }
  /** Attempt the original two mutations, followed by disable and enable in the same order. */
  readonly dispose = (): void => {
    for (const mutation of [
      () => this.#host.setFlag('persist', true),
      () => this.#host.setFlags({ persist: true })
    ]) {
      try {
        mutation()
      } catch (error) {
        this.#errors.push(error)
      }
    }
    this.#pending(this.#host.disable('persist'), this.#host.enable('persist'))
  }
}

/** Owns hostile handle getter reads and the two alternate disposer effects. */
export class SingleReadCapabilityHandle {
  /** Host adoption must read this getter exactly once. */
  #reads = 0
  /** First returned disposer records legitimate cleanup. */
  #original = 0
  /** A later getter read would expose the unwanted alternate cleanup. */
  #hijacked = 0
  /** Read counts without causing another dispose getter read. */
  get reads(): number {
    return this.#reads
  }
  /** Inspect first-disposer observations. */
  get original(): number {
    return this.#original
  }
  /** Inspect alternate-disposer observations. */
  get hijacked(): number {
    return this.#hijacked
  }
  /** Select the original or alternate disposer at precisely the host's getter-read moment. */
  get dispose(): () => void {
    this.#reads++
    return this.#reads === 1 ? this.#releaseOriginal : this.#releaseHijacked
  }
  /** Preserve the legitimate cleanup effect without requiring a call receiver. */
  readonly #releaseOriginal = (): void => {
    this.#original++
  }
  /** Preserve the alternate cleanup effect if the host wrongly reads again. */
  readonly #releaseHijacked = (): void => {
    this.#hijacked++
  }
}

/** Rejection protocol owner supplies a mockable getter result without nested callbacks. */
export class RejectedCleanupThen {
  /** Original error is passed directly to the thenable's supplied reject continuation. */
  readonly #failure: unknown
  /** Capture failure without invoking either continuation. */
  constructor(failure: unknown) {
    this.#failure = failure
  }
  /** Reject through the caller's captured thenable continuation. */
  readonly rejectCleanup = (
    _resolve: (value: unknown) => void,
    reject: (error: unknown) => void
  ): void => {
    reject(this.#failure)
  }
  /** Getter callback returns the same protocol method; mock call counts still measure getter reads. */
  readonly getThen = (): typeof this.rejectCleanup => this.rejectCleanup
}

/** Build a fresh cleanup handle whose then property getter runs only during host release. */
export function thenGetterCapabilityHandle(getThen: () => unknown): ICapabilityHandle {
  return {
    dispose() {
      // oxlint-disable-next-line unicorn/no-thenable -- test hostile then getter handling.
      return Object.defineProperty({}, 'then', { get: getThen }) as never
    }
  }
}
