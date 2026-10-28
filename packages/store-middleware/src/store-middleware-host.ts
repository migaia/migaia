import { identifyMiddlewareFailure } from './error-boundary.ts'
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
import { createStoreMiddlewareAggregateError, createStoreMiddlewareError } from './errors.ts'
import { StoreMiddlewareErrorCode } from './error-code.ts'
import { StoreMiddlewareErrorText } from './error-text.ts'
import {
  createMutationPolicy,
  type IDevToolsAdapter,
  type IMiddlewareEvent,
  type MutationPolicy
} from './middleware.ts'
import type { IPluginHostDisposalResult } from '@migaia/plugin-host'
import { ClonePolicy } from './tolerant-clone.ts'
import { MiddlewareEventPhase, MiddlewareEventType } from './event-constants.ts'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

/** Routes middleware diagnostics to the Runtime reporter, which already contains reporter failures. */
function reportMiddlewareFailure(
  runtime: IRuntime,
  error: unknown,
  phase: IRuntimeErrorContext['phase']
): void {
  runtime.reportError(error, { phase })
}

/** Store-domain services injected into plugins, alongside the canonical PluginHost core. */
export type IStoreMiddlewareCore<S> = {
  /** Borrowed Runtime used for action batches and diagnostic reporting. */
  readonly runtime: IRuntime
  /** Read state through the host's producer; copying is determined by that producer. */
  getState(): S
  /** Apply supplied state, or throw DEVTOOLS_CAPABILITY when the host omitted applyState. */
  applyState(state: S): void
  /** Report through the borrowed Runtime with the supplied diagnostic phase. */
  reportError(error: unknown, phase: string): void
}

/** Native PluginHost plugin specialized to Store events and the Store-domain core. */
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

/**
 * Required Runtime/state producer plus canonical PluginHost options, including explicit execution
 * budgets. Pipeline options are captured once and their mode is forced to sync.
 */
export type IStoreMiddlewareHostOptions<S> = IPluginHostOptions & {
  /** Required borrowed Runtime; disposing this host does not dispose the Runtime. */
  readonly runtime: IRuntime
  /** Required synchronous producer used by plugins and DevTools; no automatic clone is added here. */
  readonly getState: () => S
  /**
   * Optional synchronous state writer; omission rejects DevTools jump/reset with
   * DEVTOOLS_CAPABILITY.
   */
  readonly applyState?: (state: S) => void
  /** Exact policy shared with guarded stores/collections; defaults to a new off policy. */
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
  /** Exact selected policy; registering it on a host does not attach it to arbitrary data writes. */
  readonly mutationPolicy: MutationPolicy
  /**
   * Run the sync pipeline directly. An unchained event reports MIDDLEWARE_NOT_CHAINED; pipeline
   * failures can throw to this direct caller.
   */
  emit(event: IMiddlewareEvent<S>): void
  /**
   * Emit start, execute fn in one synchronous action/batch, then emit end or error. Event delivery
   * failures are reported without replacing the business result. A returned Promise is not awaited;
   * the action ends on return and writes already performed are not rolled back on failure.
   */
  runAction<T>(name: string, fn: () => T, metadata?: Readonly<Record<string, unknown>>): T
  /** Emit supplied previous/next references without cloning; pipeline failures are reported. */
  recordState(
    name: string,
    previous: S,
    next: S,
    metadata?: Readonly<Record<string, unknown>>
  ): void
  /** Emit a diagnostic event; nested recordError bypasses the pipeline and reports to Runtime. */
  recordError(phase: string, error: unknown, metadata?: Readonly<Record<string, unknown>>): void
  /**
   * Await installation of an adapter plugin named store-devtools by default. Port init/send and
   * subscribe callbacks are synchronous, not awaited; their subscription disposer belongs to that
   * plugin. Invalid port shape rejects INVALID_OPTION; installation failures follow PluginHost.
   */
  connectDevTools(adapter: IDevToolsAdapter<S>, name?: string): Promise<void>
  /**
   * Register synchronous cleanup, run LIFO before plugins. After cleanup admission closes, invoke
   * new disposers immediately. Return Promises are not awaited; synchronous failures are classified
   * and collected during disposal, or thrown for a late registration.
   */
  attachBindingDisposer(disposer: IDisposer): void
}>

