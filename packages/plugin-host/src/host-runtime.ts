import ERROR_TEXT, {
  PluginHostError,
  createPluginHostTypeError,
  setErrorLocale,
  tagPluginHostError,
  type ILocaleKey
} from './error-text.js';
import { PluginHostErrorCode } from './error-code.js';
import {
  copyConfig,
  copyConfigWithPatch,
  parseConfigPath,
  readConfigPath,
  readPlainDataRecord,
  readonlyConfig
} from './config.js';
import { aggregateErrors, asyncDisposeKey, resolveDisposer, snapshotDisposer } from './disposal.js';
import {
  createLifecycleScope,
  createMutationQueue,
  assimilateCapturedThen,
  LifecycleErrorCode,
  snapshotScheduler,
  systemScheduler,
  type ILifecycleScheduler,
  type IMutationQueue,
  type IReleaseDescriptor
} from '@migaia/lifecycle';
import {
  adaptSyncStageToAsync,
  adaptSyncStageToGenerator,
  registerStage,
  runPipeline
} from './pipeline.js';
import { assertExtensionResult } from './extension.js';
import { createPluginCore } from './core.js';
import {
  PluginHostPipelineMode,
  PluginHostPipelineViolation,
  PluginHostRegistrationLifecycle,
  PluginHostStatus
} from './state-constants.js';
import type { IInstallEntry, IPluginDefinition, IRegistration, ISharedEntry } from './registry.js';
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
} from './typing.js';

type IHostStatus = 'active' | 'closing' | 'disposed';
/**
 * 默认诊断 sink：无副作用 no-op（runtime-neutrality.sdd.md R-7 第 3 条「`defaultDiagnostic = () => {}`」）。
 *
 * Plugin-host 是 runtime-neutral 核心，不直接依赖宿主 `console`；需要观测非枚举扩展跳过、回滚失败等诊断的调用方必须显式注入
 * `diagnostic`。`message` 仅用于保持与注入版相同的签名。
 */
const defaultDiagnostic = (_message: string): void => {};
/** 校验可配置超时：`undefined`/`false` 合法；number 必须有限非负（AF-10）。 */
const assertTimeoutOption = (value: number | false | undefined, label: string): void => {
  if (value === undefined || value === false) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw createPluginHostTypeError(`${label} must be false or a non-negative finite number`);
  }
};
/** Convert hostile resource disposer access into the plugin-host admission error boundary. */
const resolveAdmittedDisposer = (resource: IPluginResource) => {
  try {
    return resolveDisposer(resource);
  } catch (cause) {
    throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause });
  }
};
const objectPrototypeKeys = new Set(Reflect.ownKeys(Object.prototype));
/**
 * Default queue-admission diagnostic threshold; `queueAdmissionTimeoutMs` defaults to
 * `undefined`（只诊断不拒绝）。
 */
const DEFAULT_QUEUE_ADMISSION_DIAGNOSTIC_MS = 1000;
/**
 * Default dispose-step timeout. Kept as a real default because a disposer that never settles would
 * otherwise leave the host stuck in `closing` forever — but it is now caller-overridable / can be
 * turned off (`false`).
 */
