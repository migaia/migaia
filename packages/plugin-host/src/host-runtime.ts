import ERROR_TEXT, { PluginHostError, setErrorLocale, type ILocaleKey } from './error-text';
import { copyConfig, parseConfigPath, readConfigPath, readPlainDataRecord } from './config';
import {
  aggregateErrors,
  asyncDisposeKey,
  isLikelyAsyncDisposer,
  resolveDisposer
} from './disposal';
import {
  adaptSyncStageToAsync,
  adaptSyncStageToGenerator,
  registerStage,
  runPipeline
} from './pipeline';
import { assertExtensionResult } from './extension';
import { createPluginCore } from './core';
import type { IInstallEntry, IPluginDefinition, IRegistration, ISharedEntry } from './registry';
import type {
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPluginConfig,
  IPluginConstraint,
  IPluginResource,
  IPluginHostCore,
  IPluginHostConfigFor,
  IPluginHostErrorCode,
  IPluginHostPublic,
  IMergePluginShared,
  IPluginHostOptions,
  IPipelineMode,
  ISyncPipelineStage
} from './typing';

type IHostStatus = 'active' | 'closing' | 'disposed';
type IQueuedMutation = {
  readonly task: () => Promise<unknown>;
  readonly terminal: boolean;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
};
const defaultDiagnostic = (message: string): void => {
  const runtime = globalThis as typeof globalThis & {
    console?: { warn(value: string): void };
  };
  runtime.console?.warn(message);
};
const objectPrototypeKeys = new Set(Reflect.ownKeys(Object.prototype));
/**
 * Maximum time a queued mutation may wait behind active work. This is an intentional SLA for
 * lightweight plugin assembly and never interrupts already-running plugin code.
 */
const QUEUE_WATCHDOG_MS = 5000;
/**
 * Maximum time #disposeRegistration waits for a single disposer step (pipeline disposer, plugin
 * dispose hook, or resource disposer) to settle. Without this bound a disposer that never settles —
 * including one that reentrantly awaits the very host.dispose() call it was invoked from, since
 * that call returns the same in-flight promise this step is blocking on — would leave the host
 * stuck in `closing` forever. Mirrors QUEUE_WATCHDOG_MS's philosophy: never interrupts the
 * disposer's own execution, only stops waiting on it.
 */
