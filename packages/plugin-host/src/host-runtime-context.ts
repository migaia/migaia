import { PluginHostErrorCode } from './error-code.ts'
import { PLUGIN_HOST_SOURCE } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import type {
  IHostPipelineCollection,
  IHostPipelineEntryConstructor
} from './pipeline-module-types.ts'
import type {
  IHostActivationOperations,
  IHostFeatureOperations,
  IHostEnablementOperations,
  IHostReplaceOperations,
  IHostResumeOperations
} from './host-module-surfaces.ts'
/**
 * Owns Host runtime assembly and explicit coordination context; exports no public Host methods or
 * lifecycle implementation.
 */

import ERROR_TEXT, { PluginHostInternalText } from './error-text.ts'
import { issueHostIdentity } from './host-identity.ts'
import { type IPluginHostIdentity } from './host-identity-types.ts'
import { type ITrustedDefinitionReader } from './definition-snapshots.ts'
import { PluginHostInstallRuntime } from './install-runtime.ts'

import { registerManagedHost } from './composition.ts'
import { PluginHostState } from './host-state.ts'
import type { IHostCoreConstructionRequest } from './define-host.ts'

import { admitHostScheduler, assertTimeoutOption } from './host-options.ts'

import {
  createMutationQueue,
  createAbortController,
  createPendingTracker,
  createTerminalController,
  type IMutationQueue,
  type IAbortController,
  type IPendingTracker,
  type ITerminalController
} from '@migaia/lifecycle'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import type { IPluginHostDisposalProvenance } from './cleanup-runtime.ts'
import { PluginHostCleanupRuntime } from './cleanup-runtime.ts'

import type { IPipelineDefinitions } from './pipeline-spec.ts'
import { PluginHostRemovalRuntime } from './removal-runtime.ts'
import { bindTerminalSink } from './diagnostic-report.ts'
import { PluginHostOperationRuntime } from './operation-runtime.ts'

import { PluginHostCoreRuntime } from './core-runtime.ts'
import { PluginHostConfigRuntime } from './config-runtime.ts'
import { PluginHostDisposalRuntime } from './host-disposal-runtime.ts'

import { HostModules } from './module-runtime.ts'
import type { IPluginHostInstallRuntimePort } from './install-runtime.ts'
import { DefaultPipelineCollection } from './default-pipeline.ts'

import type { IRegistration } from './registry.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginHostDiagnostic, IPluginHostOptions } from './host-options-types.ts'
import type { IPluginHandle, IPluginEnablement } from './plugin-handle-types.ts'

import {
  defaultDiagnostic,
  DEFAULT_MUTATION_TIMEOUT_MS,
  DEFAULT_PIPELINE_DRAIN_TIMEOUT_MS,
  DEFAULT_DISPOSE_STEP_TIMEOUT_MS,
  DEFAULT_QUEUE_ADMISSION_DIAGNOSTIC_MS
} from './host-defaults.ts'
import { HostTimeoutOptionKey } from './host-constants.ts'
import { PluginHostRuntimePorts } from './host-runtime-ports.ts'
import { PluginHostPublicationRuntime } from './host-publication-runtime.ts'
/**
 * Runtime state shared only through named, statically narrowed ports; lifecycle owners retain their
 * own resources.
 */
