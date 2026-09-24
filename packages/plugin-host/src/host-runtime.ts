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
import { PluginHostReplaceRuntime } from './replace-runtime.js'
import { bindTerminalSink, reportDiagnostic } from './diagnostic-report.js'
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
import { createPluginHandle } from './plugin-handle.js'
import {
  collectLazyActivationOrder,
  orderPluginInstallBatch,
  planPluginDependencyMutation,
  PluginInactiveProviderPolicy,
  readPluginBlockers,
  resolveBatchInstallSet
} from './dependency-runtime.js'
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
  IPluginHostDiagnostic,
  IPluginHandle,
  IPluginHandleTuple,
  IUniquePluginNames,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IPluginRemoval,
  IPluginHostCompositionSnapshot,
  IPluginHostCompositionIntegration,
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
export class PluginHost<
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
  /** Owns hot replacement orchestration over the install and removal runtimes. */
  #replaceRuntime: PluginHostReplaceRuntime<TDomainCore, TValue>
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
  #diagnostic: IPluginHostDiagnostic
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
  /** Shared activation Promises keyed by lazy registration name. */
  #activationRequests = new Map<string, Promise<IPluginHandle<IPluginConstraint<any>>>>()

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
      throw createPluginHostTypeError(ERROR_TEXT.DIAGNOSTIC_OPTION)
    const onDiagnosticFailure = options.onDiagnosticFailure
    if (onDiagnosticFailure !== undefined && typeof onDiagnosticFailure !== 'function')
      throw createPluginHostTypeError(ERROR_TEXT.DIAGNOSTIC_FAILURE_OPTION)
    const diagnostic = options.diagnostic ?? defaultDiagnostic
    this.#diagnostic = (message, code, error) =>
      error === undefined
        ? diagnostic(formatPluginHostDiagnostic(this, message), code)
        : diagnostic(formatPluginHostDiagnostic(this, message), code, error)
    if (onDiagnosticFailure) {
      bindTerminalSink(this.#diagnostic, onDiagnosticFailure)
      bindTerminalSink(this.#pipelineDiagnostic, onDiagnosticFailure)
    }
    this.#enablementRuntime = new PluginHostEnablementRuntime({
      state: this.#state,
      diagnostic: this.#diagnostic
    })
    this.plugin = createPluginHostEnablementFacade<this, TInstalled, TDomainCore, TValue>(
      this.#enablementRuntime,
      {
        assertActive: () => this.#assertActive(),
        assertMutationAllowed: () => this.#assertMutationAllowed(),
        enqueue: (task) => this.#enqueue(task)
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
      diagnostic: this.#diagnostic
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
      committedRegistrations: this.#state.registrations,
      snapshotBatch: () => ({
        registrations: new Map(this.#state.registrations),
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
      removedNames: this.#state.removedNames,
      diagnostic: this.#diagnostic,
      decorateError: (error) => attachPluginHostIdentity(error, this)
    })
    this.#removalRuntime = new PluginHostRemovalRuntime({
      registrations: this.#state.registrations,
      extensionOwners: this.#state.extensionOwners,
      pipelineLeases: this.#pipelineLeases,
      pipelineOwnerKeys: this.#state.lanes.pipelineOwnerKeys,
      stageSlots: this.#state.stageSlots,
      removePipelineOwner: (registration) => this.#state.lanes.removeOwner(registration),
      host: this,
      executionSignal: this.#executionController.signal,
      cleanupRuntime: this.#cleanupRuntime,
      setHookRegistration: (registration) => {
        this.#hookRegistration = registration
      }
    })
    this.#replaceRuntime = new PluginHostReplaceRuntime({
      registrations: this.#state.registrations,
      installBatch: (entries, publish, prepareBatch) =>
        this.#installRuntime.installBatch(entries, publish, prepareBatch),
      publish: (installed, batch) => this.#publishInstallBatch(installed, batch),
      drainLeases: (registration) => this.#drainRegistrationLeases(registration),
      disposeRegistration: (registration) => this.#removalRuntime.disposeRegistration(registration),
      activate: (registration) => this.#installRuntime.activate(registration),
      disable: (registration) => {
        this.#enablementRuntime.disable(registration)
      },
      markRemoved: (name) => {
        this.#state.removedNames.add(name)
      },
      forget: (name) => this.#enablementRuntime.forget(name),
      settle: () => {
        this.#state.lanes.rebuild(this.#state.enabledRegistrations(), this.#state.stageSlots)
        this.#state.commit()
      },
      diagnostic: this.#diagnostic,
      decorateError: (error) => attachPluginHostIdentity(error, this)
    })
    this.#coreRuntime = new PluginHostCoreRuntime({
      createDomainCore: (request) => this.createPluginDomainCore(request),
      assertRegistrationValid: (registration) =>
        this.#state.assertRegistrationValid(registration, (current) =>
          this.#operationRuntime.assertCurrent(current)
        ),
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
      // Dependents are disposed before the providers they captured, independent of install order.
      registrationsInReverse: () => {
        try {
          return planPluginDependencyMutation(
            [...this.#state.registrations.keys()],
            this.#state.registrations
          ).order.map((name) => this.#state.registrations.get(name)!)
        } catch (error) {
          // Terminal disposal must always proceed; admission keeps the graph acyclic, so this
          // fallback (reverse install order) only guards an invariant breach, which is reported.
          reportDiagnostic(
            this.#diagnostic,
            ERROR_TEXT.DEPENDENCY_CYCLE,
            PluginHostErrorCode.dependencyCycle,
            error
          )
          return [...this.#state.registrations.values()].reverse()
        }
      },
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
      markRemoved: (name) => {
        this.#state.removedNames.add(name)
      },
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
        () => {
          this.#assertActive()
          return this.#createView()
        }
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
  /**
   * Late-bound diagnostic used by the pipeline violation handler, which is created during field
   * initialization before `#diagnostic` exists; bound to the same terminal sink in the
   * constructor.
   */
  #pipelineDiagnostic: IPluginHostDiagnostic = (message, code, error) =>
    this.#diagnostic(message, code, error)

  #onPipelineViolation = createPluginHostPipelineViolationHandler(this, this.#pipelineDiagnostic)

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

  use<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IUniquePluginNames<TPlugins> &
      IPluginConstraintTuple<TDomainCore & IPluginHostCore<TValue>, TPlugins>
  ): Promise<IPluginHandleTuple<TPlugins>> {
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
      // Validate every prerequisite before activating anything, so a rejected batch has no
      // activation side effect; then activate only the committed lazy providers that members
      // installing now actually require (lazy members stay lazy).
      const ordered = this.#validateBatch(entries, PluginInactiveProviderPolicy.admit)
      const installSet = resolveBatchInstallSet(ordered)
      const activation = collectLazyActivationOrder(
        ordered.filter((entry) => installSet.has(entry.name)).map((entry) => entry.plugin),
        this.#state.registrations
      )
      // Only await when something activates: install must otherwise start in this same turn so
      // the lifecycle-mutation guard observes the running hook synchronously.
      if (activation.length > 0) await this.#activateInOrder(activation)
      await this.#installRuntime.installBatch(entries)
      return Object.freeze(
        entries.map((entry) => this.#createHandle(entry.name))
      ) as IPluginHandleTuple<TPlugins>
    })
  }

  /** Explicitly activates one lazy plugin; concurrent callers receive one Promise identity. */
  activate(name: string): Promise<IPluginHandle<IPluginConstraint<any>>> {
    this.#assertActive()
    const current = this.#activationRequests.get(name)
    if (current) return current
    this.#assertMutationAllowed()
    const activation = this.#enqueue(async () => {
      const registration = this.#state.registrations.get(name)
      if (!registration)
        throw new PluginHostError(
          PluginHostErrorCode.pluginNotInstalled,
          ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
        )
      if (!registration.enabled)
        throw new PluginHostError(
          PluginHostErrorCode.pluginDisabled,
          ERROR_TEXT.PLUGIN_DISABLED(name)
        )
      if (!registration.activated) {
        // Validate first so a rejected activation leaves every lazy provider untouched; then
        // activate the lazy provider chain providers-first before this registration.
        this.#validateBatch(
          [{ name, plugin: registration.plugin }],
          PluginInactiveProviderPolicy.admit,
          name
        )
        await this.#activateInOrder(
          collectLazyActivationOrder([registration.plugin], this.#state.registrations)
        )
        await this.#installRuntime.activate(registration)
      }
      return this.#createHandle(name)
    }).finally(() => {
      this.#activationRequests.delete(name)
    })
    this.#activationRequests.set(name, activation)
    return activation
  }

  /** Atomically installs a replacement before revoking the previous registration generation. */
  replace<TPlugin extends IPluginConstraint<any>>(
    name: string,
    next: TPlugin
  ): Promise<IPluginHandle<TPlugin>> {
    this.#assertActive()
    this.#assertMutationAllowed()
    const definitions = snapshotPluginDefinitions<TDomainCore, TValue>(
      [next],
      this.#trustedDefinitionReader
    )
    const definition = definitions[0]!
    if (definition.name !== name)
      return Promise.reject(
        new PluginHostError(
          PluginHostErrorCode.replaceNameMismatch,
          ERROR_TEXT.REPLACE_NAME_MISMATCH(name, definition.name)
        )
      )
    return this.#enqueue(async () => {
      const previous = this.#state.registrations.get(name)
      if (!previous)
        throw new PluginHostError(
          PluginHostErrorCode.pluginNotInstalled,
          ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
        )
      await this.#replaceRuntime.replace(previous, definition)
      return this.#createHandle<TPlugin>(name)
    })
  }

  /** Installs constructor-time plugins synchronously or throws before the host escapes. */
  protected useSync<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    plugins: readonly IPluginConstraint<any>[]
  ): IPluginHandleTuple<TViewPlugins> {
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
      return Object.freeze(
        entries.map((entry) => this.#createHandle(entry.name))
      ) as IPluginHandleTuple<TViewPlugins>
    } catch (error) {
      this.#rethrowWithIdentity(error)
    }
  }

  /**
   * Validates one batch's dependency prerequisites against committed state without side effects.
   * `self` excludes an already-committed registration that is being activated in place.
   */
  #validateBatch(
    entries: readonly import('./registry.js').IInstallEntry<TDomainCore, TValue>[],
    inactive: PluginInactiveProviderPolicy,
    self?: string
  ): readonly import('./registry.js').IInstallEntry<TDomainCore, TValue>[] {
    const committed =
      self === undefined
        ? this.#state.registrations
        : new Map([...this.#state.registrations].filter(([name]) => name !== self))
    try {
      return orderPluginInstallBatch(entries, committed, this.#state.removedNames, inactive)
    } catch (error) {
      this.#rethrowWithIdentity(error)
    }
  }

  /** Activates committed lazy registrations in the given provider-first order. */
  async #activateInOrder(
    registrations: readonly IRegistration<TDomainCore, TValue>[]
  ): Promise<void> {
    for (const registration of registrations)
      if (!registration.activated) await this.#installRuntime.activate(registration)
  }

  /** Seals one registration's pipeline owner and waits for its active leases to drain. */
  async #drainRegistrationLeases(registration: IRegistration<TDomainCore, TValue>): Promise<void> {
    this.#pipelineLeases.seal(registration.pipelineOwnerKey)
    await drainPipelineLeases({
      leases: this.#pipelineLeases,
      key: registration.pipelineOwnerKey,
      drainTimeoutMs: this.#pipelineDrainTimeoutMs,
      scheduler: this.#scheduler
    })
  }

  /** Creates a live name-addressed handle over the current registration generation. */
  #createHandle<TPlugin extends IPluginConstraint<any>>(name: string): IPluginHandle<TPlugin> {
    return createPluginHandle(name, {
      host: this,
      assertActive: () => this.#assertActive(),
      lookup: (pluginName) => this.#state.registrations.get(pluginName),
      readConfig: (pluginName) => this.config.get(pluginName),
      updateConfig: (pluginName, recipe) => this.config.update(pluginName, recipe)
    }) as IPluginHandle<TPlugin>
  }

  /** Publishes a fully prepared candidate without invoking user code or allocating state. */
  #publishInstallBatch(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): void {
    this.#state.publishInstallBatch(installed, batch)
    for (const registration of installed)
      if (registration.activated) this.#enablementRuntime.notifyInstalled(registration)
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
          new PluginHostError(
            PluginHostErrorCode.registrationRevoked,
            ERROR_TEXT.REGISTRATION_REVOKED
          ),
          this
        )
  }

  /** Materializes a null-prototype, frozen view over the current committed registrations. */
  #createView(
    registrations: readonly IRegistration<TDomainCore, TValue>[] = [
      ...this.#state.registrations.values()
    ]
  ): IPluginHostCompositionSnapshot {
    const enabled = registrations.filter((registration) => registration.enabled)
    return createPluginHostPublication<this, TDomainCore, TValue>(enabled, {
      host: this,
      assertLive: (captured) => this.#assertViewLive(captured),
      readConfig: (path) => this.config.get(path),
      updateConfig: (name, recipe) => this.config.update(name, recipe)
    })
  }

  get config(): IPluginHostConfigFor<TInstalled> {
    return this.#configRuntime.getFacade()
  }

  unUse(
    name: string,
    options: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  unUse(
    name: string,
    options?: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun?: false }>
  ): Promise<IPluginRemoval>
  unUse(
    name: string,
    options: IPluginDependencyMutationOptions = {}
  ): Promise<IPluginRemoval | IPluginDependencyPlan> {
    this.#assertActive()
    this.#assertMutationAllowed()
    return this.#enqueue(async () => {
      if (!this.#state.registrations.has(name))
        throw new PluginHostError(
          PluginHostErrorCode.pluginNotInstalled,
          ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
        )
      const blockedBy = readPluginBlockers(name, this.#state.registrations)
      if (blockedBy.length > 0 && !options.cascade)
        throw new PluginHostError(
          PluginHostErrorCode.dependencyBlocked,
          ERROR_TEXT.DEPENDENCY_BLOCKED(name),
          { detail: { blockedBy } }
        )
      const { order, edges } = planPluginDependencyMutation(name, this.#state.registrations)
      if (options.dryRun) return Object.freeze({ order, edges })
      const cleanupErrors: unknown[] = []
      for (const pluginName of order) {
        const registration = this.#state.registrations.get(pluginName)
        if (!registration) continue
        await this.#drainRegistrationLeases(registration)
        cleanupErrors.push(...(await this.#removalRuntime.disposeRegistration(registration)))
        this.#enablementRuntime.forget(pluginName)
        this.#state.removedNames.add(pluginName)
      }
      this.#state.commit()
      return cleanupErrors.length === 0
        ? Object.freeze({ ok: true as const })
        : Object.freeze({ ok: false as const, errors: Object.freeze(cleanupErrors) })
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
