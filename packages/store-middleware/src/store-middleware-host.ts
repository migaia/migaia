import {
  PluginHost,
  PluginHostPipelineMode,
  type IPlugin,
  type IPluginHostOptions
} from '@migaia/plugin-host';
import { ReactiveErrorPhase, type IDisposer, type IRuntime } from '@migaia/reactive';
import type { IRuntimeErrorPhase } from '@migaia/reactive/runtime';
import type { IReactiveStore } from '@migaia/store-light';
import { createStoreMiddlewareError } from './errors.js';
import { StoreMiddlewareErrorCode } from './error-code.js';
import {
  createMutationPolicy,
  type IDevToolsAdapter,
  type IMiddlewareEvent,
  type IMiddlewareContext,
  type MutationPolicy,
  type IStoreMiddleware
} from './middleware.js';
import { ClonePolicy } from './tolerant-clone.js';
import { MiddlewareEventPhase, MiddlewareEventType } from './event-constants.js';

export type IStoreMiddlewareCore<S> = {
  readonly runtime: IRuntime;
  getState(): S;
  applyState(state: S): void;
  reportError(error: unknown, phase: string): void;
};

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
>;

export type IStoreMiddlewareHostOptions<S> = IPluginHostOptions & {
  readonly runtime: IRuntime;
  readonly getState: () => S;
  readonly applyState?: (state: S) => void;
  readonly mutationPolicy?: MutationPolicy;
};

/** Store 专用事件 Host；通用插件生命周期和 pipeline 全部由 PluginHost 提供。 */
export class StoreMiddlewareHost<S> extends PluginHost<
  IStoreMiddlewareCore<S>,
  IMiddlewareEvent<S>
> {
  readonly mutationPolicy: MutationPolicy;
  readonly #runtime: IRuntime;
  readonly #getState: () => S;
  readonly #applyState?: (state: S) => void;
  #reportingError = false;
  #bindingDisposers: IDisposer[] = [];

  constructor(options: IStoreMiddlewareHostOptions<S>) {
    super({ ...options, pipeline: { ...options.pipeline, mode: PluginHostPipelineMode.sync } });
    this.#runtime = options.runtime;
    this.#getState = options.getState;
    this.#applyState = options.applyState;
    this.mutationPolicy = options.mutationPolicy ?? createMutationPolicy('off');
  }

  protected createPluginDomainCore(): IStoreMiddlewareCore<S> {
    return {
      runtime: this.#runtime,
      getState: () => this.#getState(),
      applyState: (state) => {
        if (!this.#applyState)
          throw createStoreMiddlewareError(
            StoreMiddlewareErrorCode.devtoolsCapability,
            '[store] DevTools state command requires applyState'
          );
        this.#applyState(state);
      },
      reportError: (error, phase) =>
        this.#runtime.reportError(error, { phase: phase as IRuntimeErrorPhase })
    };
  }

  emit(event: IMiddlewareEvent<S>): void {
    let completed = false;
    this.runPipeline(event, () => {
      completed = true;
    });
    if (!completed) {
      this.#runtime.reportError(
        createStoreMiddlewareError(
          StoreMiddlewareErrorCode.middlewareNotChained,
          '[store] middleware did not call next()'
        ),
        { phase: ReactiveErrorPhase.traceListener }
      );
    }
  }

  #emitIsolated(event: IMiddlewareEvent<S>): void {
    try {
      this.emit(event);
    } catch (error) {
      this.#runtime.reportError(error, { phase: ReactiveErrorPhase.traceListener });
    }
  }

  runAction<T>(name: string, fn: () => T, metadata?: Readonly<Record<string, unknown>>): T {
    const startedAt = globalThis.performance?.now() ?? Date.now();
    this.#emitIsolated({
      type: MiddlewareEventType.action,
      phase: MiddlewareEventPhase.start,
      name,
      timestamp: Date.now(),
      metadata
    });
    try {
      const result = this.mutationPolicy.runInAction(() => this.#runtime.batch(fn));
      this.#emitIsolated({
        type: MiddlewareEventType.action,
        phase: MiddlewareEventPhase.end,
        name,
        timestamp: Date.now(),
        durationMs: (globalThis.performance?.now() ?? Date.now()) - startedAt,
        metadata
      });
      return result;
    } catch (error) {
      this.#emitIsolated({
        type: MiddlewareEventType.action,
        phase: MiddlewareEventPhase.error,
        name,
        timestamp: Date.now(),
        durationMs: (globalThis.performance?.now() ?? Date.now()) - startedAt,
        error,
        metadata
      });
      throw error;
    }
  }

  recordState(
    name: string,
    previous: S,
    next: S,
    metadata?: Readonly<Record<string, unknown>>
  ): void {
    this.#emitIsolated({
      type: MiddlewareEventType.state,
      name,
      timestamp: Date.now(),
      previous,
      next,
      metadata
    });
  }

  recordError(phase: string, error: unknown, metadata?: Readonly<Record<string, unknown>>): void {
    if (this.#reportingError) {
      this.#runtime.reportError(error, { phase: ReactiveErrorPhase.traceListener });
      return;
    }
    this.#reportingError = true;
    try {
      this.#emitIsolated({
        type: MiddlewareEventType.error,
        phase,
        timestamp: Date.now(),
        error,
        metadata
      });
    } finally {
      this.#reportingError = false;
    }
  }

  async connectDevTools(adapter: IDevToolsAdapter<S>, name = 'store-devtools'): Promise<void> {
    const plugin: IStoreMiddlewarePlugin<S> = {
      name,
      install: (core) => {
        adapter.init(core.getState());
        core.usePipeline((event, next) => {
          next(event);
          adapter.send(event, core.getState());
        });
        core.onDispose(
          adapter.subscribe?.((command) => {
            if (command.type === 'commit') {
              adapter.init(core.getState());
            } else {
              this.runAction(`devtools:${command.type}`, () => core.applyState(command.state));
            }
          }) ?? (() => undefined)
        );
        return {};
      }
    };
    await this.use(plugin);
  }

  attachBindingDisposer(disposer: IDisposer): void {
    this.#bindingDisposers.push(disposer);
  }

  override async dispose(): Promise<void> {
    for (const disposer of this.#bindingDisposers.splice(0).reverse()) disposer();
    await super.dispose();
  }
}

