import ERROR_TEXT, {
  attachPluginHostIdentity,
  formatPluginHostDiagnostic,
  PluginHostError,
  createPluginHostTypeError,
  tagPluginHostError
} from './error-text.js'
import { issueHostIdentity, type IPluginHostIdentity } from './host-identity.js'
import {
  preflightPluginDefinitions,
  snapshotPluginDefinitions,
  type ITrustedDefinitionReader
} from './admission-runtime.js'
import { PluginHostInstallRuntime, type IInstallBatchContext } from './install-runtime.js'
import { PluginHostErrorCode } from './error-code.js'
import { buildManagedPort, registerManagedHost } from './composition-entry.js'
import { PluginHostState } from './host-state.js'
import type { IHostCoreConstructionRequest } from './define-host.js'
import { reportQueueWait, translateQueueRejection } from './host-queue.js'
import {
  createPluginHostPipelineViolationHandler,
  drainPipelineLeases
} from './pipeline-runtime.js'
import { assertRequiredTimeoutOption, assertTimeoutOption } from './host-options.js'
import { asyncDisposeKey } from './disposal.js'
import {
  createMutationQueue,
  createAbortController,
  createPendingTracker,
  createQuiescenceTracker,
  createTerminalController,
  snapshotScheduler,
  systemScheduler,
  type ILifecycleScheduler,
  type IMutationQueue,
  type IAbortController,
  type IQuiescenceTracker,
  type IPendingTracker,
  type ITerminalController
} from '@migaia/lifecycle'
import {
  PluginHostCleanupRuntime,
  PluginHostDisposalNodeKind,
  type IPluginHostDisposalProvenance
} from './cleanup-runtime.js'
export {
  PluginHostDisposalNodeKind,
  type IPluginHostDisposalNodeKind,
  type IPluginHostDisposalProvenance
} from './cleanup-runtime.js'
import { adaptSyncStageForMode } from './pipeline.js'
import { executePluginHostPipeline } from './pipeline-runtime.js'
import { PluginHostRemovalRuntime } from './removal-runtime.js'
import { PluginHostOperationRuntime } from './operation-runtime.js'
import type { IMiddlewarePipelineAbortSignal } from '@migaia/middleware-pipeline'
import { PluginHostCoreRuntime } from './core-runtime.js'
import { PluginHostConfigRuntime } from './config-runtime.js'
import { PluginHostDisposalRuntime } from './host-disposal-runtime.js'
import { PluginHostCompositionRuntime } from './composition-runtime.js'
import {
  PluginHostEnablementRuntime,
  createPluginHostEnablementFacade
} from './enablement-runtime.js'
import { createPluginHostPublication } from './publication.js'
import { PluginHostPipelineMode, PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IRegistration } from './registry.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPluginConstraint,
  IPluginConstraintTuple,
  IPluginHostCore,
  IPluginHostConfigFor,
  IPluginHostErrorCode,
  IPluginHostView,
  IPluginHostDynamicView,
  IPluginHostCompositionIntegration,
  IPluginRemovalResult,
  IMergePluginShared,
  IPluginHostOptions,
  IPluginEnablement,
  IPipelineMode,
  ISyncPipelineStage
} from './typing.js'

/** Type-only invariant marker that preserves constructor-installed tuples through subclasses. */
declare const installedPluginsBrand: unique symbol

/** Module-instance authority for Host-generated disposal nodes; duplicate instances fail closed. */
const pluginHostDisposalProvenance = new WeakMap<object, IPluginHostDisposalProvenance>()

/** Reads provenance only from this exact PluginHost module instance. */
export const readPluginHostDisposalProvenance = (
  value: unknown
): IPluginHostDisposalProvenance | undefined => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return pluginHostDisposalProvenance.get(value)
}

/** Registers one Host-created node under this module instance's private authority. */
const registerPluginHostDisposalNode = <T extends object>(
  node: T,
  provenance: IPluginHostDisposalProvenance
): T => {
  pluginHostDisposalProvenance.set(node, Object.freeze({ ...provenance }))
  return node
}