/**
 * Canonical managed, frozen PluginHost handle with Store-domain methods. Disposal is single-flight
 * and returns the PluginHost cleanup result, including binding failures in cleanupErrors; it owns
 * neither the supplied Runtime nor arbitrary state returned by getState.
 */
export type IStoreMiddlewareHost<S> = IHostHandle<
  IStoreMiddlewareCore<S>,
  IMiddlewareEvent<S>,
  readonly [],
  IStoreMiddlewareSurface<S>
>

/**
 * Create the managed frozen host synchronously; await use() separately to install plugins. Event
 * processing is always sync, with a flat next(event) handoff rather than downstream onion calls.
 * Options/read failures reject construction as INVALID_OPTION; canonical host option failures keep
 * their owner. Binding cleanup is synchronous LIFO before awaited plugin disposal.
 */
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

/**
 * Creates the built-in store-logger plugin. It records next(event), then invokes sink with the
 * event and current state before the following stage executes in this flat sync pipeline. The
 * default sink prints both with the log prefix. Sink return Promises are not awaited. The logger
 * never reads a specific state shape, so `S` defaults to `any`: the plugin installs into a host of
 * any state type without a type argument. Pass `S` explicitly only to pin the plugin to one host's
 * state type.
 */
export function loggerMiddleware<S = any>(
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

/** Binding-specific options; Store/Runtime and state application are taken from the supplied Store. */
export type IStoreMiddlewareBindingOptions = {
  /** Required explicit PluginHost mutation/drain budgets; false opts out of that deadline. */
  readonly execution: IPluginHostOptions['execution']
  /**
   * Exact host policy, defaulting to a new off policy; attach the same policy to the Store
   * separately.
   */
  readonly mutationPolicy?: MutationPolicy
  /**
   * Optional action-trace name prefix; omitted or empty accepts all action names, not state
   * filtering.
   */
  readonly actionPrefix?: string
  /**
   * Synchronous snapshot producer, default ClonePolicy.diagnostic. Used at binding and each state
   * observation/read; custom callback failures follow the invoking Store or construction boundary.
   */
  readonly clone?: (state: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Managed host plus the exact borrowed Store reference; disposal releases binding subscriptions and
 * installed host plugins without disposing the Store or its Runtime.
 */
export type IStoreMiddlewareBinding<S extends Record<string, unknown>> = IHostHandle<
  IStoreMiddlewareCore<Record<string, unknown>>,
  IMiddlewareEvent<Record<string, unknown>>,
  readonly [],
  IStoreMiddlewareSurface<Record<string, unknown>> & { readonly store: IReactiveStore<S> }
>

/**
 * Bind an existing Store's state subscription and Runtime action trace to one middleware host.
 * Clone the initial previous state immediately; subsequent observations emit store:update and
 * advance that snapshot. Setup failure attempts both acquired unsubscribers and host cleanup,
 * retaining setup/cleanup failures. Disposal detaches subscriptions but leaves Store and Runtime
 * usable; it does not retrofit mutation guarding onto an unguarded Store.
 */
export function bindStoreMiddleware<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options: IStoreMiddlewareBindingOptions
): IStoreMiddlewareBinding<S> {
  /** Select the application's synchronous snapshot function or the diagnostic default once. */
  const clone = options.clone ?? ((state) => ClonePolicy.diagnostic(state))
  /** Establish the first snapshot before acquiring subscriptions, retaining callback failures. */
  let previous: Record<string, unknown>
  try {
    previous = clone(store.$plain())
  } catch (error) {
    throw identifyMiddlewareFailure(error)
  }
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
