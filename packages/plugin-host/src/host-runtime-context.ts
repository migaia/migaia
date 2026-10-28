/**
 * Owns Host runtime assembly and explicit coordination context; exports no public Host methods or
 * lifecycle implementation.
 */

import ERROR_TEXT, { createPluginHostTypeError, PluginHostInternalText } from './error-text.js'
import { issueHostIdentity } from './host-identity.js'
import { type IPluginHostIdentity } from './host-identity-types.js'
import { type ITrustedDefinitionReader } from './admission-runtime.js'
import { PluginHostInstallRuntime } from './install-runtime.js'

import { registerManagedHost } from './composition.js'
import { PluginHostState } from './host-state.js'
import type { IHostCoreConstructionRequest } from './define-host.js'

import { admitHostScheduler, assertTimeoutOption } from './host-options.js'

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
import type { IPluginHostDisposalProvenance } from './cleanup-runtime.js'
import { PluginHostCleanupRuntime } from './cleanup-runtime.js'
import { PluginHostPipelines } from './named-pipelines.js'

import type { IPipelineDefinitions } from './pipeline-spec.js'
import { PluginHostRemovalRuntime } from './removal-runtime.js'
import { PluginHostReplaceRuntime } from './replace-runtime.js'
import { PluginHostResumeRuntime } from './resume-runtime.js'
import { bindTerminalSink } from './diagnostic-report.js'
import { PluginHostOperationRuntime } from './operation-runtime.js'

import { PluginHostCoreRuntime } from './core-runtime.js'
import { PluginHostConfigRuntime } from './config-runtime.js'
import { PluginHostDisposalRuntime } from './host-disposal-runtime.js'

import {
  PluginHostEnablementRuntime,
  createPluginHostEnablementFacade
} from './enablement-runtime.js'

import type { IRegistration } from './registry.js'
import type { IPluginConstraint } from './plugin-definition-types.js'
import type { IPluginHostDiagnostic, IPluginHostOptions } from './host-options-types.js'
import type { IPluginHandle, IPluginEnablement } from './plugin-handle-types.js'

import {
  defaultDiagnostic,
  DEFAULT_MUTATION_TIMEOUT_MS,
  DEFAULT_PIPELINE_DRAIN_TIMEOUT_MS,
  DEFAULT_DISPOSE_STEP_TIMEOUT_MS,
  DEFAULT_QUEUE_ADMISSION_DIAGNOSTIC_MS
} from './host-defaults.js'
import { HostTimeoutOptionKey } from './host-constants.js'
import { PluginHostRuntimePorts } from './host-runtime-ports.js'
import { PluginHostPublicationRuntime } from './host-publication-runtime.js'
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
  replaceRuntime: PluginHostReplaceRuntime<TDomainCore, TValue>
  /** Suspended-dependent recovery owner. */
  resumeRuntime: PluginHostResumeRuntime<TDomainCore, TValue>
  /** Install-scoped core construction owner. */
  coreRuntime: PluginHostCoreRuntime<TDomainCore, TValue>
  /** Stable config facade and update owner. */
  configRuntime: PluginHostConfigRuntime<TDomainCore, TValue, TInstalled>
  /** Terminal cleanup orchestration owner. */
  hostDisposalRuntime: PluginHostDisposalRuntime<IRegistration<TDomainCore, TValue>>
  /** Reversible availability owner. */
  enablementRuntime: PluginHostEnablementRuntime<TDomainCore, TValue>
  /** Frozen availability facade, typed for the original Host. */
  plugin: IPluginEnablement<object, TInstalled, TDomainCore, TValue>
  /** Default and named pipelines share one execution owner. */
  pipelines: PluginHostPipelines<TDomainCore, TValue>
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
    activationRequests: new Map()
  } as IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Only omission selects defaults; null remains an invalid execution policy. */
  const execution = options.execution === undefined ? {} : options.execution
  if (execution === null || typeof execution !== 'object')
    throw createPluginHostTypeError(PluginHostInternalText.EXECUTION_OBJECT)
  assertTimeoutOption(execution.mutationTimeoutMs, HostTimeoutOptionKey.mutation)
  assertTimeoutOption(execution.pipelineDrainTimeoutMs, HostTimeoutOptionKey.pipelineDrain)
  /** Admitted operation budget; operation authority remains in lifecycle. */
  const mutationTimeoutMs = execution.mutationTimeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS
  context.pipelineDrainTimeoutMs =
    execution.pipelineDrainTimeoutMs ?? DEFAULT_PIPELINE_DRAIN_TIMEOUT_MS
  context.identity = issueHostIdentity(owner.host, options.identity?.name)
  if (options.diagnostic !== undefined && typeof options.diagnostic !== 'function')
    throw createPluginHostTypeError(ERROR_TEXT.DIAGNOSTIC_OPTION)
  /** Read once, preserving option accessor behavior and failure timing. */
  const onDiagnosticFailure = options.onDiagnosticFailure
  if (onDiagnosticFailure !== undefined && typeof onDiagnosticFailure !== 'function')
    throw createPluginHostTypeError(ERROR_TEXT.DIAGNOSTIC_FAILURE_OPTION)
  context.rawDiagnostic = options.diagnostic ?? defaultDiagnostic
  /** One Host authority is narrowed to the existing port type by each receiving runtime. */
  const port = new PluginHostRuntimePorts(context)
  context.diagnostic = port.diagnostic
  if (onDiagnosticFailure) bindTerminalSink(port.diagnostic, onDiagnosticFailure)
  context.enablementRuntime = new PluginHostEnablementRuntime(port)
  context.plugin = createPluginHostEnablementFacade<object, TInstalled, TDomainCore, TValue>(
    context.enablementRuntime,
    port
  )
  context.pipelines = new PluginHostPipelines(port, options.pipeline, options.pipelines)
  // This tuple has exactly three entries, fixed here by the supported option contract.
  for (const [label, value] of [
    [HostTimeoutOptionKey.queueAdmission, options.queueAdmissionTimeoutMs],
    [HostTimeoutOptionKey.queueDiagnostic, options.queueAdmissionDiagnosticMs],
    [HostTimeoutOptionKey.disposeStep, options.disposeStepTimeoutMs]
  ] as const)
    assertTimeoutOption(value, label)
  context.scheduler = admitHostScheduler(options.scheduler) ?? systemScheduler
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
  context.replaceRuntime = new PluginHostReplaceRuntime(port)
  context.resumeRuntime = new PluginHostResumeRuntime(port)
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
