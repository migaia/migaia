import {
  boundedWait,
  createAbortController,
  createLifecycleScope,
  type ILifecycleScope
} from '@migaia/lifecycle'
import { systemScheduler, systemWallClock, type IScheduledTask } from '@migaia/utils/scheduler'
import { admitCapabilities } from '../admission.js'
import { SupervisionErrorCode } from '../error-code.js'
import { SupervisionErrorText } from '../error-text.js'
import { createSupervisionError } from '../errors.js'
import type { IUnitRuntime } from '../index.js'
import { processRequirements, validateCapabilityDeclaration } from './capabilities.js'
import { DrainedStream, ProcessCapability } from './constants.js'
import { invalidProcessOption, validateProcessSpec } from './spec.js'
import type {
  IPrewarmEntry,
  IPrewarmPool,
  IPrewarmPoolOptions,
  IProcessHandle,
  IProcessLaunchContext,
  IProcessRecord
} from './types.js'
import { startUsageMonitor } from './usage-monitor.js'

/** One idle unit and its ordered cleanup scope. */
type IIdle<THandle extends IProcessHandle> = {
  readonly lease: IPrewarmEntry<THandle>['lease']
  readonly scope: ILifecycleScope
  readonly monitors: ILifecycleScope
  readonly controller: ReturnType<typeof createAbortController>
  readonly chunks: Array<{ stream: DrainedStream; chunk: Uint8Array }>
  handle?: THandle
  launch?: Promise<THandle>
  record?: IProcessRecord
  timer?: IScheduledTask
  taken: boolean
  retired: boolean
  output?: IProcessLaunchContext['output']
}

