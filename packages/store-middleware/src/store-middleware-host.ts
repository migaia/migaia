import { identifyMiddlewareFailure } from './error-boundary.js'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import {
  defineHost,
  type IHostHandle,
  type IPlugin,
  type IPluginHostOptions
} from '@migaia/plugin-host'
import {
  ReactiveErrorPhase,
  type IDisposer,
  type IRuntime,
  type IRuntimeErrorContext
} from '@migaia/reactive'
import type { IReactiveStore } from '@migaia/store-light'
import { createStoreMiddlewareAggregateError, createStoreMiddlewareError } from './errors.js'
import { StoreMiddlewareErrorCode } from './error-code.js'
import { StoreMiddlewareErrorText } from './error-text.js'
import {
  createMutationPolicy,
  type IDevToolsAdapter,
  type IMiddlewareEvent,
  type MutationPolicy
} from './middleware.js'
import type { IPluginHostDisposalResult } from '@migaia/plugin-host'
import { ClonePolicy } from './tolerant-clone.js'
import { MiddlewareEventPhase, MiddlewareEventType } from './event-constants.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

/** Routes middleware diagnostics to the Runtime reporter, which already contains reporter failures. */
function reportMiddlewareFailure(
  runtime: IRuntime,
  error: unknown,
  phase: IRuntimeErrorContext['phase']
): void {
  runtime.reportError(error, { phase })
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
    /** Read pipeline once even when non-enumerable; rest excludes it from the option spread. */
    const { pipeline, ...snapshot } = options
    return {
      ...snapshot,
      pipeline: { ...pipeline, mode: MiddlewarePipelineMode.sync }
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
 * Provides a store event host using `plugin-host` for plugin lifecycle and pipelines.
 *
 * `defineHost` composes the store domain core and pre-disposal hook instead of inheriting
 * `PluginHost`. The handle exposes store members together with the host's public surface.
 */
/** Domain members installed into the canonical plugin-host handle before it freezes. */
type IStoreMiddlewareSurface<S> = Readonly<{
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

export type IStoreMiddlewareHost<S> = IHostHandle<
  IStoreMiddlewareCore<S>,
  IMiddlewareEvent<S>,
  readonly [],
  IStoreMiddlewareSurface<S>
>

/** Creates one managed frozen handle with the Store domain and canonical host methods. */
export function createStoreMiddlewareHost<S>(
  options: IStoreMiddlewareHostOptions<S>
): IStoreMiddlewareHost<S> {
  return createStoreMiddlewareHostCore(options)
}

/** Shared construction adds the binding's Store reference before canonical handle publication. */
function createStoreMiddlewareHostCore<S>(
  options: IStoreMiddlewareHostOptions<S>,
  bindingStore?: object
): IStoreMiddlewareHost<S> {
  const settled = snapshotHostOptions(options)
  const runtime = settled.runtime
  const getState = settled.getState
  const applyState = settled.applyState
  const mutationPolicy = settled.mutationPolicy ?? createMutationPolicy('off')
  /**
   * Binding cleanup is LIFO while open; undefined means the owner is closed and new cleanup runs
   * now.
   */
  let bindingDisposers: IDisposer[] | undefined = []
  /** 防止 recordError 在上报自身失败时递归。 */
  let reportingError = false

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

  /** Domain descriptors join the single canonical handle before identity publication and freezing. */
  const surface: IStoreMiddlewareSurface<S> & { readonly store?: object } = {
    ...(bindingStore === undefined ? {} : { store: bindingStore }),
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
      if (bindingDisposers === undefined) {
        try {
          disposer()
        } catch (error) {
          throw identifyMiddlewareFailure(error)
        }
      } else bindingDisposers.push(disposer)
    }
  }
  const host = defineHost<
    IStoreMiddlewareCore<S>,
    IMiddlewareEvent<S>,
    readonly [],
    typeof surface
  >({
    host: settled,
    surface,
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
        reportMiddlewareFailure(runtime, error, phase as IRuntimeErrorContext['phase'])
    }),
    // Store 绑定先释放，再委托 plugin-host 清理；`next()` 由句柄保证恰好执行一次。
    dispose: async (next) => {
      const errors: unknown[] = []
      /** Close admission before any disposer can reenter registration. */
      const disposers = bindingDisposers ?? []
      bindingDisposers = undefined
      for (const disposer of disposers.reverse()) {
        try {
          disposer()
        } catch (error) {
          errors.push(identifyMiddlewareFailure(error))
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
  return host
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

export type IStoreMiddlewareBinding<S extends Record<string, unknown>> = IHostHandle<
  IStoreMiddlewareCore<Record<string, unknown>>,
  IMiddlewareEvent<Record<string, unknown>>,
  readonly [],
  IStoreMiddlewareSurface<Record<string, unknown>> & { readonly store: IReactiveStore<S> }
>

export function bindStoreMiddleware<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options: IStoreMiddlewareBindingOptions
): IStoreMiddlewareBinding<S> {
  const clone = options.clone ?? ((state) => ClonePolicy.diagnostic(state))
  let previous = clone(store.$plain())
  const host = createStoreMiddlewareHostCore<Record<string, unknown>>(
    {
      execution: options.execution,
      runtime: store.$runtime,
      getState: () => clone(store.$plain()),
      applyState: (state: Record<string, unknown>) => store.$hydrate(state),
      mutationPolicy: options.mutationPolicy
    },
    store
  )
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
  // The Store reference was installed before this same canonical handle was frozen and registered.
  return host as IStoreMiddlewareBinding<S>
}
