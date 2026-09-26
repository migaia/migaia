import { createLifecycleScope, type ILifecycleScope } from '@migaia/lifecycle'
import { RpcAbortError, RpcConfigurationError, RpcTimeoutError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { raceWithAsyncControl } from './async-control.js'
import type { IRpcAbortSignal, IRpcHookEvent } from '../typing.js'
import type { IRpcTransport } from '../transport.js'
import type { IEndpointTimePort } from './time-port.js'
import type { IRpcPluginInstallScope } from './plugin-contract.js'

/** Clock capability used to calculate one construction deadline across all plugin installs. */
export type IRpcConstructionTime = IEndpointTimePort

/** Immutable batch-entry construction signal and absolute deadline snapshot. */
export type IRpcConstructionControl = {
  readonly signal: IRpcAbortSignal
  readonly time: IEndpointTimePort
  readonly deadlineAt: number | undefined
  remaining(): number | false | undefined
  close(): void
}

/** Creates the one construction control shared by every plugin in a batch. */
export function createConstructionControl(options: {
  readonly signal: IRpcAbortSignal
  readonly timeoutMs?: number | false
  readonly time: IRpcConstructionTime
}): IRpcConstructionControl {
  const timeoutMs = options.timeoutMs
  if (
    timeoutMs !== undefined &&
    timeoutMs !== false &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0)
  )
    throw new RpcConfigurationError(RpcCoreErrorText.timeoutInvalid)
  /** Construction borrows the kernel-owned time capability. */
  const time = options.time
  /** Snapshot the caller signal once so construction observes one source identity. */
  const sourceSignal = options.signal
  const deadlineAt =
    timeoutMs === undefined || timeoutMs === false ? undefined : time.now() + timeoutMs
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
  }
  return Object.freeze({
    signal: controller.signal as IRpcAbortSignal,
    time,
    deadlineAt,
    remaining: (): number | false | undefined =>
      deadlineAt === undefined ? timeoutMs : Math.max(0, deadlineAt - time.now()),
    close
  })
}

/** Construction budget and host registration required by the one-plugin install gate. */
export type IRpcConstructionInstallOptions = {
  readonly id: string
  readonly transport: IRpcTransport
  readonly control: IRpcConstructionControl
  readonly hooks: (event: IRpcHookEvent) => void
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
  options: IRpcConstructionInstallOptions,
  install: (scope: IRpcPluginInstallScope) => T | PromiseLike<T>
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
    return Promise.reject(new RpcAbortError(undefined, undefined, options.control.signal.reason))
  }
  if (timeoutMs === 0) {
    closeGate()
    options.control.close()
    return Promise.reject(new RpcTimeoutError())
  }
  return raceWithAsyncControl({
    time: options.control.time,
    operation: start,
    timeoutMs,
    signals: [options.control.signal],
    onTimeout: closeGate,
    createTimeoutError: () => new RpcTimeoutError(),
    createAbortError: (reason) => new RpcAbortError(undefined, undefined, reason),
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
