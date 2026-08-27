import ERROR_TEXT, {
  PluginHostError,
  createPluginHostTypeError,
  tagPluginHostError
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import {
  copyConfig,
  copyConfigWithPatch,
  parseConfigPath,
  readConfigPath,
  readPlainDataRecord,
  readonlyConfig
} from './config.js'
import { asyncDisposeKey, resolveDisposer, snapshotDisposer } from './disposal.js'
import {
  createLifecycleScope,
  createMutationQueue,
  assimilateCapturedThen,
  boundedWait,
  createAbortController,
  createGenerationController,
  createPendingTracker,
  createProvisionalScope,
  createQuiescenceTracker,
  createTerminalController,
  LifecycleErrorCode,
  snapshotScheduler,
  systemScheduler,
  type ILifecycleScheduler,
  type IMutationQueue,
  type IReleaseDescriptor,
  type IAbortController,
  type IGenerationRequest,
  type IGenerationController,
  type IQuiescenceTracker,
  type IPendingTracker,
  type IProvisionalScope,
  type ITerminalController
} from '@migaia/lifecycle'
import {
  adaptSyncStageToAsync,
  adaptSyncStageToAsyncGenerator,
  adaptSyncStageToGenerator,
  registerStage,
  runPipeline
} from './pipeline.js'
import type { IMiddlewarePipelineAbortSignal } from '@migaia/middleware-pipeline'
import { assertExtensionResult } from './extension.js'
import { createPluginCore } from './core.js'
import { invokeCaptured } from './invocation.js'
import {
  PluginHostPipelineMode,
  PluginHostPipelineViolation,
  PluginHostRegistrationLifecycle
} from './state-constants.js'
import type { IInstallEntry, IPluginDefinition, IRegistration, ISharedEntry } from './registry.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPluginConfig,
  IPluginConstraint,
  IPluginResource,
  IPluginHostCore,
  IPluginHostConfigFor,
  IPluginHostErrorCode,
  IPluginInstallFailureDetail,
  IPluginHostView,
  IPluginHostDynamicView,
  IPluginRemovalResult,
  IPluginDisposalContext,
  IMergePluginShared,
  IPluginHostOptions,
  IPipelineMode,
  ISyncPipelineStage
} from './typing.js'

/** Stable kinds for structured nodes emitted by PluginHost disposal producers. */
export const PluginHostDisposalNodeKind = Object.freeze({
  hostError: 'host-error',
  aggregate: 'aggregate',
  disposerWrapper: 'disposer-wrapper'
} as const)

export type IPluginHostDisposalNodeKind =
  (typeof PluginHostDisposalNodeKind)[keyof typeof PluginHostDisposalNodeKind]

/** Frozen provenance detail stored only in the private producer registry. */
export type IPluginHostDisposalProvenance = Readonly<{
  readonly kind: IPluginHostDisposalNodeKind
  readonly phase?: string
}>

/** Module-instance authority for Host-generated disposal nodes; user properties never participate. */
const pluginHostDisposalProvenance = new WeakMap<object, IPluginHostDisposalProvenance>()

/** Reads provenance for this exact PluginHost module instance; duplicate instances fail closed. */
export const readPluginHostDisposalProvenance = (
  value: unknown
): IPluginHostDisposalProvenance | undefined => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return pluginHostDisposalProvenance.get(value)
}

/** Registers a newly-created Host node without exposing mutation authority outside this module. */
const registerPluginHostDisposalNode = <T extends object>(
  node: T,
  provenance: IPluginHostDisposalProvenance
): T => {
  pluginHostDisposalProvenance.set(node, Object.freeze({ ...provenance }))
  return node
}

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
/** Convert hostile resource disposer access into the plugin-host admission error boundary. */
const resolveAdmittedDisposer = (resource: IPluginResource) => {
  try {
    return resolveDisposer(resource)
  } catch (cause) {
    throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
  }
}
const objectPrototypeKeys = new Set(Reflect.ownKeys(Object.prototype))
/** Host protocol names cannot be claimed by an extension view. */
const hostReservedKeys = new Set<PropertyKey>([
  'config',
  'pipelineMode',
  'getShared',
  'usePipeline',
  'useAsyncPipeline',
  'useGeneratorPipeline',
  'useAsyncGeneratorPipeline',
  'use',
  'unUse',
  'dispose',
  'host',
  'extensions'
])

