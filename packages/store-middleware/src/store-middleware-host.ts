import {
  defineHost,
  type IHostHandle,
  MiddlewarePipelineMode,
  type IPlugin,
  type IPluginHostOptions
} from '@migaia/plugin-host'
import { ReactiveErrorPhase, type IDisposer, type IRuntime } from '@migaia/reactive'
import type { IRuntimeErrorPhase } from '@migaia/reactive/runtime'
import type { IReactiveStore } from '@migaia/store-light'
import { createStoreMiddlewareAggregateError, createStoreMiddlewareError } from './errors.js'
import { StoreMiddlewareErrorCode } from './error-code.js'
import { StoreMiddlewareErrorText } from './error-text.js'
import {
  createMutationPolicy,
  type IDevToolsAdapter,
  type IMiddlewareEvent,
  type IMiddlewareContext,
  type MutationPolicy,
  type IStoreMiddleware
} from './middleware.js'
import type { IPluginHostDisposalResult } from '@migaia/plugin-host'
import { ClonePolicy } from './tolerant-clone.js'
import { MiddlewareEventPhase, MiddlewareEventType } from './event-constants.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

/** Reports middleware diagnostics without letting a hostile reporter escape the event boundary. */
function reportMiddlewareFailure(
  runtime: IRuntime,
  error: unknown,
  phase: IRuntimeErrorPhase
): void {
  try {
    runtime.reportError(error, { phase })
    return
  } catch (reporterError) {
    const host = (globalThis as { reportError?: (value: unknown) => void }).reportError
    try {
      if (host) host(reporterError)
      else console.error(reporterError)
    } catch {
      // A failing diagnostic sink must not create an unhandled rejection.
    }
  }
}

export type IStoreMiddlewareCore<S> = {
  readonly runtime: IRuntime
  getState(): S
  applyState(state: S): void
  reportError(error: unknown, phase: string): void
}

export type IStoreMiddlewarePlugin<
  S,
  TExt extends Record<string, unknown> = Record<string, never>,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
  TShared extends object = Record<string, never>
> = IPlugin<
  IStoreMiddlewareCore<S> & import('@migaia/plugin-host').IPluginHostCore<IMiddlewareEvent<S>>,
  TExt,
  TConfig,
  TShared
>

export type IStoreMiddlewareHostOptions<S> = IPluginHostOptions & {
  readonly runtime: IRuntime
  readonly getState: () => S
  readonly applyState?: (state: S) => void
  readonly mutationPolicy?: MutationPolicy
}

/** Rejects null/non-object host options before the constructor reads their fields. */
function assertHostOptions(options: unknown): asserts options is object {
  if (options === null || typeof options !== 'object')
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.invalidOption,
      StoreMiddlewareErrorText.optionsObject
    )
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.invalidOption,
      StoreMiddlewareErrorText.optionsObject,
      { cause: descriptorSnapshot.error }
    )
  }
}

/**
 * Snapshots host configuration once so construction and PluginHost admission observe identical
 * values.
 */
function snapshotHostOptions<T>(
  options: IStoreMiddlewareHostOptions<T>
): IStoreMiddlewareHostOptions<T> {
  assertHostOptions(options)
  try {
    return {
      ...options,
      pipeline: { ...options.pipeline, mode: MiddlewarePipelineMode.sync }
    }
  } catch (error) {
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.invalidOption,
      StoreMiddlewareErrorText.optionsObject,
      { cause: error }
    )
  }
}

/**
 * Store 专用事件 Host；通用插件生命周期和 pipeline 全部由 plugin-host 提供。
 *
 * 由 `defineHost` 组合而成而不是继承 `PluginHost`：这个壳层真正需要基类的只有一个 domain core 钩子 和一条 dispose
 * 前置，继承却把宿主的整个表面一并交了出去。句柄只带 Store 自己的成员加宿主的公开面。
 */
export type IStoreMiddlewareHost<S> = IHostHandle<
  IStoreMiddlewareCore<S>,
  IMiddlewareEvent<S>,
  readonly []
> &
  Readonly<{
    readonly mutationPolicy: MutationPolicy
    emit(event: IMiddlewareEvent<S>): void
    runAction<T>(name: string, fn: () => T, metadata?: Readonly<Record<string, unknown>>): T
    recordState(
      name: string,
      previous: S,
      next: S,
      metadata?: Readonly<Record<string, unknown>>
    ): void
    recordError(phase: string, error: unknown, metadata?: Readonly<Record<string, unknown>>): void
    connectDevTools(adapter: IDevToolsAdapter<S>, name?: string): Promise<void>
    attachBindingDisposer(disposer: IDisposer): void
  }>