/** Extracts the invariant constructor-installed tuple from a concrete PluginHost subclass. */
export type IPluginHostInstalledPlugins<THost extends PluginHost<any, any, any>> =
  THost[typeof installedPluginsBrand]

/**
 * 默认诊断 sink：无副作用 no-op（runtime-neutrality.sdd.md R-7 第 3 条「`defaultDiagnostic = () => {}`」）。
 *
 * Plugin-host 是 runtime-neutral 核心，不直接依赖宿主 `console`；需要观测非枚举扩展跳过、回滚失败等诊断的调用方必须显式注入
 * `diagnostic`。`message` 仅用于保持与注入版相同的签名。
 */
const defaultDiagnostic = (_message: string): void => {}
/**
 * Default queue-admission diagnostic threshold; `queueAdmissionTimeoutMs` defaults to
 * `undefined`（只诊断不拒绝）。
 */
const DEFAULT_QUEUE_ADMISSION_DIAGNOSTIC_MS = 1000
/**
 * Default dispose-step timeout. Kept as a real default because a disposer that never settles would
 * otherwise leave the host stuck in `closing` forever — but it is now caller-overridable / can be
 * turned off (`false`).
 */
const DEFAULT_DISPOSE_STEP_TIMEOUT_MS = 5000
/** Runtime-neutral plugin host. All external mutation enters one Promise queue. */
export abstract class PluginHost<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly []
> {
  /** Immutable process-local identity used by Host errors and diagnostics. */
  readonly identity: IPluginHostIdentity
  /** Type-only baseline tuple marker; no runtime property is emitted. */
  declare readonly [installedPluginsBrand]: TInstalled
  #terminal: ITerminalController = createTerminalController()
  #executionController: IAbortController = createAbortController()
  #operationRuntime: PluginHostOperationRuntime
  #pipelineLeases: IQuiescenceTracker<object> = createQuiescenceTracker<object>()
  #pending: IPendingTracker = createPendingTracker()
  #pipelineKey: object = {}
  /**
   * Serial FIFO mutation queue. No owner tag is passed because this boundary has no reliable
   * per-call owner identity for lifecycle's self-dependency guard.
   */
  #queue: IMutationQueue
  #scheduler: ILifecycleScheduler
  #cleanupRuntime: PluginHostCleanupRuntime
  #installRuntime: PluginHostInstallRuntime<TDomainCore, TValue>
  #removalRuntime: PluginHostRemovalRuntime<TDomainCore, TValue>
  #coreRuntime: PluginHostCoreRuntime<TDomainCore, TValue>
  #pipelineDrainTimeoutMs: number | false
  /** Records disposer steps detached by a bounded timeout until the current host disposal settles. */
  #cleanupAbandoned = false
  #queueAdmissionTimeoutMs: number | false | undefined
  /**
   * Every piece of shared mutable state, in one holder.
   *
   * It is constructed before any runtime, so the ports below carry a reference instead of a closure
   * over a field that may not exist yet — which is what forced the old deferred assignments.
   */
  #state = new PluginHostState<TDomainCore, TValue>()
  #hookRegistration: IRegistration<TDomainCore, TValue> | undefined
  #pipelineMode: IPipelineMode
  #diagnostic: (message: string, code?: IPluginHostErrorCode) => void
  /** Real lifecycle signal shared by active pipeline stages and disposal cancellation. */
  #liveSignal: IMiddlewarePipelineAbortSignal = this.#executionController
    .signal as unknown as IMiddlewarePipelineAbortSignal
  /** Tracks synchronous pipeline execution so a stage cannot extend its own traversal. */
  #pipelineDepth = 0
  #configRuntime: PluginHostConfigRuntime<TDomainCore, TValue, TInstalled>
  #hostDisposalRuntime: PluginHostDisposalRuntime<IRegistration<TDomainCore, TValue>>
  #compositionRuntime: PluginHostCompositionRuntime<TDomainCore, TValue>
  #enablementRuntime: PluginHostEnablementRuntime<TDomainCore, TValue>
  /** Readonly enablement facade over the same runtime that owns this Host's registrations. */
  readonly plugin: IPluginEnablement<this, TInstalled, TDomainCore, TValue>
  /** Candidate publication context used to keep plugin-owned stages off the live pipeline. */
  #activeInstallBatch: IInstallBatchContext<TDomainCore, TValue> | undefined
  /** Functional-entry reader for trusted definitions; absent in the structural entry. */
  #trustedDefinitionReader: ITrustedDefinitionReader | undefined

  constructor(options: IPluginHostOptions, trustedDefinitionReader?: ITrustedDefinitionReader) {
    this.#trustedDefinitionReader = trustedDefinitionReader
    // Validate the mandatory execution policy before reading unrelated options or allocating
    // lifecycle machinery. This preserves fail-fast zero-effect admission for hostile getters.
    const execution = options.execution
    if (execution === null || typeof execution !== 'object')
      throw createPluginHostTypeError('execution must provide mutation and pipeline drain budgets')
    const mutationTimeoutMs = execution.mutationTimeoutMs
    const pipelineDrainTimeoutMs = execution.pipelineDrainTimeoutMs
    assertRequiredTimeoutOption(mutationTimeoutMs, 'mutationTimeoutMs')
    assertRequiredTimeoutOption(pipelineDrainTimeoutMs, 'pipelineDrainTimeoutMs')
    this.identity = issueHostIdentity(this, options.identity?.name)
    this.#pipelineMode = options.pipeline?.mode ?? PluginHostPipelineMode.sync
    if (options.diagnostic !== undefined && typeof options.diagnostic !== 'function')
      throw createPluginHostTypeError('diagnostic must be a function')
    const diagnostic = options.diagnostic ?? defaultDiagnostic
    this.#diagnostic = (message, code) =>
      diagnostic(formatPluginHostDiagnostic(this, message), code)
    this.#enablementRuntime = new PluginHostEnablementRuntime({
      state: this.#state,
      diagnostic: this.#diagnostic
    })
    this.plugin = createPluginHostEnablementFacade<this, TInstalled, TDomainCore, TValue>(
      this.#enablementRuntime,
      {
        assertActive: () => this.#assertActive(),
        assertMutationAllowed: () => this.#assertMutationAllowed(),
        enqueue: (task) => this.#enqueue(task),
        createView: () => this.#createView() as IPluginHostDynamicView<this, TDomainCore, TValue>
      }
    )
    if (
      ![
        PluginHostPipelineMode.sync,
        PluginHostPipelineMode.async,
        PluginHostPipelineMode.generator,
        PluginHostPipelineMode.asyncGenerator
      ].includes(this.#pipelineMode)
    )
      throw attachPluginHostIdentity(
        new PluginHostError(
          PluginHostErrorCode.invalidPipelineMode,
          ERROR_TEXT.INVALID_PIPELINE_MODE
        ),
        this
      )
    // 时间策略统一走 lifecycle scheduler / 可配置阈值（AF-10）。负数/NaN/Infinity 立即 INVALID_OPTION。
    for (const [label, value] of [
      ['queueAdmissionTimeoutMs', options.queueAdmissionTimeoutMs],
      ['queueAdmissionDiagnosticMs', options.queueAdmissionDiagnosticMs],
      ['disposeStepTimeoutMs', options.disposeStepTimeoutMs]
    ] as const)
      assertTimeoutOption(value, label)
    // 只读取一次 scheduler 快照（AF-31）：校验、保存、传给 queue/dispose scope 都用这个局部快照。
    const schedulerOption = options.scheduler
    let schedulerSnapshot: ILifecycleScheduler | undefined
    if (schedulerOption !== undefined) {
      try {
        schedulerSnapshot = snapshotScheduler(schedulerOption)
      } catch (error) {
        const lifecycleCause =
          error && typeof error === 'object' && 'cause' in error
            ? (error as { readonly cause?: unknown }).cause
            : undefined
        throw tagPluginHostError(
          new TypeError(ERROR_TEXT.SCHEDULER_GETTER_FAILED, {
            cause: lifecycleCause !== undefined ? lifecycleCause : error
          }),
          PluginHostErrorCode.invalidOption
        )
      }
      if (schedulerSnapshot === undefined) {
        throw createPluginHostTypeError('scheduler must provide now() and schedule() functions')
      }
    }
    this.#scheduler = schedulerSnapshot ?? systemScheduler
    this.#operationRuntime = new PluginHostOperationRuntime({
      parentSignal: this.#executionController.signal,
      scheduler: this.#scheduler,
      timeoutMs: mutationTimeoutMs,
      isHostOpen: () => this.#terminal.lifecycle === 'open',
      diagnostic: (message) => this.#diagnostic(message)
    })
    this.#cleanupRuntime = new PluginHostCleanupRuntime({
      scheduler: this.#scheduler,
      pending: this.#pending,
      disposeStepTimeoutMs: options.disposeStepTimeoutMs ?? DEFAULT_DISPOSE_STEP_TIMEOUT_MS,
      markAbandoned: () => {
        this.#cleanupAbandoned = true
      },
      wrapDisposalError: (error, phase) => {
        const detail = error instanceof Error ? error.message : String(error)
        return registerPluginHostDisposalNode(
          new PluginHostError(
            PluginHostErrorCode.pluginDisposeFailed,
            ERROR_TEXT.DISPOSER_FAILED(phase, detail),
            { cause: error }
          ),
          { kind: PluginHostDisposalNodeKind.disposerWrapper, phase }
        )
      }
    })
    this.#installRuntime = new PluginHostInstallRuntime({
      scheduler: this.#scheduler,
      snapshotBatch: () => ({
        shared: new Map(this.#state.shared),
        extensionOwners: new Map(this.#state.extensionOwners),
        ...this.#state.lanes.copy(),
        committed: false
      }),
      setActiveBatch: (batch) => {
        this.#activeInstallBatch = batch
      },
      beginOperation: (registration) => {
        this.#operationRuntime.begin(registration)
      },
      createCore: (registration, batch) => this.#coreRuntime.create(registration, batch),
      awaitOperation: (result, registration) => this.#operationRuntime.await(result, registration),
      assertOperationCurrent: (registration) => this.#operationRuntime.assertCurrent(registration),
      setHookRegistration: (registration) => {
        this.#hookRegistration = registration
      },
      publish: (installed, batch) => this.#publishInstallBatch(installed, batch),
      disposeRegistration: (registration, preserveErrorIdentity) =>
        this.#removalRuntime.disposeRegistration(registration, preserveErrorIdentity),
      closeRegistrationSync: (registration, rollbackErrors) =>
        this.#closeRegistrationSync(registration, rollbackErrors),
      diagnostic: this.#diagnostic,
      decorateError: (error) => attachPluginHostIdentity(error, this)
    })
    this.#removalRuntime = new PluginHostRemovalRuntime({
      registrations: this.#state.registrations,
      shared: this.#state.shared,
      retiredShared: this.#state.retiredShared,
      extensionOwners: this.#state.extensionOwners,
      pipelineLeases: this.#pipelineLeases,
      pipelineOwnerKeys: this.#state.lanes.pipelineOwnerKeys,
      stageSlots: this.#state.stageSlots,
      removePipelineOwner: (name) => this.#state.lanes.removeOwner(name),
      host: this,
      executionSignal: this.#executionController.signal,
      cleanupRuntime: this.#cleanupRuntime,
      setHookRegistration: (registration) => {
        this.#hookRegistration = registration
      }
    })
    this.#coreRuntime = new PluginHostCoreRuntime({
      createDomainCore: (request) => this.createPluginDomainCore(request),
      assertRegistrationValid: (registration) =>
        this.#state.assertRegistrationValid(registration, (current) =>
          this.#operationRuntime.assertCurrent(current)
        ),
      committedShared: this.#state.shared,
      executionSignal: this.#executionController.signal,
      pipelineMode: () => this.#pipelineMode,
      onPipelineViolation: this.#onPipelineViolation,
      registerStage: (stage, registration, kind) => this.#registerStage(stage, registration, kind),
      cleanupRuntime: this.#cleanupRuntime
    })
    this.#configRuntime = new PluginHostConfigRuntime({
      registrations: this.#state.registrations,
      assertActive: () => this.#assertActive(),
      enqueue: (task) => this.#enqueue(task),
      beginOperation: (registration) => {
        this.#operationRuntime.begin(registration)
      },
      awaitOperation: (result, registration) => this.#operationRuntime.await(result, registration),
      assertOperationCurrent: (registration) => this.#operationRuntime.assertCurrent(registration),
      setHookRegistration: (registration) => {
        this.#hookRegistration = registration
      },
      createCore: (registration) => this.#coreRuntime.create(registration),
      commitRevision: () => {
        this.#state.commit()
      }
    })
    this.#hostDisposalRuntime = new PluginHostDisposalRuntime({
      terminal: this.#terminal,
      executionController: this.#executionController,
      pipelineLeases: this.#pipelineLeases,
      pending: this.#pending,
      pipelineKey: this.#pipelineKey,
      scheduler: this.#scheduler,
      pipelineDrainTimeoutMs,
      enqueueTerminal: (task) => this.#enqueue(task, true),
      registrationsInReverse: () => [...this.#state.registrations.values()].reverse(),
      disposeRegistration: (registration) => this.#removalRuntime.disposeRegistration(registration),
      clearPipelineState: () => {
        this.#state.lanes.clear()
        for (const slot of this.#state.stageSlots.values()) slot.retired = true
        this.#state.stageSlots.clear()
      },
      resetCleanupAbandoned: () => {
        this.#cleanupAbandoned = false
      },
      isCleanupAbandoned: () => this.#cleanupAbandoned,
      commitRevision: () => {
        this.#state.commit()
      },
      diagnostic: this.#diagnostic
    })
    this.#compositionRuntime = new PluginHostCompositionRuntime({
      host: this,
      scheduler: this.#scheduler,
      pipelineDrainTimeoutMs,
      registrations: this.#state.registrations,
      stageSlots: this.#state.stageSlots,
      allocateStageSlot: () => this.#state.allocateStageSlot(),
      assertActive: () => this.#assertActive(),
      assertMutationAllowed: () => this.#assertMutationAllowed(),
      snapshotPlugins: (plugins) =>
        snapshotPluginDefinitions<TDomainCore, TValue>(plugins, this.#trustedDefinitionReader),
      preflight: (definitions) =>
        preflightPluginDefinitions(definitions, (name) => this.#state.registrations.has(name)),
      enqueue: (task) => this.#enqueue(task),
      installBatch: (entries, publish) => this.#installRuntime.installBatch(entries, publish),
      publish: (installed, batch) => this.#publishInstallBatch(installed, batch),
      revision: () => this.#state.revision,
      commitRevision: () => {
        this.#state.commit()
      },
      disposeRegistration: (registration, preserveErrorIdentity) =>
        this.#removalRuntime.disposeRegistration(registration, preserveErrorIdentity),
      revokeRegistration: (registration) => this.#removalRuntime.revokeRegistration(registration),
      disposeRegistrationStrict: (registration) =>
        this.#removalRuntime.disposeRegistrationStrict(registration),
      createView: () => this.#createView(),
      diagnostic: this.#diagnostic
    })
    this.#pipelineDrainTimeoutMs = pipelineDrainTimeoutMs
    this.#queueAdmissionTimeoutMs = options.queueAdmissionTimeoutMs
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
          : (info) => reportQueueWait(this.#diagnostic, info)
    })
    // 托管协议不再挂在 Host 实例表面：它是组合方专用的出口，放在实例上会让每个普通消费者都看见
    // 八个它永远不该调用的方法。登记发生在构造函数末尾，此时 Host 已完整。
    registerManagedHost(
      this,
      buildManagedPort(
        this.#compositionRuntime as unknown as IPluginHostCompositionIntegration<object>,
        () => this.revision,
        () => this.getCurrentView()
      )
    )
  }

  get pipelineMode(): IPipelineMode {
    this.#assertActive()
    return this.#pipelineMode
  }

  /** Current committed Host mutation receipt; it changes only at publication boundaries. */
  get revision(): number {
    return this.#state.revision
  }

  /** Returns a fresh dynamic view over the currently committed registrations. */
  getCurrentView(): IPluginHostDynamicView<this, TDomainCore, TValue> {
    this.#assertActive()
    return this.#createView() as IPluginHostDynamicView<this>
  }

  #assertActive(): void {
    if (this.#terminal.lifecycle === 'terminal')
      throw attachPluginHostIdentity(
        new PluginHostError(PluginHostErrorCode.hostDisposed, ERROR_TEXT.HOST_DISPOSED),
        this
      )
    if (this.#terminal.lifecycle === 'closing')
      throw attachPluginHostIdentity(
        new PluginHostError(PluginHostErrorCode.hostDisposing, ERROR_TEXT.HOST_DISPOSING),
        this
      )
  }

  /** Retains global and owner leases for the exact stage snapshot about to execute. */
  #retainPipelineLease(stages: readonly Function[]): () => void {
    this.#assertActive()
    return this.#state.lanes.retainLeases(this.#pipelineLeases, this.#pipelineKey, stages)
  }

  #assertMutationAllowed(): void {
    if (this.#hookRegistration)
      throw attachPluginHostIdentity(
        new PluginHostError(PluginHostErrorCode.lifecycleMutation, ERROR_TEXT.LIFECYCLE_MUTATION),
        this
      )
  }

  /** Rethrows a synchronous package error after attributing it to this exact Host. */
  #rethrowWithIdentity(error: unknown): never {
    throw error instanceof PluginHostError ? attachPluginHostIdentity(error, this) : error
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
        const translated = translateQueueRejection(error, this.#queueAdmissionTimeoutMs)
        throw translated instanceof PluginHostError
          ? attachPluginHostIdentity(translated, this)
          : translated
      })
  }

  /**
   * Builds one registration's domain core. The request names the registration it is for; the class
   * entry may ignore it, and the functional entry needs it to tell one batch member from another.
   */
  protected createPluginDomainCore(_request?: IHostCoreConstructionRequest): TDomainCore {
    return {} as TDomainCore
  }

  /**
   * Transforms the final Host disposal error inside the sole disposal Promise. The base Host
   * returns its PluginHostError unchanged; subclasses may translate the boundary error without
   * creating a second lifecycle Promise.
   */
  protected translateDisposalError(error: PluginHostError): Error {
    return error
  }

  /** Preserves this host's identity and diagnostic sink for pipeline contract failures. */
  #onPipelineViolation = createPluginHostPipelineViolationHandler(this, (message, code) =>
    this.#diagnostic(message, code)
  )

  #registerStage(
    stage: Function,
    owner: IRegistration<TDomainCore, TValue> | undefined,
    kind: IPipelineMode
  ): void {
    try {
      this.#state.lanes.register({
        host: this,
        hostMode: this.#pipelineMode,
        kind,
        depth: this.#pipelineDepth,
        stage,
        owner,
        activeBatch: this.#activeInstallBatch,
        stageSlots: this.#state.stageSlots,
        allocateSlot: () => this.#state.allocateStageSlot()
      })
    } catch (error) {
      this.#rethrowWithIdentity(error)
    }
  }

  protected runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void> {
    try {
      return executePluginHostPipeline({
        mode: this.#pipelineMode,
        ...this.#state.lanes.lanes,
        value,
        done,
        onViolation: this.#onPipelineViolation,
        assertActive: () => this.#assertActive(),
        retainLease: (stages) => this.#retainPipelineLease(stages),
        enter: () => {
          this.#pipelineDepth += 1
        },
        leave: () => {
          this.#pipelineDepth -= 1
        },
        pending: this.#pending,
        liveSignal: this.#liveSignal
      })
    } catch (error) {
      this.#rethrowWithIdentity(error)
    }
  }

  /** Host-side pipeline registration for application composition. */
  usePipeline(stage: ISyncPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(
      adaptSyncStageForMode(stage, this.#pipelineMode, this.#onPipelineViolation),
      undefined,
      this.#pipelineMode
    )
    this.#state.commit()
    return this
  }

  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.async)
    this.#state.commit()
    return this
  }

  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.generator)
    this.#state.commit()
    return this
  }

  useAsyncGeneratorPipeline(stage: IAsyncGeneratorPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.asyncGenerator)
    this.#state.commit()
    return this
  }

  getShared<T = unknown>(key: PropertyKey): T | undefined {
    this.#assertActive()
    try {
      return this.#state.getShared<T>(key)
    } catch (error) {
      this.#rethrowWithIdentity(error)
    }
  }

  use<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IPluginConstraintTuple<
        TDomainCore & IPluginHostCore<TValue, IMergePluginShared<TInstalled>>,
        TPlugins
      >
  ): Promise<IPluginHostView<this, [...TInstalled, ...TPlugins], TDomainCore, TValue>> {
    this.#assertActive()
    this.#assertMutationAllowed()
    const definitions = snapshotPluginDefinitions<TDomainCore, TValue>(
      plugins,
      this.#trustedDefinitionReader
    )
    return this.#enqueue(async () => {
      const entries = preflightPluginDefinitions(definitions, (name) =>
        this.#state.registrations.has(name)
      )
      await this.#installRuntime.installBatch(entries)
      return this.#createView<[...TInstalled, ...TPlugins]>()
    })
  }

  /** Installs constructor-time plugins synchronously or throws before the host escapes. */
  protected useSync<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    plugins: readonly IPluginConstraint<any>[]
  ): IPluginHostView<this, TViewPlugins, TDomainCore, TValue> {
    try {
      this.#assertActive()
      this.#assertMutationAllowed()
      const definitions = snapshotPluginDefinitions<TDomainCore, TValue>(
        plugins,
        this.#trustedDefinitionReader
      )
      const entries = preflightPluginDefinitions(definitions, (name) =>
        this.#state.registrations.has(name)
      )
      this.#installRuntime.installBatchSync(entries)
      return this.#createView<TViewPlugins>()
    } catch (error) {
      this.#rethrowWithIdentity(error)
    }
  }

  /** Publishes a fully prepared candidate without invoking user code or allocating state. */
  #publishInstallBatch(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): void {
    this.#state.publishInstallBatch(installed, batch)
    for (const registration of installed) this.#enablementRuntime.notifyInstalled(registration)
  }

  /**
   * Synchronous half of useSync rollback: detaches a registration from all host-visible state
   * without running any user disposer code — matches `LifecycleScope.close()`'s "synchronous,
   * idempotent, never calls user code". The table bookkeeping belongs to `PluginHostState`; what
   * stays here is the part that touches the registration's own scope and lifecycle.
   */
  #closeRegistrationSync(
    registration: IRegistration<TDomainCore, TValue>,
    _rollbackErrors: unknown[] = []
  ): void {
    this.#state.closeRegistration(registration)
    registration.scope?.close()
    registration.lifecycle = PluginHostRegistrationLifecycle.dispose
  }

  /** Rejects access through a stale view after any captured registration is revoked. */
  #assertViewLive(registrations: readonly IRegistration<TDomainCore, TValue>[]): void {
    for (const registration of registrations)
      if (!this.#state.isLive(registration))
        throw attachPluginHostIdentity(
          new PluginHostError(PluginHostErrorCode.viewRevoked, ERROR_TEXT.VIEW_REVOKED),
          this
        )
  }

  /** Materializes a null-prototype, frozen view over the current committed registrations. */
  #createView<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    registrations: readonly IRegistration<TDomainCore, TValue>[] = [
      ...this.#state.registrations.values()
    ]
  ): IPluginHostView<this, TViewPlugins, TDomainCore, TValue> {
    const enabled = registrations.filter((registration) => registration.enabled)
    return createPluginHostPublication<this, TDomainCore, TValue, TViewPlugins>(enabled, {
      host: this,
      assertLive: (captured) => this.#assertViewLive(captured),
      readConfig: (path) => this.config.get(path),
      updateConfig: (name, recipe) => this.config.update(name, recipe),
      getShared: (key) => this.getShared(key),
      use: (plugins) => this.use(...plugins),
      unUse: (name) => this.unUse(name)
    })
  }

  get config(): IPluginHostConfigFor<TInstalled> {
    return this.#configRuntime.getFacade()
  }

  unUse(name: string): Promise<IPluginRemovalResult<IPluginHostDynamicView<this>>> {
    this.#assertActive()
    this.#assertMutationAllowed()
    return this.#enqueue(async () => {
      const registration = this.#state.registrations.get(name)
      if (!registration)
        return Object.freeze({
          ok: true,
          removed: false,
          view: this.#createView() as IPluginHostDynamicView<this>,
          cleanupComplete: true,
          cleanupErrors: Object.freeze([])
        })
      this.#pipelineLeases.seal(registration.pipelineOwnerKey)
      const drain = await drainPipelineLeases({
        leases: this.#pipelineLeases,
        key: registration.pipelineOwnerKey,
        drainTimeoutMs: this.#pipelineDrainTimeoutMs,
        scheduler: this.#scheduler
      })
      const errors = await this.#removalRuntime.disposeRegistration(registration)
      this.#enablementRuntime.forget(name)
      this.#state.commit()
      const view = this.#createView() as IPluginHostDynamicView<this>
      const cleanupErrors = Object.freeze([...errors])
      const cleanupComplete = drain.complete && errors.length === 0
      if (errors.length === 0)
        return Object.freeze({
          ok: true,
          removed: true,
          view,
          cleanupComplete,
          cleanupErrors,
          ...(drain.physicalCompletion ? { physicalCompletion: drain.physicalCompletion } : {})
        })
      const error = registerPluginHostDisposalNode(
        attachPluginHostIdentity(
          new PluginHostError(
            PluginHostErrorCode.pluginDisposeFailed,
            ERROR_TEXT.PLUGIN_DISPOSE_FAILED(name),
            {
              cause: errors[0],
              detail: { errors: Object.freeze([...errors]) }
            }
          ),
          this
        ),
        { kind: PluginHostDisposalNodeKind.hostError, phase: 'plugin disposal' }
      )
      try {
        this.#diagnostic(
          ERROR_TEXT.PLUGIN_DISPOSE_FAILED(name),
          PluginHostErrorCode.pluginDisposeFailed
        )
      } catch {
        // Diagnostics never alter the committed removal result.
      }
      return Object.freeze({
        ok: false,
        removed: true,
        view,
        error,
        cleanupComplete,
        cleanupErrors,
        ...(drain.physicalCompletion ? { physicalCompletion: drain.physicalCompletion } : {})
      })
    })
  }

  /** Completes logical host disposal; concrete consumer facades may narrow the observed result. */
  dispose(): Promise<import('./typing.js').IPluginHostDisposalResult> {
    return this.#hostDisposalRuntime.dispose()
  }
}

if (asyncDisposeKey !== undefined)
  Object.defineProperty(PluginHost.prototype, asyncDisposeKey, {
    configurable: true,
    value(this: PluginHost<object, unknown>) {
      return this.dispose()
    }
  })