export function createStoreMiddlewareHost<S>(
  options: IStoreMiddlewareHostOptions<S>
): StoreMiddlewareHost<S> {
  return new StoreMiddlewareHost(options);
}

export function middlewarePlugin<S>(
  name: string,
  middleware: IStoreMiddleware<S>
): IStoreMiddlewarePlugin<S> {
  return {
    name,
    install: (core) => {
      core.usePipeline((event, next) => {
        let advanced = false;
        const context: IMiddlewareContext<S> = { runtime: core.runtime, getState: core.getState };
        middleware(event, context, () => {
          advanced = true;
          next(event);
        });
        void advanced;
      });
      return {};
    }
  };
}

export function loggerMiddleware<S>(
  sink: (event: IMiddlewareEvent<unknown>, state: unknown) => void = (event, state) => {
    console.log('[store]', event, state);
  }
): IStoreMiddlewarePlugin<S> {
  return {
    name: 'store-logger',
    install: (core) => {
      core.usePipeline((event, next) => {
        next(event);
        sink(event as IMiddlewareEvent<unknown>, core.getState());
      });
      return {};
    }
  };
}

export type IStoreMiddlewareBindingOptions = {
  readonly mutationPolicy?: MutationPolicy;
  readonly actionPrefix?: string;
  readonly clone?: (state: Record<string, unknown>) => Record<string, unknown>;
};

export type IStoreMiddlewareBinding<S extends Record<string, unknown>> = StoreMiddlewareHost<
  Record<string, unknown>
> & {
  readonly store: IReactiveStore<S>;
};

export function bindStoreMiddleware<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options: IStoreMiddlewareBindingOptions = {}
): IStoreMiddlewareBinding<S> {
  const clone = options.clone ?? ((state) => ClonePolicy.diagnostic(state));
  let previous = clone(store.$plain());
  const host = new StoreMiddlewareHost<Record<string, unknown>>({
    runtime: store.$runtime,
    getState: () => clone(store.$plain()),
    applyState: (state) => store.$hydrate(state),
    mutationPolicy: options.mutationPolicy
  });
  const unsubscribeStore = store.$subscribe(() => {
    const next = clone(store.$plain());
    host.recordState('store:update', previous, next);
    previous = next;
  });
  const unsubscribeTrace = store.$runtime.subscribeTrace((event) => {
    if (
      event.type !== MiddlewareEventType.action ||
      (options.actionPrefix && !event.name.startsWith(options.actionPrefix))
    )
      return;
    if (event.phase === MiddlewareEventPhase.start)
      host.emit({
        type: MiddlewareEventType.action,
        phase: MiddlewareEventPhase.start,
        name: event.name,
        timestamp: event.timestamp
      });
    else if (event.phase === MiddlewareEventPhase.end)
      host.emit({
        type: MiddlewareEventType.action,
        phase: MiddlewareEventPhase.end,
        name: event.name,
        timestamp: event.timestamp,
        durationMs: event.durationMs ?? 0
      });
    else
      host.emit({
        type: MiddlewareEventType.action,
        phase: MiddlewareEventPhase.error,
        name: event.name,
        timestamp: event.timestamp,
        durationMs: event.durationMs ?? 0,
        error: event.error
      });
  });
  host.attachBindingDisposer(unsubscribeTrace);
  host.attachBindingDisposer(unsubscribeStore);
  return Object.assign(host, { store });
}