export function createStoreMiddlewareHost<S>(
  options: IStoreMiddlewareHostOptions<S>
): IStoreMiddlewareHost<S> {
  const settled = snapshotHostOptions(options)
  const runtime = settled.runtime
  const getState = settled.getState
  const applyState = settled.applyState
  const mutationPolicy = settled.mutationPolicy ?? createMutationPolicy('off')
  /** Store 绑定的卸载器；在委托 plugin-host 清理之前按后进先出释放。 */
  const bindingDisposers: IDisposer[] = []
  /** 防止 recordError 在上报自身失败时递归。 */
  let reportingError = false

  const host = defineHost<IStoreMiddlewareCore<S>, IMiddlewareEvent<S>>({
    host: settled,
    domainCore: () => ({
      runtime,
      getState: () => getState(),
      applyState: (state) => {
        if (!applyState)
          throw createStoreMiddlewareError(
            StoreMiddlewareErrorCode.devtoolsCapability,
            StoreMiddlewareErrorText.applyState
          )
        applyState(state)
      },
      reportError: (error, phase) =>
        reportMiddlewareFailure(runtime, error, phase as IRuntimeErrorPhase)
    }),
    // Store 绑定先释放，再委托 plugin-host 清理；`next()` 由句柄保证恰好执行一次。
    dispose: async (next) => {
      const errors: unknown[] = []
      for (const disposer of bindingDisposers.splice(0).reverse()) {
        try {
          disposer()
        } catch (error) {
          errors.push(error)
        }
      }
      let pluginResult: IPluginHostDisposalResult
      try {
        pluginResult = await next()
      } catch (error) {
        pluginResult = {
          logicalTerminal: true,
          cleanupComplete: false,
          cleanupErrors: Object.freeze([error])
        }
      }
      return Object.freeze({
        ...pluginResult,
        // 同步的绑定失败是已落定的观测，不是未完成的物理清理。
        cleanupComplete: pluginResult.cleanupComplete,
        cleanupErrors: Object.freeze([...errors, ...pluginResult.cleanupErrors])
      })
    }
  })

  const emit = (event: IMiddlewareEvent<S>): void => {
    let completed = false
    host.runPipeline(event, () => {
      completed = true
    })
    if (!completed)
      reportMiddlewareFailure(
        runtime,
        createStoreMiddlewareError(
          StoreMiddlewareErrorCode.middlewareNotChained,
          StoreMiddlewareErrorText.missingNext
        ),
        ReactiveErrorPhase.traceListener
      )
  }
  /** 事件发射永不向业务路径抛出；失败经 runtime 上报。 */
  const emitIsolated = (event: IMiddlewareEvent<S>): void => {
    try {
      emit(event)
    } catch (error) {
      reportMiddlewareFailure(runtime, error, ReactiveErrorPhase.traceListener)
    }
  }

  const runAction = <T>(
    name: string,
    fn: () => T,
    metadata?: Readonly<Record<string, unknown>>
  ): T => {
    const startedAt = globalThis.performance?.now() ?? Date.now()
    emitIsolated({
      type: MiddlewareEventType.action,
      phase: MiddlewareEventPhase.start,
      name,
      timestamp: Date.now(),
      metadata
    })
    try {
      const result = mutationPolicy.runInAction(() => runtime.batch(fn))
      emitIsolated({
        type: MiddlewareEventType.action,
        phase: MiddlewareEventPhase.end,
        name,
        timestamp: Date.now(),
        durationMs: (globalThis.performance?.now() ?? Date.now()) - startedAt,
        metadata
      })
      return result
    } catch (error) {
      emitIsolated({
        type: MiddlewareEventType.action,
        phase: MiddlewareEventPhase.error,
        name,
        timestamp: Date.now(),
        durationMs: (globalThis.performance?.now() ?? Date.now()) - startedAt,
        error,
        metadata
      })
      throw error
    }
  }

  const handle: IStoreMiddlewareHost<S> = Object.freeze({
    ...host,
    mutationPolicy,
    emit,
    runAction,
    recordState: (
      name: string,
      previous: S,
      next: S,
      metadata?: Readonly<Record<string, unknown>>
    ) => {
      emitIsolated({
        type: MiddlewareEventType.state,
        name,
        timestamp: Date.now(),
        previous,
        next,
        metadata
      })
    },
    recordError: (phase: string, error: unknown, metadata?: Readonly<Record<string, unknown>>) => {
      if (reportingError) {
        reportMiddlewareFailure(runtime, error, ReactiveErrorPhase.traceListener)
        return
      }
      reportingError = true
      try {
        emitIsolated({
          type: MiddlewareEventType.error,
          phase,
          timestamp: Date.now(),
          error,
          metadata
        })
      } finally {
        reportingError = false
      }
    },
    connectDevTools: async (adapter: IDevToolsAdapter<S>, name = 'store-devtools') => {
      try {
        if (
          adapter === null ||
          typeof adapter !== 'object' ||
          typeof adapter.init !== 'function' ||
          typeof adapter.send !== 'function' ||
          (adapter.subscribe !== undefined && typeof adapter.subscribe !== 'function')
        )
          throw createStoreMiddlewareError(
            StoreMiddlewareErrorCode.invalidOption,
            StoreMiddlewareErrorText.adapterInvalid
          )
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) throw error
        throw createStoreMiddlewareError(
          StoreMiddlewareErrorCode.invalidOption,
          StoreMiddlewareErrorText.adapterInvalid,
          { cause: error }
        )
      }
      const plugin: IStoreMiddlewarePlugin<S> = {
        name,
        install: (core) => {
          adapter.init(core.getState())
          core.usePipeline((event, next) => {
            next(event)
            adapter.send(event, core.getState())
          })
          core.onDispose(
            adapter.subscribe?.((command) => {
              if (command.type === 'commit') adapter.init(core.getState())
              else runAction(`devtools:${command.type}`, () => core.applyState(command.state))
            }) ?? (() => undefined)
          )
          return {}
        }
      }
      await host.use(plugin as never)
    },
    attachBindingDisposer: (disposer: IDisposer) => {
      bindingDisposers.push(disposer)
    }
  }) as IStoreMiddlewareHost<S>
  return handle
}