const DEFAULT_DISPOSE_STEP_TIMEOUT_MS = 5000;
/** Runtime-neutral plugin host. All external mutation enters one Promise queue. */
export abstract class PluginHost<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly []
> {
  static setLocale(localeKey: ILocaleKey): void {
    setErrorLocale(localeKey);
  }

  #status: IHostStatus = PluginHostStatus.active;
  #disposePromise: Promise<void> | undefined;
  /**
   * Serial FIFO admission queue for every external mutation, ported off the hand-rolled
   * `#mutationQueue`/`#armQueueWatchdog` onto `@migaia/lifecycle`'s `createMutationQueue`. No
   * `owner` tag is passed to `enqueue()` — an earlier adversarial pass (see hardening-regressions
   * `#4`/PH-R3-1) found no reliable per-call owner identity here that would let self-dependency
   * detection reject a genuine self-await without also risking a legitimate queued mutation; the
   * queue's owner-self-dependency guard is therefore intentionally unused at this call site.
   */
  #queue: IMutationQueue;
  #scheduler: ILifecycleScheduler;
  #disposeStepTimeoutMs: number | false;
  #queueAdmissionTimeoutMs: number | false | undefined;
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

  constructor(options: IPluginHostOptions = {}) {
    this.#pipelineMode = options.pipeline?.mode ?? PluginHostPipelineMode.sync;
    if (options.diagnostic !== undefined && typeof options.diagnostic !== 'function')
      throw createPluginHostTypeError('diagnostic must be a function');
    this.#diagnostic = options.diagnostic ?? defaultDiagnostic;
    if (
      ![
        PluginHostPipelineMode.sync,
        PluginHostPipelineMode.async,
        PluginHostPipelineMode.generator
      ].includes(this.#pipelineMode)
    )
      throw new PluginHostError('INVALID_PIPELINE_MODE', ERROR_TEXT.INVALID_PIPELINE_MODE);
    // 时间策略统一走 lifecycle scheduler / 可配置阈值（AF-10）。负数/NaN/Infinity 立即 INVALID_OPTION。
    for (const [label, value] of [
      ['queueAdmissionTimeoutMs', options.queueAdmissionTimeoutMs],
      ['queueAdmissionDiagnosticMs', options.queueAdmissionDiagnosticMs],
      ['disposeStepTimeoutMs', options.disposeStepTimeoutMs]
    ] as const)
      assertTimeoutOption(value, label);
    // 只读取一次 scheduler 快照（AF-31）：校验、保存、传给 queue/dispose scope 都用这个局部快照。
    const schedulerOption = options.scheduler;
    let schedulerSnapshot: ILifecycleScheduler | undefined;
    if (schedulerOption !== undefined) {
      try {
        schedulerSnapshot = snapshotScheduler(schedulerOption);
      } catch (error) {
        const lifecycleCause =
          error && typeof error === 'object' && 'cause' in error
            ? (error as { readonly cause?: unknown }).cause
            : undefined;
        throw tagPluginHostError(
          new TypeError('scheduler getter failed', {
            cause: lifecycleCause !== undefined ? lifecycleCause : error
          }),
          PluginHostErrorCode.invalidOption
        );
      }
      if (schedulerSnapshot === undefined) {
        throw createPluginHostTypeError('scheduler must provide now() and schedule() functions');
      }
    }
    this.#scheduler = schedulerSnapshot ?? systemScheduler;
    this.#disposeStepTimeoutMs = options.disposeStepTimeoutMs ?? DEFAULT_DISPOSE_STEP_TIMEOUT_MS;
    this.#queueAdmissionTimeoutMs = options.queueAdmissionTimeoutMs;
    this.#queue = createMutationQueue({
      scheduler: this.#scheduler,
      queueAdmissionTimeoutMs: options.queueAdmissionTimeoutMs,
      admissionDiagnosticMs:
        options.queueAdmissionDiagnosticMs === false
          ? undefined
          : (options.queueAdmissionDiagnosticMs ?? DEFAULT_QUEUE_ADMISSION_DIAGNOSTIC_MS),
      onAdmissionDiagnostic:
        options.queueAdmissionDiagnosticMs === false
          ? undefined
          : (info) => this.#reportQueueWait(info)
    });
  }

  get pipelineMode(): IPipelineMode {
    this.#assertActive();
    return this.#pipelineMode;
  }

  #assertActive(): void {
    if (this.#status === PluginHostStatus.disposed)
      throw new PluginHostError('HOST_DISPOSED', ERROR_TEXT.HOST_DISPOSED);
    if (this.#status === PluginHostStatus.closing)
      throw new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING);
  }

  #assertMutationAllowed(): void {
    if (this.#hookRegistration)
      throw new PluginHostError('LIFECYCLE_MUTATION', ERROR_TEXT.LIFECYCLE_MUTATION);
  }

  /** 队列 admission 诊断（未配置 reject 阈值时）：只观测，不出队、不 reject，且**不携带错误码**（非拒绝事件）。 */
  #reportQueueWait(info: { readonly owner: string | undefined; readonly waitedMs: number }): void {
    try {
      this.#diagnostic(
        `[plugin-host] mutation waited in the queue for ${info.waitedMs}ms${info.owner ? ` (owner: ${info.owner})` : ''}`
      );
    } catch {
      // Diagnostics must never alter control flow.
    }
  }

  /**
   * `terminal` (used only by `dispose()`) passes `queueAdmissionTimeoutMs: false` for this one
   * task, exempting it from the queue SLA — mirrors the original `#mutationQueue`'s "terminal
   * mutations are never evicted" rule (R4-1).
   */
  #enqueue<T>(task: () => Promise<T>, terminal = false): Promise<T> {
    return this.#queue
      .enqueue(task, terminal ? { queueAdmissionTimeoutMs: false } : undefined)
      .catch((error: unknown) => {
        if (
          error &&
          typeof error === 'object' &&
          (error as { code?: unknown }).code === LifecycleErrorCode.queueAdmissionTimeout
        ) {
          // 文案报告配置阈值；实际 waitedMs 只放 detail（owner 一并从 lifecycle 错误透传）。
          const lifecycleDetail = (error as { detail?: { owner?: unknown; waitedMs?: number } })
            .detail;
          const threshold =
            typeof this.#queueAdmissionTimeoutMs === 'number' ? this.#queueAdmissionTimeoutMs : 0;
          throw new PluginHostError(
            'MUTATION_QUEUE_TIMEOUT',
            ERROR_TEXT.MUTATION_QUEUE_TIMEOUT(threshold),
            {
              cause: error,
              detail: {
                owner: lifecycleDetail?.owner,
                waitedMs: lifecycleDetail?.waitedMs ?? 0
              }
            }
          );
        }
        throw error;
      });
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
        if (registration.lifecycle !== PluginHostRegistrationLifecycle.install)
          throw new PluginHostError(
            'RESOURCE_OUTSIDE_INSTALL',
            ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
          );
        const disposer = resolveAdmittedDisposer(resource);
        if (!disposer) throw createPluginHostTypeError('plugin resource must provide a disposer');
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

  #onPipelineViolation = (
    kind: (typeof PluginHostPipelineViolation)[keyof typeof PluginHostPipelineViolation]
  ): void => {
    if (kind === PluginHostPipelineViolation.late) {
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
    if (typeof stage !== 'function')
      throw createPluginHostTypeError('pipeline stage must be a function');
    if (kind !== this.#pipelineMode)
      throw new PluginHostError(
        'PIPELINE_MODE_MISMATCH',
        ERROR_TEXT.PIPELINE_MODE_MISMATCH(this.#pipelineMode, kind)
      );
    if (owner && owner.lifecycle !== PluginHostRegistrationLifecycle.install)
      throw new PluginHostError('RESOURCE_OUTSIDE_INSTALL', ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL);
    if (this.#pipelineDepth > 0)
      throw new PluginHostError('PIPELINE_EXECUTING', ERROR_TEXT.PIPELINE_EXECUTING);
    const track = (dispose: () => void): void => {
      if (owner) owner.pipelineDisposers.push(dispose);
    };
    if (kind === PluginHostPipelineMode.sync)
      registerStage(this.#syncStages, stage as ISyncPipelineStage<TValue>, track);
    else if (kind === PluginHostPipelineMode.async)
      registerStage(this.#asyncStages, stage as IAsyncPipelineStage<TValue>, track);
    else registerStage(this.#generatorStages, stage as IGeneratorPipelineStage<TValue>, track);
  }

  protected runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void> {
    const onViolation = this.#onPipelineViolation;
    if (this.#pipelineMode === PluginHostPipelineMode.sync) {
      this.#assertActive();
      this.#pipelineDepth += 1;
      try {
        return runPipeline(PluginHostPipelineMode.sync, this.#syncStages, value, done, onViolation);
      } finally {
        this.#pipelineDepth -= 1;
      }
    }
    if (this.#pipelineMode === PluginHostPipelineMode.async) {
      try {
        this.#assertActive();
      } catch (error) {
        return Promise.reject(error);
      }
      // Async mode snapshots stages, while the depth guard rejects registration for the full await span.
      this.#pipelineDepth += 1;
      return (
        runPipeline(
          PluginHostPipelineMode.async,
          [...this.#asyncStages],
          value,
          done,
          onViolation,
          () => this.#assertActive()
        ) as Promise<void>
      ).finally(() => {
        this.#pipelineDepth -= 1;
      });
    }
    this.#assertActive();
    this.#pipelineDepth += 1;
    try {
      return runPipeline(
        PluginHostPipelineMode.generator,
        this.#generatorStages,
        value,
        done,
        onViolation
      );
    } finally {
      this.#pipelineDepth -= 1;
    }
  }

  /** Host-side pipeline registration for application composition. */
  usePipeline(stage: ISyncPipelineStage<TValue>): this {
    this.#assertActive();
    if (this.#pipelineMode === PluginHostPipelineMode.sync)
      this.#registerStage(stage, undefined, PluginHostPipelineMode.sync);
    else if (this.#pipelineMode === PluginHostPipelineMode.async)
      this.#registerStage(
        adaptSyncStageToAsync(stage, this.#onPipelineViolation),
        undefined,
        PluginHostPipelineMode.async
      );
    else
      this.#registerStage(
        adaptSyncStageToGenerator(stage, this.#onPipelineViolation),
        undefined,
        PluginHostPipelineMode.generator
      );
    return this;
  }

  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): this {
    this.#assertActive();
    this.#registerStage(stage, undefined, PluginHostPipelineMode.async);
    return this;
  }

  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): this {
    this.#assertActive();
    this.#registerStage(stage, undefined, PluginHostPipelineMode.generator);
    return this;
  }

  getShared<T = unknown>(key: PropertyKey): T | undefined {
    this.#assertActive();
    return this.#shared.get(key)?.value as T | undefined;
  }

  protected onDispose(resource: IPluginResource): void {
    const dispose = resolveAdmittedDisposer(resource);
    if (!dispose) throw createPluginHostTypeError('plugin resource must provide a disposer');
    if (this.#lifecycleRegistration?.lifecycle === PluginHostRegistrationLifecycle.install)
      this.#lifecycleRegistration.disposers.push(dispose);
    else throw new PluginHostError('RESOURCE_OUTSIDE_INSTALL', ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL);
  }

  protected trackPluginResourceIfInstalling(resource: IPluginResource): boolean {
    const dispose = resolveAdmittedDisposer(resource);
    if (!dispose) throw createPluginHostTypeError('plugin resource must provide a disposer');
    if (this.#lifecycleRegistration?.lifecycle !== PluginHostRegistrationLifecycle.install)
      return false;
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
      let captured: {
        readonly name: unknown;
        readonly config: unknown;
        readonly install: unknown;
        readonly update: unknown;
        readonly dispose: unknown;
        readonly shared: unknown;
        readonly disposer: ReturnType<typeof snapshotDisposer>;
      };
      try {
        captured = {
          name: plugin?.name,
          config: plugin?.config,
          install: plugin?.install,
          update: plugin?.update,
          dispose: plugin?.dispose,
          shared: plugin?.shared,
          disposer: snapshotDisposer(plugin as IPluginResource)
        };
      } catch (cause) {
        throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause });
      }
      const { name, config: rawConfig, install, update, dispose, shared, disposer } = captured;
      if (typeof name !== 'string' || name.length === 0)
        throw createPluginHostTypeError('plugin name must be a non-empty string');
      if (name.includes('.')) throw createPluginHostTypeError('plugin name must not contain "."');
      if (typeof install !== 'function')
        throw createPluginHostTypeError('plugin install must be a function');
      for (const [key, hook] of [
        ['update', update],
        ['dispose', dispose],
        ['shared', shared]
      ] as const)
        if (hook !== undefined && typeof hook !== 'function')
          throw createPluginHostTypeError(`plugin ${key} must be a function`);
      for (const candidate of [...disposer.asyncCandidates, ...disposer.disposeCandidates])
        if (candidate.value !== undefined && typeof candidate.value !== 'function')
          throw createPluginHostTypeError(
            `plugin disposer ${String(candidate.key)} must be a function`
          );
      if (names.has(name))
        throw new PluginHostError('PLUGIN_DUPLICATE', ERROR_TEXT.PLUGIN_DUPLICATE(name));
      names.add(name);
      const config = copyConfig((rawConfig ?? {}) as IPluginConfig, 'plugin config');
      return {
        owner: plugin,
        name,
        config,
        install: install as IPluginConstraint<any>['install'],
        update: update as IPluginConstraint<any>['update'],
        dispose: dispose as IPluginConstraint<any>['dispose'],
        shared: shared as IPluginConstraint<any>['shared'],
        disposer: disposer.disposer
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
          lifecycle: PluginHostRegistrationLifecycle.install
        };
        this.#lifecycleRegistration = registration;
        installed.push(registration);
        try {
          this.#hookRegistration = registration;
          let installResult: unknown;
          try {
            installResult = Reflect.apply(plugin.install, plugin.owner, [this.#core(registration)]);
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
          const installThen =
            installResult &&
            (typeof installResult === 'object' || typeof installResult === 'function')
              ? (installResult as { then?: unknown }).then
              : undefined;
          const installedValue =
            typeof installThen === 'function'
              ? await assimilateCapturedThen(
                  installThen as (...args: unknown[]) => void,
                  installResult
                )
              : installResult;
          const pendingShared: Array<[PropertyKey, unknown]> = [];
          if (plugin.shared) {
            this.#hookRegistration = registration;
            let sharedValue: unknown;
            try {
              sharedValue = Reflect.apply(plugin.shared!, plugin.owner, [this.#core(registration)]);
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
          registration.lifecycle = PluginHostRegistrationLifecycle.idle;
          this.#lifecycleRegistration = undefined;
        }
      }
    } catch (error) {
      // L-T39 (§3.7.4/M-T44): the original construct error stays the thrown error's `cause` no
      // matter what — a cleanup/rollback failure is reported through the diagnostic channel as an
      // additional signal, never promoted to replace it as the primary error.
      const rollbackErrors: unknown[] = [];
      for (const registration of [...installed].reverse())
        rollbackErrors.push(...(await this.#disposeRegistration(registration)));
      this.#reportRollbackFailure(failedName, rollbackErrors);
      throw new PluginHostError(
        'PLUGIN_INSTALL_FAILED',
        `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /** Reports a batch of rollback/cleanup failures via the diagnostic channel — never thrown. */
  #reportRollbackFailure(failedName: string, rollbackErrors: readonly unknown[]): void {
    if (rollbackErrors.length === 0) return;
    const detail = rollbackErrors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join('; ');
    try {
      this.#diagnostic(
        `${ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName)}: ${detail}`,
        'PLUGIN_INSTALL_ROLLBACK_FAILED'
      );
    } catch {
      // Diagnostics must never alter control flow.
    }
  }

  /** Runs the initial install transaction without allowing awaitable extensions. */
  #installBatchSync(entries: readonly IInstallEntry<TDomainCore, TValue>[]): void {
    const installed: IRegistration<TDomainCore, TValue>[] = [];
    let failedName = entries[0]?.name ?? 'unknown';
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
          lifecycle: PluginHostRegistrationLifecycle.install
        };
        this.#lifecycleRegistration = registration;
        installed.push(registration);
        try {
          this.#hookRegistration = registration;
          let installedValue: unknown;
          try {
            installedValue = Reflect.apply(plugin.install, plugin.owner, [
              this.#core(registration)
            ]);
          } finally {
            this.#hookRegistration = undefined;
          }
          const installedThen =
            installedValue &&
            (typeof installedValue === 'object' || typeof installedValue === 'function')
              ? (installedValue as { then?: unknown }).then
              : undefined;
          if (typeof installedThen === 'function') {
            void assimilateCapturedThen(
              installedThen as (...args: unknown[]) => void,
              installedValue
            ).catch(() => undefined);
            throw createPluginHostTypeError(
              `plugin ${registration.name} returned an awaitable during synchronous installation`
            );
          }
          const pendingShared: Array<[PropertyKey, unknown]> = [];
          if (plugin.shared) {
            this.#hookRegistration = registration;
            let sharedValue: unknown;
            try {
              sharedValue = Reflect.apply(plugin.shared!, plugin.owner, [this.#core(registration)]);
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
          registration.lifecycle = PluginHostRegistrationLifecycle.idle;
          this.#lifecycleRegistration = undefined;
        }
      }
    } catch (cause) {
      // §5.6: rollback is now two-phase — `#closeRegistrationSync` synchronously detaches every
      // partially/fully installed registration (so host state, e.g. mounted extensions, is
      // consistent the instant this throw reaches the caller), and the registration's own
      // disposers (which may be async — no longer statically rejected at registration time, M-T15)
      // run afterward via `#rollbackDisposersAsync`, fire-and-forget. A disposer failure there can
      // no longer be known synchronously, so — like the async `#installBatch` path — it is reported
      // through the diagnostic channel instead of being folded into this throw.
      for (const registration of [...installed].reverse())
        this.#closeRegistrationSync(registration);
      this.#rollbackDisposersAsync(installed, failedName);
      throw new PluginHostError(
        'PLUGIN_INSTALL_FAILED',
        `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause }
      );
    }
  }

  /**
   * Synchronous half of useSync rollback: detaches a registration from all host-visible state
   * (shared keys, mounted extensions, the registrations map) without running any user disposer code
   * — matches `LifecycleScope.close()`'s "synchronous, idempotent, never calls user code".
   * Extension-removal failures are reported via diagnostic immediately (synchronously) since they
   * are themselves synchronous, unlike the disposers handled by `#rollbackDisposersAsync`.
   */
  #closeRegistrationSync(registration: IRegistration<TDomainCore, TValue>): void {
    for (const key of registration.shared)
      if (this.#shared.get(key)?.owner === registration) this.#shared.delete(key);
    for (const { key } of [...registration.extensions].reverse()) {
      try {
        if (!Reflect.deleteProperty(this, key))
          throw createPluginHostTypeError(`extension property ${String(key)} could not be deleted`);
      } catch (error) {
        this.#reportRollbackFailure(registration.name, [error]);
      }
    }
    if (this.#registrations.get(registration.name) === registration)
      this.#registrations.delete(registration.name);
    registration.lifecycle = PluginHostRegistrationLifecycle.idle;
  }

  /**
   * Asynchronous half of useSync rollback: runs each registration's own disposers off the
   * synchronous throw path. Failures are collected per registration and reported via diagnostic —
   * never thrown, since `useSync` has already returned by the time these settle.
   */
  #rollbackDisposersAsync(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    failedName: string
  ): void {
    for (const registration of [...installed].reverse()) {
      void this.#disposeGroup(registration.pipelineDisposers, 'pipeline disposer')
        .then((pipelineErrors) =>
          this.#runRollbackDisposeHook(registration).then((hookErrors) => [
            ...pipelineErrors,
            ...hookErrors
          ])
        )
        .then((headErrors) =>
          this.#disposeGroup(registration.disposers, 'resource disposer').then((resourceErrors) => [
            ...headErrors,
            ...resourceErrors
          ])
        )
        .then((errors) => this.#reportRollbackFailure(failedName, errors));
    }
  }

  /** Runs one registration's plugin dispose hook, if any, as its own single-item disposer group. */
  async #runRollbackDisposeHook(
    registration: IRegistration<TDomainCore, TValue>
  ): Promise<unknown[]> {
    if (!registration.installed) return [];
    const pluginDispose = registration.plugin.dispose
      ? () => Reflect.apply(registration.plugin.dispose!, registration.plugin.owner, [])
      : registration.plugin.disposer;
    if (!pluginDispose) return [];
    return this.#disposeGroup([pluginDispose], 'plugin dispose hook');
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
        throw createPluginHostTypeError('extension property must be a configurable data property');
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
      const previous = readonlyConfig(registration.config);
      const patch = readPlainDataRecord(
        recipe(previous as Readonly<T>),
        'config patch',
        true,
        true
      );
      const next = copyConfigWithPatch(registration.config, patch);
      this.#lifecycleRegistration = registration;
      try {
        if (registration.plugin.update) {
          this.#hookRegistration = registration;
          let updateResult: void | Promise<void>;
          try {
            updateResult = Reflect.apply(registration.plugin.update!, registration.plugin.owner, [
              readonlyConfig(next) as never,
              this.#core(registration)
            ]);
          } finally {
            this.#hookRegistration = undefined;
          }
          await updateResult;
        }
      } finally {
        this.#lifecycleRegistration = undefined;
      }
      registration.config = next;
    });
  }

  get config(): IPluginHostConfigFor<TInstalled> {
    if (this.#configApi) return this.#configApi;
    this.#configApi = {
      get: (path: string) => {
        this.#assertActive();
        if (typeof path !== 'string' || path.length === 0)
          throw createPluginHostTypeError('config path must be a non-empty string');
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
   * Builds a release descriptor for one disposer step: `graceful` runs it and races it against
   * `DISPOSE_STEP_TIMEOUT_MS` (abandoning, not cancelling, on timeout — L-T23); `force` fires only
   * when `graceful` didn't itself settle within that race, i.e. exactly the timeout case, and turns
   * it into a `DISPOSE_STEP_TIMEOUT` failure so the step is still recorded as failed. A real error
   * (sync throw or async rejection) settles `graceful` itself, so `force` sees `settled` already
   * true and stays a no-op — the step is recorded exactly once either way.
   */
  #stepDescriptor(phase: string, run: () => void | Promise<void>): IReleaseDescriptor {
    const timeoutMs = this.#disposeStepTimeoutMs;
    if (timeoutMs === false) {
      // dispose timeout 关闭：永久等待，不触发 force。
      return { graceful: run, force: () => {} };
    }
    let settled = false;
    return {
      graceful: async () => {
        try {
          await run();
        } finally {
          settled = true;
        }
      },
      gracefulTimeoutMs: timeoutMs,
      force: () => {
        if (!settled)
          throw new PluginHostError(
            'DISPOSE_STEP_TIMEOUT',
            ERROR_TEXT.DISPOSE_STEP_TIMEOUT(phase, timeoutMs)
          );
      }
    };
  }

  /**
   * Runs one disposer group (pipeline disposers / plugin dispose hook / resource disposers) as its
   * own `LifecycleScope` — LIFO release, each item bounded by DISPOSE_STEP_TIMEOUT_MS.
   */
  async #disposeGroup(
    disposers: readonly (() => void | Promise<void>)[],
    phase: string
  ): Promise<unknown[]> {
    if (disposers.length === 0) return [];
    const scope = createLifecycleScope({ errorPolicy: 'collect', scheduler: this.#scheduler });
    for (const dispose of disposers) scope.own(dispose, this.#stepDescriptor(phase, dispose));
    const collected = await scope.dispose();
    return collected.map((entry) => {
      const detail = entry.error instanceof Error ? entry.error.message : String(entry.error);
      return new Error(`${phase}: ${detail}`, { cause: entry.error });
    });
  }

  async #disposeRegistration(registration: IRegistration<TDomainCore, TValue>): Promise<unknown[]> {
    registration.lifecycle = PluginHostRegistrationLifecycle.dispose;
    this.#lifecycleRegistration = registration;
    const errors: unknown[] = [];
    errors.push(...(await this.#disposeGroup(registration.pipelineDisposers, 'pipeline disposer')));
    if (registration.installed) {
      const pluginDispose = registration.plugin.dispose
        ? () => Reflect.apply(registration.plugin.dispose!, registration.plugin.owner, [])
        : registration.plugin.disposer;
      if (pluginDispose)
        errors.push(
          ...(await this.#disposeGroup(
            [
              () => {
                this.#hookRegistration = registration;
                try {
                  return pluginDispose();
                } finally {
                  this.#hookRegistration = undefined;
                }
              }
            ],
            'plugin dispose hook'
          ))
        );
    }
    for (const key of registration.shared)
      if (this.#shared.get(key)?.owner === registration) this.#shared.delete(key);
    errors.push(...(await this.#disposeGroup(registration.disposers, 'resource disposer')));
    for (const { key } of [...registration.extensions].reverse()) {
      try {
        const current = Object.getOwnPropertyDescriptor(this, key);
        if (!current) continue;
        if (!Reflect.deleteProperty(this, key))
          throw createPluginHostTypeError(`extension property ${String(key)} could not be deleted`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        errors.push(new Error(`extension removal: ${detail}`, { cause: error }));
      }
    }
    if (this.#registrations.get(registration.name) === registration)
      this.#registrations.delete(registration.name);
    registration.lifecycle = PluginHostRegistrationLifecycle.idle;
    this.#lifecycleRegistration = undefined;
    return errors;
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    if (this.#status !== PluginHostStatus.active) return Promise.resolve();
    this.#assertMutationAllowed();
    this.#status = PluginHostStatus.closing;
    this.#disposePromise = this.#enqueue(async () => {
      const errors: unknown[] = [];
      for (const registration of [...this.#registrations.values()].reverse())
        errors.push(...(await this.#disposeRegistration(registration)));
      this.#syncStages.length = 0;
      this.#asyncStages.length = 0;
      this.#generatorStages.length = 0;
      this.#status = PluginHostStatus.disposed;
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