const DISPOSE_STEP_TIMEOUT_MS = 5000;
/** Runtime-neutral plugin host. All external mutation enters one Promise queue. */
export abstract class PluginHost<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly []
> {
  static setLocale(localeKey: ILocaleKey): void {
    setErrorLocale(localeKey);
  }

  #status: IHostStatus = 'active';
  #disposePromise: Promise<void> | undefined;
  #mutationQueue: IQueuedMutation[] = [];
  #mutationRunning = false;
  #registrations = new Map<string, IRegistration<TDomainCore, TValue>>();
  #shared = new Map<PropertyKey, ISharedEntry<TDomainCore, TValue>>();
  #lifecycleRegistration: IRegistration<TDomainCore, TValue> | undefined;
  #hookRegistration: IRegistration<TDomainCore, TValue> | undefined;
  #pipelineMode: IPipelineMode;
  #diagnostic: (message: string, code?: IPluginHostErrorCode) => void;
  #syncStages: ISyncPipelineStage<TValue>[] = [];
  #asyncStages: IAsyncPipelineStage<TValue>[] = [];
  #generatorStages: IGeneratorPipelineStage<TValue>[] = [];
  /** Tracks synchronous pipeline execution so a stage cannot extend its own traversal. */
  #pipelineDepth = 0;
  /** Lazily cached public config facade; its methods retain this host as owner. */
  #configApi: IPluginHostConfigFor<TInstalled> | undefined;
  #watchdogTimers = new Map<IQueuedMutation, ReturnType<typeof setTimeout>>();
  /** True while #installBatchSync is registering resources; see #assertSyncCompatibleDisposer. */
  #syncInstallActive = false;

  constructor(options: IPluginHostOptions = {}) {
    this.#pipelineMode = options.pipeline?.mode ?? 'sync';
    if (options.diagnostic !== undefined && typeof options.diagnostic !== 'function')
      throw new TypeError('diagnostic must be a function');
    this.#diagnostic = options.diagnostic ?? defaultDiagnostic;
    if (!['sync', 'async', 'generator'].includes(this.#pipelineMode))
      throw new PluginHostError('INVALID_PIPELINE_MODE', ERROR_TEXT.INVALID_PIPELINE_MODE);
  }

  get pipelineMode(): IPipelineMode {
    this.#assertActive();
    return this.#pipelineMode;
  }

  #assertActive(): void {
    if (this.#status === 'disposed')
      throw new PluginHostError('HOST_DISPOSED', ERROR_TEXT.HOST_DISPOSED);
    if (this.#status === 'closing')
      throw new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING);
  }

  #assertMutationAllowed(): void {
    if (this.#hookRegistration)
      throw new PluginHostError('LIFECYCLE_MUTATION', ERROR_TEXT.LIFECYCLE_MUTATION);
  }

  /**
   * UseSync's rollback contract is "fully synchronous" (see #disposeRegistrationSync) — an async
   * disposer's side effect has already started by the time rollback could reject it. Catch the
   * common declared shapes (async function, Symbol.asyncDispose) at registration time instead of
   * discovering it only after rollback already ran the disposer.
   */
  #assertSyncCompatibleDisposer(resource: IPluginResource): void {
    if (this.#syncInstallActive && isLikelyAsyncDisposer(resource))
      throw new TypeError(
        'async disposer (async function or Symbol.asyncDispose) is not supported during synchronous installation — register it after use() completes instead'
      );
  }

  #enqueue<T>(task: () => Promise<T>, terminal = false): Promise<T> {
    const mutation: IQueuedMutation = {
      task: task as () => Promise<unknown>,
      terminal,
      resolve: undefined as unknown as (value: unknown) => void,
      reject: undefined as unknown as (reason: unknown) => void
    };
    const run = new Promise<T>((resolve, reject) => {
      (mutation as { resolve: (value: unknown) => void }).resolve = resolve as (
        value: unknown
      ) => void;
      (mutation as { reject: (reason: unknown) => void }).reject = reject;
    });
    const queuedBehindInFlightWork = this.#mutationRunning;
    this.#mutationQueue.push(mutation);
    if (queuedBehindInFlightWork && !terminal) this.#armQueueWatchdog(mutation);
    if (!this.#mutationRunning) void this.#runMutationQueue();
    return run;
  }

  /** Rejects a queued mutation at the documented queue SLA without touching active work. */
  #armQueueWatchdog(mutation: IQueuedMutation): void {
    const timer = setTimeout(() => {
      this.#watchdogTimers.delete(mutation);
      const index = this.#mutationQueue.indexOf(mutation);
      if (index < 0) return;
      this.#mutationQueue.splice(index, 1);
      mutation.reject(
        new PluginHostError(
          'MUTATION_QUEUE_TIMEOUT',
          ERROR_TEXT.MUTATION_QUEUE_TIMEOUT(QUEUE_WATCHDOG_MS)
        )
      );
    }, QUEUE_WATCHDOG_MS);
    (timer as { unref?: () => void }).unref?.();
    this.#watchdogTimers.set(mutation, timer);
  }

  /** Clears an armed watchdog the instant its mutation settles, instead of waiting out the timer. */
  #disarmQueueWatchdog(mutation: IQueuedMutation): void {
    const timer = this.#watchdogTimers.get(mutation);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#watchdogTimers.delete(mutation);
  }

  async #runMutationQueue(): Promise<void> {
    this.#mutationRunning = true;
    try {
      while (this.#mutationQueue.length > 0) {
        const mutation = this.#mutationQueue.shift()!;
        this.#disarmQueueWatchdog(mutation);
        try {
          mutation.resolve(await mutation.task());
        } catch (error) {
          mutation.reject(error);
        }
      }
    } finally {
      this.#mutationRunning = false;
    }
  }

  protected createPluginDomainCore(): TDomainCore {
    return {} as TDomainCore;
  }

  #core(registration: IRegistration<TDomainCore, TValue>): TDomainCore & IPluginHostCore<TValue> {
    if (registration.core) return registration.core;
    registration.core = createPluginCore({
      registration,
      createDomainCore: () => this.createPluginDomainCore(),
      assertRegistrationValid: () => this.#assertRegistrationValid(registration),
      getShared: (key) => this.#shared.get(key)?.value,
      pipelineMode: () => this.#pipelineMode,
      onPipelineViolation: this.#onPipelineViolation,
      registerResource: (resource) => {
        if (registration.lifecycle !== 'install')
          throw new PluginHostError(
            'RESOURCE_OUTSIDE_INSTALL',
            ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
          );
        this.#assertSyncCompatibleDisposer(resource);
        const disposer = resolveDisposer(resource);
        if (!disposer) throw new TypeError('plugin resource must provide a disposer');
        registration.disposers.push(disposer);
      },
      registerStage: (stage, kind) => {
        this.#registerStage(stage, registration, kind);
      }
    });
    return registration.core;
  }

  #assertRegistrationValid(registration: IRegistration<TDomainCore, TValue>): void {
    if (
      this.#lifecycleRegistration !== registration &&
      this.#registrations.get(registration.name) !== registration
    )
      throw new PluginHostError(
        'PLUGIN_NOT_INSTALLED',
        ERROR_TEXT.PLUGIN_NOT_INSTALLED(registration.name)
      );
  }

  #onPipelineViolation = (kind: 'late' | 'duplicate'): void => {
    if (kind === 'late') {
      try {
        this.#diagnostic(ERROR_TEXT.PIPELINE_NEXT_CALLED_LATE, 'PIPELINE_NEXT_LATE');
      } catch {
        // Diagnostics must never alter pipeline control flow.
      }
      return;
    }
    throw new PluginHostError('PIPELINE_NEXT_DUPLICATE', ERROR_TEXT.PIPELINE_NEXT_ALREADY_CALLED);
  };

  #registerStage(
    stage: Function,
    owner: IRegistration<TDomainCore, TValue> | undefined,
    kind: IPipelineMode
  ): void {
    if (typeof stage !== 'function') throw new TypeError('pipeline stage must be a function');
    if (kind !== this.#pipelineMode)
      throw new PluginHostError(
        'PIPELINE_MODE_MISMATCH',
        ERROR_TEXT.PIPELINE_MODE_MISMATCH(this.#pipelineMode, kind)
      );
    if (owner && owner.lifecycle !== 'install')
      throw new PluginHostError('RESOURCE_OUTSIDE_INSTALL', ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL);
    if (this.#pipelineDepth > 0)
      throw new PluginHostError('PIPELINE_EXECUTING', ERROR_TEXT.PIPELINE_EXECUTING);
    const track = (dispose: () => void): void => {
      if (owner) owner.pipelineDisposers.push(dispose);
    };
    if (kind === 'sync')
      registerStage(this.#syncStages, stage as ISyncPipelineStage<TValue>, track);
    else if (kind === 'async')
      registerStage(this.#asyncStages, stage as IAsyncPipelineStage<TValue>, track);
    else registerStage(this.#generatorStages, stage as IGeneratorPipelineStage<TValue>, track);
  }

  protected runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void> {
    const onViolation = this.#onPipelineViolation;
    if (this.#pipelineMode === 'sync') {
      this.#assertActive();
      this.#pipelineDepth += 1;
      try {
        return runPipeline('sync', this.#syncStages, value, done, onViolation);
      } finally {
        this.#pipelineDepth -= 1;
      }
    }
    if (this.#pipelineMode === 'async') {
      try {
        this.#assertActive();
      } catch (error) {
        return Promise.reject(error);
      }
      // Async mode snapshots stages, while the depth guard rejects registration for the full await span.
      this.#pipelineDepth += 1;
      return (
        runPipeline('async', [...this.#asyncStages], value, done, onViolation, () =>
          this.#assertActive()
        ) as Promise<void>
      ).finally(() => {
        this.#pipelineDepth -= 1;
      });
    }
    this.#assertActive();
    this.#pipelineDepth += 1;
    try {
      return runPipeline('generator', this.#generatorStages, value, done, onViolation);
    } finally {
      this.#pipelineDepth -= 1;
    }
  }

  /** Host-side pipeline registration for application composition. */
  usePipeline(stage: ISyncPipelineStage<TValue>): this {
    this.#assertActive();
    if (this.#pipelineMode === 'sync') this.#registerStage(stage, undefined, 'sync');
    else if (this.#pipelineMode === 'async')
      this.#registerStage(adaptSyncStageToAsync(stage), undefined, 'async');
    else
      this.#registerStage(
        adaptSyncStageToGenerator(stage, this.#onPipelineViolation),
        undefined,
        'generator'
      );
    return this;
  }

  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): this {
    this.#assertActive();
    this.#registerStage(stage, undefined, 'async');
    return this;
  }

  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): this {
    this.#assertActive();
    this.#registerStage(stage, undefined, 'generator');
    return this;
  }

  getShared<T = unknown>(key: PropertyKey): T | undefined {
    this.#assertActive();
    return this.#shared.get(key)?.value as T | undefined;
  }

  protected onDispose(resource: IPluginResource): void {
    this.#assertSyncCompatibleDisposer(resource);
    const dispose = resolveDisposer(resource);
    if (!dispose) throw new TypeError('plugin resource must provide a disposer');
    if (this.#lifecycleRegistration?.lifecycle === 'install')
      this.#lifecycleRegistration.disposers.push(dispose);
    else throw new PluginHostError('RESOURCE_OUTSIDE_INSTALL', ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL);
  }

  protected trackPluginResourceIfInstalling(resource: IPluginResource): boolean {
    const dispose = resolveDisposer(resource);
    if (!dispose) throw new TypeError('plugin resource must provide a disposer');
    if (this.#lifecycleRegistration?.lifecycle !== 'install') return false;
    this.#assertSyncCompatibleDisposer(resource);
    this.#lifecycleRegistration.disposers.push(dispose);
    return true;
  }

  use<
    const TPlugins extends readonly IPluginConstraint<
      TDomainCore & IPluginHostCore<TValue, IMergePluginShared<TInstalled>>
    >[]
  >(
    ...plugins: TPlugins
  ): Promise<IPluginHostPublic<TDomainCore, TValue, [...TInstalled, ...TPlugins]>> {
    this.#assertActive();
    this.#assertMutationAllowed();
    const definitions = this.#snapshotPlugins(plugins);
    return this.#enqueue(async () => {
      const entries = this.#preflight(definitions);
      await this.#installBatch(entries);
      return this as unknown as IPluginHostPublic<
        TDomainCore,
        TValue,
        [...TInstalled, ...TPlugins]
      >;
    });
  }

  /** Installs constructor-time plugins synchronously or throws before the host escapes. */
  protected useSync(plugins: readonly IPluginConstraint<any>[]): this {
    this.#assertActive();
    this.#assertMutationAllowed();
    const definitions = this.#snapshotPlugins(plugins);
    const entries = this.#preflight(definitions);
    this.#installBatchSync(entries);
    return this;
  }

  #preflight(
    plugins: readonly IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[]
  ): IInstallEntry<TDomainCore, TValue>[] {
    for (const plugin of plugins)
      if (this.#registrations.has(plugin.name))
        throw new PluginHostError('PLUGIN_DUPLICATE', ERROR_TEXT.PLUGIN_DUPLICATE(plugin.name));
    return plugins.map((plugin) => ({ plugin, name: plugin.name }));
  }

  #snapshotPlugins(
    plugins: readonly IPluginConstraint<any>[]
  ): IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[] {
    const names = new Set<string>();
    return plugins.map((plugin) => {
      const name = plugin?.name;
      if (typeof name !== 'string' || name.length === 0)
        throw new TypeError('plugin name must be a non-empty string');
      if (name.includes('.')) throw new TypeError('plugin name must not contain "."');
      if (typeof plugin.install !== 'function')
        throw new TypeError('plugin install must be a function');
      for (const [key, hook] of [
        ['update', plugin.update],
        ['dispose', plugin.dispose],
        ['shared', plugin.shared],
        ['asyncDispose', plugin[Symbol.asyncDispose]],
        ['disposeSymbol', plugin[Symbol.dispose]]
      ] as const)
        if (hook !== undefined && typeof hook !== 'function')
          throw new TypeError(`plugin ${key} must be a function`);
      if (names.has(name))
        throw new PluginHostError('PLUGIN_DUPLICATE', ERROR_TEXT.PLUGIN_DUPLICATE(name));
      names.add(name);
      const rawConfig = plugin.config ?? {};
      const config = copyConfig(rawConfig as IPluginConfig, 'plugin config');
      return {
        owner: plugin,
        name,
        config,
        install: plugin.install,
        update: plugin.update,
        dispose: plugin.dispose,
        shared: plugin.shared
      };
    });
  }

  async #installBatch(entries: readonly IInstallEntry<TDomainCore, TValue>[]): Promise<void> {
    const installed: IRegistration<TDomainCore, TValue>[] = [];
    let failedName = entries[0]?.name ?? 'unknown';
    try {
      for (const entry of entries) {
        const { plugin, name } = entry;
        failedName = name;
        const config = plugin.config;
        const registration: IRegistration<TDomainCore, TValue> = {
          name,
          plugin,
          config: copyConfig(config),
          extensions: [],
          pipelineDisposers: [],
          disposers: [],
          shared: [],
          installed: false,
          lifecycle: 'install'
        };
        this.#lifecycleRegistration = registration;
        installed.push(registration);
        try {
          this.#hookRegistration = registration;
          let installResult: unknown;
          try {
            installResult = plugin.owner.install(this.#core(registration));
          } finally {
            this.#hookRegistration = undefined;
          }
          if (
            installResult &&
            typeof installResult === 'object' &&
            Reflect.ownKeys(installResult).includes('then')
          )
            throw new PluginHostError(
              'EXTENSION_RESERVED',
              ERROR_TEXT.EXTENSION_RESERVED(registration.name, 'then')
            );
          const installedValue =
            installResult &&
            typeof installResult === 'object' &&
            typeof (installResult as { then?: unknown }).then === 'function'
              ? await installResult
              : installResult;
          const pendingShared: Array<[PropertyKey, unknown]> = [];
          if (plugin.shared) {
            this.#hookRegistration = registration;
            let sharedValue: unknown;
            try {
              sharedValue = plugin.owner.shared!(this.#core(registration));
            } finally {
              this.#hookRegistration = undefined;
            }
            const shared = readPlainDataRecord(sharedValue, 'plugin shared', false);
            for (const key of Reflect.ownKeys(shared)) {
              if (this.#shared.has(key))
                throw new PluginHostError('SHARED_DUPLICATE', ERROR_TEXT.SHARED_DUPLICATE(key));
              pendingShared.push([key, shared[key]]);
            }
          }
          this.#mountExtensions(registration, installedValue);
          for (const [key, value] of pendingShared) {
            this.#shared.set(key, { owner: registration, value });
            registration.shared.push(key);
          }
          registration.installed = true;
          this.#registrations.set(registration.name, registration);
        } finally {
          this.#hookRegistration = undefined;
          registration.lifecycle = 'idle';
          this.#lifecycleRegistration = undefined;
        }
      }
    } catch (error) {
      const errors: unknown[] = [error];
      for (const registration of [...installed].reverse())
        errors.push(...(await this.#disposeRegistration(registration)));
      if (errors.length === 1) {
        const cause = errors[0];
        throw new PluginHostError(
          'PLUGIN_INSTALL_FAILED',
          `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause }
        );
      }
      const rollbackCause = new AggregateError(
        errors,
        `${ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName)}: ${errors
          .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
          .join('; ')}`
      );
      throw new PluginHostError(
        'PLUGIN_INSTALL_ROLLBACK_FAILED',
        ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName),
        { cause: rollbackCause }
      );
    }
  }

  /** Runs the initial install transaction without allowing awaitable extensions. */
  #installBatchSync(entries: readonly IInstallEntry<TDomainCore, TValue>[]): void {
    const installed: IRegistration<TDomainCore, TValue>[] = [];
    let failedName = entries[0]?.name ?? 'unknown';
    this.#syncInstallActive = true;
    try {
      for (const entry of entries) {
        const { plugin, name } = entry;
        failedName = name;
        const registration: IRegistration<TDomainCore, TValue> = {
          name,
          plugin,
          config: copyConfig(plugin.config),
          extensions: [],
          pipelineDisposers: [],
          disposers: [],
          shared: [],
          installed: false,
          lifecycle: 'install'
        };
        this.#lifecycleRegistration = registration;
        installed.push(registration);
        try {
          this.#hookRegistration = registration;
          let installedValue: unknown;
          try {
            installedValue = plugin.owner.install(this.#core(registration));
          } finally {
            this.#hookRegistration = undefined;
          }
          if (
            installedValue &&
            typeof installedValue === 'object' &&
            typeof (installedValue as { then?: unknown }).then === 'function'
          ) {
            void Promise.resolve(installedValue).catch(() => undefined);
            throw new TypeError(
              `plugin ${registration.name} returned an awaitable during synchronous installation`
            );
          }
          const pendingShared: Array<[PropertyKey, unknown]> = [];
          if (plugin.shared) {
            this.#hookRegistration = registration;
            let sharedValue: unknown;
            try {
              sharedValue = plugin.owner.shared!(this.#core(registration));
            } finally {
              this.#hookRegistration = undefined;
            }
            const shared = readPlainDataRecord(sharedValue, 'plugin shared', false);
            for (const key of Reflect.ownKeys(shared)) {
              if (this.#shared.has(key))
                throw new PluginHostError('SHARED_DUPLICATE', ERROR_TEXT.SHARED_DUPLICATE(key));
              pendingShared.push([key, shared[key]]);
            }
          }
          this.#mountExtensions(registration, installedValue);
          for (const [key, value] of pendingShared) {
            this.#shared.set(key, { owner: registration, value });
            registration.shared.push(key);
          }
          registration.installed = true;
          this.#registrations.set(registration.name, registration);
        } finally {
          registration.lifecycle = 'idle';
          this.#lifecycleRegistration = undefined;
        }
      }
    } catch (cause) {
      const rollbackErrors = [...installed]
        .reverse()
        .flatMap((registration) => this.#disposeRegistrationSync(registration));
      if (rollbackErrors.length > 0) {
        throw new PluginHostError(
          'PLUGIN_INSTALL_ROLLBACK_FAILED',
          ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName),
          {
            cause: new AggregateError(
              [cause, ...rollbackErrors],
              ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName)
            )
          }
        );
      }
      throw new PluginHostError(
        'PLUGIN_INSTALL_FAILED',
        `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause }
      );
    } finally {
      this.#syncInstallActive = false;
    }
  }

  #mountExtensions(registration: IRegistration<TDomainCore, TValue>, extension: unknown): void {
    const extensionObject = assertExtensionResult(extension, registration.name);
    for (const key of Reflect.ownKeys(extensionObject)) {
      const descriptor = Object.getOwnPropertyDescriptor(extensionObject, key);
      // Non-enumerable extension keys are intentionally ignored (keeps symbol metadata such as
      // Symbol.toStringTag out of the host surface) — but the omission must be observable rather
      // than silent, so it is reported through the diagnostic channel every time it happens.
      if (!descriptor?.enumerable) {
        try {
          this.#diagnostic(
            ERROR_TEXT.EXTENSION_NON_ENUMERABLE_IGNORED(registration.name, key),
            'EXTENSION_NON_ENUMERABLE_IGNORED'
          );
        } catch {
          // Diagnostics must never throw into unrelated code paths.
        }
        continue;
      }
      if (key in (this as object)) {
        if (objectPrototypeKeys.has(key))
          throw new PluginHostError(
            'EXTENSION_OBJECT_PROTOTYPE',
            ERROR_TEXT.EXTENSION_OBJECT_PROTOTYPE(registration.name, key)
          );
        throw new PluginHostError(
          'EXTENSION_DUPLICATE',
          ERROR_TEXT.EXTENSION_DUPLICATE(registration.name, key)
        );
      }
      if (
        !descriptor ||
        'get' in descriptor ||
        'set' in descriptor ||
        descriptor.configurable === false
      )
        throw new TypeError('extension property must be a configurable data property');
      Object.defineProperty(this, key, descriptor);
      registration.extensions.push({ key, descriptor });
    }
  }

  #updateRegistration<T extends IPluginConfig>(
    name: string,
    recipe: (previous: Readonly<T>) => Partial<T>
  ): Promise<void> {
    this.#assertActive();
    this.#assertMutationAllowed();
    return this.#enqueue(async () => {
      const registration = this.#registrations.get(name);
      if (!registration)
        throw new PluginHostError('PLUGIN_NOT_INSTALLED', ERROR_TEXT.PLUGIN_NOT_INSTALLED(name));
      const previous = copyConfig(registration.config);
      const patch = readPlainDataRecord(
        recipe(previous as Readonly<T>),
        'config patch',
        true,
        true
      );
      const next = { ...previous, ...patch } as IPluginConfig;
      this.#lifecycleRegistration = registration;
      try {
        if (registration.plugin.update) {
          this.#hookRegistration = registration;
          let updateResult: void | Promise<void>;
          try {
            updateResult = registration.plugin.owner.update!(
              copyConfig(next) as never,
              this.#core(registration)
            );
          } finally {
            this.#hookRegistration = undefined;
          }
          await updateResult;
        }
      } finally {
        this.#lifecycleRegistration = undefined;
      }
      registration.config = copyConfig(next);
    });
  }

  get config(): IPluginHostConfigFor<TInstalled> {
    if (this.#configApi) return this.#configApi;
    this.#configApi = {
      get: (path: string) => {
        this.#assertActive();
        if (typeof path !== 'string' || path.length === 0)
          throw new TypeError('config path must be a non-empty string');
        const registration = [...this.#registrations.entries()]
          .sort(([left], [right]) => right.length - left.length)
          .find(([name]) => path === name || path.startsWith(`${name}.`))?.[1];
        if (!registration) return undefined;
        return readConfigPath(registration.config, parseConfigPath(path));
      },
      update: <T extends IPluginConfig>(
        name: string,
        recipe: (previous: Readonly<T>) => Partial<T>
      ) => this.#updateRegistration(name, recipe)
    } as IPluginHostConfigFor<TInstalled>;
    return this.#configApi;
  }

  unUse(name: string): Promise<void> {
    this.#assertActive();
    this.#assertMutationAllowed();
    return this.#enqueue(async () => {
      const registration = this.#registrations.get(name);
      if (!registration) return;
      const errors = await this.#disposeRegistration(registration);
      try {
        aggregateErrors(errors, ERROR_TEXT.PLUGIN_DISPOSE_FAILED(name));
      } catch (cause) {
        throw new PluginHostError('PLUGIN_DISPOSE_FAILED', ERROR_TEXT.PLUGIN_DISPOSE_FAILED(name), {
          cause
        });
      }
    });
  }

  /**
   * Runs one disposer step and waits for it, but never longer than DISPOSE_STEP_TIMEOUT_MS. A
   * synchronous throw from `run()` is recorded immediately. An asynchronous result races against
   * the bound; on timeout the step is recorded as failed and the disposal transaction moves on.
   *
   * `pending` gets both a fulfillment _and_ a rejection reaction attached in the same synchronous
   * tick it is obtained (via the two-argument `.then()` below), rather than only being caught later
   * inside a conditional branch. Attaching the rejection handler even one tick late is enough for
   * the runtime to report a promise as an unhandled rejection for that tick, even though it is
   * eventually handled — deferring it, or deriving an intermediate promise that itself has no
   * synchronous rejection handler, reintroduces exactly that gap.
   */
  async #awaitDisposeStep(
    phase: string,
    run: () => void | Promise<void>,
    recordDisposeError: (phase: string, error: unknown) => void
  ): Promise<void> {
    let result: void | Promise<void>;
    try {
      result = run();
    } catch (error) {
      recordDisposeError(phase, error);
      return;
    }
    if (!result || typeof (result as { then?: unknown }).then !== 'function') return;
    const pending = result as Promise<void>;
    const outcome: Promise<{ ok: true } | { ok: false; error: unknown }> = pending.then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error })
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), DISPOSE_STEP_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
    });
    try {
      const raced = await Promise.race([outcome, timedOut]);
      if (raced === 'timed-out')
        recordDisposeError(
          phase,
          new PluginHostError(
            'DISPOSE_STEP_TIMEOUT',
            ERROR_TEXT.DISPOSE_STEP_TIMEOUT(phase, DISPOSE_STEP_TIMEOUT_MS)
          )
        );
      else if (!raced.ok) recordDisposeError(phase, raced.error);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async #disposeRegistration(registration: IRegistration<TDomainCore, TValue>): Promise<unknown[]> {
    registration.lifecycle = 'dispose';
    this.#lifecycleRegistration = registration;
    const errors: unknown[] = [];
    const recordDisposeError = (phase: string, error: unknown): void => {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(new Error(`${phase}: ${detail}`, { cause: error }));
    };
    for (const dispose of [...registration.pipelineDisposers].reverse())
      await this.#awaitDisposeStep('pipeline disposer', dispose, recordDisposeError);
    if (registration.installed) {
      const pluginDispose = registration.plugin.dispose
        ? () => registration.plugin.owner.dispose?.()
        : resolveDisposer(registration.plugin.owner as IPluginResource);
      if (pluginDispose)
        await this.#awaitDisposeStep(
          'plugin dispose hook',
          () => {
            this.#hookRegistration = registration;
            try {
              return pluginDispose();
            } finally {
              this.#hookRegistration = undefined;
            }
          },
          recordDisposeError
        );
    }
    for (const key of registration.shared)
      if (this.#shared.get(key)?.owner === registration) this.#shared.delete(key);
    for (const dispose of [...registration.disposers].reverse())
      await this.#awaitDisposeStep('resource disposer', dispose, recordDisposeError);
    for (const { key } of [...registration.extensions].reverse()) {
      try {
        const current = Object.getOwnPropertyDescriptor(this, key);
        if (!current) continue;
        if (!Reflect.deleteProperty(this, key))
          throw new TypeError(`extension property ${String(key)} could not be deleted`);
      } catch (error) {
        recordDisposeError('extension removal', error);
      }
    }
    if (this.#registrations.get(registration.name) === registration)
      this.#registrations.delete(registration.name);
    registration.lifecycle = 'idle';
    this.#lifecycleRegistration = undefined;
    return errors;
  }

  #disposeRegistrationSync(registration: IRegistration<TDomainCore, TValue>): unknown[] {
    registration.lifecycle = 'dispose';
    this.#lifecycleRegistration = registration;
    const errors: unknown[] = [];
    const record = (phase: string, error: unknown): void => {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(new Error(`${phase}: ${detail}`, { cause: error }));
    };
    const run = (phase: string, dispose: () => void | Promise<void>): void => {
      try {
        const result = dispose();
        if (result && typeof (result as { then?: unknown }).then === 'function')
          record(phase, new TypeError('useSync rollback disposer must be synchronous'));
      } catch (error) {
        record(phase, error);
      }
    };
    for (const dispose of [...registration.pipelineDisposers].reverse())
      run('pipeline disposer', dispose);
    if (registration.installed) {
      const pluginDispose = registration.plugin.dispose
        ? () => registration.plugin.owner.dispose?.()
        : resolveDisposer(registration.plugin.owner as IPluginResource);
      if (pluginDispose) run('plugin dispose hook', pluginDispose);
    }
    for (const key of registration.shared)
      if (this.#shared.get(key)?.owner === registration) this.#shared.delete(key);
    for (const dispose of [...registration.disposers].reverse()) run('resource disposer', dispose);
    for (const { key } of [...registration.extensions].reverse()) {
      try {
        if (!Reflect.deleteProperty(this, key))
          throw new TypeError(`extension property ${String(key)} could not be deleted`);
      } catch (error) {
        record('extension removal', error);
      }
    }
    if (this.#registrations.get(registration.name) === registration)
      this.#registrations.delete(registration.name);
    registration.lifecycle = 'idle';
    this.#lifecycleRegistration = undefined;
    return errors;
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    if (this.#status !== 'active') return Promise.resolve();
    this.#assertMutationAllowed();
    this.#status = 'closing';
    this.#disposePromise = this.#enqueue(async () => {
      const errors: unknown[] = [];
      for (const registration of [...this.#registrations.values()].reverse())
        errors.push(...(await this.#disposeRegistration(registration)));
      this.#syncStages.length = 0;
      this.#asyncStages.length = 0;
      this.#generatorStages.length = 0;
      this.#status = 'disposed';
      try {
        aggregateErrors(errors, ERROR_TEXT.HOST_DISPOSE_FAILED);
      } catch (cause) {
        throw new PluginHostError('HOST_DISPOSE_FAILED', ERROR_TEXT.HOST_DISPOSE_FAILED, { cause });
      }
    }, true);
    return this.#disposePromise;
  }
}

if (asyncDisposeKey !== undefined)
  Object.defineProperty(PluginHost.prototype, asyncDisposeKey, {
    configurable: true,
    value(this: PluginHost<object, unknown>) {
      return this.dispose();
    }
  });