export type IPluginHostRuntimeContext<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  _TPipelines extends IPipelineDefinitions
> = {
  /** Concrete public Host and its protected domain-core capability. */
  owner: IPluginHostRuntimeOwner<TDomainCore>
  /** Host identity remains issued by the original WeakMap authority. */
  identity: IPluginHostIdentity
  /** Terminal lifecycle and cancellation keep their canonical lifecycle owners. */
  terminal: ITerminalController
  /** Execution cancellation shared by every pipeline and operation. */
  executionController: IAbortController
  /** Tracks physical continuations after logical completion. */
  pending: IPendingTracker
  /** One FIFO mutation queue for all structural changes. */
  queue: IMutationQueue
  /** Admitted scheduler snapshot. */
  scheduler: IScheduler
  /** One canonical committed-state owner. */
  state: PluginHostState<TDomainCore, TValue>
  /** Per-operation generation and deadline owner. */
  operationRuntime: PluginHostOperationRuntime
  /** Bounded disposal and failure classification owner. */
  cleanupRuntime: PluginHostCleanupRuntime
  /** Registration installation owner. */
  installRuntime: PluginHostInstallRuntime<TDomainCore, TValue>
  /** Physical registration cleanup owner. */
  removalRuntime: PluginHostRemovalRuntime<TDomainCore, TValue>
  /** Candidate replacement owner. */
  replaceRuntime?: IHostReplaceOperations<TDomainCore, TValue>
  /** Suspended-dependent recovery owner. */
  resumeRuntime?: IHostResumeOperations
  /** Install-scoped core construction owner. */
  coreRuntime: PluginHostCoreRuntime<TDomainCore, TValue>
  /** Stable config facade and update owner. */
  configRuntime: PluginHostConfigRuntime<TDomainCore, TValue, TInstalled>
  /** Terminal cleanup orchestration owner. */
  hostDisposalRuntime: PluginHostDisposalRuntime<IRegistration<TDomainCore, TValue>>
  /** Reversible availability owner. */
  enablementRuntime?: IHostEnablementOperations<TDomainCore, TValue>
  /** Frozen availability facade, typed for the original Host. */
  plugin: IPluginEnablement<object, TInstalled, TDomainCore, TValue>
  /** Default and named pipelines share one execution owner. */
  pipelines: IHostPipelineCollection<TDomainCore, TValue>
  /** Validated module identities are the sole construction-time extension source. */
  modules: HostModules
  /** Actual optional owners are created only by installed built-ins. */
  featureOperations?: IHostFeatureOperations
  activationOperations?: IHostActivationOperations
  featureRuntime?: IPluginHostInstallRuntimePort<TDomainCore, TValue>['featureRuntime']
  validateInstallBatch?: (
    entries: readonly import('./registry.ts').IInstallEntry<TDomainCore, TValue>[],
    inactive?: import('./dependency-constants.ts').PluginInactiveProviderPolicy,
    roots?: readonly string[]
  ) => ReturnType<
    NonNullable<IPluginHostInstallRuntimePort<TDomainCore, TValue>['validateInstallBatch']>
  >
  createPipelines?: (
    port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, _TPipelines>,
    options: IPluginHostOptions
  ) => IHostPipelineCollection<TDomainCore, TValue>
  pipelineEntry?: IHostPipelineEntryConstructor
  /** Feature planning supplies dependency-safe teardown; core uses reverse install order. */
  teardownOrder?: () => IRegistration<TDomainCore, TValue>[]
  pipelineModes: Map<string, import('@migaia/middleware-pipeline').IPipelineModeObject<any>>
  /** Exact synchronous hook owner, cleared on hook exit. */
  hookRegistration: IRegistration<TDomainCore, TValue> | undefined
  /** Synchronous hook stack depth; asynchronous continuations do not inherit it. */
  hookInvocationDepth: number
  /** Registration awaiting setup, cleared by the installation owner. */
  setupPending: IRegistration<TDomainCore, TValue> | undefined
  /** Registration inside beforeRelease, cleared only by its owner. */
  releasePending: IRegistration<TDomainCore, TValue> | undefined
  /** Host diagnostic callback captured once after admission. */
  rawDiagnostic: IPluginHostDiagnostic
  /** Original terminal diagnostic failure policy. */
  diagnostic: IPluginHostDiagnostic
  /** Admitted drain budget; false preserves unbounded waiting. */
  pipelineDrainTimeoutMs: number | false
  /** Admission deadline remains optional. */
  queueAdmissionTimeoutMs: number | false | undefined
  /** Bounded disposal budget shared by hook and disposer contexts. */
  disposeStepTimeoutMs: number | false
  /** Trusted functional-definition authority, absent for structural hosts. */
  trustedDefinitionReader: ITrustedDefinitionReader | undefined
  /** Same-name activation Promises are removed by their original finally callback. */
  activationRequests: Map<string, Promise<IPluginHandle<IPluginConstraint<any>>>>
}

/** Protected capabilities lent by the public class without exposing them on its surface. */
export type IPluginHostRuntimeOwner<TDomainCore extends object> = Readonly<{
  /** Original receiver for extension calls and identity attribution. */
  host: object
  /** Calls the public class's protected override without changing its receiver. */
  createDomainCore(request: IHostCoreConstructionRequest): TDomainCore
  /** Disposal producer authority belongs to the exact public Host module instance. */
  registerDisposalNode<T extends object>(node: T, provenance: IPluginHostDisposalProvenance): T
}>

