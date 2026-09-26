import { createLifecycleScope, type ILifecycleScope } from '@migaia/lifecycle'
import { WebRpcAbortError, WebRpcConfigurationError, WebRpcTimeoutError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import { raceWithAsyncControl } from './async-control.js'
import type { IWebRpcAbortSignal, IWebRpcHookEvent } from '../typing.js'
import type { IWebRpcTransport } from '../transport.js'
import { createEndpointTimePort, type IEndpointTimePort } from './time-port.js'
import type { IWebRpcPluginInstallScope } from './plugin-contract.js'

/** Clock capability used to calculate one construction deadline across all plugin installs. */
export type IWebRpcConstructionTime = IEndpointTimePort

/** Immutable batch-entry construction signal and absolute deadline snapshot. */
export type IWebRpcConstructionControl = {
  readonly signal: IWebRpcAbortSignal
  readonly time: IEndpointTimePort
  readonly deadlineAt: number | undefined
  remaining(): number | false | undefined
  close(): void
}

/** Creates the one construction control shared by every plugin in a batch. */
export function createConstructionControl(options: {
  readonly signal: IWebRpcAbortSignal
  readonly timeoutMs?: number | false
  readonly time?: IWebRpcConstructionTime
}): IWebRpcConstructionControl {
  const timeoutMs = options.timeoutMs
  if (
    timeoutMs !== undefined &&
    timeoutMs !== false &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0)
  )
    throw new WebRpcConfigurationError(WebRpcErrorText.timeoutInvalid)
  /** Snapshot the optional time capability once so hostile getters cannot change ownership. */
  const suppliedTime = options.time
  /** Whether this control owns the default endpoint time port and must dispose it. */
  const ownsTime = suppliedTime === undefined
  const time = suppliedTime ?? createEndpointTimePort()
  /** Snapshot the caller signal once so construction observes one source identity. */
  const sourceSignal = options.signal
  let deadlineAt: number | undefined
  try {
    deadlineAt = timeoutMs === undefined || timeoutMs === false ? undefined : time.now() + timeoutMs
  } catch (error) {
    if (ownsTime) {
      try {
        time.dispose()
      } catch {}
    }
    throw error
  }
  const controller = new AbortController()
  const onSourceAbort = (): void => controller.abort(sourceSignal.reason)
  try {
    if (sourceSignal.aborted) controller.abort(sourceSignal.reason)
    else sourceSignal.addEventListener('abort', onSourceAbort, { once: true })
  } catch {
    controller.abort(sourceSignal.reason)
  }
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    try {
      sourceSignal.removeEventListener('abort', onSourceAbort)
    } catch {}
    controller.abort()
    if (ownsTime) time.dispose()
  }
  return Object.freeze({
    signal: controller.signal as IWebRpcAbortSignal,
    time,
    deadlineAt,
    remaining: (): number | false | undefined =>
      deadlineAt === undefined ? timeoutMs : Math.max(0, deadlineAt - time.now()),
    close
  })
}

/** Construction budget and host registration required by the one-plugin install gate. */
export type IWebRpcConstructionInstallOptions = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly control: IWebRpcConstructionControl
  readonly hooks: (event: IWebRpcHookEvent) => void
  readonly getPort?: (key: PropertyKey) => unknown
  readonly report?: (error: unknown) => void
  readonly registerScope: (
    scope: ILifecycleScope,
    close: () => void,
    awaitClose: () => Promise<void>
  ) => void
}

/** Runs one plugin body under the absolute construction gate and late-resource ownership scope. */
export function runConstructionInstall<T>(
  options: IWebRpcConstructionInstallOptions,
  install: (scope: IWebRpcPluginInstallScope) => T | PromiseLike<T>
): Promise<T> {
  const report = (error: unknown): void => {
    try {
      options.report?.(error)
    } catch {
      // Diagnostic failures cannot alter construction or cleanup semantics.
    }
  }
  const scope = createLifecycleScope({ errorPolicy: 'collect', report })
  let accepting = true
  let cleanupPromise: Promise<readonly { readonly error: unknown }[]> | undefined
  const closeGate = (): void => {
    if (!accepting) return
    accepting = false
    scope.close()
    cleanupPromise = scope.dispose()
    void cleanupPromise.then((errors) => {
      for (const error of errors) report(error)
    }, report)
  }
  const awaitClose = async (): Promise<void> => {
    closeGate()
    const errors = await cleanupPromise!
    if (errors.length > 0) throw new AggregateError(errors.map((entry) => entry.error))
  }
  try {
    options.registerScope(scope, closeGate, awaitClose)
  } catch (error) {
    closeGate()
    options.control.close()
    return Promise.reject(error)
  }
  const own = <TResource>(resource: TResource, release: () => void | Promise<void>): TResource => {
    if (!accepting) {
      void Promise.resolve().then(release).catch(report)
      return resource
    }
    return scope.own(resource, { force: () => release() })
  }
  let operation: Promise<T> | undefined
  const start = (): Promise<T> => {
    operation = Promise.resolve()
      .then(() =>
        install({
          id: options.id,
          transport: options.transport,
          signal: options.control.signal,
          hooks: options.hooks,
          getPort: options.getPort ?? (() => undefined),
          own
        })
      )
      .then(
        (value) => value,
        (error) => {
          if (!accepting) report(error)
          throw error
        }
      )
    return operation
  }
  const abortListener = (): void => closeGate()
  try {
    options.control.signal.addEventListener('abort', abortListener, { once: true })
  } catch (error) {
    closeGate()
    report(error)
  }
  try {
    if (options.control.signal.aborted) closeGate()
  } catch (error) {
    closeGate()
    report(error)
  }
  const timeoutMs = options.control.remaining()
  if (options.control.signal.aborted) {
    closeGate()
    options.control.close()
    return Promise.reject(new WebRpcAbortError(undefined, undefined, options.control.signal.reason))
  }
  if (timeoutMs === 0) {
    closeGate()
    options.control.close()
    return Promise.reject(new WebRpcTimeoutError())
  }
  return raceWithAsyncControl({
    operation: start,
    timeoutMs,
    signals: [options.control.signal],
    onTimeout: closeGate,
    createTimeoutError: () => new WebRpcTimeoutError(),
    createAbortError: (reason) => new WebRpcAbortError(undefined, undefined, reason),
    createTimer: (task, delayMs) => options.control.time.setTimeout(task, delayMs),
    onSetupFailure: () => closeGate(),
    onDiagnostic: report
  })
    .then(
      (value) => value,
      (error) => {
        options.control.close()
        throw error
      }
    )
    .finally(() => {
      try {
        options.control.signal.removeEventListener('abort', abortListener)
      } catch (error) {
        report(error)
      }
    })
}