export function middlewarePlugin<S>(
  name: string,
  middleware: IStoreMiddleware<S>
): IStoreMiddlewarePlugin<S> {
  return {
    name,
    install: (core) => {
      core.usePipeline((event, next) => {
        let advanced = false
        const context: IMiddlewareContext<S> = { runtime: core.runtime, getState: core.getState }
        middleware(event, context, () => {
          advanced = true
          next(event)
        })
        void advanced
      })
      return {}
    }
  }
}

export function loggerMiddleware<S>(
  sink: (event: IMiddlewareEvent<unknown>, state: unknown) => void = (event, state) => {
    console.log(StoreMiddlewareErrorText.logPrefix, event, state)
  }
): IStoreMiddlewarePlugin<S> {
  return {
    name: 'store-logger',
    install: (core) => {
      core.usePipeline((event, next) => {
        next(event)
        sink(event as IMiddlewareEvent<unknown>, core.getState())
      })
      return {}
    }
  }
}

export type IStoreMiddlewareBindingOptions = {
  readonly execution: IPluginHostOptions['execution']
  readonly mutationPolicy?: MutationPolicy
  readonly actionPrefix?: string
  readonly clone?: (state: Record<string, unknown>) => Record<string, unknown>
}

export type IStoreMiddlewareBinding<S extends Record<string, unknown>> = IStoreMiddlewareHost<
  Record<string, unknown>
> & {
  readonly store: IReactiveStore<S>
}

export function bindStoreMiddleware<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options: IStoreMiddlewareBindingOptions
): IStoreMiddlewareBinding<S> {
  const clone = options.clone ?? ((state) => ClonePolicy.diagnostic(state))
  let previous = clone(store.$plain())
  const host = createStoreMiddlewareHost<Record<string, unknown>>({
    execution: options.execution,
    runtime: store.$runtime,
    getState: () => clone(store.$plain()),
    applyState: (state: Record<string, unknown>) => store.$hydrate(state),
    mutationPolicy: options.mutationPolicy
  })
  let unsubscribeStore: IDisposer | undefined
  let unsubscribeTrace: IDisposer | undefined
  try {
    unsubscribeStore = store.$subscribe(() => {
      const next = clone(store.$plain())
      host.recordState('store:update', previous, next)
      previous = next
    })
    unsubscribeTrace = store.$runtime.subscribeTrace((event) => {
      if (
        event.type !== MiddlewareEventType.action ||
        (options.actionPrefix && !event.name.startsWith(options.actionPrefix))
      )
        return
      if (event.phase === MiddlewareEventPhase.start)
        host.emit({
          type: MiddlewareEventType.action,
          phase: MiddlewareEventPhase.start,
          name: event.name,
          timestamp: event.timestamp
        })
      else if (event.phase === MiddlewareEventPhase.end)
        host.emit({
          type: MiddlewareEventType.action,
          phase: MiddlewareEventPhase.end,
          name: event.name,
          timestamp: event.timestamp,
          durationMs: event.durationMs ?? 0
        })
      else
        host.emit({
          type: MiddlewareEventType.action,
          phase: MiddlewareEventPhase.error,
          name: event.name,
          timestamp: event.timestamp,
          durationMs: event.durationMs ?? 0,
          error: event.error
        })
    })
    host.attachBindingDisposer(unsubscribeTrace)
    host.attachBindingDisposer(unsubscribeStore)
  } catch (error) {
    const cleanupErrors: unknown[] = []
    try {
      unsubscribeTrace?.()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    try {
      unsubscribeStore?.()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    void host.dispose().catch((cleanupError: unknown) => {
      reportMiddlewareFailure(store.$runtime, cleanupError, ReactiveErrorPhase.asyncFlush)
    })
    if (cleanupErrors.length > 0) {
      throw createStoreMiddlewareAggregateError(
        StoreMiddlewareErrorCode.cleanupFailed,
        [error, ...cleanupErrors],
        StoreMiddlewareErrorText.cleanupFailed
      )
    }
    throw error
  }
  // 句柄是冻结的，不能被就地扩展；绑定是一个新对象，宿主成员照原样带过来。
  return Object.freeze({ ...host, store }) as IStoreMiddlewareBinding<S>
}
