/**
 * Owns Host admission, hook marks and inter-runtime capabilities; runtime state is explicit and
 * lifecycle algorithms stay in their original owners.
 */
import type { INativeAbortSignal } from '@migaia/utils/promise'
import ERROR_TEXT, {
  attachPluginHostIdentity,
  formatPluginHostDiagnostic,
  PluginHostError,
  PluginHostInternalText
} from './error-text.ts'
import { readHostNodeId } from './host-identity-authority.ts'
import { snapshotPluginDefinitions } from './admission-runtime.ts'
import { type IInstallBatchContext } from './install-runtime.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { matchesManagedHost } from './composition.ts'

import type { IHostCoreConstructionRequest } from './define-host.ts'
import { reportQueueWait, translateQueueRejection } from './host-queue.ts'
import { drainPipelineLeases } from './pipeline-runtime.ts'

import { LifecycleState } from '@migaia/lifecycle'

import { PluginHostDisposalNodeKind } from './cleanup-runtime.ts'

import { PluginHostRuntimeIntegration } from './runtime-integration.ts'
import type { IPipelineDefinitions } from './pipeline-spec.ts'

import { reportDiagnostic } from './diagnostic-report.ts'

import { type IMiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { planTeardown } from '@migaia/capability/graph/dependency'

import { createPluginHostPublication } from './publication.ts'
import { createPluginHandle } from './plugin-handle.ts'

import { PluginHostRegistrationLifecycle } from './state-constants.ts'
import type { IRegistration } from './registry.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginHostDiagnostic } from './host-options-types.ts'
import type { IPluginHandle } from './plugin-handle-types.ts'
import type { IPluginHostCompositionSnapshot } from './composition-types.ts'

import { detachRegistrationStages } from './cleanup-runtime.ts'
import type { IPluginHostRuntimeContext } from './host-runtime-context.ts'
import { defaultDiagnostic } from './host-defaults.ts'
import { PluginHostHandlePort, PluginHostPublicationPort } from './host-publication-runtime.ts'

/** One Host authority, statically narrowed by each runtime's named port type. */
export class PluginHostRuntimePorts<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> {
  /** Explicit Host context, never another runtime's private state. */
  readonly #context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Captures the Host context before the first collaborator is constructed. */
  constructor(context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>) {
    this.#context = context
  }
  /** Original Host receiver and WeakMap identity target. */
  get host() {
    return this.#context.owner.host
  }
  /** Original immutable public identity. */
  get identity() {
    return this.#context.identity
  }
  /** Integration nodes retain the private node issued for the actual Host. */
  get nodeId() {
    return readHostNodeId(this.host)
  }
  /** Configured domain outlet remains absent when no diagnostic callback was supplied. */
  get report() {
    return this.#context.rawDiagnostic === defaultDiagnostic ? undefined : this.reportDomain
  }
  /** Native execution signal shared with scopes, pipeline runners and hook contexts. */
  get executionSignal() {
    return this.#context.executionController.signal as unknown as INativeAbortSignal
  }
  /** Pipeline execution borrows that same cancellation signal. */
  get signal() {
    return this.executionSignal
  }
  /** Pipeline registration borrows the canonical lane collection. */
  get lanes() {
    return this.#context.state.lanes
  }
  /** Stage ordering borrows the canonical slot index. */
  get slots() {
    return this.#context.state.stageSlots
  }
  /** Name resolution borrows the committed registration index. */
  get registrations() {
    return this.#context.state.registrations
  }
  /** Lease draining uses lifecycle's existing quiescence owner. */
  get pipelineLeases() {
    return this.#context.state.lanes.leases
  }
  /** Borrows the canonical state owner or admitted policy. */
  get state() {
    return this.#context.state
  }
  /** Borrows the canonical scheduler owner or admitted policy. */
  get scheduler() {
    return this.#context.scheduler
  }
  /** Borrows the canonical pending owner or admitted policy. */
  get pending() {
    return this.#context.pending
  }
  /** Borrows the canonical terminal owner or admitted policy. */
  get terminal() {
    return this.#context.terminal
  }
  /** Borrows the canonical executionController owner or admitted policy. */
  get executionController() {
    return this.#context.executionController
  }
  /** Borrows the canonical operationRuntime owner or admitted policy. */
  get operations() {
    return this.#context.operationRuntime
  }
  /** Borrows the canonical cleanupRuntime owner or admitted policy. */
  get cleanupRuntime() {
    return this.#context.cleanupRuntime
  }
  /** Borrows the canonical installRuntime owner or admitted policy. */
  get installation() {
    return this.#context.installRuntime
  }
  /** Borrows the canonical removalRuntime owner or admitted policy. */
  get removal() {
    return this.#context.removalRuntime
  }
  /** Borrows the canonical enablementRuntime owner or admitted policy. */
  get enablement() {
    return this.#context.enablementRuntime
  }
  /** Borrows the canonical coreRuntime owner or admitted policy. */
  get core() {
    return this.#context.coreRuntime
  }
  /** Borrows the canonical pipelineDrainTimeoutMs owner or admitted policy. */
  get pipelineDrainTimeoutMs() {
    return this.#context.pipelineDrainTimeoutMs
  }
  /** Borrows the canonical disposeStepTimeoutMs owner or admitted policy. */
  get disposeStepTimeoutMs() {
    return this.#context.disposeStepTimeoutMs
  }

  /** Prefixes diagnostics with the original Host identity, preserving two versus three arguments. */
  readonly diagnostic: IPluginHostDiagnostic = (message, code, error) => {
    /** User callbacks remain receiverless; the coordination context must never escape. */
    const diagnostic = this.#context.rawDiagnostic
    return error === undefined
      ? diagnostic(formatPluginHostDiagnostic(this.host, message), code)
      : diagnostic(formatPluginHostDiagnostic(this.host, message), code, error)
  }
  /** Reports domain errors at the configured Host boundary. */
  readonly reportDomain = (error: unknown): void =>
    reportDiagnostic(
      this.diagnostic,
      PluginHostInternalText.DOMAIN_REPORTED_FAILURE,
      undefined,
      error
    )
  /** Reports queue waiting through the existing diagnostic formatter. */
  readonly reportQueueWait = (info: Parameters<typeof reportQueueWait>[1]): void =>
    reportQueueWait(this.diagnostic, info)
  /** Marks only the original synchronous invocation, preserving exact return identity. */
  readonly invokeHook = <T>(invoke: () => T): T => {
    this.#context.hookInvocationDepth += 1
    try {
      return invoke()
    } finally {
      this.#context.hookInvocationDepth -= 1
    }
  }
  /** Operation admission reads lifecycle's canonical state. */
  readonly isHostOpen = (): boolean => this.#context.terminal.lifecycle === LifecycleState.open
  /** Stage slot allocation remains with committed Host state. */
  readonly allocateSlot = (): bigint => this.#context.state.allocateStageSlot()
  /** Every committed mutation advances the same receipt revision. */
  readonly commit = (): void => this.#context.state.commit()
  /** Cleanup is owned by the registration's current provisional or committed scope. */
  readonly ownCleanup = (
    registration: IRegistration<TDomainCore, TValue>,
    cleanup: () => void
  ): void => {
    ;(registration.provisional ?? registration.scope)!.own(
      cleanup,
      this.cleanupRuntime.createStepDescriptor(
        PluginHostInternalText.RESOURCE_DISPOSER_PHASE,
        cleanup,
        registration
      )
    )
  }
  /** Late cleanup failure keeps its existing diagnostic code and original value. */
  readonly reportLateError = (error: unknown): void =>
    reportDiagnostic(
      this.diagnostic,
      ERROR_TEXT.HOST_DISPOSING,
      PluginHostErrorCode.cleanupIncomplete,
      error
    )
  /** Adds producer provenance while preserving the original failure as cause. */
  readonly wrapDisposalError = (error: unknown, phase: string): PluginHostError => {
    /** Existing error text conversion is part of the disposal diagnostic contract. */
    const detail = error instanceof Error ? error.message : String(error)
    return this.#context.owner.registerDisposalNode(
      new PluginHostError(
        PluginHostErrorCode.pluginDisposeFailed,
        ERROR_TEXT.DISPOSER_FAILED(phase, detail),
        { cause: error }
      ),
      { kind: PluginHostDisposalNodeKind.disposerWrapper, phase }
    )
  }
  /** Records the exact hook owner until the existing runtime clears it. */
  readonly setHookRegistration = (
    registration: IRegistration<TDomainCore, TValue> | undefined
  ): void => {
    this.#context.hookRegistration = registration
  }
  /** Before-release admission blocks config mutation for this exact owner. */
  readonly setBeforeReleaseRegistration = (
    registration: IRegistration<TDomainCore, TValue>
  ): void => {
    this.#context.hookRegistration = registration
    this.#context.releasePending = registration
  }
  /** Late release settlement cannot clear a successor's markers. */
  readonly clearBeforeReleaseRegistrationIfOwner = (
    registration: IRegistration<TDomainCore, TValue>
  ): void => {
    if (this.#context.hookRegistration === registration) this.#context.hookRegistration = undefined
    if (this.#context.releasePending === registration) this.#context.releasePending = undefined
  }
  /** Setup owns and clears this config-mutation admission mark. */
  readonly setSetupPending = (
    registration: IRegistration<TDomainCore, TValue> | undefined
  ): void => {
    this.#context.setupPending = registration
  }
  /** Error attribution retains the same native instance and Host identity. */
  readonly decorateError = <TError extends PluginHostError>(error: TError): TError =>
    attachPluginHostIdentity(error, this.host)
  /** Provider recovery delegates to its sole orchestration owner. */
  readonly resumeAfterProvider = (provider: string, generationChanged: boolean): Promise<void> =>
    this.#context.resumeRuntime.resumeAfterProvider(provider, generationChanged)
  /** Returns the same registration-scoped core facade. */
  readonly createCore = (
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ) => this.#context.coreRuntime.create(registration, batch)
  /** Lends only the public class's protected domain-core capability. */
  readonly createDomainCore = (request: IHostCoreConstructionRequest): TDomainCore =>
    this.#context.owner.createDomainCore(request)
  /** Current install and committed-registration authority remain in their existing owners. */
  readonly assertRegistrationValid = (registration: IRegistration<TDomainCore, TValue>): void =>
    this.state.assertRegistrationValid(registration, this.assertCurrentOperation)
  /** Operation generation validation keeps the original operation-runtime receiver. */
  readonly assertCurrentOperation = (registration: IRegistration<TDomainCore, TValue>): void =>
    this.#context.operationRuntime.assertCurrent(registration)
  /** Prepares declared pipelines against the original candidate batch. */
  readonly preparePipelines = (
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ): void => this.#context.pipelines.prepare(registration, batch)
  /** Features and plugin cores borrow the same registration-scoped pipeline entry. */
  readonly pipeline = (
    name: string,
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>,
    feature?: string
  ): object => this.#context.pipelines.registration(name, registration, batch, feature)
  /** Integration authority is scoped to the original registration and batch. */
  readonly runtimeIntegration = (
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ) => Object.freeze(new PluginHostRuntimeIntegration(this, registration, batch))
  /** Managed aliases compare against the original Host authority. */
  readonly matchesHost = (host: object): boolean => matchesManagedHost(host, this.host)
  /** Synchronous hook attribution never infers asynchronous call origin. */
  readonly currentHookRegistration = () => this.#context.hookRegistration
  /** Config admission observes only actual pending setup. */
  readonly isSetupPending = (): boolean => this.#context.setupPending !== undefined
  /** Config admission observes only actual before-release ownership. */
  readonly isReleasePending = (): boolean => this.#context.releasePending !== undefined
  /** Disposal captures the already-admitted pipeline key set. */
  readonly pipelineKeys = (): readonly object[] => this.#context.pipelines.keys()
  /** Terminal work remains in the original queue, exempt from its admission deadline. */
  readonly enqueueTerminal = <T>(task: () => Promise<T>): Promise<T> => this.enqueue(task, true)
  /** Physical cleanup retires all remaining slots through their canonical owner. */
  readonly clearPipelineState = (): void => {
    this.state.lanes.clear()
    for (const slot of this.state.stageSlots.values()) slot.retired = true
    this.state.stageSlots.clear()
  }
  /** Snapshot admission retains the entry's original trusted-definition authority. */
  readonly snapshotPlugins = (plugins: readonly IPluginConstraint<any>[]) =>
    snapshotPluginDefinitions<TDomainCore, TValue>(plugins, this.#context.trustedDefinitionReader)
  /** Managed composition reads the canonical committed revision. */
  readonly readRevision = (): number => this.state.revision
  /** Rejects closing or terminal access with original Host identity. */
  readonly assertActive = (): void => {
    if (this.#context.terminal.lifecycle === LifecycleState.terminal)
      throw attachPluginHostIdentity(
        new PluginHostError(PluginHostErrorCode.hostDisposed, ERROR_TEXT.HOST_DISPOSED),
        this.host
      )
    if (this.#context.terminal.lifecycle === LifecycleState.closing)
      throw attachPluginHostIdentity(
        new PluginHostError(PluginHostErrorCode.hostDisposing, ERROR_TEXT.HOST_DISPOSING),
        this.host
      )
  }

  /** Rejects synchronous hook reentry before any mutation is queued. */
  readonly assertMutationAllowed = (): void => {
    if (this.#context.hookRegistration || this.#context.hookInvocationDepth > 0)
      throw attachPluginHostIdentity(
        new PluginHostError(PluginHostErrorCode.lifecycleMutation, ERROR_TEXT.LIFECYCLE_MUTATION),
        this.host
      )
  }

  /**
   * Returns committed registrations with dependents before the providers they captured. Admission
   * keeps the dependency graph acyclic, so the teardown plan always exists.
   */
  readonly registrationsInReverse = (): IRegistration<TDomainCore, TValue>[] => {
    /** Dependency order is canonical; this projection visits each returned name once. */
    const registrations: IRegistration<TDomainCore, TValue>[] = []
    for (const name of planTeardown(this.#context.state.dependencyIndex()).order)
      registrations.push(this.#context.state.registrations.get(name)!)
    return registrations
  }

  /** Rethrows a synchronous package error after attributing it to this exact Host. */
  readonly rethrowWithIdentity = (error: unknown): never => {
    throw error instanceof PluginHostError ? attachPluginHostIdentity(error, this.host) : error
  }

  /**
   * `terminal` (used only by `dispose()`) passes `queueAdmissionTimeoutMs: false` for this one
   * task, exempting it from the queue SLA — mirrors the original `#mutationQueue`'s "terminal
   * mutations are never evicted" rule.
   */
  readonly enqueue = <T>(task: () => Promise<T>, terminal = false): Promise<T> =>
    this.#enqueueTask(task, terminal)

  /** Queue rejection translation stays at the original Host boundary. */
  #enqueueTask<T>(task: () => Promise<T>, terminal: boolean): Promise<T> {
    return this.#context.queue
      .enqueue(task, terminal ? { queueAdmissionTimeoutMs: false } : undefined)
      .catch((error: unknown) => {
        /** Queue ownership errors are translated once; original user failures retain identity. */
        const translated = translateQueueRejection(error, this.#context.queueAdmissionTimeoutMs)
        throw translated instanceof PluginHostError
          ? attachPluginHostIdentity(translated, this.host)
          : translated
      })
  }

  /** Default registration and typed named registration use the same entry implementation. */
  readonly registerStage = (
    stage: Function,
    owner: IRegistration<TDomainCore, TValue> | undefined,
    kind: IMiddlewarePipelineMode
  ): void => {
    this.#context.pipelines.default.register(stage, owner, kind)
  }

  /** Seals one registration's pipeline owner and waits for its active leases to drain. */
  readonly drainLeases = async (
    registration: IRegistration<TDomainCore, TValue>,
    cleanupErrors?: unknown[]
  ): Promise<void> => {
    this.#context.state.lanes.retireLeaseOwner(registration, this.#context.state.lanes.leases)
    /** The existing drain result distinguishes physical completion from bounded continuation. */
    const result = await drainPipelineLeases({
      leases: this.#context.state.lanes.leases,
      key: registration.pipelineOwnerKey,
      drainTimeoutMs: this.#context.pipelineDrainTimeoutMs,
      scheduler: this.#context.scheduler
    })
    if (!result.complete) {
      /** Reuse the caller's existing cleanup accumulator; every caller also gets the diagnostic. */
      const error = attachPluginHostIdentity(
        new PluginHostError(
          PluginHostErrorCode.pipelineDrainTimeout,
          ERROR_TEXT.PIPELINE_DRAIN_TIMEOUT(this.#context.pipelineDrainTimeoutMs as number)
        ),
        this.host
      )
      cleanupErrors?.push(error)
      reportDiagnostic(
        this.diagnostic,
        error.message,
        PluginHostErrorCode.pipelineDrainTimeout,
        error
      )
    }
  }

  /** Preparing Feature reads may see their original batch; committed handles resolve live state. */
  readonly createHandle = <TPlugin extends IPluginConstraint<any>>(
    name: string,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ): IPluginHandle<TPlugin> => {
    return createPluginHandle(
      name,
      new PluginHostHandlePort(this.#context, this, batch)
    ) as IPluginHandle<TPlugin>
  }

  /** Publishes a fully prepared candidate without invoking user code or allocating state. */
  readonly publish = (
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): void => {
    this.#context.state.publishInstallBatch(installed, batch)
    for (const registration of installed)
      if (registration.activated) this.#context.enablementRuntime.notifyInstalled(registration)
  }

  /**
   * Synchronous half of useSync rollback: detaches a registration from all host-visible state
   * without running any user disposer code — matches `LifecycleScope.close()`'s "synchronous,
   * idempotent, never calls user code". The table bookkeeping belongs to `PluginHostState`; what
   * stays here is the part that touches the registration's own scope and lifecycle.
   */
  readonly closeRegistrationSync = (
    registration: IRegistration<TDomainCore, TValue>,
    rollbackErrors: unknown[] = []
  ): void => {
    this.#context.state.lanes.retireLeaseOwner(registration, this.#context.state.lanes.leases)
    detachRegistrationStages(registration, rollbackErrors)
    this.#context.state.closeRegistration(registration)
    registration.extensions = []
    registration.scope?.close()
    registration.lifecycle = PluginHostRegistrationLifecycle.dispose
  }

  /** Rejects access through a stale view after any captured registration is revoked. */
  readonly assertLive = (registrations: readonly IRegistration<TDomainCore, TValue>[]): void => {
    for (const registration of registrations)
      if (!this.#context.state.isLive(registration))
        throw attachPluginHostIdentity(
          new PluginHostError(
            PluginHostErrorCode.registrationRevoked,
            ERROR_TEXT.REGISTRATION_REVOKED
          ),
          this.host
        )
  }

  /** Materializes a null-prototype, frozen view over the current committed registrations. */
  readonly createView = (
    registrations: readonly IRegistration<TDomainCore, TValue>[] = [
      ...this.#context.state.registrations.values()
    ]
  ): IPluginHostCompositionSnapshot => {
    /** Publication needs one ordered pass over current registrations. */
    const enabled: IRegistration<TDomainCore, TValue>[] = []
    for (const registration of registrations) if (registration.enabled) enabled.push(registration)
    return createPluginHostPublication<object, TDomainCore, TValue>(
      enabled,
      new PluginHostPublicationPort(this.#context, this)
    )
  }
}
