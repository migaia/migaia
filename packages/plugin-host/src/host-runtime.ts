import type { INativeAbortSignal } from '@migaia/utils/promise'
import ERROR_TEXT, {
  attachPluginHostIdentity,
  formatPluginHostDiagnostic,
  PluginHostError,
  createPluginHostTypeError,
  tagPluginHostError,
  PluginHostInternalText
} from './error-text.js'
import { issueHostIdentity, readHostNodeId, type IPluginHostIdentity } from './host-identity.js'
import {
  preflightPluginDefinitions,
  snapshotPluginDefinitions,
  type ITrustedDefinitionReader
} from './admission-runtime.js'
import { PluginHostInstallRuntime, type IInstallBatchContext } from './install-runtime.js'
import { PluginHostErrorCode } from './error-code.js'
import { registerManagedHost, matchesManagedHost } from './composition.js'
import { PluginHostState } from './host-state.js'
import type { IHostCoreConstructionRequest } from './define-host.js'
import { reportQueueWait, translateQueueRejection } from './host-queue.js'
import { drainPipelineLeases } from './pipeline-runtime.js'
import {
  admitHostScheduler,
  assertRequiredTimeoutOption,
  assertTimeoutOption
} from './host-options.js'
import { asyncDisposeKey } from './symbols.js'
import {
  createMutationQueue,
  createAbortController,
  createPendingTracker,
  createTerminalController,
  type IMutationQueue,
  type IAbortController,
  type IPendingTracker,
  type ITerminalController,
  LifecycleState
} from '@migaia/lifecycle'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
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
import { PluginHostPipelines } from './named-pipelines.js'
import {
  PluginHostRuntimeIntegration,
  type IPluginHostRuntimeIntegrationPort
} from './runtime-integration.js'
import type { IPipelineDefinitions, IPipelineOwner } from './pipeline-spec.js'
import { PluginHostRemovalRuntime } from './removal-runtime.js'
import { PluginHostReplaceRuntime } from './replace-runtime.js'
import { PluginHostResumeRuntime } from './resume-runtime.js'
import { bindTerminalSink, reportDiagnostic, reportTerminalFailure } from './diagnostic-report.js'
import { PluginHostOperationRuntime } from './operation-runtime.js'
import {
  MiddlewarePipelineMode,
  type IAsyncGeneratorMiddlewareStage,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineMode,
  type ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'
import {
  DependencyAction,
  DependencyMutationKind,
  planDependencyMutation,
  planTeardown
} from '@migaia/capability/graph/dependency'
import { PluginHostCoreRuntime } from './core-runtime.js'
import { PluginHostConfigRuntime } from './config-runtime.js'
import { PluginHostDisposalRuntime } from './host-disposal-runtime.js'
import type { IPluginHostCompositionRuntimePort } from './composition-runtime.js'
import {
  PluginHostEnablementRuntime,
  createPluginHostEnablementFacade
} from './enablement-runtime.js'
import { createPluginHostPublication } from './publication.js'
import { createPluginHandle } from './plugin-handle.js'
import {
  admitDependencyMutationOptions,
  PluginInactiveProviderPolicy,
  toPluginPlan,
  projectAffected,
  validateInstallBatch
} from './dependency-runtime.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IRegistration } from './registry.js'
import type {
  pluginHostCoreTypes,
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
  IPluginHostOptions,
  IPluginEnablement
} from './typing.js'

/** Type-only invariant marker that preserves constructor-installed tuples through subclasses. */
declare const installedPluginsBrand: unique symbol

/** Module-instance authority for Host-generated disposal nodes; duplicate instances fail closed. */
const pluginHostDisposalProvenance = new WeakMap<object, IPluginHostDisposalProvenance>()

/**
 * Reads frozen producer provenance for a disposal node issued by this package instance. Unknown
 * values return undefined without inspecting properties; matching public fields cannot forge it.
 * Translators can use this distinction without changing the node's original error identity.
 */
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
 * 默认诊断 sink：无副作用 no-op（`defaultDiagnostic = () => {}`）。
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
/**
 * Runtime-neutral owner of plugin registration, configuration, pipeline leases and resource
 * cleanup. Async mutations share a FIFO queue; synchronous owner installation is a separate
 * explicit path. Handles address names, while captured callable views retain exact-generation
 * revocation guards.
 */
class PluginHostConstructor<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  TPipelines extends IPipelineDefinitions = Record<never, never>
> {
  /** Type-only core axes let composition owners retain the exact plugin-facing capabilities. */
  declare readonly [pluginHostCoreTypes]: Readonly<{
    readonly core: TDomainCore
    readonly value: TValue
    readonly pipelines: TPipelines
  }>
  /** Immutable process-local identity used by Host errors and diagnostics. */
  readonly identity: IPluginHostIdentity
  /** Type-only baseline tuple marker; no runtime property is emitted. */
  declare readonly [installedPluginsBrand]: TInstalled
  #terminal: ITerminalController = createTerminalController()
  #executionController: IAbortController = createAbortController()
  #operationRuntime: PluginHostOperationRuntime
  #pending: IPendingTracker = createPendingTracker()
  /**
   * Serial FIFO mutation queue. No owner tag is passed because this boundary has no reliable
   * per-call owner identity for lifecycle's self-dependency guard.
   */
  #queue: IMutationQueue
  #scheduler: IScheduler
  #cleanupRuntime: PluginHostCleanupRuntime
  #installRuntime: PluginHostInstallRuntime<TDomainCore, TValue>
  #removalRuntime: PluginHostRemovalRuntime<TDomainCore, TValue>
  /** Owns hot replacement orchestration over the install and removal runtimes. */
  #replaceRuntime: PluginHostReplaceRuntime<TDomainCore, TValue>
  /** Coordinates suspended-dependent recovery when providers return. */
  #resumeRuntime: PluginHostResumeRuntime<TDomainCore, TValue>
  #coreRuntime: PluginHostCoreRuntime<TDomainCore, TValue>
  #pipelineDrainTimeoutMs: number | false
  /** Optional queue admission deadline; undefined keeps diagnostic-only waiting. */
  #queueAdmissionTimeoutMs: number | false | undefined
  /**
   * Every piece of shared mutable state, in one holder.
   *
   * It is constructed before any runtime, so the ports below carry a reference instead of a closure
   * over a field that may not exist yet — which is what forced the old deferred assignments.
   */
  #state = new PluginHostState<TDomainCore, TValue>()
  #hookRegistration: IRegistration<TDomainCore, TValue> | undefined
  /** Synchronous hook stack only; asynchronous continuations have no portable origin identity. */
  #hookInvocationDepth = 0
  /** Marks the original invocation without wrapping its return value or adding an await turn. */
  #invokeHook = <T>(invoke: () => T): T => {
    this.#hookInvocationDepth += 1
    try {
      return invoke()
    } finally {
      this.#hookInvocationDepth -= 1
    }
  }
  /** Registration currently awaiting setup; blocks synchronous config mutation admission. */
  #setupPending: IRegistration<TDomainCore, TValue> | undefined
  /** Exact registration inside a bounded pre-release hook; config updates reject before enqueue. */
  #releasePending: IRegistration<TDomainCore, TValue> | undefined
  /** Default and named entries share one canonical registration and execution owner. */
  readonly #pipelines: PluginHostPipelines<TDomainCore, TValue>
  #diagnostic: IPluginHostDiagnostic
  /** Real lifecycle signal shared by active pipeline stages and disposal cancellation. */
  #liveSignal: INativeAbortSignal = this.#executionController
    .signal as unknown as INativeAbortSignal
  #configRuntime: PluginHostConfigRuntime<TDomainCore, TValue, TInstalled>
  #hostDisposalRuntime: PluginHostDisposalRuntime<IRegistration<TDomainCore, TValue>>
  #enablementRuntime: PluginHostEnablementRuntime<TDomainCore, TValue>
  /** Readonly enablement facade over the same runtime that owns this Host's registrations. */
  readonly plugin: IPluginEnablement<this, TInstalled, TDomainCore, TValue>
  /** Candidate publication context used to keep plugin-owned stages off the live pipeline. */
  /** Functional-entry reader for trusted definitions; absent in the structural entry. */
  #trustedDefinitionReader: ITrustedDefinitionReader | undefined
  /** Shared activation Promises keyed by lazy registration name. */
  #activationRequests = new Map<string, Promise<IPluginHandle<IPluginConstraint<any>>>>()

  /**
   * Creates an empty Host with required execution budgets. Numeric budgets must be finite and
   * nonnegative; false explicitly waits without a deadline. Pipeline mode defaults to sync,
   * diagnostics to no-op, queue diagnostics to 1000 ms and disposal steps to 5000 ms. Invalid
   * options fail admission; the scheduler defaults to systemScheduler and secure Host identity
   * requires host cryptographic randomness.
   */
  constructor(
    options: IPluginHostOptions<TPipelines>,
    trustedDefinitionReader?: ITrustedDefinitionReader
  ) {
    this.#trustedDefinitionReader = trustedDefinitionReader
    // Validate the mandatory execution policy before reading the remaining options. Field
    // initializers have already created the basic lifecycle and shared-state owners.
    const execution = options.execution
    if (execution === null || typeof execution !== 'object')
      throw createPluginHostTypeError(PluginHostInternalText.EXECUTION_REQUIRED)
    const mutationTimeoutMs = execution.mutationTimeoutMs
    const pipelineDrainTimeoutMs = execution.pipelineDrainTimeoutMs
    assertRequiredTimeoutOption(mutationTimeoutMs, 'mutationTimeoutMs')
    assertRequiredTimeoutOption(pipelineDrainTimeoutMs, 'pipelineDrainTimeoutMs')
    this.identity = issueHostIdentity(this, options.identity?.name)
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
    /** Only a configured native outlet replaces a domain runtime's own default reporter. */
    const domainReport =
      diagnostic === defaultDiagnostic
        ? undefined
        : (error: unknown): void =>
            reportDiagnostic(
              this.#diagnostic,
              PluginHostInternalText.DOMAIN_REPORTED_FAILURE,
              undefined,
              error
            )
    this.#enablementRuntime = new PluginHostEnablementRuntime({
      invokeHook: this.#invokeHook,
      state: this.#state,
      diagnostic: this.#diagnostic
    })
    this.plugin = createPluginHostEnablementFacade<this, TInstalled, TDomainCore, TValue>(
      this.#enablementRuntime,
      {
        assertActive: () => this.#assertActive(),
        assertMutationAllowed: () => this.#assertMutationAllowed(),
        enqueue: (task) => this.#enqueue(task),
        resumeAfterProvider: (provider, generationChanged) =>
          this.#resumeRuntime.resumeAfterProvider(provider, generationChanged)
      }
    )
    this.#pipelines = new PluginHostPipelines(
      {
        host: this,
        signal: this.#liveSignal,
        pending: this.#pending,
        lanes: this.#state.lanes,
        slots: this.#state.stageSlots,
        allocateSlot: () => this.#state.allocateStageSlot(),
        assertActive: () => this.#assertActive(),
        commit: () => this.#state.commit(),
        diagnostic: this.#pipelineDiagnostic
      },
      options.pipeline,
      options.pipelines
    )
    // 时间策略统一走 lifecycle scheduler / 可配置阈值。负数/NaN/Infinity 立即 INVALID_OPTION。
    for (const [label, value] of [
      ['queueAdmissionTimeoutMs', options.queueAdmissionTimeoutMs],
      ['queueAdmissionDiagnosticMs', options.queueAdmissionDiagnosticMs],
      ['disposeStepTimeoutMs', options.disposeStepTimeoutMs]
    ] as const)
      assertTimeoutOption(value, label)
    this.#scheduler = admitHostScheduler(options.scheduler) ?? systemScheduler
    this.#operationRuntime = new PluginHostOperationRuntime({
      parentSignal: this.#executionController.signal,
      scheduler: this.#scheduler,
      timeoutMs: mutationTimeoutMs,
      isHostOpen: () => this.#terminal.lifecycle === LifecycleState.open,
      diagnostic: this.#diagnostic
    })
    /** One admitted cleanup budget shared by the hook context and the bounded disposer. */
    const disposeStepTimeoutMs = options.disposeStepTimeoutMs ?? DEFAULT_DISPOSE_STEP_TIMEOUT_MS
    this.#cleanupRuntime = this.#createCleanupRuntime(disposeStepTimeoutMs)
    this.#removalRuntime = this.#createRemovalRuntime(disposeStepTimeoutMs)
    this.#installRuntime = this.#createInstallRuntime()
    this.#replaceRuntime = new PluginHostReplaceRuntime({
      invokeHook: this.#invokeHook,
      operations: this.#operationRuntime,
      state: this.#state,
      publish: (installed, batch) => this.#publishInstallBatch(installed, batch),
      drainLeases: (registration) => this.#drainRegistrationLeases(registration),
      diagnostic: this.#diagnostic,
      decorateError: (error) => attachPluginHostIdentity(error, this),
      installation: this.#installRuntime,
      removal: this.#removalRuntime,
      enablement: this.#enablementRuntime
    })
    this.#resumeRuntime = new PluginHostResumeRuntime({
      invokeHook: this.#invokeHook,
      operations: this.#operationRuntime,
      state: this.#state,
      drainLeases: (registration) => this.#drainRegistrationLeases(registration),
      diagnostic: this.#diagnostic,
      installation: this.#installRuntime,
      removal: this.#removalRuntime,
      enablement: this.#enablementRuntime
    })
    this.#coreRuntime = this.#createCoreRuntime(domainReport)
    this.#state.configureSharedPublication({
      assertActive: () => this.#assertActive(),
      report: (error) => reportTerminalFailure(error, this.#diagnostic),
      publish: (key) => this.#publishSharedKey(key)
    })
    this.#configRuntime = new PluginHostConfigRuntime({
      invokeHook: this.#invokeHook,
      assertActive: () => this.#assertActive(),
      isSetupPending: () => this.#setupPending !== undefined,
      isReleasePending: () => this.#releasePending !== undefined,
      decorateError: (error) => attachPluginHostIdentity(error, this),
      enqueue: (task) => this.#enqueue(task),
      setHookRegistration: (registration) => {
        this.#hookRegistration = registration
      },
      state: this.#state,
      operations: this.#operationRuntime,
      core: this.#coreRuntime
    })
    this.#hostDisposalRuntime = this.#createDisposalRuntime(pipelineDrainTimeoutMs)
    this.#pipelineDrainTimeoutMs = pipelineDrainTimeoutMs
    this.#queueAdmissionTimeoutMs = options.queueAdmissionTimeoutMs
    this.#queue = this.#createQueue(options)
    // 托管协议不再挂在 Host 实例表面：它是组合方专用的出口，放在实例上会让每个普通消费者都看见
    // 八个它永远不该调用的方法。登记发生在构造函数末尾，此时 Host 已完整。
    registerManagedHost(
      this,
      this.#compositionPort(pipelineDrainTimeoutMs),
      () => this.revision,
      () => {
        this.#assertActive()
        return this.#createView()
      }
    )
  }

  /**
   * Builds the FIFO mutation queue. Queue diagnostics default to 1000 ms; `false` turns them off,
   * and the admission timeout stays optional.
   */
  #createQueue(options: IPluginHostOptions<TPipelines>): IMutationQueue {
    return createMutationQueue({
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
  }

  /** Builds the cleanup owner that bounds each disposer and wraps disposer failures. */
  #createCleanupRuntime(disposeStepTimeoutMs: number | false): PluginHostCleanupRuntime {
    return new PluginHostCleanupRuntime({
      scheduler: this.#scheduler,
      pending: this.#pending,
      disposeStepTimeoutMs,
      reportLateError: (error) =>
        reportDiagnostic(
          this.#diagnostic,
          ERROR_TEXT.HOST_DISPOSING,
          PluginHostErrorCode.cleanupIncomplete,
          error
        ),
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
  }

  /** Builds the removal owner; its hook ports record which registration is releasing. */
  #createRemovalRuntime(
    disposeStepTimeoutMs: number | false
  ): PluginHostRemovalRuntime<TDomainCore, TValue> {
    return new PluginHostRemovalRuntime({
      invokeHook: this.#invokeHook,
      pipelineLeases: this.#state.lanes.leases,
      executionSignal: this.#executionController.signal,
      cleanupRuntime: this.#cleanupRuntime,
      scheduler: this.#scheduler,
      disposeStepTimeoutMs,
      setHookRegistration: (registration) => {
        this.#hookRegistration = registration
      },
      setBeforeReleaseRegistration: (registration) => {
        this.#hookRegistration = registration
        this.#releasePending = registration
      },
      clearBeforeReleaseRegistrationIfOwner: (registration) => {
        if (this.#hookRegistration === registration) this.#hookRegistration = undefined
        if (this.#releasePending === registration) this.#releasePending = undefined
      },
      state: this.#state
    })
  }

  /** Builds the install owner over the already constructed core, operation and removal owners. */
  #createInstallRuntime(): PluginHostInstallRuntime<TDomainCore, TValue> {
    return new PluginHostInstallRuntime({
      invokeHook: this.#invokeHook,
      scheduler: this.#scheduler,
      executionSignal: this.#executionController.signal,
      state: this.#state,
      createCore: (registration, batch) => this.#coreRuntime.create(registration, batch),
      setHookRegistration: (registration) => {
        this.#hookRegistration = registration
      },
      setSetupPending: (registration) => {
        this.#setupPending = registration
      },
      publish: (installed, batch) => this.#publishInstallBatch(installed, batch),
      closeRegistrationSync: (registration, rollbackErrors) =>
        this.#closeRegistrationSync(registration, rollbackErrors),
      diagnostic: this.#diagnostic,
      decorateError: (error) => attachPluginHostIdentity(error, this),
      operations: this.#operationRuntime,
      removal: this.#removalRuntime
    })
  }

  /**
   * Builds the plugin-facing core owner and the one integration port authority it lends to every
   * install-scoped core.
   */
  #createCoreRuntime(
    domainReport: ((error: unknown) => void) | undefined
  ): PluginHostCoreRuntime<TDomainCore, TValue> {
    /** One Host authority shared by every install-scoped integration port this Host issues. */
    const integrationPort: IPluginHostRuntimeIntegrationPort<TDomainCore, TValue> = {
      host: this,
      identity: this.identity,
      nodeId: readHostNodeId(this),
      report: domainReport,
      state: this.#state,
      operations: this.#operationRuntime,
      assertActive: () => this.#assertActive(),
      matchesHost: (host) => matchesManagedHost(host, this),
      createHandle: (name, batch) =>
        this.#createHandle(name, batch) as unknown as ReturnType<
          IPluginHostRuntimeIntegrationPort<TDomainCore, TValue>['createHandle']
        >,
      currentHookRegistration: () => this.#hookRegistration
    }
    return new PluginHostCoreRuntime({
      createDomainCore: (request) => this.createPluginDomainCore(request),
      assertRegistrationValid: (registration) =>
        this.#state.assertRegistrationValid(registration, (current) =>
          this.#operationRuntime.assertCurrent(current)
        ),
      executionSignal: this.#executionController.signal,
      registerStage: (stage, registration, kind) => this.#registerStage(stage, registration, kind),
      pipeline: (name, registration) => {
        const entry = this.#pipelines.named(name)
        return Object.freeze({ use: (stage: Function) => entry.register(stage, registration) })
      },
      cleanupRuntime: this.#cleanupRuntime,
      runtimeIntegration: (registration, batch) =>
        Object.freeze(new PluginHostRuntimeIntegration(integrationPort, registration, batch))
    })
  }

  /** Builds the terminal disposal owner over every runtime it must close. */
  #createDisposalRuntime(
    pipelineDrainTimeoutMs: number | false
  ): PluginHostDisposalRuntime<IRegistration<TDomainCore, TValue>> {
    return new PluginHostDisposalRuntime({
      terminal: this.#terminal,
      executionController: this.#executionController,
      pipelineLeases: this.#state.lanes.leases,
      pending: this.#pending,
      pipelineKeys: this.#pipelines.keys(),
      scheduler: this.#scheduler,
      pipelineDrainTimeoutMs,
      enqueueTerminal: (task) => this.#enqueue(task, true),
      // Dependents are disposed before the providers they captured, independent of install order.
      registrationsInReverse: () => this.#registrationsInReverse(),
      clearPipelineState: () => {
        this.#state.lanes.clear()
        for (const slot of this.#state.stageSlots.values()) slot.retired = true
        this.#state.stageSlots.clear()
      },
      diagnostic: this.#diagnostic,
      state: this.#state,
      removal: this.#removalRuntime
    })
  }

  /** Captures the composition ports now; the composition facade is created only on demand. */
  #compositionPort(
    pipelineDrainTimeoutMs: number | false
  ): IPluginHostCompositionRuntimePort<TDomainCore, TValue> {
    /** Composition captures the original ports now and creates its facade only on public demand. */
    return {
      host: this,
      scheduler: this.#scheduler,
      pipelineDrainTimeoutMs,
      state: this.#state,
      assertActive: () => this.#assertActive(),
      assertMutationAllowed: () => this.#assertMutationAllowed(),
      snapshotPlugins: (plugins) =>
        snapshotPluginDefinitions<TDomainCore, TValue>(plugins, this.#trustedDefinitionReader),
      enqueue: (task) => this.#enqueue(task),
      publish: (installed, batch) => this.#publishInstallBatch(installed, batch),
      createView: () => this.#createView(),
      diagnostic: this.#diagnostic,
      installation: this.#installRuntime,
      removal: this.#removalRuntime
    } satisfies IPluginHostCompositionRuntimePort<TDomainCore, TValue>
  }

  /** Current runner mode; closing or disposed Hosts reject access with their lifecycle code. */
  get pipelineMode(): IMiddlewarePipelineMode {
    this.#assertActive()
    return this.#pipelines.default.mode
  }

  /** Current committed Host mutation receipt; it changes only at publication boundaries. */
  get revision(): number {
    return this.#state.revision
  }

  /** Frozen handles receive only this read port for the same committed shared publication. */
  protected readRuntimeSharedExtension(key: PropertyKey): object | undefined {
    return this.#state.readSharedExtension(key)
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

  #assertMutationAllowed(): void {
    if (this.#hookRegistration || this.#hookInvocationDepth > 0)
      throw attachPluginHostIdentity(
        new PluginHostError(PluginHostErrorCode.lifecycleMutation, ERROR_TEXT.LIFECYCLE_MUTATION),
        this
      )
  }

  /**
   * Publishes one admitted shared-extension key as an enumerable getter on this Host. The getter
   * reads canonical state on each access, so withdrawal and reuse need no second registry. Defining
   * the property fails with the native TypeError when the Host was made non-extensible; that
   * failure keeps its type and gains the install-failure code.
   */
  #publishSharedKey(key: PropertyKey): void {
    if (Object.hasOwn(this, key)) return
    try {
      Object.defineProperty(this, key, {
        enumerable: true,
        configurable: false,
        get: () => this.#state.readSharedExtension(key)
      })
    } catch (error) {
      throw tagPluginHostError(error as TypeError, PluginHostErrorCode.pluginInstallFailed)
    }
  }

  /**
   * Returns committed registrations with dependents before the providers they captured. Admission
   * keeps the dependency graph acyclic, so the teardown plan always exists.
   */
  #registrationsInReverse(): IRegistration<TDomainCore, TValue>[] {
    return planTeardown(this.#state.dependencyIndex()).order.map((name) =>
      this.#state.registrations.get(name)!
    )
  }

  /** Rethrows a synchronous package error after attributing it to this exact Host. */
  #rethrowWithIdentity(error: unknown): never {
    throw error instanceof PluginHostError ? attachPluginHostIdentity(error, this) : error
  }

  /**
   * `terminal` (used only by `dispose()`) passes `queueAdmissionTimeoutMs: false` for this one
   * task, exempting it from the queue SLA — mirrors the original `#mutationQueue`'s "terminal
   * mutations are never evicted" rule.
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
   * Retained protected translation hook, returning the supplied error unchanged by default. The
   * current structured cleanup-result path does not invoke it; overriding it does not translate
   * each cleanupErrors entry or replace the Host's disposal completion protocol.
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

  /** Default registration and typed named registration use the same entry implementation. */
  #registerStage(
    stage: Function,
    owner: IRegistration<TDomainCore, TValue> | undefined,
    kind: IMiddlewarePipelineMode
  ): void {
    this.#pipelines.default.register(stage, owner, kind)
  }

  /** Typed owner authority exposes execution only to the Host's own handle or subclass. */
  protected pipeline<TName extends keyof TPipelines & string>(
    name: TName
  ): IPipelineOwner<TPipelines[TName]> {
    this.#assertActive()
    return this.#pipelines.named(name).owner as IPipelineOwner<TPipelines[TName]>
  }

  /** Default selected-mode execution retains its established public signature. */
  protected runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void> {
    return this.#pipelines.default.runVoid(value, done)
  }

  /** Default synchronous execution uses original sync forms from the same canonical lane. */
  protected runPipelineSync<TResult>(
    value: TValue,
    done: (value: TValue) => TResult
  ): TResult | undefined {
    return this.#pipelines.default.runSync(value, done)
  }

  /** Default asynchronous execution shares snapshots and preserves empty terminal Promise identity. */
  protected runPipelineAsync<TResult>(
    value: TValue,
    done: (value: TValue) => Promise<TResult>
  ): Promise<TResult | undefined> {
    return this.#pipelines.default.runAsync(value, done)
  }

  /**
   * Adds a Host-owned sync stage and advances revision, returning this same Host. Registration
   * during execution throws PIPELINE_EXECUTING; incompatible lifting throws
   * PIPELINE_MODE_MISMATCH.
   */
  usePipeline(stage: ISyncMiddlewareStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, MiddlewarePipelineMode.sync)
    this.#state.commit()
    return this
  }

  /** Adds a Host-owned async stage under the same liveness, execution and mode-lifting guards. */
  useAsyncPipeline(stage: IAsyncMiddlewareStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, MiddlewarePipelineMode.async)
    this.#state.commit()
    return this
  }

  /**
   * Adds a Host-owned generator stage; its return/yield values follow the canonical runner
   * protocol.
   */
  useGeneratorPipeline(stage: IGeneratorMiddlewareStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, MiddlewarePipelineMode.generator)
    this.#state.commit()
    return this
  }

  /** Adds a Host-owned async-generator stage; new runs see it only after registration commits. */
  useAsyncGeneratorPipeline(stage: IAsyncGeneratorMiddlewareStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, MiddlewarePipelineMode.asyncGenerator)
    this.#state.commit()
    return this
  }

  /**
   * Captures input definitions now, then queues atomic installation and returns frozen handles in
   * input order. Dependencies determine execution order; eager consumers activate needed lazy
   * providers. Preflight failure runs no install hooks. Later construction failure rolls back this
   * batch in reverse order, retaining the primary cause under PLUGIN_INSTALL_FAILED and rollback
   * details; previously committed registrations remain installed.
   */
  use<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins &
      IUniquePluginNames<TPlugins> &
      IPluginConstraintTuple<TDomainCore & IPluginHostCore<TValue>, TPlugins, TInstalled>
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
      const { activationOrder } = this.#validateBatch(entries, PluginInactiveProviderPolicy.admit)
      /** Committed lazy providers selected by capability's activation plan. */
      const activation = activationOrder.map((name) => this.#state.registrations.get(name)!)
      // Only await when something activates: install must otherwise start in this same turn so
      // the lifecycle-mutation guard observes the running hook synchronously.
      if (activation.length > 0) await this.#activateInOrder(activation)
      await this.#installRuntime.installBatch(entries)
      for (const entry of entries) await this.#resumeRuntime.resumeAfterProvider(entry.name, true)
      return Object.freeze(
        entries.map((entry) => this.#createHandle(entry.name))
      ) as IPluginHandleTuple<TPlugins>
    })
  }

  /**
   * Activates a lazy registration and required lazy providers, sharing one pending Promise per
   * name. Missing, disabled or suspended targets fail explicitly. Failed attempts clean up and may
   * be retried; success returns a name-addressed handle. Do not await this activation from itself.
   */
  activate(name: string): Promise<IPluginHandle<IPluginConstraint<any>>> {
    this.#assertActive()
    // Direct hook nesting must reject before coalescing. After an await, callers share the
    // request regardless of origin; a finite operation deadline bounds any resulting self-wait.
    if (this.#hookInvocationDepth > 0) this.#assertMutationAllowed()
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
      if (registration.suspended)
        throw new PluginHostError(
          PluginHostErrorCode.pluginSuspended,
          ERROR_TEXT.PLUGIN_SUSPENDED(name)
        )
      if (!registration.activated) {
        // Validate first so a rejected activation leaves every lazy provider untouched; then
        // activate the lazy provider chain providers-first before this registration.
        const { activationOrder } = this.#validateBatch(
          [{ name, plugin: registration.plugin }],
          PluginInactiveProviderPolicy.admit,
          [name]
        )
        await this.#activateInOrder(
          activationOrder.map((provider) => this.#state.registrations.get(provider)!)
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

  /**
   * Installs a same-name replacement before revoking the previous generation. Candidate failure
   * leaves the old provider live; after publication, dependent rebind/restart failures do not roll
   * the new provider back. Old captured callable extensions reject, while name-addressed handles
   * resolve the successor. Names that differ reject with REPLACE_NAME_MISMATCH before enqueue.
   */
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
      if (previous.suspended)
        throw new PluginHostError(
          PluginHostErrorCode.pluginSuspended,
          ERROR_TEXT.PLUGIN_SUSPENDED(name)
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
      for (const entry of entries) {
        if (this.#resumeRuntime.planAfterProvider(entry.name, true).steps.length === 0) continue
        // Recovery drains, disposes and reinstalls registrations, so it must run inside the
        // mutation queue like every other structural change instead of racing queued mutations.
        /** Queued recovery for this entry; failures are reported, never rethrown to the caller. */
        const task = this.#enqueue(() =>
          this.#resumeRuntime.resumeAfterProvider(entry.name, true)
        ).catch((error) => {
          reportDiagnostic(
            this.#diagnostic,
            ERROR_TEXT.DEPENDENT_RESTART_FAILED(entry.name, []),
            PluginHostErrorCode.dependentRestartFailed,
            error
          )
        })
        this.#pending.track(task)
      }
      return Object.freeze(
        entries.map((entry) => this.#createHandle(entry.name))
      ) as IPluginHandleTuple<TViewPlugins>
    } catch (error) {
      this.#rethrowWithIdentity(error)
    }
  }

  /**
   * Validates one batch's dependency prerequisites against committed state without side effects.
   * Existing same-name nodes are projected with transaction-local dependencies for activation and
   * replacement validation.
   */
  #validateBatch(
    entries: readonly import('./registry.js').IInstallEntry<TDomainCore, TValue>[],
    inactive: PluginInactiveProviderPolicy,
    activationRoots?: readonly string[]
  ): ReturnType<typeof validateInstallBatch<TDomainCore, TValue>> {
    try {
      return validateInstallBatch(entries, this.#state, inactive, activationRoots)
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
  async #drainRegistrationLeases(
    registration: IRegistration<TDomainCore, TValue>,
    cleanupErrors?: unknown[]
  ): Promise<void> {
    this.#state.lanes.retireLeaseOwner(registration, this.#state.lanes.leases)
    /** The existing drain result distinguishes physical completion from bounded continuation. */
    const result = await drainPipelineLeases({
      leases: this.#state.lanes.leases,
      key: registration.pipelineOwnerKey,
      drainTimeoutMs: this.#pipelineDrainTimeoutMs,
      scheduler: this.#scheduler
    })
    if (!result.complete) {
      /** Reuse the caller's existing cleanup accumulator; every caller also gets the diagnostic. */
      const error = attachPluginHostIdentity(
        new PluginHostError(
          PluginHostErrorCode.pipelineDrainTimeout,
          ERROR_TEXT.PIPELINE_DRAIN_TIMEOUT(this.#pipelineDrainTimeoutMs as number)
        ),
        this
      )
      cleanupErrors?.push(error)
      reportDiagnostic(
        this.#diagnostic,
        error.message,
        PluginHostErrorCode.pipelineDrainTimeout,
        error
      )
    }
  }

  /** Preparing Feature reads may see their original batch; committed handles resolve live state. */
  #createHandle<TPlugin extends IPluginConstraint<any>>(
    name: string,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ): IPluginHandle<TPlugin> {
    return createPluginHandle(name, {
      host: this,
      assertActive: () => this.#assertActive(),
      lookup: (pluginName) =>
        (batch && !batch.committed ? batch.registrations.get(pluginName) : undefined) ??
        this.#state.registrations.get(pluginName),
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
    rollbackErrors: unknown[] = []
  ): void {
    this.#state.lanes.retireLeaseOwner(registration, this.#state.lanes.leases)
    for (const detach of [...registration.pipelineDisposers].reverse()) {
      try {
        detach()
      } catch (error) {
        rollbackErrors.push(error)
      }
    }
    registration.pipelineDisposers = []
    registration.stageEntries.clear()
    this.#state.closeRegistration(registration)
    registration.extensions = []
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
      updateConfig: (name, recipe) => this.config.update(name, recipe),
      readSharedExtensions: () => {
        /** Existing publication reads one committed facade per shared key, never one per member. */
        const shared = new Map<PropertyKey, object>()
        for (const key of this.#state.extensionOwners.keys()) {
          /** Ordinary exclusive extensions retain their original exact-registration publication. */
          const facade = this.#state.readSharedExtension(key)
          if (facade) shared.set(key, facade)
        }
        return shared
      }
    })
  }

  /** Stable config facade; each read/update still checks current Host and registration state. */
  get config(): IPluginHostConfigFor<TInstalled> {
    return this.#configRuntime.getFacade()
  }

  /** Plans dependency-safe removal without revoking registrations or changing revision. */
  unUse(
    name: string,
    options: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  /**
   * Removes according to default reject, cascade or suspend policy; returns actual affected
   * changes.
   */
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
      /** Validated breaking option shape and default reject policy. */
      const admitted = admitDependencyMutationOptions(options)
      /** Capability-owned dependency decision for this exact committed state. */
      const plan = planDependencyMutation(
        this.#state.dependencyIndex(),
        (pluginName) => this.#state.readDependencyState(pluginName),
        {
          roots: [name],
          kind: DependencyMutationKind.remove,
          policy: admitted.policy
        }
      )
      if (plan.blockedBy.length > 0)
        throw new PluginHostError(
          PluginHostErrorCode.dependencyBlocked,
          ERROR_TEXT.DEPENDENCY_BLOCKED(name),
          { detail: { blockedBy: plan.blockedBy } }
        )
      if (admitted.dryRun) return toPluginPlan(plan, admitted.policy)
      const cleanupErrors: unknown[] = []
      /** Names whose planned removal or suspension actually changed this Host. */
      const applied: string[] = []
      try {
        for (const step of plan.steps) {
          const registration = this.#state.registrations.get(step.id)
          if (!registration) continue
          try {
            if (step.action === DependencyAction.suspend) {
              if (this.#enablementRuntime.suspend(registration)) applied.push(step.id)
              continue
            }
            if (step.action !== DependencyAction.release) continue
            const beforeRelease = this.#removalRuntime.runBeforeRelease(registration)
            if (beforeRelease) cleanupErrors.push(...(await beforeRelease).cleanupErrors)
            await this.#drainRegistrationLeases(registration, cleanupErrors)
            cleanupErrors.push(
              ...(await this.#removalRuntime.disposeRegistration(registration)).cleanupErrors
            )
            this.#enablementRuntime.forget(step.id)
            this.#state.removedNames.add(step.id)
            applied.push(step.id)
          } catch (error) {
            cleanupErrors.push(error)
            if (step.action === DependencyAction.release && !this.#state.registrations.has(step.id))
              applied.push(step.id)
          }
        }
      } finally {
        this.#state.commit()
      }
      const affected = projectAffected(plan, applied, admitted.policy)
      return cleanupErrors.length === 0
        ? Object.freeze({ ok: true as const, affected })
        : Object.freeze({ ok: false as const, errors: Object.freeze(cleanupErrors), affected })
    })
  }

  /**
   * Closes admission immediately, signals running stages and returns the same Promise on every
   * call. Default runtime cleanup returns logicalTerminal/cleanupErrors; incomplete physical work
   * is exposed through physicalCompletion rather than treated as forcibly stopped. Cleanup failure
   * does not reopen the Host. Functional defineHost middleware can separately reject its chain.
   */
  dispose(): Promise<import('./typing.js').IPluginHostDisposalResult> {
    return this.#hostDisposalRuntime.dispose()
  }
}

/** Set up the optional native disposal method only when the public constructor is retained. */
function initializePluginHost(): typeof PluginHostConstructor {
  /** Keep constructor reflection stable for consumers and diagnostic tooling. */
  const name = 'PluginHost'
  Object.defineProperty(PluginHostConstructor, 'name', { configurable: true, value: name })
  if (asyncDisposeKey !== undefined)
    Object.defineProperty(PluginHostConstructor.prototype, asyncDisposeKey, {
      configurable: true,
      value(this: PluginHost<object, unknown>) {
        return this.dispose()
      }
    })
  return PluginHostConstructor
}

/** Public constructor keeps its generic axes while unused applications can discard setup. */
export const PluginHost = /* @__PURE__ */ initializePluginHost()
/** Instance type preserves the implementation's exact lifecycle and private-state identity. */
export type PluginHost<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  TPipelines extends IPipelineDefinitions = Record<never, never>
> = PluginHostConstructor<TDomainCore, TValue, TInstalled, TPipelines>