/** Candidate registries held privately until one install batch reaches its commit point. */
type IInstallBatchContext<TDomainCore extends object, TValue> = {
  readonly shared: Map<PropertyKey, ISharedEntry<TDomainCore, TValue>>
  readonly extensionOwners: Map<PropertyKey, IRegistration<TDomainCore, TValue>>
  committed: boolean
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
  #terminal: ITerminalController = createTerminalController()
  #executionController: IAbortController = createAbortController()
  #operationController: IGenerationController
  #pipelineLeases: IQuiescenceTracker<object> = createQuiescenceTracker<object>()
  #pending: IPendingTracker = createPendingTracker()
  #pipelineKey: object = {}
  #disposePromise: Promise<import('./typing.js').IPluginHostDisposalResult> | undefined
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
  #disposeStepTimeoutMs: number | false
  #mutationTimeoutMs: number | false
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
  /** Lazily cached public config facade; its methods retain this host as owner. */
  #configApi: IPluginHostConfigFor<TInstalled> | undefined

  constructor(options: IPluginHostOptions) {
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
      throw new PluginHostError('INVALID_PIPELINE_MODE', ERROR_TEXT.INVALID_PIPELINE_MODE)
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
          new TypeError('scheduler getter failed', {
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
    this.#operationController = createGenerationController({
      parentSignal: this.#executionController.signal,
      scheduler: this.#scheduler
    })
    this.#disposeStepTimeoutMs = options.disposeStepTimeoutMs ?? DEFAULT_DISPOSE_STEP_TIMEOUT_MS
    this.#mutationTimeoutMs = mutationTimeoutMs
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

  #assertActive(): void {
    if (this.#terminal.lifecycle === 'terminal')
      throw new PluginHostError('HOST_DISPOSED', ERROR_TEXT.HOST_DISPOSED)
    if (this.#terminal.lifecycle === 'closing')
      throw new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING)
  }

  /** Retains one lifecycle lease so disposal can seal and drain active pipeline executions. */
  #retainPipelineLease(): () => void {
    this.#assertActive()
    return this.#pipelineLeases.retain(this.#pipelineKey)
  }

  #assertMutationAllowed(): void {
    if (this.#hookRegistration)
      throw new PluginHostError('LIFECYCLE_MUTATION', ERROR_TEXT.LIFECYCLE_MUTATION)
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
            'MUTATION_QUEUE_TIMEOUT',
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

  /** Starts one generation and records the single absolute deadline for a lifecycle hook. */
  #beginOperation(registration: IRegistration<TDomainCore, TValue>): IGenerationRequest {
    const request = this.#operationController.begin()
    registration.operation = request
    if (this.#mutationTimeoutMs === false) {
      registration.operationDeadlineAt = undefined
      return request
    }
    registration.operationDeadlineAt = this.#scheduler.now() + this.#mutationTimeoutMs
    return request
  }

  /**
   * Waits through lifecycle boundedWait, superseding the operation on deadline without cancelling
   * user work.
   */
  async #awaitOperation<T>(
    result: T | PromiseLike<T>,
    registration: IRegistration<TDomainCore, TValue>
  ): Promise<T> {
    const request = registration.operation
    if (!request || this.#mutationTimeoutMs === false) {
      return await result
    }
    const deadlineAt = registration.operationDeadlineAt
    if (deadlineAt === undefined) {
      return await result
    }
    const settled = await boundedWait(Promise.resolve(result), deadlineAt, {
      scheduler: this.#scheduler
    })
    if (settled) return await result
    const timeout = new PluginHostError(
      'MUTATION_EXECUTION_TIMEOUT',
      ERROR_TEXT.MUTATION_EXECUTION_TIMEOUT(this.#mutationTimeoutMs)
    )
    try {
      this.#operationController.supersede(timeout)
    } catch (secondary) {
      try {
        Object.defineProperty(timeout, 'errors', {
          value: Object.freeze([secondary]),
          enumerable: true,
          configurable: true
        })
      } catch {
        // The timeout primary remains authoritative even when signal cleanup is hostile.
      }
    }
    throw timeout
  }

  /** Rejects a settled operation that lost commit authority to timeout or host disposal. */
  #assertOperationCurrent(registration: IRegistration<TDomainCore, TValue>): void {
    const operation = registration.operation
    if (
      this.#terminal.lifecycle !== 'open' ||
      operation === undefined ||
      !this.#operationController.isCurrent(operation.token)
    ) {
      if (this.#terminal.lifecycle !== 'open')
        throw new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING)
      throw new PluginHostError(
        'MUTATION_EXECUTION_TIMEOUT',
        ERROR_TEXT.MUTATION_EXECUTION_TIMEOUT(this.#mutationTimeoutMs as number)
      )
    }
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

  #core(
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ): TDomainCore & IPluginHostCore<TValue> {
    if (registration.core) return registration.core
    registration.core = createPluginCore({
      registration,
      createDomainCore: () => this.createPluginDomainCore(),
      assertRegistrationValid: () => this.#assertRegistrationValid(registration),
      getShared: (key) => {
        const shared = batch?.committed ? this.#shared : (batch?.shared ?? this.#shared)
        return shared.get(key)?.value
      },
      operation: () => {
        if (!registration.operation)
          throw new PluginHostError('RESOURCE_OUTSIDE_INSTALL', ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL)
        return {
          signal: registration.operation.signal,
          deadlineAt: registration.operationDeadlineAt
        }
      },
      lifecycle: () => ({
        signal: registration.lifecycleController?.signal ?? this.#executionController.signal
      }),
      pipelineMode: () => this.#pipelineMode,
      onPipelineViolation: this.#onPipelineViolation,
      registerResource: (resource) => {
        if (registration.lifecycle !== PluginHostRegistrationLifecycle.install)
          throw new PluginHostError('RESOURCE_OUTSIDE_INSTALL', ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL)
        const disposer = resolveAdmittedDisposer(resource)
        if (!disposer) throw createPluginHostTypeError('plugin resource must provide a disposer')
        const owner: IProvisionalScope | import('@migaia/lifecycle').ILifecycleScope | undefined =
          registration.provisional ?? registration.scope
        if (!owner)
          throw new PluginHostError('RESOURCE_OUTSIDE_INSTALL', ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL)
        owner.own(disposer, this.#stepDescriptor('resource disposer', disposer))
      },
      registerStage: (stage, kind) => {
        this.#registerStage(stage, registration, kind)
      }
    })
    return registration.core
  }

  #assertRegistrationValid(registration: IRegistration<TDomainCore, TValue>): void {
    if (registration.lifecycle === PluginHostRegistrationLifecycle.install) {
      const operation = registration.operation
      if (operation && this.#operationController.isCurrent(operation.token)) return
      throw new PluginHostError(
        'MUTATION_EXECUTION_TIMEOUT',
        ERROR_TEXT.MUTATION_EXECUTION_TIMEOUT(this.#mutationTimeoutMs as number)
      )
    }
    if (this.#registrations.get(registration.name) === registration) return
    throw new PluginHostError(
      'PLUGIN_NOT_INSTALLED',
      ERROR_TEXT.PLUGIN_NOT_INSTALLED(registration.name)
    )
  }

  #onPipelineViolation = (
    kind: (typeof PluginHostPipelineViolation)[keyof typeof PluginHostPipelineViolation]
  ): void => {
    if (kind === PluginHostPipelineViolation.late) {
      try {
        this.#diagnostic(ERROR_TEXT.PIPELINE_NEXT_CALLED_LATE, 'PIPELINE_NEXT_LATE')
      } catch {
        // Diagnostics must never alter pipeline control flow.
      }
      return
    }
    throw new PluginHostError('PIPELINE_NEXT_DUPLICATE', ERROR_TEXT.PIPELINE_NEXT_ALREADY_CALLED)
  }

  #registerStage(
    stage: Function,
    owner: IRegistration<TDomainCore, TValue> | undefined,
    kind: IPipelineMode
  ): void {
    if (typeof stage !== 'function')
      throw createPluginHostTypeError('pipeline stage must be a function')
    if (kind !== this.#pipelineMode)
      throw new PluginHostError(
        'PIPELINE_MODE_MISMATCH',
        ERROR_TEXT.PIPELINE_MODE_MISMATCH(this.#pipelineMode, kind)
      )
    if (owner && owner.lifecycle !== PluginHostRegistrationLifecycle.install)
      throw new PluginHostError('RESOURCE_OUTSIDE_INSTALL', ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL)
    if (this.#pipelineDepth > 0)
      throw new PluginHostError('PIPELINE_EXECUTING', ERROR_TEXT.PIPELINE_EXECUTING)
    const track = (dispose: () => void): void => {
      if (owner) owner.pipelineDisposers.push(dispose)
    }
    if (kind === PluginHostPipelineMode.sync)
      registerStage(this.#syncStages, stage as ISyncPipelineStage<TValue>, track)
    else if (kind === PluginHostPipelineMode.async)
      registerStage(this.#asyncStages, stage as IAsyncPipelineStage<TValue>, track)
    else if (kind === PluginHostPipelineMode.generator)
      registerStage(this.#generatorStages, stage as IGeneratorPipelineStage<TValue>, track)
    else
      registerStage(
        this.#asyncGeneratorStages,
        stage as IAsyncGeneratorPipelineStage<TValue>,
        track
      )
  }

  protected runPipeline(value: TValue, done: (value: TValue) => void): void | Promise<void> {
    const onViolation = this.#onPipelineViolation
    if (this.#pipelineMode === PluginHostPipelineMode.sync) {
      this.#assertActive()
      const release = this.#retainPipelineLease()
      this.#pipelineDepth += 1
      try {
        return runPipeline(PluginHostPipelineMode.sync, this.#syncStages, value, done, onViolation)
      } finally {
        this.#pipelineDepth -= 1
        release()
      }
    }
    if (this.#pipelineMode === PluginHostPipelineMode.async) {
      try {
        this.#assertActive()
      } catch (error) {
        return Promise.reject(error)
      }
      // Async mode snapshots stages, while the depth guard rejects registration for the full await span.
      const release = this.#retainPipelineLease()
      this.#pipelineDepth += 1
      const task = (
        runPipeline(
          PluginHostPipelineMode.async,
          [...this.#asyncStages],
          value,
          done,
          onViolation,
          () => this.#assertActive()
        ) as Promise<void>
      ).finally(() => {
        this.#pipelineDepth -= 1
        release()
      })
      return this.#pending.track(task)
    }
    if (this.#pipelineMode === PluginHostPipelineMode.generator) {
      this.#assertActive()
      const release = this.#retainPipelineLease()
      this.#pipelineDepth += 1
      try {
        return runPipeline(
          PluginHostPipelineMode.generator,
          this.#generatorStages,
          value,
          done,
          onViolation
        )
      } finally {
        this.#pipelineDepth -= 1
        release()
      }
    }
    try {
      this.#assertActive()
    } catch (error) {
      return Promise.reject(error)
    }
    // Async-generator mode snapshots stages like async mode; the depth guard rejects registration
    // for the full await span, and `#liveSignal` gives it the same "host died mid-flight" coverage
    // async mode gets from `assertActive` (the underlying runner only accepts a signal, not a callback).
    const release = this.#retainPipelineLease()
    this.#pipelineDepth += 1
    const task = (
      runPipeline(
        PluginHostPipelineMode.asyncGenerator,
        [...this.#asyncGeneratorStages],
        value,
        done,
        onViolation,
        undefined,
        this.#liveSignal
      ) as Promise<void>
    ).finally(() => {
      this.#pipelineDepth -= 1
      release()
    })
    return this.#pending.track(task)
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
    return this
  }

  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.async)
    return this
  }

  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.generator)
    return this
  }

  useAsyncGeneratorPipeline(stage: IAsyncGeneratorPipelineStage<TValue>): this {
    this.#assertActive()
    this.#registerStage(stage, undefined, PluginHostPipelineMode.asyncGenerator)
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
    const definitions = this.#snapshotPlugins(plugins)
    return this.#enqueue(async () => {
      const entries = this.#preflight(definitions)
      await this.#installBatch(entries)
      return this.#createView<[...TInstalled, ...TPlugins]>()
    })
  }

  /** Installs constructor-time plugins synchronously or throws before the host escapes. */
  protected useSync<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    plugins: readonly IPluginConstraint<any>[]
  ): IPluginHostView<this, TViewPlugins> {
    this.#assertActive()
    this.#assertMutationAllowed()
    const definitions = this.#snapshotPlugins(plugins)
    const entries = this.#preflight(definitions)
    this.#installBatchSync(entries)
    return this.#createView<TViewPlugins>()
  }

  #preflight(
    plugins: readonly IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[]
  ): IInstallEntry<TDomainCore, TValue>[] {
    for (const plugin of plugins)
      if (this.#registrations.has(plugin.name))
        throw new PluginHostError('PLUGIN_DUPLICATE', ERROR_TEXT.PLUGIN_DUPLICATE(plugin.name))
    return plugins.map((plugin) => ({ plugin, name: plugin.name }))
  }

  #snapshotPlugins(
    plugins: readonly IPluginConstraint<any>[]
  ): IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[] {
    const names = new Set<string>()
    return plugins.map((plugin) => {
      let captured: {
        readonly name: unknown
        readonly config: unknown
        readonly install: unknown
        readonly update: unknown
        readonly dispose: unknown
        readonly shared: unknown
        readonly disposer: ReturnType<typeof snapshotDisposer>
      }
      try {
        captured = {
          name: plugin?.name,
          config: plugin?.config,
          install: plugin?.install,
          update: plugin?.update,
          dispose: plugin?.dispose,
          shared: plugin?.shared,
          disposer: snapshotDisposer(plugin as IPluginResource)
        }
      } catch (cause) {
        throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
      }
      const { name, config: rawConfig, install, update, dispose, shared, disposer } = captured
      if (typeof name !== 'string' || name.length === 0)
        throw createPluginHostTypeError('plugin name must be a non-empty string')
      if (name.includes('.')) throw createPluginHostTypeError('plugin name must not contain "."')
      if (typeof install !== 'function')
        throw createPluginHostTypeError('plugin install must be a function')
      for (const [key, hook] of [
        ['update', update],
        ['dispose', dispose],
        ['shared', shared]
      ] as const)
        if (hook !== undefined && typeof hook !== 'function')
          throw createPluginHostTypeError(`plugin ${key} must be a function`)
      for (const candidate of [...disposer.asyncCandidates, ...disposer.disposeCandidates])
        if (candidate.value !== undefined && typeof candidate.value !== 'function')
          throw createPluginHostTypeError(
            `plugin disposer ${String(candidate.key)} must be a function`
          )
      if (names.has(name))
        throw new PluginHostError('PLUGIN_DUPLICATE', ERROR_TEXT.PLUGIN_DUPLICATE(name))
      names.add(name)
      const config = copyConfig((rawConfig ?? {}) as IPluginConfig, 'plugin config')
      return {
        owner: plugin,
        name,
        config,
        install: install as IPluginConstraint<any>['install'],
        update: update as IPluginConstraint<any>['update'],
        dispose: dispose as IPluginConstraint<any>['dispose'],
        shared: shared as IPluginConstraint<any>['shared'],
        disposer: disposer.disposer
      }
    })
  }

  async #installBatch(entries: readonly IInstallEntry<TDomainCore, TValue>[]): Promise<void> {
    const installed: IRegistration<TDomainCore, TValue>[] = []
    const batch: IInstallBatchContext<TDomainCore, TValue> = {
      shared: new Map(this.#shared),
      extensionOwners: new Map(this.#extensionOwners),
      committed: false
    }
    let failedName = entries[0]?.name ?? 'unknown'
    try {
      for (const entry of entries) {
        const { plugin, name } = entry
        failedName = name
        const config = plugin.config
        const registration: IRegistration<TDomainCore, TValue> = {
          name,
          plugin,
          config: copyConfig(config),
          extensions: [],
          pipelineDisposers: [],
          shared: [],
          installed: false,
          lifecycle: PluginHostRegistrationLifecycle.install,
          lifecycleController: createAbortController(),
          scope: createLifecycleScope({ errorPolicy: 'collect', scheduler: this.#scheduler })
        }
        installed.push(registration)
        try {
          this.#beginOperation(registration)
          registration.provisional = createProvisionalScope({
            parentSignal: registration.operation?.signal
          })
          this.#hookRegistration = registration
          let installResult: unknown
          installResult = invokeCaptured(plugin.install, plugin.owner, [
            this.#core(registration, batch)
          ])
          if (
            installResult &&
            typeof installResult === 'object' &&
            Reflect.ownKeys(installResult).includes('then')
          )
            throw new PluginHostError(
              'EXTENSION_RESERVED',
              ERROR_TEXT.EXTENSION_RESERVED(registration.name, 'then')
            )
          const installThen =
            installResult &&
            (typeof installResult === 'object' || typeof installResult === 'function')
              ? (installResult as { then?: unknown }).then
              : undefined
          const installedValue = await this.#awaitOperation(
            typeof installThen === 'function'
              ? assimilateCapturedThen(installThen as (...args: unknown[]) => void, installResult)
              : installResult,
            registration
          )
          this.#assertOperationCurrent(registration)
          if (plugin.shared) {
            this.#hookRegistration = registration
            let sharedValue: unknown
            try {
              sharedValue = invokeCaptured(plugin.shared!, plugin.owner, [
                this.#core(registration, batch)
              ])
            } finally {
              this.#hookRegistration = undefined
            }
            const shared = readPlainDataRecord(sharedValue, 'plugin shared', false)
            for (const key of Reflect.ownKeys(shared)) {
              if (batch.shared.has(key))
                throw new PluginHostError('SHARED_DUPLICATE', ERROR_TEXT.SHARED_DUPLICATE(key))
              batch.shared.set(key, { owner: registration, value: shared[key] })
              registration.shared.push(key)
            }
          }
          this.#mountExtensions(registration, installedValue, batch.extensionOwners)
          if (!registration.scope || !registration.provisional)
            throw new PluginHostError(
              'RESOURCE_OUTSIDE_INSTALL',
              ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
            )
          await registration.provisional.commitTo(registration.scope)
          registration.provisional = undefined
          registration.installed = true
        } finally {
          this.#hookRegistration = undefined
          registration.lifecycle = PluginHostRegistrationLifecycle.idle
        }
      }
      // Publish all candidate registries in one synchronous point after every hook, validation, and
      // scope transfer has succeeded. No user code runs during this publication.
      for (const registration of installed) this.#registrations.set(registration.name, registration)
      for (const [key, entry] of batch.shared) this.#shared.set(key, entry)
      for (const [key, registration] of batch.extensionOwners)
        this.#extensionOwners.set(key, registration)
      batch.committed = true
    } catch (error) {
      // L-T39 (§3.7.4/M-T44): the original construct error stays the thrown error's `cause` no
      // matter what — a cleanup/rollback failure is reported through the diagnostic channel as an
      // additional signal, never promoted to replace it as the primary error.
      /** Raw rollback failures retained for the structured install error detail. */
      const rollbackErrors: unknown[] = []
      for (const registration of [...installed].reverse())
        rollbackErrors.push(...(await this.#disposeRegistration(registration, true)))
      this.#reportRollbackFailure(failedName, rollbackErrors)
      /** Frozen async-install detail keeps rollback identities stable after the batch settles. */
      const failureDetail = Object.freeze({
        failedName,
        rollbackErrors: Object.freeze([...rollbackErrors])
      })
      throw new PluginHostError<IPluginInstallFailureDetail>(
        'PLUGIN_INSTALL_FAILED',
        `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, detail: failureDetail }
      )
    }
  }

  /** Reports a batch of rollback/cleanup failures via the diagnostic channel — never thrown. */
  #reportRollbackFailure(failedName: string, rollbackErrors: readonly unknown[]): void {
    if (rollbackErrors.length === 0) return
    const detail = rollbackErrors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join('; ')
    try {
      this.#diagnostic(
        `${ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName)}: ${detail}`,
        'PLUGIN_INSTALL_ROLLBACK_FAILED'
      )
    } catch {
      // Diagnostics must never alter control flow.
    }
  }

  /** Runs the initial install transaction without allowing awaitable extensions. */
  #installBatchSync(entries: readonly IInstallEntry<TDomainCore, TValue>[]): void {
    const installed: IRegistration<TDomainCore, TValue>[] = []
    const batch: IInstallBatchContext<TDomainCore, TValue> = {
      shared: new Map(this.#shared),
      extensionOwners: new Map(this.#extensionOwners),
      committed: false
    }
    let failedName = entries[0]?.name ?? 'unknown'
    try {
      for (const entry of entries) {
        const { plugin, name } = entry
        failedName = name
        const registration: IRegistration<TDomainCore, TValue> = {
          name,
          plugin,
          config: copyConfig(plugin.config),
          extensions: [],
          pipelineDisposers: [],
          shared: [],
          installed: false,
          lifecycle: PluginHostRegistrationLifecycle.install,
          lifecycleController: createAbortController(),
          scope: createLifecycleScope({ errorPolicy: 'collect', scheduler: this.#scheduler })
        }
        installed.push(registration)
        try {
          this.#beginOperation(registration)
          this.#hookRegistration = registration
          let installedValue: unknown
          try {
            installedValue = invokeCaptured(plugin.install, plugin.owner, [
              this.#core(registration, batch)
            ])
          } finally {
            this.#hookRegistration = undefined
          }
          const installedThen =
            installedValue &&
            (typeof installedValue === 'object' || typeof installedValue === 'function')
              ? (installedValue as { then?: unknown }).then
              : undefined
          if (typeof installedThen === 'function') {
            void assimilateCapturedThen(
              installedThen as (...args: unknown[]) => void,
              installedValue
            ).catch(() => undefined)
            throw createPluginHostTypeError(
              `plugin ${registration.name} returned an awaitable during synchronous installation`
            )
          }
          if (plugin.shared) {
            this.#hookRegistration = registration
            let sharedValue: unknown
            try {
              sharedValue = invokeCaptured(plugin.shared!, plugin.owner, [
                this.#core(registration, batch)
              ])
            } finally {
              this.#hookRegistration = undefined
            }
            const shared = readPlainDataRecord(sharedValue, 'plugin shared', false)
            for (const key of Reflect.ownKeys(shared)) {
              if (batch.shared.has(key))
                throw new PluginHostError('SHARED_DUPLICATE', ERROR_TEXT.SHARED_DUPLICATE(key))
              batch.shared.set(key, { owner: registration, value: shared[key] })
              registration.shared.push(key)
            }
          }
          this.#mountExtensions(registration, installedValue, batch.extensionOwners)
          registration.installed = true
        } finally {
          registration.lifecycle = PluginHostRegistrationLifecycle.idle
        }
      }
      // Publish all candidate registries in one synchronous point after every install validates.
      for (const registration of installed) this.#registrations.set(registration.name, registration)
      for (const [key, entry] of batch.shared) this.#shared.set(key, entry)
      for (const [key, registration] of batch.extensionOwners)
        this.#extensionOwners.set(key, registration)
      batch.committed = true
    } catch (cause) {
      // §5.6/M-T15: close still detaches Host-visible state synchronously, while async disposers
      // remain admitted. The thrown detail is an immutable snapshot; its completion resolves the
      // final rollback identities instead of mutating the published error after it crosses the
      // caller boundary.
      const rollbackErrors: unknown[] = []
      for (const registration of [...installed].reverse())
        this.#closeRegistrationSync(registration, rollbackErrors)
      const publishedErrors = Object.freeze([...rollbackErrors])
      const completion = this.#rollbackDisposersAsync(installed, failedName).then(
        (lateErrors) =>
          Object.freeze({
            failedName,
            rollbackErrors: Object.freeze([...publishedErrors, ...lateErrors])
          }),
        (error) => {
          this.#reportRollbackFailure(failedName, [error])
          return Object.freeze({
            failedName,
            rollbackErrors: Object.freeze([...publishedErrors, error])
          })
        }
      )
      const failureDetail: IPluginInstallFailureDetail = Object.freeze({
        failedName,
        rollbackErrors: publishedErrors,
        completion
      })
      throw new PluginHostError<IPluginInstallFailureDetail>(
        'PLUGIN_INSTALL_FAILED',
        `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause, detail: failureDetail }
      )
    }
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

  /**
   * Asynchronous half of useSync rollback: runs each registration's own disposers off the
   * synchronous throw path. Failures are collected per registration and reported via diagnostic,
   * then returned to the completion promise in deterministic rollback order.
   */
  #rollbackDisposersAsync(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    failedName: string
  ): Promise<readonly unknown[]> {
    /** Sequential rollback chain preserves registration and error order across async cleanup. */
    let rollback: Promise<readonly unknown[]> = Promise.resolve([])
    for (const registration of [...installed].reverse())
      rollback = rollback.then((previousErrors) =>
        this.#disposeRegistration(registration, true).then((errors) => {
          this.#reportRollbackFailure(failedName, errors)
          return [...previousErrors, ...errors]
        })
      )
    return rollback
  }

  #mountExtensions(
    registration: IRegistration<TDomainCore, TValue>,
    extension: unknown,
    extensionOwners = this.#extensionOwners
  ): void {
    const extensionObject = assertExtensionResult(extension, registration.name)
    for (const key of Reflect.ownKeys(extensionObject)) {
      const descriptor = Object.getOwnPropertyDescriptor(extensionObject, key)
      // Non-enumerable extension keys are intentionally ignored (keeps symbol metadata such as
      // Symbol.toStringTag out of the host surface) — but the omission must be observable rather
      // than silent, so it is reported through the diagnostic channel every time it happens.
      if (!descriptor?.enumerable) {
        try {
          this.#diagnostic(
            ERROR_TEXT.EXTENSION_NON_ENUMERABLE_IGNORED(registration.name, key),
            'EXTENSION_NON_ENUMERABLE_IGNORED'
          )
        } catch {
          // Diagnostics must never throw into unrelated code paths.
        }
        continue
      }
      if (objectPrototypeKeys.has(key))
        throw new PluginHostError(
          'EXTENSION_OBJECT_PROTOTYPE',
          ERROR_TEXT.EXTENSION_OBJECT_PROTOTYPE(registration.name, key)
        )
      if (hostReservedKeys.has(key))
        throw new PluginHostError(
          'EXTENSION_RESERVED',
          ERROR_TEXT.EXTENSION_RESERVED(registration.name, key)
        )
      if (extensionOwners.has(key)) {
        throw new PluginHostError(
          'EXTENSION_DUPLICATE',
          ERROR_TEXT.EXTENSION_DUPLICATE(registration.name, key)
        )
      }
      if (
        !descriptor ||
        'get' in descriptor ||
        'set' in descriptor ||
        descriptor.configurable === false
      )
        throw createPluginHostTypeError('extension property must be a configurable data property')
      registration.extensions.push({ key, descriptor })
      extensionOwners.set(key, registration)
    }
  }

  /** Rejects access through a stale view after any captured registration is revoked. */
  #assertViewLive(registrations: readonly IRegistration<TDomainCore, TValue>[]): void {
    for (const registration of registrations)
      if (!registration.installed || this.#registrations.get(registration.name) !== registration)
        throw new PluginHostError('VIEW_REVOKED', ERROR_TEXT.VIEW_REVOKED)
  }

  /** Materializes a null-prototype, frozen view over the current committed registrations. */
  #createView<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    registrations: readonly IRegistration<TDomainCore, TValue>[] = [...this.#registrations.values()]
  ): IPluginHostView<this, TViewPlugins> {
    const captured = Object.freeze([...registrations])
    const extensions = Object.create(null) as Record<PropertyKey, unknown>
    for (const registration of captured)
      for (const { key, descriptor } of registration.extensions) {
        const value = descriptor.value
        const published =
          typeof value === 'function'
            ? (...args: unknown[]) => invokeCaptured(value, this, args)
            : value
        Object.defineProperty(extensions, key, {
          value: published,
          enumerable: true,
          configurable: false,
          writable: false
        })
      }
    Object.freeze(extensions)
    const view = Object.create(null) as Record<PropertyKey, unknown>
    Object.defineProperties(view, {
      host: { value: this, enumerable: true, configurable: false, writable: false },
      extensions: {
        enumerable: true,
        configurable: false,
        get: () => {
          this.#assertViewLive(captured)
          return extensions
        }
      },
      config: {
        enumerable: true,
        configurable: false,
        get: () => {
          this.#assertViewLive(captured)
          return {
            get: (path: string) => {
              this.#assertViewLive(captured)
              return this.config.get(path)
            },
            update: (
              name: string,
              recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
            ) => {
              this.#assertViewLive(captured)
              return this.config.update(name, recipe)
            }
          } as IPluginHostConfigFor<TViewPlugins>
        }
      },
      getShared: {
        enumerable: true,
        configurable: false,
        writable: false,
        value: (key: PropertyKey) => {
          this.#assertViewLive(captured)
          return this.getShared(key)
        }
      },
      use: {
        enumerable: true,
        configurable: false,
        writable: false,
        value: (...plugins: readonly IPluginConstraint<any>[]) => this.use(...(plugins as any))
      },
      unUse: {
        enumerable: true,
        configurable: false,
        writable: false,
        value: (name: string) => this.unUse(name)
      }
    })
    return Object.freeze(view) as IPluginHostView<this, TViewPlugins>
  }

  #updateRegistration<T extends IPluginConfig>(
    name: string,
    recipe: (previous: Readonly<T>) => Partial<T>
  ): Promise<void> {
    this.#assertActive()
    return this.#enqueue(async () => {
      const registration = this.#registrations.get(name)
      if (!registration)
        throw new PluginHostError('PLUGIN_NOT_INSTALLED', ERROR_TEXT.PLUGIN_NOT_INSTALLED(name))
      const previous = readonlyConfig(registration.config)
      const patch = readPlainDataRecord(recipe(previous as Readonly<T>), 'config patch', true, true)
      const next = copyConfigWithPatch(registration.config, patch)
      try {
        if (registration.plugin.update) {
          this.#beginOperation(registration)
          this.#hookRegistration = registration
          let updateResult: void | Promise<void>
          updateResult = invokeCaptured(registration.plugin.update!, registration.plugin.owner, [
            readonlyConfig(next) as never,
            this.#core(registration)
          ])
          await this.#awaitOperation(updateResult, registration)
          this.#assertOperationCurrent(registration)
        }
      } finally {
        this.#hookRegistration = undefined
      }
      registration.config = next
    })
  }

  get config(): IPluginHostConfigFor<TInstalled> {
    if (this.#configApi) return this.#configApi
    this.#configApi = {
      get: (path: string) => {
        this.#assertActive()
        if (typeof path !== 'string' || path.length === 0)
          throw createPluginHostTypeError('config path must be a non-empty string')
        const registration = [...this.#registrations.entries()]
          .sort(([left], [right]) => right.length - left.length)
          .find(([name]) => path === name || path.startsWith(`${name}.`))?.[1]
        if (!registration) return undefined
        return readConfigPath(registration.config, parseConfigPath(path))
      },
      update: <T extends IPluginConfig>(
        name: string,
        recipe: (previous: Readonly<T>) => Partial<T>
      ) => this.#updateRegistration(name, recipe)
    } as IPluginHostConfigFor<TInstalled>
    return this.#configApi
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
          view: this.#createView() as IPluginHostDynamicView<this>
        })
      const errors = await this.#disposeRegistration(registration)
      const view = this.#createView() as IPluginHostDynamicView<this>
      if (errors.length === 0) return Object.freeze({ ok: true, removed: true, view })
      const error = registerPluginHostDisposalNode(
        new PluginHostError('PLUGIN_DISPOSE_FAILED', ERROR_TEXT.PLUGIN_DISPOSE_FAILED(name), {
          cause: errors[0],
          detail: { errors: Object.freeze([...errors]) }
        }),
        { kind: PluginHostDisposalNodeKind.hostError, phase: 'plugin disposal' }
      )
      try {
        this.#diagnostic(ERROR_TEXT.PLUGIN_DISPOSE_FAILED(name), 'PLUGIN_DISPOSE_FAILED')
      } catch {
        // Diagnostics never alter the committed removal result.
      }
      return Object.freeze({ ok: false, removed: true, view, error })
    })
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
    const timeoutMs = this.#disposeStepTimeoutMs
    if (timeoutMs === false) {
      // dispose timeout 关闭：永久等待，不触发 force。
      return { graceful: run, force: () => {} }
    }
    let settled = false
    return {
      graceful: async () => {
        const pending: Promise<void> = Promise.resolve().then(async () => {
          await run()
        })
        try {
          await this.#pending.track(pending)
        } finally {
          settled = true
        }
      },
      gracefulTimeoutMs: timeoutMs,
      force: () => {
        if (!settled) {
          this.#cleanupAbandoned = true
          throw new PluginHostError(
            'DISPOSE_STEP_TIMEOUT',
            ERROR_TEXT.DISPOSE_STEP_TIMEOUT(phase, timeoutMs)
          )
        }
      }
    }
  }

  /**
   * Runs one disposer group (pipeline disposers / plugin dispose hook / resource disposers) as its
   * own `LifecycleScope` — LIFO release, each item bounded by DISPOSE_STEP_TIMEOUT_MS. Rollback
   * callers can request raw error identities while ordinary disposal retains contextual wrappers.
   */
  async #disposeGroup(
    disposers: readonly (() => void | Promise<void>)[],
    phase: string,
    preserveErrorIdentity = false
  ): Promise<unknown[]> {
    if (disposers.length === 0) return []
    const scope = createLifecycleScope({ errorPolicy: 'collect', scheduler: this.#scheduler })
    for (const dispose of disposers) scope.own(dispose, this.#stepDescriptor(phase, dispose))
    const collected = await scope.dispose()
    return collected.map((entry) => {
      if (preserveErrorIdentity) return entry.error
      const detail = entry.error instanceof Error ? entry.error.message : String(entry.error)
      return registerPluginHostDisposalNode(
        new Error(`${phase}: ${detail}`, { cause: entry.error }),
        {
          kind: PluginHostDisposalNodeKind.disposerWrapper,
          phase
        }
      )
    })
  }

  /** Disposes a registration-owned lifecycle scope and preserves its collected error identities. */
  async #disposeScope(
    scope: import('@migaia/lifecycle').ILifecycleScope | undefined,
    phase: string,
    preserveErrorIdentity = false
  ): Promise<unknown[]> {
    if (!scope) return []
    const collected = await scope.dispose()
    return collected.map((entry) => {
      if (preserveErrorIdentity) return entry.error
      const detail = entry.error instanceof Error ? entry.error.message : String(entry.error)
      return registerPluginHostDisposalNode(
        new Error(`${phase}: ${detail}`, { cause: entry.error }),
        { kind: PluginHostDisposalNodeKind.disposerWrapper, phase }
      )
    })
  }

  /** Disposes one registration and optionally preserves raw rollback error identities. */
  async #disposeRegistration(
    registration: IRegistration<TDomainCore, TValue>,
    preserveErrorIdentity = false
  ): Promise<unknown[]> {
    registration.lifecycle = PluginHostRegistrationLifecycle.dispose
    const errors: unknown[] = []
    // Revoke every published capability before invoking user cleanup. The registration identity
    // remains available locally for ordered cleanup, but no public read or new resource admission
    // can observe it after this commit point.
    if (this.#registrations.get(registration.name) === registration)
      this.#registrations.delete(registration.name)
    for (const key of registration.shared)
      if (this.#shared.get(key)?.owner === registration) this.#shared.delete(key)
    for (const { key } of registration.extensions)
      if (this.#extensionOwners.get(key) === registration) this.#extensionOwners.delete(key)
    try {
      registration.lifecycleController?.abort(
        new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING)
      )
    } catch (error) {
      errors.push(error)
    }
    errors.push(
      ...(await this.#disposeGroup(
        registration.pipelineDisposers,
        'pipeline disposer',
        preserveErrorIdentity
      ))
    )
    if (registration.installed) {
      const pluginDispose = registration.plugin.dispose
        ? () =>
            invokeCaptured(registration.plugin.dispose!, registration.plugin.owner, [
              Object.freeze({
                signal:
                  registration.lifecycleController?.signal ?? this.#executionController.signal,
                deadlineAt: undefined
              } satisfies IPluginDisposalContext)
            ])
        : registration.plugin.disposer
      if (pluginDispose)
        errors.push(
          ...(await this.#disposeGroup(
            [
              async () => {
                this.#hookRegistration = registration
                try {
                  await pluginDispose()
                } finally {
                  this.#hookRegistration = undefined
                }
              }
            ],
            'plugin dispose hook',
            preserveErrorIdentity
          ))
        )
    }
    for (const key of registration.shared)
      if (this.#shared.get(key)?.owner === registration) this.#shared.delete(key)
    if (registration.provisional) {
      try {
        await registration.provisional.rollback()
      } catch (error) {
        if (error instanceof AggregateError) errors.push(...error.errors)
        else errors.push(error)
      }
      registration.provisional = undefined
    } else {
      errors.push(
        ...(await this.#disposeScope(
          registration.scope,
          'resource disposer',
          preserveErrorIdentity
        ))
      )
    }
    for (const { key } of [...registration.extensions].reverse())
      if (this.#extensionOwners.get(key) === registration) this.#extensionOwners.delete(key)
    if (this.#registrations.get(registration.name) === registration)
      this.#registrations.delete(registration.name)
    registration.lifecycle = PluginHostRegistrationLifecycle.idle
    return errors
  }

  /** Completes logical host disposal; concrete consumer facades may narrow the observed result. */
  dispose(): Promise<import('./typing.js').IPluginHostDisposalResult> {
    if (this.#disposePromise) return this.#disposePromise
    if (this.#terminal.lifecycle !== 'open')
      return Promise.resolve({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: Object.freeze([])
      })
    this.#terminal.close()
    this.#cleanupAbandoned = false
    this.#pipelineLeases.seal(this.#pipelineKey)
    try {
      this.#executionController.abort(
        new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING)
      )
    } catch (error) {
      this.#diagnostic(ERROR_TEXT.HOST_DISPOSING, 'HOST_DISPOSING')
      void error
    }
    this.#disposePromise = this.#enqueue(async () => {
      const errors: unknown[] = []
      const drained =
        this.#pipelineDrainTimeoutMs === false
          ? await this.#pipelineLeases.whenZero(this.#pipelineKey).then(() => true)
          : await boundedWait(
              this.#pipelineLeases.whenZero(this.#pipelineKey),
              this.#scheduler.now() + this.#pipelineDrainTimeoutMs,
              { scheduler: this.#scheduler }
            )
      if (!drained) {
        errors.push(
          new PluginHostError(
            'PIPELINE_DRAIN_TIMEOUT',
            ERROR_TEXT.PIPELINE_DRAIN_TIMEOUT(this.#pipelineDrainTimeoutMs as number)
          )
        )
      }
      for (const registration of [...this.#registrations.values()].reverse())
        errors.push(...(await this.#disposeRegistration(registration)))
      this.#syncStages.length = 0
      this.#asyncStages.length = 0
      this.#generatorStages.length = 0
      this.#asyncGeneratorStages.length = 0
      this.#terminal.forceTerminal()
      for (const error of errors) {
        try {
          this.#diagnostic(
            error instanceof Error ? error.message : String(error),
            'CLEANUP_INCOMPLETE'
          )
        } catch {
          // Diagnostics are report-only and cannot change terminal state.
        }
      }
      // Completion describes physical settlement only; settled disposer failures remain visible in
      // cleanupErrors but must not manufacture a physicalCompletion promise.
      const cleanupComplete = drained && this.#pending.size === 0 && !this.#cleanupAbandoned
      const physicalCompletion = cleanupComplete
        ? undefined
        : Promise.all([this.#pending.drain(), this.#pipelineLeases.whenZero(this.#pipelineKey)])
            .then(() => Object.freeze({ cleanupErrors: Object.freeze([]) }))
            .catch((error: unknown) => Object.freeze({ cleanupErrors: Object.freeze([error]) }))
      return Object.freeze({
        logicalTerminal: true,
        cleanupComplete,
        cleanupErrors: Object.freeze([...errors]),
        ...(physicalCompletion ? { physicalCompletion } : {})
      })
    }, true)
    return this.#disposePromise
  }
}

if (asyncDisposeKey !== undefined)
  Object.defineProperty(PluginHost.prototype, asyncDisposeKey, {
    configurable: true,
    value(this: PluginHost<object, unknown>) {
      return this.dispose()
    }
  })