/** Launches bounded idle units without adding a second restart policy. */
export function createPrewarmPool<THandle extends IProcessHandle>(
  options: IPrewarmPoolOptions<THandle>
): IPrewarmPool<THandle> {
  validateProcessSpec(options.spec)
  validateCapabilityDeclaration(options.launcher.capabilities)
  if (options.budget.kind !== 'process') invalidProcessOption('budget')
  if (!Number.isSafeInteger(options.size) || options.size < 0) invalidProcessOption('size', true)
  if (typeof options.report !== 'function') invalidProcessOption('report')
  if (
    options.registry &&
    (typeof options.launcher.probe !== 'function' ||
      typeof options.launcher.terminateRecord !== 'function')
  )
    invalidProcessOption('registry')
  admitCapabilities(
    [...processRequirements(options.spec), ...(options.requires ?? [])],
    options.launcher.capabilities,
    options.isolation ?? 'required',
    'process'
  )
  const scheduler = options.scheduler ?? systemScheduler
  const wallClock = options.wallClock ?? systemWallClock
  const idle = new Set<IIdle<THandle>>()
  const starting = new Set<IIdle<THandle>>()
  const retiring = new Set<Promise<void>>()
  let closed = false
  let disposePromise: Promise<void> | undefined
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000
  const idleTimeoutMs = options.idleTimeoutMs ?? 60_000
  const exitTimeoutMs = options.exitTimeoutMs ?? 5_000
  const reapTimeoutMs = options.reapTimeoutMs ?? 5_000
  for (const [field, value] of Object.entries({
    startupTimeoutMs,
    idleTimeoutMs,
    exitTimeoutMs,
    reapTimeoutMs
  }))
    if (!Number.isFinite(value) || value < 0) invalidProcessOption(field, true)

  /** Creates a coded diagnostic without embedding process output or bootstrap bytes. */
  const failure = (
    code: (typeof SupervisionErrorCode)[keyof typeof SupervisionErrorCode],
    text: string,
    cause?: unknown,
    detail: Readonly<Record<string, unknown>> = {}
  ): Error =>
    createSupervisionError(Error, code, text, {
      cause,
      detail: { kind: 'process', prewarm: true, ...detail }
    })

  /** Observes one cleanup operation and keeps disposal joinable. */
  const track = (task: Promise<void>): void => {
    retiring.add(task)
    void task.finally(() => retiring.delete(task))
  }

  /** Ends an idle entry; lease and record are released only after actual exit. */
  const retire = (entry: IIdle<THandle>, force = false): Promise<void> => {
    if (entry.retired) return Promise.resolve()
    entry.retired = true
    idle.delete(entry)
    starting.delete(entry)
    entry.controller.abort()
    entry.timer?.cancel()
    const handle = entry.handle
    if (handle) {
      entry.scope.own(handle, {
        ...(force
          ? {}
          : {
              graceful: () => {
                handle.terminate('graceful')
                return handle.exited.then(() => undefined)
              },
              gracefulTimeoutMs: exitTimeoutMs
            }),
        force: async () => {
          try {
            handle.terminate('force')
          } catch (error) {
            options.report(error)
          }
          try {
            if (!(await boundedWait(handle.exited, scheduler.now() + reapTimeoutMs, { scheduler })))
              options.report(
                failure(SupervisionErrorCode.reapTimeout, SupervisionErrorText.reapTimeout)
              )
          } catch (error) {
            options.report(error)
          }
        }
      })
    }
    const task = entry.scope.dispose().then(() => undefined)
    track(task)
    return task
  }

  /** Drops bounded buffered output into a newly attached supervisor sink in source order. */
  const bindOutput = (entry: IIdle<THandle>, sink: IProcessLaunchContext['output']): void => {
    for (const item of entry.chunks) sink(item.stream, item.chunk)
    entry.chunks.length = 0
    entry.output = sink
  }

  /** Adds one idle unit if a nonqueuing budget lease is immediately available. */
  const spawnOne = (): boolean => {
    const grant = options.budget.tryAcquire()
    if (grant.kind === 'rejected') return false
    const controller = createAbortController()
    const scope = createLifecycleScope({ errorPolicy: 'report', report: options.report, scheduler })
    const monitors = createLifecycleScope({
      errorPolicy: 'report',
      report: options.report,
      scheduler
    })
    const entry: IIdle<THandle> = {
      lease: grant.lease,
      scope,
      monitors,
      controller,
      chunks: [],
      taken: false,
      retired: false
    }
    scope.own(grant.lease, {
      force: async () => {
        let handle = entry.handle
        if (!handle && entry.launch) {
          try {
            if (
              !(await boundedWait(entry.launch, scheduler.now() + reapTimeoutMs, { scheduler }))
            ) {
              options.report(
                failure(
                  SupervisionErrorCode.reapTimeout,
                  SupervisionErrorText.reapTimeout,
                  undefined,
                  { phase: 'launch' }
                )
              )
              void entry.launch.then(
                async (late) => {
                  try {
                    late.terminate('force')
                  } catch (error) {
                    options.report(error)
                  }
                  try {
                    await late.exited
                  } catch (error) {
                    options.report(error)
                  }
                  grant.lease.release()
                },
                (error) => {
                  options.report(error)
                  grant.lease.release()
                }
              )
              return
            }
            handle = await entry.launch
            entry.handle = handle
            try {
              handle.terminate('force')
            } catch (error) {
              options.report(error)
            }
          } catch {
            grant.lease.release()
            return
          }
        }
        if (handle) {
          try {
            if (
              !(await boundedWait(handle.exited, scheduler.now() + reapTimeoutMs, { scheduler }))
            ) {
              void handle.exited.then(
                () => grant.lease.release(),
                (error) => {
                  options.report(error)
                  grant.lease.release()
                }
              )
              return
            }
          } catch (error) {
            options.report(error)
          }
        }
        grant.lease.release()
      }
    })
    scope.own(monitors, { force: () => monitors.dispose().then(() => undefined) })
    starting.add(entry)
    const output: IProcessLaunchContext['output'] = (stream, chunk) => {
      if (entry.retired) return
      if (entry.output) {
        entry.output(stream, chunk)
        return
      }
      entry.chunks.push({ stream, chunk: chunk.slice() })
      let bytes = entry.chunks.reduce((sum, part) => sum + part.chunk.length, 0)
      while (bytes > 65_536 && entry.chunks.length > 1) bytes -= entry.chunks.shift()!.chunk.length
    }
    const launch = Promise.resolve().then(() =>
      options.launcher.launch(options.spec, { signal: controller.signal, output })
    )
    entry.launch = launch
    void (async () => {
      try {
        if (!(await boundedWait(launch, scheduler.now() + startupTimeoutMs, { scheduler }))) {
          options.report(
            failure(SupervisionErrorCode.startupTimeout, SupervisionErrorText.startupTimeout)
          )
          await retire(entry, true)
          return
        }
        const handle = await launch
        entry.handle = handle
        if (closed || entry.retired) {
          await retire(entry, true)
          return
        }
        if (
          typeof handle.sampleUsage !== 'function' &&
          ((options.spec.limits?.memoryBytes !== undefined &&
            options.launcher.capabilities[ProcessCapability.memoryLimit] === 'monitored') ||
            (options.spec.limits?.cpuTimeMs !== undefined &&
              options.launcher.capabilities[ProcessCapability.cpuTimeLimit] === 'monitored'))
        )
          throw createSupervisionError(
            Error,
            SupervisionErrorCode.capabilityUnsupported,
            SupervisionErrorText.capabilityUnsupported,
            { detail: { kind: 'process', reason: 'sample-usage-missing' } }
          )
        if (options.registry) {
          const record: IProcessRecord = {
            id: `${options.id}/${handle.identity.fingerprint}`,
            namespace: options.registry.namespace,
            identity: handle.identity,
            launchedAt: wallClock.timestamp()
          }
          await options.registry.port.add(record)
          entry.record = record
          scope.own(record, {
            force: async () => {
              try {
                if (
                  await boundedWait(handle.exited, scheduler.now() + reapTimeoutMs, { scheduler })
                )
                  await options.registry!.port.remove(record.id)
                else
                  void handle.exited.then(
                    () => options.registry!.port.remove(record.id).catch(options.report),
                    options.report
                  )
              } catch (error) {
                options.report(error)
              }
            }
          })
        }
        starting.delete(entry)
        idle.add(entry)
        const unit: IUnitRuntime = { generation: 0, scope, monitors, signal: controller.signal }
        startUsageMonitor(
          handle,
          options.spec.limits,
          options.launcher.capabilities,
          unit,
          scheduler,
          options.usage?.intervalMs ?? 1_000,
          options.usage?.failureThreshold ?? 3,
          (reason, detail, cause) => {
            const code =
              reason === 'unhealthy'
                ? SupervisionErrorCode.unhealthy
                : SupervisionErrorCode.resourceLimitExceeded
            options.report(
              failure(
                code,
                reason === 'unhealthy'
                  ? SupervisionErrorText.unhealthy
                  : SupervisionErrorText.resourceLimitExceeded,
                cause,
                detail
              )
            )
            void retire(entry, true)
          },
          options.report
        )
        entry.timer = scheduler.schedule(() => {
          void retire(entry)
        }, idleTimeoutMs)
        entry.timer.unref?.()
        monitors.own(entry.timer, { force: () => entry.timer?.cancel() })
        void handle.exited.then((status) => {
          if (entry.taken || entry.retired) return
          if (status.code !== 0 || status.signal !== null)
            options.report(
              failure(
                SupervisionErrorCode.exitUnexpected,
                SupervisionErrorText.exitUnexpected,
                undefined,
                { code: status.code, signal: status.signal }
              )
            )
          void retire(entry, true)
        }, options.report)
      } catch (error) {
        if (!entry.retired)
          options.report(
            failure(SupervisionErrorCode.launchFailed, SupervisionErrorText.launchFailed, error)
          )
        await retire(entry, true)
      }
    })()
    return true
  }

  /** Refills only after construction, take, or explicit invalidation. */
  const refill = (): void => {
    if (closed) return
    while (idle.size + starting.size < options.size) if (!spawnOne()) break
  }
  refill()
  return {
    id: options.id,
    spec: options.spec,
    budget: options.budget,
    launcher: options.launcher,
    get idle() {
      return idle.size
    },
    take() {
      if (closed) return undefined
      const entry = idle.values().next().value as IIdle<THandle> | undefined
      if (!entry?.handle) {
        refill()
        return undefined
      }
      idle.delete(entry)
      entry.taken = true
      entry.timer?.cancel()
      void entry.monitors.dispose()
      entry.scope.release(entry.lease)
      entry.scope.release(entry.monitors)
      if (entry.record) {
        entry.scope.release(entry.record)
        void entry.handle.exited.then(
          () => options.registry?.port.remove(entry.record!.id).catch(options.report),
          options.report
        )
      }
      const result: IPrewarmEntry<THandle> = {
        handle: entry.handle,
        lease: entry.lease,
        bindOutput: (sink) => bindOutput(entry, sink)
      }
      refill()
      return result
    },
    invalidate() {
      if (closed) return
      const tasks = [...idle, ...starting].map((entry) => retire(entry))
      void Promise.all(tasks).then(refill)
    },
    dispose() {
      if (disposePromise) return disposePromise
      closed = true
      const tasks = [...idle, ...starting].map((entry) => retire(entry))
      disposePromise = Promise.all([...tasks, ...retiring]).then(() => undefined)
      return disposePromise
    }
  }
}
