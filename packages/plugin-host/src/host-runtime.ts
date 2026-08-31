import ERROR_TEXT, {
  PluginHostError,
  createPluginHostTypeError,
  tagPluginHostError
} from './error-text.js'
import {
  preflightPluginDefinitions,
  snapshotPluginDefinitions,
  type ITrustedDefinitionReader
} from './admission-runtime.js'
import { PluginHostInstallRuntime, type IInstallBatchContext } from './install-runtime.js'
import { PluginHostErrorCode } from './error-code.js'
import { asyncDisposeKey } from './disposal.js'
import {
  createMutationQueue,
  boundedWait,
  createAbortController,
  createPendingTracker,
  createQuiescenceTracker,
  createTerminalController,
  LifecycleErrorCode,
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
import {
  adaptSyncStageToAsync,
  adaptSyncStageToAsyncGenerator,
  adaptSyncStageToGenerator
} from './pipeline.js'
import { executePluginHostPipeline, registerPluginHostStage } from './pipeline-runtime.js'
import { PluginHostRemovalRuntime } from './removal-runtime.js'
import { PluginHostOperationRuntime } from './operation-runtime.js'
import type { IMiddlewarePipelineAbortSignal } from '@migaia/middleware-pipeline'
import { PluginHostCoreRuntime } from './core-runtime.js'
import { PluginHostConfigRuntime } from './config-runtime.js'
import { PluginHostDisposalRuntime } from './host-disposal-runtime.js'
import { PluginHostCompositionRuntime } from './composition-runtime.js'
import { type IDataOrderSlotState } from './composition.js'
import { createPluginHostPublication } from './publication.js'
import {
  PluginHostPipelineMode,
  PluginHostPipelineViolation,
  PluginHostRegistrationLifecycle
} from './state-constants.js'
import type { IRegistration, ISharedEntry } from './registry.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPluginConstraint,
  IPluginHostCore,
  IPluginHostConfigFor,
  IPluginHostErrorCode,
  IPluginHostView,
  IPluginHostDynamicView,
  IPluginRemovalResult,
  IMergePluginShared,
  IPluginHostOptions,
  IPluginAdmissionRequest,
  IPluginPreparedAdmissions,
  IPluginPreparedRemovalBatch,
  IPluginRegistrationReceipt,
  IPluginBatchRemovalOptions,
  IPluginBatchRemovalResult,
  IPluginHostPhysicalCleanupResult,
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
/** 校验可配置超时：`undefined`/`false` 合法；number 必须有限非负（AF-10）。 */
const assertTimeoutOption = (value: number | false | undefined, label: string): void => {
  if (value === undefined || value === false) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw createPluginHostTypeError(`${label} must be false or a non-negative finite number`)
  }
}
/** Rejects an omitted mandatory execution budget before any unrelated option is observed. */
const assertRequiredTimeoutOption = (value: number | false | undefined, label: string): void => {
  if (value === undefined)
    throw createPluginHostTypeError(
      `${label} must be provided as false or a non-negative finite number`
    )
  assertTimeoutOption(value, label)
}

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
  /** Type-only baseline tuple marker; no runtime property is emitted. */
  declare readonly [installedPluginsBrand]: TInstalled
  #terminal: ITerminalController = createTerminalController()
  #executionController: IAbortController = createAbortController()
  #operationRuntime: PluginHostOperationRuntime
  #pipelineLeases: IQuiescenceTracker<object> = createQuiescenceTracker<object>()
  #pending: IPendingTracker = createPendingTracker()
  #pipelineKey: object = {}
  /** Stable quiescence keys allow removal to drain only the revoked plugin's stages. */
  #pipelineOwnerKeys = new Map<string, object>()
  /**
   * Serial FIFO admission queue for every external mutation, ported off the hand-rolled
   * `#mutationQueue`/`#armQueueWatchdog` onto `@migaia/lifecycle`'s `createMutationQueue`. No
   * `owner` tag is passed to `enqueue()` — an earlier adversarial pass (see hardening-regressions
   * `#4`/PH-R3-1) found no reliable per-call owner identity here that would let self-dependency
   * detection reject a genuine self-await without also risking a legitimate queued mutation; the
   * queue's owner-self-dependency guard is therefore intentionally unused at this call site.
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
  #registrations = new Map<string, IRegistration<TDomainCore, TValue>>()
  #shared = new Map<PropertyKey, ISharedEntry<TDomainCore, TValue>>()
  /** Registration owner for each immutable extension view slot. */
  #extensionOwners = new Map<PropertyKey, IRegistration<TDomainCore, TValue>>()
  #hookRegistration: IRegistration<TDomainCore, TValue> | undefined
  #pipelineMode: IPipelineMode
  #diagnostic: (message: string, code?: IPluginHostErrorCode) => void
  #syncStages: ISyncPipelineStage<TValue>[] = []
  #asyncStages: IAsyncPipelineStage<TValue>[] = []
  #generatorStages: IGeneratorPipelineStage<TValue>[] = []
  #asyncGeneratorStages: IAsyncGeneratorPipelineStage<TValue>[] = []
  /** Live definition lanes; replacement/restart retain the handle while delete retires it. */
  #stageSlots = new Map<string, IDataOrderSlotState>()
  /** Next Host-owned slot for a never-before-seen plugin name. */
  #nextStageSlot = 0n
  /** Owner provenance for committed and candidate stage functions. */
  #stageOwners = new WeakMap<Function, string>()
  /**
   * Structural abort signal reflecting host disposal state, used only to give async-generator
   * pipeline runs the same "stop if the host died mid-flight" protection that async mode gets via
   * `assertActive`. Middleware-pipeline's async-generator runner only polls `aborted`/`reason` — it
   * never calls `addEventListener`, so those two methods are never actually invoked.
   *
   * `reason` returns the same `PluginHostError('HOST_DISPOSING' | 'HOST_DISPOSED', ...)` that
   * `#assertActive()` would throw: middleware-pipeline's abort error factory returns an `Error`
   * reason as-is (unwrapped) rather than re-tagging it, so surfacing this reason gives
   * async-generator mode the exact same error identity async mode gets from `assertActive` — even
   * though the underlying runner only accepts a signal, not a callback, for this mode.
   *
   * Both getters are `Object.defineProperty`-based (not object-literal `get` shorthand) so they are
   * lexically-scoped arrow functions bound to this host instance, not to the signal object itself.
   */
  /** Real lifecycle signal shared by active pipeline stages and disposal cancellation. */
  #liveSignal: IMiddlewarePipelineAbortSignal = this.#executionController
    .signal as unknown as IMiddlewarePipelineAbortSignal
  /** Tracks synchronous pipeline execution so a stage cannot extend its own traversal. */
  #pipelineDepth = 0
  #configRuntime: PluginHostConfigRuntime<TDomainCore, TValue, TInstalled>
  #hostDisposalRuntime: PluginHostDisposalRuntime<IRegistration<TDomainCore, TValue>>
  #compositionRuntime: PluginHostCompositionRuntime<TDomainCore, TValue>
  /** Monotonic committed mutation receipt used by composition owners to detect raw bypass. */
  #revision = 0
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
    this.#pipelineMode = options.pipeline?.mode ?? PluginHostPipelineMode.sync
    if (options.diagnostic !== undefined && typeof options.diagnostic !== 'function')
      throw createPluginHostTypeError('diagnostic must be a function')
    this.#diagnostic = options.diagnostic ?? defaultDiagnostic
    if (
      ![
        PluginHostPipelineMode.sync,
        PluginHostPipelineMode.async,
        PluginHostPipelineMode.generator,
        PluginHostPipelineMode.asyncGenerator
      ].includes(this.#pipelineMode)
    )
      throw new PluginHostError(
        PluginHostErrorCode.invalidPipelineMode,
        ERROR_TEXT.INVALID_PIPELINE_MODE
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
      isHostOpen: () => this.#terminal.lifecycle === 'open'
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
        shared: new Map(this.#shared),
        extensionOwners: new Map(this.#extensionOwners),
        syncStages: [...this.#syncStages],
        asyncStages: [...this.#asyncStages],
        generatorStages: [...this.#generatorStages],
        asyncGeneratorStages: [...this.#asyncGeneratorStages],
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
      diagnostic: this.#diagnostic
    })
    this.#removalRuntime = new PluginHostRemovalRuntime({
      registrations: this.#registrations,
      shared: this.#shared,
      extensionOwners: this.#extensionOwners,
      pipelineLeases: this.#pipelineLeases,
      pipelineOwnerKeys: this.#pipelineOwnerKeys,
      executionSignal: this.#executionController.signal,
      cleanupRuntime: this.#cleanupRuntime,
      setHookRegistration: (registration) => {
        this.#hookRegistration = registration
      }
    })
    this.#coreRuntime = new PluginHostCoreRuntime({
      createDomainCore: () => this.createPluginDomainCore(),
      assertRegistrationValid: (registration) => this.#assertRegistrationValid(registration),
      committedShared: this.#shared,
      executionSignal: this.#executionController.signal,
      pipelineMode: () => this.#pipelineMode,
      onPipelineViolation: this.#onPipelineViolation,
      registerStage: (stage, registration, kind) => this.#registerStage(stage, registration, kind),
      cleanupRuntime: this.#cleanupRuntime
    })
    this.#configRuntime = new PluginHostConfigRuntime({
      registrations: this.#registrations,
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
        this.#revision += 1
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
      registrationsInReverse: () => [...this.#registrations.values()].reverse(),
      disposeRegistration: (registration) => this.#removalRuntime.disposeRegistration(registration),
      clearPipelineState: () => {
        this.#syncStages.length = 0
        this.#asyncStages.length = 0
        this.#generatorStages.length = 0
        this.#asyncGeneratorStages.length = 0
        for (const slot of this.#stageSlots.values()) slot.retired = true
        this.#stageSlots.clear()
      },
      resetCleanupAbandoned: () => {
        this.#cleanupAbandoned = false
      },
      isCleanupAbandoned: () => this.#cleanupAbandoned,
      commitRevision: () => {
        this.#revision += 1
      },
      diagnostic: this.#diagnostic
    })
    this.#compositionRuntime = new PluginHostCompositionRuntime({
      host: this,
      scheduler: this.#scheduler,
      pipelineDrainTimeoutMs,
      registrations: this.#registrations,
      stageSlots: this.#stageSlots,
      allocateStageSlot: () => this.#nextStageSlot++,
      assertActive: () => this.#assertActive(),
      assertMutationAllowed: () => this.#assertMutationAllowed(),
      snapshotPlugins: (plugins) =>
        snapshotPluginDefinitions<TDomainCore, TValue>(plugins, this.#trustedDefinitionReader),
      preflight: (definitions) =>
        preflightPluginDefinitions(definitions, (name) => this.#registrations.has(name)),
      enqueue: (task) => this.#enqueue(task),
      installBatch: (entries, publish) => this.#installRuntime.installBatch(entries, publish),
      publish: (installed, batch) => this.#publishInstallBatch(installed, batch),
      revision: () => this.#revision,
      commitRevision: () => {
        this.#revision += 1
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
          : (info) => this.#reportQueueWait(info)
    })
  }

  get pipelineMode(): IPipelineMode {
    this.#assertActive()
    return this.#pipelineMode
  }

  /** Current committed Host mutation receipt; it changes only at publication boundaries. */
  get revision(): number {
    return this.#revision
  }

  /** Returns a fresh dynamic view over the currently committed registrations. */
  getCurrentView(): IPluginHostDynamicView<this> {
    this.#assertActive()
    return this.#createView() as IPluginHostDynamicView<this>
  }

  #assertActive(): void {
    if (this.#terminal.lifecycle === 'terminal')
      throw new PluginHostError(PluginHostErrorCode.hostDisposed, ERROR_TEXT.HOST_DISPOSED)
    if (this.#terminal.lifecycle === 'closing')
      throw new PluginHostError(PluginHostErrorCode.hostDisposing, ERROR_TEXT.HOST_DISPOSING)
  }

  /** Retains global and owner leases for the exact stage snapshot about to execute. */
  #retainPipelineLease(stages: readonly Function[]): () => void {
    this.#assertActive()
    const releases = [this.#pipelineLeases.retain(this.#pipelineKey)]
    const owners = new Set<string>()
    for (const stage of stages) {
      const owner = this.#stageOwners.get(stage)
      if (owner !== undefined) owners.add(owner)
    }
    for (const owner of owners) {
      const key = this.#pipelineOwnerKeys.get(owner)
      if (key !== undefined) releases.push(this.#pipelineLeases.retain(key))
    }
    return () => {
      for (const release of releases) release()
    }
  }

  /** Waits for the currently snapshotted pipeline work before releasing stage owners. */
  async #drainPipelineOwners(owner?: IRegistration<TDomainCore, TValue>): Promise<{
    readonly complete: boolean
    readonly physicalCompletion?: Promise<import('./typing.js').IPluginHostPhysicalCleanupResult>
  }> {
    const ownerKey = owner?.pipelineOwnerKey
    const pending = this.#pipelineLeases.whenZeroOnce(ownerKey ?? this.#pipelineKey)
    if (this.#pipelineDrainTimeoutMs === false) {
      await pending
      return { complete: true }
    }
    const complete = await boundedWait(
      pending,
      this.#scheduler.now() + this.#pipelineDrainTimeoutMs,
      { scheduler: this.#scheduler }
    )
    if (complete) return { complete: true }
    const physicalCompletion = pending.then(
      () => Object.freeze({ cleanupErrors: Object.freeze([]) }),
      (error: unknown) => Object.freeze({ cleanupErrors: Object.freeze([error]) })
    )
    return { complete: false, physicalCompletion }
  }

  #assertMutationAllowed(): void {
    if (this.#hookRegistration)
      throw new PluginHostError(
        PluginHostErrorCode.lifecycleMutation,
        ERROR_TEXT.LIFECYCLE_MUTATION
      )
  }

  /** 队列 admission 诊断（未配置 reject 阈值时）：只观测，不出队、不 reject，且**不携带错误码**（非拒绝事件）。 */
  #reportQueueWait(info: { readonly owner: string | undefined; readonly waitedMs: number }): void {
    try {
      this.#diagnostic(
        `[plugin-host] mutation waited in the queue for ${info.waitedMs}ms${info.owner ? ` (owner: ${info.owner})` : ''}`
      )
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
            .detail
          const threshold =
            typeof this.#queueAdmissionTimeoutMs === 'number' ? this.#queueAdmissionTimeoutMs : 0
          throw new PluginHostError(
            PluginHostErrorCode.mutationQueueTimeout,
            ERROR_TEXT.MUTATION_QUEUE_TIMEOUT(threshold),
            {
              cause: error,
              detail: {
                owner: lifecycleDetail?.owner,
                waitedMs: lifecycleDetail?.waitedMs ?? 0
              }
            }
          )
        }
        throw error
      })
  }

  protected createPluginDomainCore(): TDomainCore {
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

  #assertRegistrationValid(registration: IRegistration<TDomainCore, TValue>): void {
    if (registration.lifecycle === PluginHostRegistrationLifecycle.install) {
      this.#operationRuntime.assertCurrent(registration)
      return
    }
    if (this.#registrations.get(registration.name) === registration) return
    throw new PluginHostError(
      PluginHostErrorCode.pluginNotInstalled,
      ERROR_TEXT.PLUGIN_NOT_INSTALLED(registration.name)
    )
  }

  #onPipelineViolation = (
    kind: (typeof PluginHostPipelineViolation)[keyof typeof PluginHostPipelineViolation]
  ): void => {
    if (kind === PluginHostPipelineViolation.late) {
      try {
        this.#diagnostic(ERROR_TEXT.PIPELINE_NEXT_CALLED_LATE, PluginHostErrorCode.pipelineNextLate)
      } catch {
        // Diagnostics must never alter pipeline control flow.
      }
      return
    }
    throw new PluginHostError(
      PluginHostErrorCode.pipelineNextDuplicate,
      ERROR_TEXT.PIPELINE_NEXT_ALREADY_CALLED
    )
  }

  #registerStage(
    stage: Function,
    owner: IRegistration<TDomainCore, TValue> | undefined,
    kind: IPipelineMode
  ): void {
    registerPluginHostStage({
      host: this,
      hostMode: this.#pipelineMode,
      kind,
      depth: this.#pipelineDepth,
      stage,
      owner,
      activeBatch: this.#activeInstallBatch,
      syncStages: this.#syncStages,
      asyncStages: this.#asyncStages,
      generatorStages: this.#generatorStages,
      asyncGeneratorStages: this.#asyncGeneratorStages,
      stageSlots: this.#stageSlots,
      stageOwners: this.#stageOwners,
      pipelineOwnerKeys: this.#pipelineOwnerKeys,
      allocateSlot: () => this.#nextStageSlot++,
      readLiveStages: () => [
        this.#syncStages,
        this.#asyncStages,
        this.#generatorStages,
        this.#asyncGeneratorStages
      ]
    })
  }

  protected runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void> {
    return executePluginHostPipeline({
      mode: this.#pipelineMode,
      syncStages: this.#syncStages,
      asyncStages: this.#asyncStages,
      generatorStages: this.#generatorStages,
      asyncGeneratorStages: this.#asyncGeneratorStages,
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
  }

  /** Host-side pipeline registration for application composition. */
  usePipeline(stage: ISyncPipelineStage<TValue>): this {
    this.#assertActive()
    if (this.#pipelineMode === PluginHostPipelineMode.sync)
      this.#registerStage(stage, undefined, PluginHostPipelineMode.sync)
    else if (this.#pipelineMode === PluginHostPipelineMode.async)
      this.#registerStage(
        adaptSyncStageToAsync(stage, this.#onPipelineViolation),
        undefined,
        PluginHostPipelineMode.async
      )
    else if (this.#pipelineMode === PluginHostPipelineMode.generator)
      this.#registerStage(
        adaptSyncStageToGenerator(stage, this.#onPipelineViolation),
        undefined,
        PluginHostPipelineMode.generator
      )
    else
      this.#registerStage(
        adaptSyncStageToAsyncGenerator(stage, this.#onPipelineViolation),
        undefined,
        PluginHostPipelineMode.asyncGenerator
      )
    this.#revision += 1
    return this
  }

  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.async)
    this.#revision += 1
    return this
  }

  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.generator)
    this.#revision += 1
    return this
  }

  useAsyncGeneratorPipeline(stage: IAsyncGeneratorPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.asyncGenerator)
    this.#revision += 1
    return this
  }

  getShared<T = unknown>(key: PropertyKey): T | undefined {
    this.#assertActive()
    return this.#shared.get(key)?.value as T | undefined
  }

  use<
    const TPlugins extends readonly IPluginConstraint<
      TDomainCore & IPluginHostCore<TValue, IMergePluginShared<TInstalled>>
    >[]
  >(...plugins: TPlugins): Promise<IPluginHostView<this, [...TInstalled, ...TPlugins]>> {
    this.#assertActive()
    this.#assertMutationAllowed()
    const definitions = snapshotPluginDefinitions<TDomainCore, TValue>(
      plugins,
      this.#trustedDefinitionReader
    )
    return this.#enqueue(async () => {
      const entries = preflightPluginDefinitions(definitions, (name) =>
        this.#registrations.has(name)
      )
      await this.#installRuntime.installBatch(entries)
      return this.#createView<[...TInstalled, ...TPlugins]>()
    })
  }

  /** Creates one immutable admission snapshot through the canonical Host validator. */
  createPluginAdmission<TPlugin extends IPluginConstraint<any>>(
    plugin: TPlugin
  ): import('./typing.js').IPluginAdmission<TPlugin> {
    return this.#compositionRuntime.createPluginAdmission(plugin)
  }

  /** Reserves a Host-owned opaque ordering slot for one composition definition name. */
  createDataOrderSlot(name: string): import('./typing.js').IPluginDataOrderSlot {
    return this.#compositionRuntime.createDataOrderSlot(name)
  }

  /** Permanently retires the exact definition ordering lane after definition deletion. */
  retireDataOrderSlot(slot: import('./typing.js').IPluginDataOrderSlot): void {
    this.#compositionRuntime.retireDataOrderSlot(slot)
  }

  /** Prepares an admission batch for a composition owner without publishing candidate state. */
  async prepareAdmissions(
    requestsInPublicationOrder: readonly IPluginAdmissionRequest[]
  ): Promise<IPluginPreparedAdmissions> {
    return this.#compositionRuntime.prepareAdmissions(requestsInPublicationOrder)
  }

  /** Commits a prepared admission in one synchronous publication point. */
  commitPreparedAdmissions(
    prepared: IPluginPreparedAdmissions
  ): readonly IPluginRegistrationReceipt[] {
    return this.#compositionRuntime.commitPreparedAdmissions(prepared)
  }

  /** Discards a prepared candidate and resolves with exact rollback observations. */
  async discardPreparedAdmissions(
    prepared: IPluginPreparedAdmissions
  ): Promise<IPluginHostPhysicalCleanupResult> {
    return this.#compositionRuntime.discardPreparedAdmissions(prepared)
  }

  /** Validates exact live receipts before a composition removal critical section. */
  prepareUnUseBatch(
    receiptsInCleanupOrder: readonly IPluginRegistrationReceipt[]
  ): IPluginPreparedRemovalBatch {
    return this.#compositionRuntime.prepareUnUseBatch(receiptsInCleanupOrder)
  }

  /** Revokes a prepared receipt batch synchronously, then drains its cleanup fence. */
  async commitPreparedUnUseBatch<TView>(
    prepared: IPluginPreparedRemovalBatch,
    options: IPluginBatchRemovalOptions
  ): Promise<IPluginBatchRemovalResult<TView>> {
    return this.#compositionRuntime.commitPreparedUnUseBatch<TView>(prepared, options)
  }

  /** Installs constructor-time plugins synchronously or throws before the host escapes. */
  protected useSync<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    plugins: readonly IPluginConstraint<any>[]
  ): IPluginHostView<this, TViewPlugins> {
    this.#assertActive()
    this.#assertMutationAllowed()
    const definitions = snapshotPluginDefinitions<TDomainCore, TValue>(
      plugins,
      this.#trustedDefinitionReader
    )
    const entries = preflightPluginDefinitions(definitions, (name) => this.#registrations.has(name))
    this.#installRuntime.installBatchSync(entries)
    return this.#createView<TViewPlugins>()
  }

  /** Publishes a fully prepared candidate without invoking user code or allocating state. */
  #publishInstallBatch(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): void {
    for (const registration of installed) this.#registrations.set(registration.name, registration)
    for (const [key, entry] of batch.shared) this.#shared.set(key, entry)
    for (const [key, registration] of batch.extensionOwners)
      this.#extensionOwners.set(key, registration)
    this.#syncStages = batch.syncStages
    this.#asyncStages = batch.asyncStages
    this.#generatorStages = batch.generatorStages
    this.#asyncGeneratorStages = batch.asyncGeneratorStages
    batch.committed = true
    this.#revision += 1
  }

  /**
   * Synchronous half of useSync rollback: detaches a registration from all host-visible state
   * (shared keys, mounted extensions, the registrations map) without running any user disposer code
   * — matches `LifecycleScope.close()`'s "synchronous, idempotent, never calls user code".
   * Extension-removal failures are reported via diagnostic immediately (synchronously) since they
   * are themselves synchronous, unlike the disposers handled by `#rollbackDisposersAsync`.
   */
  #closeRegistrationSync(
    registration: IRegistration<TDomainCore, TValue>,
    _rollbackErrors: unknown[] = []
  ): void {
    for (const key of registration.shared)
      if (this.#shared.get(key)?.owner === registration) this.#shared.delete(key)
    for (const { key } of [...registration.extensions].reverse())
      if (this.#extensionOwners.get(key) === registration) this.#extensionOwners.delete(key)
    if (this.#registrations.get(registration.name) === registration)
      this.#registrations.delete(registration.name)
    registration.scope?.close()
    registration.lifecycle = PluginHostRegistrationLifecycle.idle
  }

  /** Rejects access through a stale view after any captured registration is revoked. */
  #assertViewLive(registrations: readonly IRegistration<TDomainCore, TValue>[]): void {
    for (const registration of registrations)
      if (!registration.installed || this.#registrations.get(registration.name) !== registration)
        throw new PluginHostError(PluginHostErrorCode.viewRevoked, ERROR_TEXT.VIEW_REVOKED)
  }

  /** Materializes a null-prototype, frozen view over the current committed registrations. */
  #createView<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    registrations: readonly IRegistration<TDomainCore, TValue>[] = [...this.#registrations.values()]
  ): IPluginHostView<this, TViewPlugins> {
    return createPluginHostPublication<this, TDomainCore, TValue, TViewPlugins>(registrations, {
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
      const registration = this.#registrations.get(name)
      if (!registration)
        return Object.freeze({
          ok: true,
          removed: false,
          view: this.#createView() as IPluginHostDynamicView<this>,
          cleanupComplete: true,
          cleanupErrors: Object.freeze([])
        })
      const drain = await this.#drainPipelineOwners(registration)
      const errors = await this.#removalRuntime.disposeRegistration(registration)
      this.#revision += 1
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
        new PluginHostError(
          PluginHostErrorCode.pluginDisposeFailed,
          ERROR_TEXT.PLUGIN_DISPOSE_FAILED(name),
          {
            cause: errors[0],
            detail: { errors: Object.freeze([...errors]) }
          }
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
