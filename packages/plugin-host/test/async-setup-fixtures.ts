/** Owns shared fixture construction; test assertions remain in their focused suites. */
import { createManualScheduler } from '@migaia/utils/testing'
import { PluginHost } from '../src/index.ts'

/** Holds one setup attempt until a test explicitly resolves or rejects its Promise. */
export const deferred = <T>() => {
  /** Completes the held setup result after assertions observe its pending state. */
  let resolve!: (value: T) => void
  /** Rejects the held setup result with an exact error identity. */
  let reject!: (error: unknown) => void
  /** Exact pending result returned to the plugin's setup callback. */
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** Creates a host and its manual scheduler under the requested setup deadline. */
export const createHost = (
  timeout: number | false = false,
  diagnostic?: (...args: any[]) => void
) => {
  /** Runtime-neutral clock whose deadlines advance only when the test requests it. */
  const scheduler = createManualScheduler()
  /** Host whose lifecycle and diagnostics are controlled by this fixture. */
  const host = new PluginHost<Record<string, never>>({
    scheduler,
    diagnostic,
    execution: { mutationTimeoutMs: timeout, pipelineDrainTimeoutMs: false }
  })
  return { host, scheduler }
}
