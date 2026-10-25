import { workerData as bootstrap } from 'node:worker_threads'
import { createSyncLifecycleScope } from '@migaia/lifecycle'
import { UtilsAbortError } from '@migaia/utils/error'
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { readThreadBootstrap } from '../../../dist/threads/bootstrap.js'
/** Native launch data selects only this real Worker's fixture business behavior. */
const { data: workerData } = readThreadBootstrap(bootstrap)
/**
 * Returns normal fixture data, crashes the selected generation, or rejects with two real package
 * errors.
 *
 * @param {unknown} value Portable business value received through the public request path.
 * @returns {unknown} The original value, or a pending Promise until the deliberate crash.
 * @throws {UtilsAbortError} Source-domain mode wraps the lifecycle admission failure as its cause.
 */
function request(value) {
  if (workerData.sourceDomainFailure) {
    /** A real closed lifecycle owner creates the inner registered package error. */
    const scope = createSyncLifecycleScope()
    scope.dispose()
    try {
      scope.own('already-disposed', { syncSafe: true, force: () => undefined })
    } catch (cause) {
      throw new UtilsAbortError(cause)
    }
  }
  if (workerData.crash && workerData.generation === 1) {
    setTimeout(() => process.exit(1), workerData.crashDelay ?? 1)
    return new Promise(() => undefined)
  }
  return value
}

/**
 * Holds this real business stream until its actual provider signal is cancelled.
 *
 * @param {unknown} value The original first yielded business value.
 * @param {{ signal: AbortSignal }} context The real provider cancellation context.
 * @returns {AsyncGenerator<unknown>} A live stream ending only after the caller's native deadline.
 */
async function* heldStream(value, context) {
  yield value
  if (!context.signal.aborted)
    await new Promise((resolve) =>
      context.signal.addEventListener('abort', resolve, { once: true })
    )
}

/** One actual public Host owns the native child bootstrap and original business providers. */
await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  contract: workerData.contract,
  provide: {
    p: {
      read: request,
      write: request,
      hold: () => new Promise(() => undefined),
      bad: () => () => undefined,
      stream: workerData.holdStream
        ? heldStream
        : function* (value) {
            yield value
            yield value
          },
      notify: () => undefined
    }
  },
  report: (error) => process.stderr.write(`${error?.stack ?? String(error)}\n`)
})