/** Assembles existing owners in their original order; callbacks are named port methods. */
export function createHostRuntimeContext<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
>(
  owner: IPluginHostRuntimeOwner<TDomainCore>,
  options: IPluginHostOptions<TPipelines>,
  trustedDefinitionReader?: ITrustedDefinitionReader
) {
  /** Coordination fields precede every runtime that can read them, matching class initialization. */
  const context = {
    owner,
    terminal: createTerminalController(),
    executionController: createAbortController(),
    pending: createPendingTracker(),
    state: new PluginHostState<TDomainCore, TValue>(),
    hookRegistration: undefined,
    hookInvocationDepth: 0,
    setupPending: undefined,
    releasePending: undefined,
    trustedDefinitionReader,
    pipelineModes: new Map()
  } as IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Only omission selects defaults; null remains an invalid execution policy. */
  const execution = options.execution === undefined ? {} : options.execution
  if (execution === null || typeof execution !== 'object')
    throw attachErrorIdentity(new TypeError(PluginHostInternalText.EXECUTION_OBJECT), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  assertTimeoutOption(execution.mutationTimeoutMs, HostTimeoutOptionKey.mutation)
  assertTimeoutOption(execution.pipelineDrainTimeoutMs, HostTimeoutOptionKey.pipelineDrain)
  /** Admitted operation budget; operation authority remains in lifecycle. */
  const mutationTimeoutMs = execution.mutationTimeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS
  context.pipelineDrainTimeoutMs =
    execution.pipelineDrainTimeoutMs ?? DEFAULT_PIPELINE_DRAIN_TIMEOUT_MS
  context.identity = issueHostIdentity(owner.host, options.identity?.name)
  if (options.diagnostic !== undefined && typeof options.diagnostic !== 'function')
    throw attachErrorIdentity(new TypeError(ERROR_TEXT.DIAGNOSTIC_OPTION), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  /** Read once, preserving option accessor behavior and failure timing. */
  const onDiagnosticFailure = options.onDiagnosticFailure
  if (onDiagnosticFailure !== undefined && typeof onDiagnosticFailure !== 'function')
    throw attachErrorIdentity(new TypeError(ERROR_TEXT.DIAGNOSTIC_FAILURE_OPTION), {
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidOption
    })
  context.rawDiagnostic = options.diagnostic ?? defaultDiagnostic
  /** One Host authority is narrowed to the existing port type by each receiving runtime. */
  const port = new PluginHostRuntimePorts(context)
  context.diagnostic = port.diagnostic
  if (onDiagnosticFailure) bindTerminalSink(port.diagnostic, onDiagnosticFailure)
  // This tuple has exactly three entries, fixed here by the supported option contract.
  for (const [label, value] of [
    [HostTimeoutOptionKey.queueAdmission, options.queueAdmissionTimeoutMs],
    [HostTimeoutOptionKey.queueDiagnostic, options.queueAdmissionDiagnosticMs],
    [HostTimeoutOptionKey.disposeStep, options.disposeStepTimeoutMs]
  ] as const)
    assertTimeoutOption(value, label)
  context.scheduler = admitHostScheduler(options.scheduler) ?? systemScheduler
  context.modules = new HostModules(options.modules)
  context.modules.install(context, port, options)
  try {
    context.pipelines =
      context.createPipelines?.(port, options) ??
      new DefaultPipelineCollection(context, port, options.pipeline)
  } catch (error) {
    // Pipeline admission is the last construction step that can reject options after modules run.
    context.modules.rollback(error)
  }
  context.operationRuntime = new PluginHostOperationRuntime({
    parentSignal: context.executionController.signal,
    scheduler: context.scheduler,
    timeoutMs: mutationTimeoutMs,
    isHostOpen: port.isHostOpen,
    diagnostic: port.diagnostic
  })
  context.disposeStepTimeoutMs = options.disposeStepTimeoutMs ?? DEFAULT_DISPOSE_STEP_TIMEOUT_MS
  context.cleanupRuntime = new PluginHostCleanupRuntime(port)
  context.removalRuntime = new PluginHostRemovalRuntime(port)
  context.installRuntime = new PluginHostInstallRuntime(port)
  context.coreRuntime = new PluginHostCoreRuntime(port)
  /** Shared publication is distinct from batch publication; it grants no mutation orchestration. */
  const publication = new PluginHostPublicationRuntime(context, port)
  context.state.configureSharedPublication(publication)
  context.configRuntime = new PluginHostConfigRuntime(port)
  context.hostDisposalRuntime = new PluginHostDisposalRuntime(port)
  context.queueAdmissionTimeoutMs = options.queueAdmissionTimeoutMs
  context.queue = createMutationQueue({
    scheduler: context.scheduler,
    queueAdmissionTimeoutMs: options.queueAdmissionTimeoutMs,
    admissionDiagnosticMs:
      options.queueAdmissionDiagnosticMs === false
        ? undefined
        : (options.queueAdmissionDiagnosticMs ?? DEFAULT_QUEUE_ADMISSION_DIAGNOSTIC_MS),
    onAdmissionDiagnostic:
      options.queueAdmissionDiagnosticMs === false ? undefined : port.reportQueueWait
  })
  registerManagedHost(owner.host, port, port.readRevision, publication.captureView)
  return { context, port }
}
