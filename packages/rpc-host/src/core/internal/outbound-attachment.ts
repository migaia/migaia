import { carrierSizeBytes } from '../adapters/probe-content.js'
import {
  createRpcAbortError,
  createRpcAuthenticationError,
  createRpcContractError,
  createRpcError,
  createRpcProtocolError,
  createRpcRemoteError,
  createRpcSerializationError,
  createRpcTimeoutError,
  isLocalRpcError,
  localRpcErrorCode,
  RpcAbortError,
  RpcCoreErrorCode,
  RpcError,
  RpcLifecycleError,
  RpcRemoteError,
  RpcTimeoutError,
  tagRpcError
} from '../errors.js'
import { readCanonicalReceiver } from './plugin-shared-keys.js'
import { deferred } from '@migaia/utils/promise'
import {
  createOutboundEnvelope,
  createRuntimeOutboundEnvelope,
  createRuntimeRequestOutboundEnvelope,
  createOwnedRuntimeRequestOutboundEnvelope,
  isRuntimeRequestInput,
  readRuntimeRequestInput,
  retainRuntimeRequestInput,
  retainForwardOptions,
  readForwardRoute
} from './outbound-envelope.js'
import { hasFastEndpoint, hasFastComponents, hasDecodedRuntimeMetadata } from './fast-path.js'
import {
  hasBatchAgreement,
  batchPayloadLimit,
  readTransportCapabilities,
  readPeerTransportCapabilities,
  readPeerTransportPipeline,
  type IRpcPeerTransportPipeline,
  hasCloneTransferCarrier
} from './batch-frame.js'
import { readRuntimeCarrier } from '@migaia/rpc-contract/runtime'
import {
  createRuntimeCallEnvelope,
  type IRpcRuntimeCallHeader
} from '@migaia/rpc-contract/runtime/metadata'
import {
  readRpcNativeBinary,
  assertRpcNativeBinaryFrameSize,
  isRpcBinaryIntegrityFailure
} from '@migaia/rpc-contract/binary/inspect'
import {
  normalizeInboundRpcEnvelope,
  normalizeInboundRuntimeEnvelope,
  normalizeInboundDecodedRuntimeEnvelope,
  normalizeInboundDecodedRuntimeBinaryEnvelope,
  restoreInboundRuntimeBinary,
  restoreInboundDecodedRuntimeBinary
} from './inbound-normalization.js'
import { RpcMiddlewareErrorText } from '../middleware/error-text.js'
import { RpcBinaryProfile, RpcBinaryStorage } from '@migaia/rpc-contract/framing/v1'
import { runtimeOperationCapabilities } from '@migaia/rpc-contract/runtime'
import {
  RpcRuntimeKind,
  RpcRuntimeOperation,
  RpcRuntimeCancel,
  RpcRuntimeMode,
  RpcRuntimeProfile
} from '@migaia/rpc-contract/framing/v1'
import type { IRpcRuntimeEnvelope, IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import type {
  IRpcRuntimeTask,
  IRpcRuntimeOptions,
  IRpcRuntimeStep
} from '@migaia/rpc-contract/runtime'
import { RpcCapability, RpcBatchPhysical } from '@migaia/rpc-contract'
import type { ProviderAdmissionRegistry, IProviderIngressReceipt } from './provider-admission.js'
import { readRpcBatchMembers, assertRpcPhysicalFrameSize } from '@migaia/rpc-contract/framing'
import { RPC_CONTRACT_SOURCE, RpcContractErrorCode } from '@migaia/rpc-contract/errors'
import { attachErrorIdentity } from '@migaia/utils/error'
import type { IInboundIdentityPreparedSource } from './inbound-identity.js'

import { enableFastTimePort } from './time-port.js'
import {
  selectedJsonObjectPort,
  releaseJsonObjectSelection,
  JsonObjectSelectionResource
} from './json-object-port.js'
import { bindRpcFrameIngress } from '@migaia/rpc-contract/framing'
import { RpcPlatform } from '../transport-constants.js'

import {
  RpcMessageKind,
  RpcProviderRejectionReason,
  RpcReplayCapacityNamespace,
  RPC_REPLAY_CAPACITY_REPORT_INTERVAL_MS
} from '../semantic-constants.js'
import { RpcCoreErrorText } from '../error-text.js'
import type {
  IRpcFanoutResult,
  IRpcHook,
  IRpcHookEvent,
  IRpcAuthenticationCapability,
  IRpcContractCapability,
  IRpcTimeoutCapability,
  IRpcUuidConfig,
  ISendOptions
} from '../typing.js'
import { assertContractMethod as assertMethod, validateContractData } from './contract.js'
import {
  normalizePortable,
  RpcControl,
  RpcEnvelopeKind,
  RpcRouteProfile,
  RpcWireLimit,
  type IRpcEnvelope,
  type IRpcEnvelopeData,
  type IRpcPortableValue,
  type IRpcResponseFailure,
  type IRpcWireErrorFailure
} from '@migaia/rpc-contract'
import { createRpcUnknownFieldWarner } from '@migaia/rpc-contract'
import {
  deserializeRpcError,
  serializeRpcError,
  registerLocalErrorWireSummary
} from './error-wire-metadata.js'
import { RpcProtocolEvent } from '../protocol-constants.js'
import { EndpointOwnerKey, type IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IRpcInboundMessage } from '../transport.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import { HookRegistry } from './hooks.js'
import { allocateRpcId, assertRpcIdempotencyKey } from './id.js'
import { PendingRegistry } from './pending.js'
import { RpcOutboundSender } from './outbound-sender.js'
import { outboundGateMatchesFeature, readOutboundGate } from './outbound-gate.js'
import { RpcOutboundAdmission, type IRpcOutboundGate } from './outbound-gate.js'
import { ReplayWindow } from './replay.js'
import { claimNativeReplayTransport, type INativeReplayReceipt } from './native-replay.js'
import { createNativeDefaultAllocator } from './native-default-id.js'
import { NativeDefaultIdText } from './native-default-id-text.js'
import {
  bindAuthenticationReplayContext,
  bindAuthenticationBinaryValidation,
  readAuthenticationBinaryDigest,
  markAuthenticationReplayEnvelope,
  consumedAuthenticationFrame,
  readAuthenticationChallengeProof,
  readAuthenticationChallengePort,
  RpcAuthenticationControl,
  assertAuthenticationChallengeEnvelope
} from './authentication-replay.js'
import { OperationScope } from './operation-scope.js'
import { InboundIdentityCoordinator, type IInboundIdentityAdmission } from './inbound-identity.js'
import { RpcVariationCoordinator } from './variation-coordinator.js'
import { createSafeRecord, fanoutDeliveryKey, runtimeTaskKey } from './safe-value.js'
import {
  readSelectedFramerChunks,
  RpcDebugProperty,
  type IRpcEndpointDebugSnapshot
} from './test-observer.js'
import type { IRpcDiscoveryResolverPort } from './plugin-shared-keys.js'
import type { IRpcFrameAdmission, IRpcStreamOpenCommand } from './plugin-shared-keys.js'
import type { IEndpointTimer } from './time-port.js'
import { createEndpointTransportActivation } from './transport-activation.js'
import { resolveAbortReason, raceWithAsyncControl } from './async-control.js'
import type { IRpcOneWayOptions } from '../features/one-way.js'
import {
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage
} from '../probe/constants.js'
import { envelopeProbeKind, runtimeProbeKind, type IProbeEmitter } from './probe-emitter.js'

/** One pending slim-client request and its terminal cleanup handles. */
type IOutboundPending = {
  readonly targetId: string
  readonly method: string
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  readonly cleanup: () => void
  /** Opt-in tasks correlate full mode/method/generation identity in the original pending registry. */
  readonly runtimeTask?: IRpcRuntimeTask
}

/** Signals remain local; only the closed portable options enter an opted-in physical frame. */
export type IRpcRuntimeSendOptions = Omit<IRpcRuntimeOptions, 'timeoutMs'> &
  Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>

/** The original raw operation input stays on its caller record without another payload capture. */
type IRuntimeOperationInput = Readonly<{
  method?: string
  payload?: IRpcPortableValue
  steps?: readonly IRpcRuntimeStep[]
  idempotencyKey?: string
}>

/** One admitted runtime call carries the existing operation and original option/input objects. */
type IRuntimeOperationPlan = Readonly<{
  owner: RpcOutboundAttachment
  taskId: string
  task: IRpcRuntimeTask
  input: IRuntimeOperationInput
  options: IRpcRuntimeSendOptions
  wireOptions: IRpcRuntimeOptions
  operation: OperationScope
  awaitNotifyTerminal: boolean
}>

/** Receiver identity selected for one logical target before a frame is emitted. */
export type IOutboundReceiver = {
  readonly receiverId: string
  readonly verifiedPeerKey?: string
}

/** Shared runtime contract exposed to the provider security attachment. */
export type IOutboundAttachmentHost = {
  readonly id: string
  /** Receiver identity advertised by discovery and required on inbound frames. */
  readonly receiverId: string
  readonly kernel: IEndpointKernelHost
  readonly targetIds: readonly string[]
  sendFrame(
    message: IRpcEnvelope,
    transfer?: readonly unknown[],
    admission?: IRpcFrameAdmission
  ): Promise<void>
  sendStreamOpen(command: IRpcStreamOpenCommand): Promise<void>
  onTransportFailure(listener: (error: unknown) => void): () => void
  dispatch(targetId: string, method: string, data: unknown): void
  sendOneWay(
    targetId: string,
    method: string,
    data: unknown,
    options?: IRpcOneWayOptions
  ): Promise<void>
  readonly hooks: { on(listener: IRpcHook): () => void }
  emitFailure(error: unknown, code?: string, field?: string, detail?: IRpcHookEvent['detail']): void
  emitDiagnostic(event: Omit<IRpcHookEvent, 'at' | 'localId'>): void
  noteUnknownField(connection: string, kind: string, pointer: string, field: string): void
  readonly inboundIdentity: InboundIdentityCoordinator
  readonly variations: RpcVariationCoordinator
  send<T>(targetId: string, method: string, data: unknown, options?: ISendOptions): Promise<T>
  sendAll<T>(method: string, data: unknown, options?: ISendOptions): Promise<IRpcFanoutResult<T>>
  dispatchAll(method: string, data: unknown): void
  setReceiverResolver(resolver: (targetId: string) => Promise<IOutboundReceiver>): void
  resolveReceiver(targetId: string, receiverId?: string): Promise<IOutboundReceiver>
  validate(method: string, side: 'params' | 'result', data: unknown): void
  debugSnapshot(): IRpcEndpointDebugSnapshot
}

/** Canonical outbound/client owner attached to one endpoint kernel. */
export class RpcOutboundAttachment implements IOutboundAttachmentHost {
  /** Runtime request state stays inside the original outbound owner and pending registry. */
  static readonly #RuntimeOperation = class
    extends RpcOutboundAdmission
    implements IOutboundPending
  {
    /** Existing pending correlation reads the target without extracting any task authority. */
    readonly targetId: string
    /** Populated at the original pending-registration point after receiver and envelope preparation. */
    method = ''
    /** Same complete task tuple fences reply identity and generation. */
    readonly runtimeTask: IRpcRuntimeTask
    /** The original completion is the one public Promise settled by the pending record. */
    readonly #completion = deferred<unknown>()
    /** Captured owner, input and options are the original operation values, never a second snapshot. */
    readonly #plan: IRuntimeOperationPlan
    /** Probe duration shares the existing monotonic operation clock and owns no timer. */
    #probeStartedAt = -1

    /** Receiver selection supplies this exact immutable envelope before any listener or write. */
    #envelope: IRpcRuntimeEnvelope | undefined
    /** Physical commit remains separate from an internal notification terminal receipt. */
    #sent = false
    /** One guard owns all replay, deadline, pending and listener cleanup. */
    #settled = false
    /** Original endpoint timer retains the logical caller budget. */
    #timer: IEndpointTimer | undefined
    /** External abort callback exists only if an actual caller signal registers it. */
    #abortListener: (() => void) | undefined
    /** Computed at the same original post-capture point before pending registration. */
    #terminalReceipt = false
    /** Admission retains original local caller signals; no native child signal is allocated here. */
    signals!: readonly import('@migaia/utils/promise').IAbortSignal[]
    /** The extension gate contract permits extracting this receiver-free admission callback. */
    readonly assertCanSend = (): void => this.#assertActive()

    constructor(targetId: string, plan: IRuntimeOperationPlan) {
      super(plan.operation)
      this.targetId = targetId
      this.runtimeTask = plan.task
      this.#plan = plan
      if (
        plan.owner.#probe !== undefined &&
        (plan.owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#probeStartedAt = plan.owner.kernel.time.scheduler.now()
    }

    /** Established native selection can prepare directly; a genuine miss retains its continuation. */
    start(): Promise<unknown> {
      try {
        /** The accepted original binding supplies the actual physical receiver. */
        const receiver = this.#plan.owner.#selectRuntimeReceiver(this.targetId)
        if (receiver instanceof Promise) void this.#awaitReceiver(receiver)
        else this.#prepare(receiver)
      } catch (error) {
        this.#captureFailed(error)
      }
      return this.#completion.promise
    }

    /** Capture failure precedes public listener registration and retains its original cleanup point. */
    #captureFailed(error: unknown): void {
      this.#plan.owner.#replay.releaseId(this.#plan.taskId)
      this.#plan.operation.finish()
      if (
        this.#plan.owner.#probe !== undefined &&
        (this.#plan.owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#plan.owner.#probe.message(
          RpcProbeDirection.outbound,
          this.runtimeTask.mode === RpcRuntimeMode.notify
            ? RpcProbeKind.notify
            : RpcProbeKind.request,
          RpcProbeOutcome.failed,
          this.#plan.taskId,
          this.runtimeTask.method,
          this.#plan.owner.id,
          this.targetId,
          undefined,
          this.#probeStartedAt < 0
            ? 0
            : this.#plan.owner.kernel.time.scheduler.now() - this.#probeStartedAt,
          undefined,
          error
        )
      this.#completion.reject(error)
    }

    /** The original selection failure releases only the id and scope, before listener registration. */
    async #awaitReceiver(receiver: Promise<IOutboundReceiver>): Promise<void> {
      let selected: IOutboundReceiver
      try {
        selected = await receiver
        this.#prepare(selected)
      } catch (error) {
        this.#captureFailed(error)
      }
    }

    /** Header preparation retains the original clock, forwarding reads and strict input policy. */
    #prepare(receiver: IOutboundReceiver): void {
      const { owner, taskId, task, input, options, wireOptions, operation } = this.#plan
      const mode = task.mode
      operation.assertActive(owner.kernel.generation)
      const preparedInput = mode !== RpcRuntimeMode.group && isRuntimeRequestInput(input)
      const message = {
        profile: RpcRuntimeProfile,
        kind:
          mode === RpcRuntimeMode.group
            ? RpcRuntimeKind.group
            : mode === RpcRuntimeMode.outcome
              ? RpcRuntimeKind.outcome
              : RpcRuntimeKind.call,
        id: taskId,
        task,
        ...(mode === RpcRuntimeMode.outcome
          ? { operation: RpcRuntimeOperation.lookup, idempotencyKey: input.idempotencyKey }
          : { options: wireOptions }),
        route: {
          applicationVersion: owner.#version,
          senderId: owner.id,
          targetId: this.targetId,
          receiverId: receiver.receiverId,
          sentAt: owner.kernel.time.timestamp(),
          ...(readForwardRoute(options) === undefined
            ? {}
            : { forwardRoute: readForwardRoute(options) })
        },
        ...(mode === RpcRuntimeMode.group
          ? { steps: input.steps }
          : preparedInput || input.payload === undefined
            ? {}
            : { payload: input.payload })
      }
      this.#envelope = preparedInput
        ? message.kind === RpcRuntimeKind.call
          ? createOwnedRuntimeRequestOutboundEnvelope(
              message as IRpcRuntimeCallHeader,
              input as { method: string }
            )
          : createRuntimeRequestOutboundEnvelope(message, input as { method: string })
        : createRuntimeOutboundEnvelope(message)
      if (owner.#probe !== undefined && (owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0)
        owner.#probe.message(
          RpcProbeDirection.outbound,
          runtimeProbeKind(this.#envelope),
          RpcProbeOutcome.created,
          taskId,
          task.method,
          owner.id,
          this.targetId,
          undefined,
          -1,
          undefined,
          undefined
        )
      this.#register()
    }

    /** The public Promise keeps the original executor rejection point for post-capture setup. */
    #register(): void {
      const { owner, taskId, task, input, options, awaitNotifyTerminal } = this.#plan
      try {
        this.#terminalReceipt =
          awaitNotifyTerminal ||
          task.mode !== RpcRuntimeMode.notify ||
          options.cancel === RpcRuntimeCancel ||
          options.orderKey !== undefined
        if (this.#terminalReceipt) {
          this.method = input.method ?? ''
          owner.#pending.set(taskId, this)
        }
      } catch (error) {
        this.#completion.reject(error)
        return
      }
      try {
        options.signal?.addEventListener('abort', (this.#abortListener ??= () => this.#onAbort()), {
          once: true
        })
        if (options.signal?.aborted) this.#onAbort()
        if (this.#settled) return
        if (options.timeoutMs !== undefined && options.timeoutMs !== false)
          this.#timer = owner.kernel.time.setTimeout(
            () => this.cancel(createRpcTimeoutError()),
            options.timeoutMs
          )
        this.signals = options.signal ? [options.signal] : []
        void this.#write()
      } catch (error) {
        this.reject(error)
      }
    }

    /** Actual physical completion is the only asynchronous continuation in this stable write method. */
    async #write(): Promise<void> {
      const { owner, task, options, awaitNotifyTerminal } = this.#plan
      try {
        await owner.#pipeline.sendRuntime(
          this.#envelope!,
          owner.#runtimeCapabilities!,
          this,
          this,
          undefined,
          options
        )
      } catch (error) {
        this.reject(error)
        // A terminal before physical settlement cannot conceal the original write failure.
        this.#completion.reject(error)
        return
      }
      if (task.mode === RpcRuntimeMode.notify) {
        if (!this.#terminalReceipt) {
          this.#settled = true
          this.#plan.operation.markSuccess()
          this.cleanup()
        }
        if (!awaitNotifyTerminal) this.#completion.resolve(undefined)
      }
    }

    /** Sender calls this same record immediately before its actual physical host invocation. */
    started(): void {
      this.#sent = true
    }

    /** Original live checks reject a late or cancelled write without another admission pass. */
    #assertActive(): void {
      if (this.#settled) throw createRpcAbortError()
      this.#plan.operation.assertActive(this.#plan.owner.kernel.generation)
    }

    /** Terminal cleanup releases each original handle before exposing the public settlement. */
    cleanup(): void {
      const { owner, taskId, options, operation } = this.#plan
      if (this.#timer) owner.kernel.time.clearTimeout(this.#timer)
      options.signal?.removeEventListener('abort', this.#abortListener!)
      owner.#pending.delete(taskId)
      owner.#replay.releaseId(taskId)
      operation.finish()
    }

    /** Pending uses this stable method with its own record receiver. */
    reject(error: unknown): void {
      if (this.#settled) return
      this.#settled = true
      this.cleanup()
      if (
        this.#plan.owner.#probe !== undefined &&
        (this.#plan.owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#plan.owner.#probe.message(
          RpcProbeDirection.outbound,
          this.#envelope === undefined ? RpcProbeKind.request : runtimeProbeKind(this.#envelope),
          RpcProbeOutcome.failed,
          this.#plan.taskId,
          this.runtimeTask.method,
          this.#plan.owner.id,
          this.targetId,
          undefined,
          this.#probeStartedAt < 0
            ? 0
            : this.#plan.owner.kernel.time.scheduler.now() - this.#probeStartedAt,
          undefined,
          error
        )
      if (
        this.runtimeTask.mode === RpcRuntimeMode.notify &&
        this.#sent &&
        !this.#plan.awaitNotifyTerminal
      )
        this.#plan.owner.emitFailure(error)
      else this.#completion.reject(error)
    }

    /** The exact pending Promise resolves only after original success and cleanup. */
    resolve(result: unknown): void {
      if (this.#settled) return
      this.#settled = true
      this.#plan.operation.markSuccess()
      this.cleanup()
      if (
        this.#plan.owner.#probe !== undefined &&
        (this.#plan.owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#plan.owner.#probe.message(
          RpcProbeDirection.outbound,
          this.#envelope === undefined ? RpcProbeKind.request : runtimeProbeKind(this.#envelope),
          RpcProbeOutcome.settled,
          this.#plan.taskId,
          this.runtimeTask.method,
          this.#plan.owner.id,
          this.targetId,
          undefined,
          this.#probeStartedAt < 0
            ? 0
            : this.#plan.owner.kernel.time.scheduler.now() - this.#probeStartedAt,
          undefined,
          undefined
        )
      if (this.runtimeTask.mode !== RpcRuntimeMode.notify || this.#plan.awaitNotifyTerminal)
        this.#completion.resolve(result)
    }

    /** Ordinary abort/deadline preserves the original before-start or routed cancellation policy. */
    cancel(reason: unknown): void {
      if (this.#settled) return
      if (!this.#sent || this.runtimeTask.mode === RpcRuntimeMode.outcome) {
        this.reject(reason)
        return
      }
      void this.#sendCancellation(reason)
      if (this.#plan.options.cancel !== RpcRuntimeCancel) this.reject(reason)
    }

    /** Only actual cancel transmission retains a real send continuation and failure report. */
    async #sendCancellation(reason: unknown): Promise<void> {
      /** Inline bytes stay entirely in the original protected physical frame. */
      const envelope = this.#envelope!
      /** Replies belong to the original consumer registry, independently from scalar pending. */
      const owner = this.#plan.owner
      try {
        await owner.sendRuntimeFrame({
          profile: RpcRuntimeProfile,
          id: envelope.id,
          kind: RpcRuntimeKind.control,
          operation: RpcRuntimeOperation.cancel,
          task: this.runtimeTask,
          route: envelope.route,
          reason: serializeRpcError(reason, { report: owner.#runtimeErrorReport })
        })
      } catch (error) {
        owner.emitFailure(error)
      }
    }

    /** Native caller reason is read at the original cancellation callback point. */
    #onAbort(): void {
      const options = this.#plan.options
      this.cancel(
        createRpcAbortError(
          undefined,
          undefined,
          options.signal ? resolveAbortReason(options.signal) : undefined
        )
      )
    }
  }
  /** All runtime scopes share the original canonical clock callable, without per-call captures. */
  readonly #runtimeNow = (): number => this.kernel.time.scheduler.now()
  /** Construction captures the endpoint's sole emitter; receive/send never look up a port. */
  readonly #probe: IProbeEmitter | undefined
  /** Id allocation still checks the original replay owner synchronously. */
  readonly #runtimeReserved = (id: string): boolean => this.#replay.hasReservedId(id)
  /** Existing error serializer reporting remains endpoint-owned and receiver-free. */
  // The nested RuntimeCall record uses this private member through its held owner.
  // eslint-disable-next-line no-unused-private-class-members
  readonly #runtimeErrorReport = (failure: { error: unknown }): void =>
    this.emitFailure(failure.error)

  /** Validated endpoint identifier. */
  readonly id: string
  /** Stable local receiver identity used by multiplexed discovery routing. */
  readonly receiverId: string
  /** One kernel shared by all selected attachments. */
  readonly kernel: IEndpointKernelHost
  /** Immutable configured remote target set. */
  readonly targetIds: readonly string[]
  /** Contract version placed on outbound requests. */
  readonly #version: string
  /** Identifier generator snapshot installed by middleware. */
  readonly #uuid: IRpcUuidConfig
  /** Contract validation owner shared with provider execution. */
  readonly #validateData: IRpcContractCapability['validateData']
  /** Validated canonical descriptors retained for the endpoint lifetime. */
  readonly #components: import('./endpoint-options.js').IRpcSelectedComponents
  /** Private receive components are captured once after ordinary construction admission. */
  readonly #runtimeComponents: import('./endpoint-options.js').IRpcSelectedComponents
  /** The receive owner selects decoded metadata only from its held decoder and actual clone carrier. */
  readonly #decodedMetadata: boolean
  /** Optional inbound/outbound protection capability. */
  readonly #authentication: IRpcAuthenticationCapability | undefined
  /** Source-less physical channels share the endpoint's authentication partition. */
  // oxlint-disable-next-line no-unused-private-class-members -- InboundPhysicalOperation reads this lexical private member through its held original owner.
  readonly #authenticationPhysicalSession = {}
  /** Actual object sources partition authentication weakly; primitive token text grants no proof. */
  // oxlint-disable-next-line no-unused-private-class-members -- InboundPhysicalOperation reads this lexical private member through its held original owner.
  readonly #authenticationSessions = new WeakMap<object, object>()
  /** One native claim is shared by provider and stream owners, never reconstructed from metadata. */
  readonly #native: INativeReplayReceipt | undefined
  /** Secure canonical initialization alone grants the default allocator non-reuse exemption. */
  readonly #defaultGenerate: (() => string) | undefined

  /** Optional stream allocation uses this same endpoint counter without claiming another owner. */
  get defaultGenerate(): (() => string) | undefined {
    return this.#defaultGenerate
  }
  /** Canonical dynamic timeout capability installed by middleware. */
  readonly #timeout: IRpcTimeoutCapability
  /** Enables caller abort semantics only when the abort capability is selected. */
  readonly #abortEnabled: boolean
  /** Outbound transport/protocol pipeline. */
  readonly #pipeline: RpcOutboundSender
  /** Once-finalized private proof selects only the canonical request/response optimization. */
  readonly #fast: boolean
  /** Qualified batch sending and synchronous identity admission. */
  readonly #batch: boolean
  /** Factory-owned framing overhead is shared by ingress and the existing sender. */
  readonly #physicalLimit: number
  /** Only a genuine negotiated runtime base enables selector parsing on this original port. */
  readonly #runtimeCapabilities: readonly string[] | undefined
  /** The original runtime assembly supplies its accepted execution/session identity once. */
  #runtimeGeneration: IRpcRuntimeGeneration | undefined
  /** Optional wrapper-owned whole-envelope gate selected before the sender is constructed. */
  readonly #outboundGate: IRpcOutboundGate | undefined
  /** Active request settlements keyed by wire task id. */
  readonly #pending = new PendingRegistry<IOutboundPending>()
  /** Optional stream owners observe the same canonical transport failure as requests. */
  #transportFailureListener: ((error: unknown) => void) | undefined
  /** Prevents active and recently released task-id reuse. */
  readonly #replay: ReplayWindow
  /** Last capacity report in the monotonic clock; one constant-size budget spans both namespaces. */
  #lastCapacityReportAt: number | undefined
  /** Hook callbacks owned by the outbound runtime. */
  readonly #hooks = new HookRegistry()
  /** Per-connection warning cache for additive fields and unknown control subtypes. */
  readonly #unknownFields = createRpcUnknownFieldWarner({
    warn: (_connection, field) =>
      this.emitDiagnostic({ name: RpcProtocolEvent.unknownField, field })
  })

  /** Route control payload warnings through the same per-connection cache as envelope fields. */
  noteUnknownField(connection: string, kind: string, pointer: string, field: string): void {
    this.#unknownFields.note(connection, kind, pointer, field)
  }
  /** Shared inbound source-proof/connect/binding owner for all selected features. */
  readonly inboundIdentity: InboundIdentityCoordinator
  /** Shared variation route and admission owner for optional feature handlers. */
  readonly variations: RpcVariationCoordinator
  /** Pins each logical target to the first verified response source in the slim runtime. */
  readonly #responseBindings = new Map<string, string>()
  /** Optional discovery-backed receiver selector; target identity is safe default. */
  #receiverResolver: (targetId: string) => Promise<IOutboundReceiver> = async (targetId) => ({
    receiverId: targetId
  })
  /** Reads the later-installed discovery resolver without publishing a broad owner port. */
  readonly #discoveryResolver: (() => IRpcDiscoveryResolverPort | undefined) | undefined
  /** Canonical hook failure reporter snapshotted during construction. */
  readonly #hookErrorReporter: ((error: unknown, event: IRpcHookEvent) => void) | undefined
  /** Indicates that activation installed the physical receiver. */
  #activated = false
  /** Stable feature-result disposal Promise; root kernel disposal is owned by the kernel plugin. */
  #featureDisposePromise: Promise<void> | undefined

  /** Creates outbound owners without subscribing; provider may install its routes first. */
  constructor(
    kernel: IEndpointKernelHost,
    prepared: IPreparedEndpoint<string>,
    discoveryResolver?: () => IRpcDiscoveryResolverPort | undefined
  ) {
    this.kernel = kernel
    this.#probe = kernel.probe
    this.variations = new RpcVariationCoordinator(
      () => kernel.time.now(),
      () => kernel.time.scheduler.now()
    )
    this.#discoveryResolver = discoveryResolver
    this.id = prepared.id
    this.targetIds = Object.freeze([...(prepared.options.targetIds ?? [])])
    this.#native = claimNativeReplayTransport(kernel.transport)
    try {
      this.#defaultGenerate = this.#native
        ? createNativeDefaultAllocator(prepared.options.uuid ?? {}, 0n, (error) =>
            this.emitFailure(error)
          )
        : undefined
    } catch (error) {
      this.#native?.retire()
      throw error
    }
    this.#replay = new ReplayWindow(
      () => kernel.time.scheduler.now(),
      prepared.options.replay?.maxEntries,
      prepared.options.replay?.ttlMs,
      () => this.#defaultGenerate !== undefined && this.#native?.active === true
    )
    const contract = prepared.options.contract ?? {}
    this.#version = contract.version ?? '1.0'
    const uniqueTargetId = prepared.options.connect?.uniqueTargetId
    this.receiverId =
      kernel.platform === RpcPlatform.broadcastChannel && typeof uniqueTargetId === 'string'
        ? `${this.id}:${uniqueTargetId}`
        : this.id
    this.#validateData =
      'validateData' in contract && contract.validateData
        ? (contract.validateData as IRpcContractCapability['validateData'])
        : (method, side, data) => validateContractData(contract, method, side, data)
    this.#uuid = this.#defaultGenerate
      ? { ...prepared.options.uuid, generate: this.#defaultGenerate }
      : (prepared.options.uuid ?? {})
    this.#components = prepared.options.components!
    /** Port selection never changes the public component snapshot or semantic normalizer. */
    const objectPort = selectedJsonObjectPort(this.#components)
    this.#runtimeComponents = objectPort
      ? {
          ...this.#components,
          codec: objectPort.codec,
          framer: objectPort.framer,
          ingressPrepare: bindRpcFrameIngress(objectPort.framer.accept, objectPort.framer.frame)
        }
      : this.#components
    if (objectPort)
      kernel.resources.addSync(JsonObjectSelectionResource, () =>
        releaseJsonObjectSelection(this.#components)
      )
    this.#authentication = prepared.options.authentication
    this.#decodedMetadata = hasDecodedRuntimeMetadata(
      this.#runtimeComponents,
      hasCloneTransferCarrier(kernel.transport) && this.#authentication === undefined
    )
    this.#hookErrorReporter = prepared.options.hooks?.onHookError
    this.#abortEnabled = prepared.options.features?.abort === true
    const timeout = prepared.options.timeout ?? {}
    const timeoutDefault = timeout.timeoutMs ?? 1000
    this.#timeout = {
      ...timeout,
      resolveTimeout:
        'resolveTimeout' in timeout && timeout.resolveTimeout
          ? (timeout.resolveTimeout as IRpcTimeoutCapability['resolveTimeout'])
          : (override) => (override === undefined ? timeoutDefault : override)
    }
    this.#batch = hasBatchAgreement(kernel.transport) && hasFastComponents(this.#components)
    this.#physicalLimit = batchPayloadLimit(kernel.transport)
    /** A local capability offer alone cannot install a parser or create physical receipts. */
    const negotiated = readTransportCapabilities(kernel.transport)
    this.#runtimeCapabilities =
      negotiated?.includes(RpcCapability.runtimeApi) &&
      negotiated.includes(RpcCapability.generation)
        ? negotiated
        : undefined
    this.#fast = hasFastEndpoint(prepared.options)
    if (this.#probe !== undefined) {
      this.#probe.fastPath = this.#fast
      if (this.#authentication && this.#probe.authentication === 'none')
        this.#probe.authentication = this.#authentication.mode ?? 'sign'
    }
    if (this.#fast) enableFastTimePort(kernel.time)
    this.#outboundGate = readOutboundGate(kernel.transport)
    this.#pipeline = new RpcOutboundSender(
      kernel,
      this.id,
      this.#components,
      prepared.options.authentication,
      kernel.platform,
      this.#outboundGate,
      (error) => this.emitFailure(error, RpcCoreErrorCode.invalidConfig),
      this.#fast,
      this.#batch,
      this.#physicalLimit,
      this.receiverId,
      hasCloneTransferCarrier(kernel.transport),
      this.#probe,
      (peerId) => readPeerTransportCapabilities(kernel.transport, peerId),
      (peerId) => readPeerTransportPipeline(kernel.transport, peerId)
    )
    this.inboundIdentity = new InboundIdentityCoordinator({
      native: this.#native,
      now: () => kernel.time.scheduler.now(),
      connect:
        prepared.options.connect && 'verify' in prepared.options.connect
          ? prepared.options.connect
          : undefined,
      sourceProof: kernel.transport.sourceProof,
      reportRead: ({ key, error }) => {
        this.emitFailure(
          error,
          RpcCoreErrorCode.transport,
          typeof key === 'string' ? key : undefined
        )
        return undefined
      },
      platform: kernel.platform,
      topology: kernel.topology
    })
    this.#registerKernelBindings(prepared)
  }

  /** Publish this attachment's existing kernel owners, cleanup receipts, hooks and wire routes. */
  #registerKernelBindings(prepared: IPreparedEndpoint<string>): void {
    /** Registration stays with the same original endpoint kernel used during construction. */
    const kernel = this.kernel
    if (this.#native)
      kernel.resources.addSync(
        NativeDefaultIdText.terminalSubscription,
        this.#native.onRetire(() => {
          kernel.beginClose()
          this.#failAll(createRpcAbortError())
          this.#replay.clear()
        })
      )
    if (this.#runtimeCapabilities) kernel.registerOwner(EndpointOwnerKey.outboundAttachment, this)
    kernel.registerOwner('outbound-pipeline', this.#pipeline)
    kernel.registerOwner(EndpointOwnerKey.pendingRegistry, this.#pending)
    kernel.registerOwner('replay-window', this.#replay)
    kernel.registerOwner('hook-registry', this.#hooks)
    kernel.registerOwner('inbound-identity', this.inboundIdentity)
    kernel.registerOwner('variation-coordinator', this.variations)
    kernel.resources.addSync('outbound hook registry', () => this.#hooks.clear())
    kernel.resources.addSync('outbound unknown fields', () => this.#unknownFields.clear())
    kernel.resources.addSync('outbound response bindings', () => this.#responseBindings.clear())
    if (this.#outboundGate) {
      /** Endpoint diagnostics own their subscription until kernel scope release. */
      const unsubscribe = this.#outboundGate.onEvent((event) => {
        /** Existing enumerable shape stays stable; replay counts are an explicit passive read. */
        const snapshot = event as { readonly name: string; readonly error?: unknown }
        this.emitDiagnostic({ name: snapshot.name, contract: event, error: snapshot.error })
      })
      kernel.resources.addSync('IPC diagnostics', unsubscribe)
    }
    for (const listener of normalizeHooks(prepared.options.hooks?.listeners))
      this.#hooks.add(listener)
    /** Capacity details are frozen numeric facts; ordinary failure hooks retain their old shape. */
    for (const event of prepared.options.initialHookEvents ?? []) this.#emit(event)
    kernel.registerRoute(RpcMessageKind.response, (message) => this.#receiveResponse(message))
    kernel.registerRoute(RpcMessageKind.variation, (message) => this.#receiveVariation(message))
    kernel.registerRoute(RpcRuntimeKind.control, (message) => this.#receiveRuntimeControl(message))
    kernel.registerRoute(RpcRuntimeKind.outcome, (message) => this.#receiveRuntimeOutcome(message))
  }

  /** Routes one variation through the shared coordinator after identity admission. */
  async #receiveVariation(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IRpcEnvelope
      route?: IRpcEnvelopeData
      inbound?: import('../transport.js').IRpcInboundMessage
      admission?: IInboundIdentityAdmission
    }
    /** Inline bytes stay entirely in the original protected physical frame. */
    const envelope = record.envelope
    const route = record.route
    if (
      envelope?.kind !== 'variation' ||
      route?.route.type !== 'variation' ||
      !route.route.variation ||
      (route.route.receiverId !== this.receiverId && route.route.receiverId !== this.id)
    )
      return
    if (!record.admission) return
    const disposition = await this.variations.dispatch(
      route.route.variation,
      `${record.admission.token}:${envelope.id}`,
      message,
      record.admission.token
    )
    if (disposition === 'unknown')
      this.#unknownFields.note(record.admission.token, 'variation', '', route.route.variation)
  }

  /** Own one physical arrival through source admission, authentication, decoding and dispatch. */
  static #InboundPhysicalOperation = class InboundPhysicalOperation {
    /** The original attachment retains all endpoint, transport and authentication authority. */
    #owner: RpcOutboundAttachment
    /** The original native arrival is retained without copying source or transfer metadata. */
    #message: IRpcInboundMessage
    /** Synchronous physical arrival is captured before any transform can yield. */
    #carrierSeq!: number
    /** Every later phase asserts the same original endpoint generation. */
    #generation!: number
    /** The original inbound identity preparation remains the only physical source proof. */
    #physical: IInboundIdentityPreparedSource | undefined
    /** Proven physical-source selection lends its original codec/framer to this arrival only. */
    #arrivalPipeline!: IRpcPeerTransportPipeline
    /** Only the selected original decoder's exact fast-path facts may skip a metadata snapshot. */
    #arrivalDecodedMetadata!: boolean
    /** The genuine negotiated runtime selector decides whether this is runtime traffic. */
    #carrier: ReturnType<typeof readRuntimeCarrier>
    /** The original provider admission receipt owns this physical ingress until finally. */
    #receipt: IProviderIngressReceipt | undefined
    /** Closing releases this exact original ingress candidate while transforms wait. */
    #closeCandidate: (() => void) | undefined
    /** Authentication and framing update only this physical arrival's current value. */
    #frame: unknown
    /** The original native wrapper retains its actual backing buffers and metadata. */
    #nativeBinary: ReturnType<typeof readRpcNativeBinary>
    /** Only the existing binary validator can publish restored semantic data. */
    #restoredBinary: IRpcRuntimeEnvelope | undefined
    /** The same original auth context carries physical binding through asynchronous transforms. */
    #authenticationContext!: import('../typing.js').IRpcAuthenticationContext
    /** Framing and codec admission publish only this arrival's semantic decoded value. */
    #decoded: unknown
    /** Retain the original attachment and physical message before any admission getter executes. */
    constructor(owner: RpcOutboundAttachment, message: IRpcInboundMessage) {
      this.#owner = owner
      this.#message = message
    }
    /** Preserve original asynchronous transform points and final ingress receipt cleanup. */
    async receive(): Promise<void> {
      if (!this.#prepareIngress()) return
      try {
        this.#prepareNativeFrame()
        /** Native validation remains absent for ordinary frames and never changes their await path. */
        const validate = this.#nativeBinary && this.#validateNativeBinary
        if (this.#owner.#authentication) {
          this.#bindReplayContext()
          if (validate) bindAuthenticationBinaryValidation(this.#authenticationContext, validate)
          this.#frame = await this.#owner.#authentication.unprotect(
            this.#frame,
            this.#authenticationContext
          )
          if (this.#frame === consumedAuthenticationFrame) return
        } else if (validate) await validate(this.#frame)
        this.#owner.#native?.observeOwner()
        this.#owner.kernel.assertActive(this.#generation)
        if (this.#owner.#native && !this.#owner.#native.active) return
        if (!this.#decodeFrame()) return
        if (this.#carrier)
          return await this.#owner.#receiveRuntimeEnvelope(
            this.#decoded,
            this.#physical!,
            this.#message,
            this.#generation,
            this.#authenticationContext,
            this.#receipt!,
            this.#restoredBinary,
            this.#arrivalDecodedMetadata
          )
        /** Receive negotiated batches independently of send optimization. */
        let members: readonly unknown[] | undefined
        if (hasBatchAgreement(this.#owner.kernel.transport)) {
          try {
            members = readRpcBatchMembers(this.#decoded)
          } catch (cause) {
            throw createRpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
          }
        }
        if (!members)
          return this.#owner.#receiveEnvelope(
            this.#decoded,
            this.#physical!,
            this.#message,
            this.#generation,
            this.#authenticationContext
          )
        /**
         * Each sibling owns its own identity lease and dispatch completion; no member awaits
         * another.
         */
        const proofs = this.#owner.inboundIdentity.splitPrepared(this.#physical!, members.length)
        await Promise.all(
          members.map((member, index) =>
            this.#owner.#receiveEnvelope(
              member,
              proofs[index]!,
              this.#message,
              this.#generation,
              this.#authenticationContext,
              members.length
            ).catch((error: unknown) => {
              this.#owner.emitFailure(error)
            })
          )
        )
      } finally {
        this.#receipt?.release()
        if (this.#closeCandidate)
          this.#owner.kernel.closingSignal.removeEventListener('abort', this.#closeCandidate)
      }
    }
    /** Capture synchronous arrival/source facts and own the original close-during-transform receipt. */
    #prepareIngress(): boolean {
      this.#carrierSeq =
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.carrier)) !== 0
          ? this.#owner.#probe.takeInboundCarrierSeq()
          : -1
      this.#generation = this.#owner.kernel.generation
      if (this.#owner.kernel.state !== 'active') return false
      this.#owner.#native?.observeOwner()
      if (this.#owner.#native && !this.#owner.#native.active) return false
      this.#physical = this.#owner.inboundIdentity.prepareSource(this.#message, this.#carrierSeq)
      if (!this.#physical) return false
      this.#carrier = this.#owner.#runtimeCapabilities
        ? readRuntimeCarrier(this.#physical!.data)
        : undefined
      this.#arrivalPipeline =
        (this.#carrier && this.#message.peerId !== undefined
          ? readPeerTransportPipeline(this.#owner.kernel.transport, this.#message.peerId)
          : undefined) ?? this.#owner.#runtimeComponents
      this.#arrivalDecodedMetadata =
        this.#owner.#decodedMetadata &&
        this.#arrivalPipeline.codec.encode === this.#owner.#runtimeComponents.codec.encode &&
        this.#arrivalPipeline.codec.decode === this.#owner.#runtimeComponents.codec.decode &&
        this.#arrivalPipeline.framer.frame === this.#owner.#runtimeComponents.framer.frame &&
        this.#arrivalPipeline.framer.accept === this.#owner.#runtimeComponents.framer.accept
      this.#receipt = this.#carrier
        ? (
            this.#owner.kernel.readOwner(EndpointOwnerKey.providerAdmission) as
              | ProviderAdmissionRegistry
              | undefined
          )?.captureIngress()
        : undefined
      if (this.#carrier && !this.#receipt) {
        /** Core detected its actual ingress quota; retain the original native wire identity. */
        /** This error belongs to the provider admission attempt, not a synthetic byte frame. */
        const error = new RangeError(RpcCoreErrorText.runtimeIngressFrameLimitExceeded)
        registerLocalErrorWireSummary(
          error,
          RpcContractErrorCode.frameLimitExceeded,
          RpcCoreErrorText.runtimeIngressFrameLimitExceeded
        )
        throw attachErrorIdentity(error, {
          source: RPC_CONTRACT_SOURCE,
          code: RpcContractErrorCode.frameLimitExceeded
        })
      }
      this.#closeCandidate = this.#receipt
        ? () => {
            this.#receipt!.release()
          }
        : undefined
      if (this.#closeCandidate)
        this.#owner.kernel.closingSignal.addEventListener('abort', this.#closeCandidate, {
          once: true
        })
      return true
    }
    /** Admit native wrapper capabilities, actual physical limits and the original auth context. */
    #prepareNativeFrame(): void {
      this.#frame = this.#carrier ? this.#carrier.frame : this.#physical!.data
      this.#nativeBinary = this.#carrier
        ? readRpcNativeBinary(this.#frame, this.#owner.#physicalLimit)
        : undefined

      if (this.#nativeBinary) {
        /** A routed receiver borrows this proven physical source's actual agreement. */
        const physicalCapabilities =
          this.#message.peerId === undefined
            ? undefined
            : readPeerTransportCapabilities(this.#owner.kernel.transport, this.#message.peerId)
        if (
          !hasCloneTransferCarrier(this.#owner.kernel.transport) ||
          !readAuthenticationBinaryDigest(this.#owner.#authentication) ||
          !this.#owner.#runtimeCapabilities?.includes(RpcCapability.portableBinary) ||
          !this.#owner.#runtimeCapabilities.includes(RpcCapability.nativeBinary) ||
          (physicalCapabilities !== undefined &&
            (!physicalCapabilities.includes(RpcCapability.portableBinary) ||
              !physicalCapabilities.includes(RpcCapability.nativeBinary)))
        )
          throw createRpcError(
            RpcCoreErrorCode.capabilityUnsupported,
            RpcCoreErrorText.capabilityUnsupported
          )
        this.#frame = this.#nativeBinary.protectedMetadata
      }
      if (
        this.#owner.#authentication &&
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.protected)) !== 0
      )
        this.#owner.#probe.protected(
          RpcProbeDirection.inbound,
          '',
          carrierSizeBytes(this.#frame),
          -1,
          -1,
          (this.#owner.#probe.captureMask & (1 << RpcProbeStage.protected)) !== 0
            ? this.#frame
            : undefined,
          undefined,
          undefined,
          this.#physical!.carrierSeq
        )
      if (this.#carrier) {
        /** Only original paired callables prove whole acceptance and the complete frame budget. */
        const facts = this.#arrivalPipeline.ingressPrepare.singleFrameLimits
        if (!facts)
          throw createRpcError(
            RpcCoreErrorCode.capabilityUnsupported,
            RpcCoreErrorText.capabilityUnsupported
          )
        /** Sidecar properties never participate in native serialization or physical bytes. */
        const limit = Math.min(
          RpcBatchPhysical.maxBytes,
          this.#owner.#physicalLimit,
          facts.maxMessageBytes
        )
        if (this.#nativeBinary)
          assertRpcNativeBinaryFrameSize(
            this.#nativeBinary.protectedMetadata,
            this.#nativeBinary!.sidecars.length,
            this.#nativeBinary.backingBytes,
            limit
          )
        else assertRpcPhysicalFrameSize(this.#physical!.data, limit)
      }
      if (
        hasBatchAgreement(this.#owner.kernel.transport) &&
        (this.#owner.#authentication || typeof this.#frame === 'string')
      )
        assertRpcPhysicalFrameSize(this.#frame, this.#owner.#physicalLimit)
      this.#authenticationContext = {
        direction: 'inbound' as const,
        endpointId: this.#owner.id,
        platform: this.#owner.kernel.platform
      }
    }
    /** Restore one genuinely held native binary frame through the canonical validator. */
    #validateNativeBinary = async (encoded: unknown): Promise<IRpcRuntimeEnvelope> => {
      try {
        const accepted = this.#arrivalPipeline.framer.accept(encoded, {
          source: this.#physical!.sourceToken,
          messageId: 'whole'
        })
        if (accepted.status !== 'complete')
          throw createRpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid)
        const manifest = this.#arrivalPipeline.codec.decode(accepted.value)
        this.#restoredBinary = await (
          this.#arrivalDecodedMetadata
            ? restoreInboundDecodedRuntimeBinary
            : restoreInboundRuntimeBinary
        )(
          manifest,
          RpcBinaryStorage.native,
          this.#nativeBinary!.sidecars,
          this.#owner.#physicalLimit,
          readAuthenticationBinaryDigest(this.#owner.#authentication)!
        )
        return this.#restoredBinary
      } catch (cause) {
        throw this.#owner.#authentication && isRpcBinaryIntegrityFailure(cause)
          ? createRpcAuthenticationError(
              RpcMiddlewareErrorText.inboundFrameAuthenticationFailed,
              cause
            )
          : createRpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid, cause)
      }
    }
    /** Bind the original weakly held source session and native authentication replay callbacks. */
    #bindReplayContext(): void {
      /** Native or absent (undefined/null) sources use the endpoint partition. */
      let session =
        this.#owner.#native || this.#physical!.source == null
          ? this.#owner.#authenticationPhysicalSession
          : undefined
      if (
        !session &&
        this.#physical!.source !== null &&
        (typeof this.#physical!.source === 'object' || typeof this.#physical!.source === 'function')
      ) {
        /** Actual source object is weakly owned; token text cannot create trusted sessions. */
        const source = this.#physical!.source as object
        session = this.#owner.#authenticationSessions.get(source)
        if (!session) {
          session = {}
          this.#owner.#authenticationSessions.set(source, session)
        }
      }
      if (session)
        bindAuthenticationReplayContext(
          this.#authenticationContext,
          session,
          () =>
            this.#owner.kernel.state === 'active' &&
            this.#owner.kernel.generation === this.#generation &&
            (this.#owner.#native?.active ?? true),
          this.#owner.kernel.topology !== 'exclusive' && this.#physical!.source == null
            ? {
                receiverId: this.#owner.receiverId,
                unknown: (nonce, counter) =>
                  this.#owner.#pipeline
                    .sendAuthenticationControl({
                      control: RpcAuthenticationControl.unknown,
                      echoNonce: nonce,
                      counter,
                      receiverId: this.#owner.receiverId
                    })
                    .catch((error) => this.#owner.emitFailure(error))
              }
            : undefined
        )
    }
    /** Decode only a complete admitted frame; pending/rejected framing does not dispatch a message. */
    #decodeFrame(): boolean {
      if (this.#nativeBinary) {
        if (!this.#restoredBinary)
          throw createRpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid)
        this.#decoded = this.#restoredBinary
        if (
          this.#owner.#probe !== undefined &&
          (this.#owner.#probe.mask & (1 << RpcProbeStage.encoded)) !== 0
        )
          this.#owner.#probe.encoded(
            RpcProbeDirection.inbound,
            this.#restoredBinary.id,
            carrierSizeBytes(this.#frame),
            (this.#owner.#probe.captureMask & (1 << RpcProbeStage.encoded)) !== 0
              ? this.#frame
              : undefined,
            this.#restoredBinary.task.method,
            this.#restoredBinary.route.senderId
          )
      } else if (this.#owner.#fast && !this.#carrier)
        this.#decoded = this.#arrivalPipeline.codec.decode(this.#frame)
      else {
        const preparedFrame = this.#arrivalPipeline.ingressPrepare(this.#frame, {
          source: this.#physical!.sourceToken,
          messageId: 'whole'
        })
        if (
          this.#owner.#probe !== undefined &&
          (this.#owner.#probe.mask & (1 << RpcProbeStage.frame)) !== 0
        ) {
          /** Only the exact native pair supplies a snapshotted chunk; custom frames remain opaque. */
          const fragment =
            this.#arrivalPipeline.ingressPrepare.nativeOutputDomain !== undefined &&
            this.#arrivalPipeline.ingressPrepare.singleFrameLimits !== undefined
              ? (preparedFrame.frame as { index?: number; count?: number } | null)
              : undefined
          this.#owner.#probe.frame(
            RpcProbeDirection.inbound,
            preparedFrame.messageId,
            carrierSizeBytes(preparedFrame.frame),
            typeof fragment?.index === 'number' ? fragment.index : -1,
            typeof fragment?.count === 'number' ? fragment.count : -1,
            (this.#owner.#probe.captureMask & (1 << RpcProbeStage.frame)) !== 0
              ? preparedFrame.frame
              : undefined,
            undefined,
            undefined,
            this.#physical!.carrierSeq
          )
        }
        const accepted = this.#arrivalPipeline.framer.accept(preparedFrame.frame, {
          source: this.#physical!.sourceToken,
          messageId: preparedFrame.messageId
        })
        if (accepted.status === 'pending') return false
        if (accepted.status === 'rejected') {
          this.#owner.emitFailure(accepted.error, RpcCoreErrorCode.transport)
          return false
        }
        if (
          this.#owner.#probe !== undefined &&
          (this.#owner.#probe.mask & (1 << RpcProbeStage.encoded)) !== 0
        )
          this.#owner.#probe.encoded(
            RpcProbeDirection.inbound,
            preparedFrame.messageId,
            carrierSizeBytes(accepted.value),
            (this.#owner.#probe.captureMask & (1 << RpcProbeStage.encoded)) !== 0
              ? accepted.value
              : undefined
          )
        this.#decoded = this.#arrivalPipeline.codec.decode(accepted.value)
      }
      if (
        this.#owner.#fast &&
        !this.#carrier &&
        !this.#nativeBinary &&
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.encoded)) !== 0
      )
        this.#owner.#probe.encoded(
          RpcProbeDirection.inbound,
          '',
          carrierSizeBytes(this.#frame),
          (this.#owner.#probe.captureMask & (1 << RpcProbeStage.encoded)) !== 0
            ? this.#frame
            : undefined
        )
      return true
    }
  }

  /** Installs the one physical receiver after all selected routes exist. */
  activate(): void {
    if (this.#activated) return
    if (!outboundGateMatchesFeature(this.kernel.transport))
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.ipcGateMismatch),
        RpcCoreErrorCode.invalidConfig
      )
    const activation = createEndpointTransportActivation(
      this.kernel.transport,
      {
        receive: (message) =>
          new RpcOutboundAttachment.#InboundPhysicalOperation(this, message).receive(),
        transportError: (error) => {
          /** Settle with the original transport error before retirement can emit a lifecycle abort. */
          this.#failAll(error)
          this.#native?.observeOwner()
        },
        listenerError: (error) => this.emitFailure(error, RpcCoreErrorCode.transport),
        receiveError: (error) => this.emitFailure(error)
      },
      selectedJsonObjectPort(this.#components)?.subscribe
    )
    this.kernel.activate(activation)
    this.#activated = true
  }

  /** Admit one independent semantic frame through the original auth, identity and route owners. */
  // oxlint-disable-next-line no-unused-private-class-members -- InboundPhysicalOperation reads this lexical private member through its held original owner.
  async #receiveRuntimeEnvelope(
    decoded: unknown,
    physical: IInboundIdentityPreparedSource,
    message: IRpcInboundMessage,
    generation: number,
    authenticationContext: import('../typing.js').IRpcAuthenticationContext,
    receipt: IProviderIngressReceipt,
    restoredBinary?: IRpcRuntimeEnvelope,
    decodedMetadata = this.#decodedMetadata
  ): Promise<void> {
    /** Closed metadata, task association and portable payloads are checked before identity leases. */
    /** The independent binary parser is selected only by its own protected profile. */
    const binary =
      decoded &&
      typeof decoded === 'object' &&
      Object.getOwnPropertyDescriptor(decoded, 'profile')?.value === RpcBinaryProfile
    if (binary && !this.#runtimeCapabilities?.includes(RpcCapability.portableBinary))
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** Inline bytes stay entirely in the original protected physical frame. */
    let envelope: IRpcRuntimeEnvelope
    if (restoredBinary) envelope = restoredBinary
    else if (binary) {
      try {
        const normalized = normalizeInboundDecodedRuntimeBinaryEnvelope(
          await (
            decodedMetadata ? restoreInboundDecodedRuntimeBinary : restoreInboundRuntimeBinary
          )(decoded, RpcBinaryStorage.inline, [], this.#physicalLimit)
        )
        envelope = normalized instanceof Promise ? await normalized : normalized
        if (normalized instanceof Promise) {
          this.kernel.assertActive(generation)
          if (this.#native && !this.#native.active) return
        }
      } catch (cause) {
        throw createRpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid, cause)
      }
    } else {
      const normalized = decodedMetadata
        ? normalizeInboundDecodedRuntimeEnvelope(decoded)
        : normalizeInboundRuntimeEnvelope(decoded)
      if (normalized instanceof Promise) {
        envelope = await normalized
        this.kernel.assertActive(generation)
        if (this.#native && !this.#native.active) return
      } else envelope = normalized
    }
    assertAuthenticationChallengeEnvelope(authenticationContext, envelope)
    markAuthenticationReplayEnvelope(authenticationContext, envelope)
    if (this.#probe !== undefined && (this.#probe.mask & (1 << RpcProbeStage.envelope)) !== 0)
      this.#probe.envelope(
        RpcProbeDirection.inbound,
        envelope.id,
        envelope.task.method,
        -1,
        (this.#probe.captureMask & (1 << RpcProbeStage.envelope)) !== 0 ? envelope : undefined,
        envelope.route.senderId,
        undefined,
        physical.carrierSeq
      )
    /** Every explicitly requested capability must be present in the actual completed intersection. */
    const required = runtimeOperationCapabilities(
      envelope.task.mode,
      'options' in envelope ? envelope.options : {}
    )
    if (required.some((capability) => !this.#runtimeCapabilities?.includes(capability)))
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    if (envelope.route.targetId !== this.id || envelope.route.receiverId !== this.receiverId) return
    if (
      envelope.kind === RpcRuntimeKind.control &&
      envelope.operation === RpcRuntimeOperation.cancel &&
      !this.#runtimeCapabilities?.includes(RpcCapability.abort) &&
      !this.#runtimeCapabilities?.includes(RpcCapability.cancelBeforeStart)
    )
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** Selector fields grant no source authority; the same connect verifier sees actual content. */
    const admission = await this.inboundIdentity.admitPrepared(physical, {
      senderId: envelope.route.senderId,
      targetId: envelope.route.targetId,
      data:
        'payload' in envelope ? envelope.payload : 'steps' in envelope ? envelope.steps : undefined,
      inbound: message
    })
    if (!admission) return
    if (this.#probe !== undefined && (this.#probe.mask & (1 << RpcProbeStage.message)) !== 0)
      this.#probe.message(
        RpcProbeDirection.inbound,
        runtimeProbeKind(envelope),
        RpcProbeOutcome.received,
        envelope.id,
        envelope.task.method,
        envelope.route.senderId,
        envelope.route.targetId,
        undefined,
        -1,
        undefined,
        undefined
      )
    /** One identity release serves rejection, withdrawal and eventual business completion. */
    let released = false
    const releaseIdentity = (): void => {
      if (!released) {
        released = true
        admission.release()
      }
    }
    try {
      this.kernel.assertActive(generation)
      this.#rememberAuthenticationReply(envelope, envelope.route.senderId)
      if (envelope.kind !== RpcRuntimeKind.call && envelope.kind !== RpcRuntimeKind.group) {
        receipt.release()
        await this.kernel.dispatchRoute(
          envelope.kind,
          Object.freeze({ envelope, inbound: message, admission })
        )
        return
      }
      /** Prefix submission enters the original route synchronously and never waits for its result. */
      await new Promise<void>((resolve) => {
        const close = (): void => {
          receipt.release()
          releaseIdentity()
          resolve()
        }
        const finish = (): void => {
          this.kernel.closingSignal.removeEventListener('abort', close)
          releaseIdentity()
          resolve()
        }
        this.kernel.closingSignal.addEventListener('abort', close, { once: true })
        if (
          !receipt.ready(() => {
            if (this.kernel.state !== 'active' || this.kernel.generation !== generation) {
              finish()
              return
            }
            void this.kernel
              .dispatchRoute(
                envelope.kind,
                Object.freeze({ envelope, inbound: message, admission })
              )
              .catch((error: unknown) => this.emitFailure(error))
              .finally(finish)
          })
        )
          finish()
      })
    } finally {
      releaseIdentity()
    }
  }

  /** Reverse freshness is retained only after the original identity owner accepted this hop. */
  configureRuntime(generation: IRpcRuntimeGeneration): void {
    if (this.#runtimeGeneration !== undefined || !this.#runtimeCapabilities)
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.providerGenerationMismatch
      )
    this.#runtimeGeneration = generation
  }

  /** Incoming describe binds its exact already-authenticated invocation token. */
  bindRuntimeCaller(token: string, generation: IRpcRuntimeGeneration): void {
    if (!this.inboundIdentity.bindGeneration(token, generation))
      throw createRpcError(
        RpcCoreErrorCode.providerGenerationMismatch,
        RpcCoreErrorText.providerGenerationMismatch
      )
  }

  /**
   * Outgoing describe binds only the original verified response source, never a self-reported
   * token.
   */
  bindRuntimeTarget(targetId: string, generation: IRpcRuntimeGeneration): void {
    const binding = this.#responseBindings.get(targetId)
    if (!binding || !this.inboundIdentity.bindResponseGeneration(binding, generation))
      throw createRpcError(
        RpcCoreErrorCode.providerGenerationMismatch,
        RpcCoreErrorText.providerGenerationMismatch
      )
  }

  /** Provider execution reads the same local generation reference held by the original caller owner. */
  get runtimeGeneration(): IRpcRuntimeGeneration | undefined {
    return this.#runtimeGeneration
  }

  /** Core raw operations reuse the existing describe binding, never an options generation claim. */
  runtimeTargetGeneration(targetId: string): IRpcRuntimeGeneration | undefined {
    const binding = this.#responseBindings.get(targetId)
    return binding === undefined ? undefined : this.inboundIdentity.readResponseGeneration(binding)
  }

  /** A departed physical session settles only its original pending calls and response binding. */
  retireRuntimeTarget(targetId: string, reason: unknown): void {
    for (const pending of this.#pending.values()) {
      if (pending.targetId === targetId) pending.reject(reason)
    }
    this.#responseBindings.delete(targetId)
  }

  /** Original controls and executor replies use the one codec/framer/auth/physical sender. */
  sendRuntimeFrame(
    envelope: IRpcRuntimeEnvelope,
    admission?: IRpcFrameAdmission,
    onPrepared?: () => Promise<void>,
    transferOptions?: Pick<ISendOptions, 'transfer'>
  ): Promise<void> {
    return this.#pipeline.sendRuntime(
      envelope,
      this.#runtimeCapabilities ?? [],
      admission
        ? {
            queueSignal: admission.queueSignal,
            signals: admission.queueSignal ? [admission.queueSignal] : [],
            assertCanSend: admission.assertCanSend
          }
        : undefined,
      admission?.onStarted,
      onPrepared,
      transferOptions
    )
  }

  /** The original replay owner bounds a lazy stream's single task until its actual terminal. */
  reserveRuntimeStream(
    id: string,
    targetGeneration: IRpcRuntimeGeneration,
    method: string,
    options: IRpcRuntimeSendOptions
  ): Readonly<{ task: IRpcRuntimeTask; options: IRpcRuntimeOptions }> {
    this.kernel.assertActive()
    /** Full capability and local control validation precedes original task reservation. */
    const wireOptions = this.#runtimeOptions(RpcRuntimeMode.stream, options)
    if (!this.#replay.reserveId(id))
      throw createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
    return {
      task: {
        mode: RpcRuntimeMode.stream,
        callerId: this.id,
        callerGeneration: this.#runtimeGeneration!,
        targetGeneration,
        method
      },
      options: wireOptions
    }
  }

  /** Stream cleanup releases only its original reserved task identity, never another pending. */
  releaseRuntimeStream(id: string): void {
    this.#replay.releaseId(id)
  }

  /** Lazy open uses the original receiver selection, complete task grammar and one physical sender. */
  async prepareRuntimeStreamOpen(
    id: string,
    targetId: string,
    task: IRpcRuntimeTask,
    options: IRpcRuntimeOptions,
    payload: IRpcPortableValue | undefined,
    forwardRoute?: readonly string[]
  ): Promise<IRpcRuntimeEnvelope> {
    /** The accepted original binding supplies the actual physical receiver. */
    const receiver = await this.resolveReceiver(targetId)
    return createRuntimeCallEnvelope(
      {
        id,
        task,
        options,
        route: {
          applicationVersion: this.#version,
          senderId: this.id,
          targetId,
          receiverId: receiver.receiverId,
          sentAt: this.kernel.time.timestamp(),
          ...(forwardRoute === undefined ? {} : { forwardRoute })
        }
      },
      payload
    )
  }

  /** Stream replies use the same exact authenticated binding fence as original request pending. */
  runtimeReplyMatches(
    envelope: IRpcRuntimeEnvelope,
    task: IRpcRuntimeTask,
    admission: IInboundIdentityAdmission
  ): boolean {
    return (
      runtimeTaskKey(task) === runtimeTaskKey(envelope.task) &&
      this.#responseBindings.get(envelope.route.senderId) === admission.bindingKey
    )
  }

  /** Every new mode uses one option/capability policy; ordinary calls never enter this branch. */
  #runtimeOptions(mode: RpcRuntimeMode, options: IRpcRuntimeSendOptions): IRpcRuntimeOptions {
    this.#pipeline.assertRuntimeTransfer(this.#runtimeCapabilities ?? [], options)
    if (!this.#runtimeGeneration)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    const wireOptions: IRpcRuntimeOptions = {
      ...(options.orderKey === undefined ? {} : { orderKey: options.orderKey }),
      ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      ...(options.timeoutMs === undefined ||
      options.timeoutMs === false ||
      (mode === RpcRuntimeMode.notify && options.cancel !== RpcRuntimeCancel)
        ? {}
        : /** Wire durations are integers; rounding down never extends the original logical budget. */
          { timeoutMs: Math.floor(options.timeoutMs) })
    }
    /** Every explicitly requested capability must be present in the actual completed intersection. */
    const required = runtimeOperationCapabilities(mode, wireOptions, options.signal !== undefined)
    if (required.some((capability) => !this.#runtimeCapabilities?.includes(capability)))
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    if (options.signal) this.#assertAbortSignal(options.signal)
    assertTimeout(options.timeoutMs)
    if (options.signal?.aborted)
      throw createRpcAbortError(undefined, undefined, resolveAbortReason(options.signal))
    return wireOptions
  }

  /** Opted-in business uses the original task allocator, replay budget, pending registry and scope. */
  sendRuntimeOperation(
    targetId: string,
    targetGeneration: IRpcRuntimeGeneration,
    mode: 'request' | 'notify' | 'group' | 'outcome',
    input: Readonly<{
      method?: string
      payload?: IRpcPortableValue
      steps?: readonly IRpcRuntimeStep[]
      idempotencyKey?: string
    }>,
    options: IRpcRuntimeSendOptions = {},
    awaitNotifyTerminal = false
  ): Promise<unknown> {
    try {
      this.kernel.assertActive()
      /** All new modes share the same original capability and option validation owner. */
      const wireOptions = this.#runtimeOptions(mode, options)
      /** Existing signed route identifies a forwarded notify that needs the final provider receipt. */
      if (
        awaitNotifyTerminal &&
        mode === RpcRuntimeMode.notify &&
        wireOptions.cancel !== RpcRuntimeCancel &&
        wireOptions.orderKey === undefined &&
        readForwardRoute(options) === undefined
      )
        throw createRpcError(
          RpcCoreErrorCode.capabilityUnsupported,
          RpcCoreErrorText.capabilityUnsupported
        )
      const taskId = allocateRpcId(this.#uuid, 'task', this.id, targetId, this.#runtimeReserved)
      if (!this.#replay.reserveId(taskId))
        throw createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
      /** Invalid/custom ID allocation cannot strand a child lifecycle listener. */
      const operation = new OperationScope(
        this.kernel.generation,
        options.timeoutMs,
        this.kernel.closingSignal,
        this.#runtimeNow,
        true
      )
      const task: IRpcRuntimeTask = {
        mode,
        callerId: this.id,
        callerGeneration: this.#runtimeGeneration!,
        targetGeneration,
        ...(input.method === undefined ? {} : { method: input.method })
      }
      const record = new RpcOutboundAttachment.#RuntimeOperation(targetId, {
        owner: this,
        taskId,
        task,
        input,
        options,
        wireOptions,
        operation,
        awaitNotifyTerminal
      })
      return record.start()
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Only an authenticated terminal with the full selected task can settle the original pending. */
  async #receiveRuntimeOutcome(message: unknown): Promise<void> {
    const record = message as {
      envelope: IRpcRuntimeEnvelope
      admission: IInboundIdentityAdmission
    }
    /** Inline bytes stay entirely in the original protected physical frame. */
    const envelope = record.envelope
    if (envelope.kind !== RpcRuntimeKind.outcome) return
    if (envelope.operation === RpcRuntimeOperation.lookup) {
      /** The original final controller performs authentication/task/start fencing for credits. */
      const provider = this.kernel.readOwner(EndpointOwnerKey.providerAttachment) as
        | { receiveRuntimeOutcome(message: unknown): Promise<void> }
        | undefined
      await provider?.receiveRuntimeOutcome(message)
      return
    }
    const pending = this.#runtimePending(envelope, record.admission)
    pending?.resolve({
      state: envelope.state,
      store: envelope.store,
      ...(envelope.state === 'done' ? { outcome: envelope.outcome } : {})
    })
  }

  /** Complete task and original source binding jointly fence every terminal and lookup response. */
  #runtimePending(
    envelope: IRpcRuntimeEnvelope,
    admission: IInboundIdentityAdmission
  ): IOutboundPending | undefined {
    const pending = this.#pending.get(envelope.id)
    if (
      !pending?.runtimeTask ||
      pending.targetId !== envelope.route.senderId ||
      runtimeTaskKey(pending.runtimeTask) !== runtimeTaskKey(envelope.task)
    )
      return undefined
    const binding = this.#responseBindings.get(envelope.route.senderId)
    return binding && binding === admission.bindingKey ? pending : undefined
  }

  /** Only an authenticated terminal with the full selected task can settle the original pending. */
  async #receiveRuntimeControl(message: unknown): Promise<void> {
    const record = message as {
      envelope: IRpcRuntimeEnvelope
      admission: IInboundIdentityAdmission
    }
    /** Inline bytes stay entirely in the original protected physical frame. */
    const envelope = record.envelope
    if (envelope.kind !== RpcRuntimeKind.control) return
    if (envelope.operation === RpcRuntimeOperation.stream) {
      if (envelope.stream.event === 'pull' || envelope.stream.event === 'finish-without-items') {
        /** The original final controller performs authentication/task/start fencing for credits. */
        const provider = this.kernel.readOwner(EndpointOwnerKey.providerAttachment) as
          | { receiveRuntimeControl(message: unknown): Promise<void> }
          | undefined
        await provider?.receiveRuntimeControl(message)
      } else {
        /** Replies belong to the original consumer registry, independently from scalar pending. */
        const owner = this.kernel.readOwner(EndpointOwnerKey.streamOwner) as
          | {
              receiveRuntimeControl(
                envelope: IRpcRuntimeEnvelope,
                admission: IInboundIdentityAdmission
              ): void
            }
          | undefined
        owner?.receiveRuntimeControl(envelope, record.admission)
      }
      return
    }
    if (envelope.operation === RpcRuntimeOperation.cancel) {
      /** The original final controller performs authentication/task/start fencing for credits. */
      const provider = this.kernel.readOwner(EndpointOwnerKey.providerAttachment) as
        | { receiveRuntimeControl(message: unknown): Promise<void> }
        | undefined
      await provider?.receiveRuntimeControl(message)
      return
    }
    if (envelope.operation !== RpcRuntimeOperation.terminal) return
    const pending = this.#runtimePending(envelope, record.admission)
    if (!pending) return
    if (envelope.completion.ok) pending.resolve(envelope.completion.result)
    else pending.reject(deserializeRpcError(envelope.completion.error))
  }

  /** Reverse freshness is retained only after the original identity owner accepted this hop. */
  #rememberAuthenticationReply(envelope: object, senderId: string): void {
    const challenge = readAuthenticationChallengeProof(envelope)
    if (
      challenge?.control === undefined &&
      challenge?.replyChallenge &&
      challenge.replyReceiverId &&
      (challenge.replyReceiverId === senderId ||
        challenge.replyReceiverId.startsWith(`${senderId}:`))
    )
      readAuthenticationChallengePort(this.#authentication)?.remember(
        challenge.replyReceiverId,
        challenge.nonce,
        challenge.replyChallenge,
        true,
        senderId
      )
  }

  /**
   * Normalizes and admits one semantic member through the existing owner, independently of
   * siblings.
   */
  // oxlint-disable-next-line no-unused-private-class-members -- InboundPhysicalOperation reads this lexical private member through its held original owner.
  async #receiveEnvelope(
    decoded: unknown,
    physical: IInboundIdentityPreparedSource,
    message: IRpcInboundMessage,
    generation: number,
    authenticationContext: import('../typing.js').IRpcAuthenticationContext,
    members = -1
  ): Promise<void> {
    /** Inline bytes stay entirely in the original protected physical frame. */
    let envelope: IRpcEnvelope
    /** Unknown fields are reported after normalize returns its once-read kind. */
    const ignored: Array<readonly [string, string]> = []
    try {
      envelope = normalizeInboundRpcEnvelope(decoded, this.#components.protocol, {
        onUnknownField: (pointer, field) => ignored.push([pointer, field])
      })
    } catch (error) {
      if ((error as { readonly violation?: unknown }).violation === 'unknownKind') {
        this.#unknownFields.note(
          physical.sourceToken,
          'kind',
          '',
          String((error as { readonly unknownKindValue?: unknown }).unknownKindValue)
        )
        return
      }
      this.emitFailure(error, RpcCoreErrorCode.transport)
      return
    }
    for (const [pointer, field] of ignored)
      this.#unknownFields.note(physical.sourceToken, envelope.kind, pointer, field)
    assertAuthenticationChallengeEnvelope(authenticationContext, envelope)
    markAuthenticationReplayEnvelope(authenticationContext, envelope)
    const route = envelope.data
    if (this.#probe !== undefined && (this.#probe.mask & (1 << RpcProbeStage.envelope)) !== 0)
      this.#probe.envelope(
        RpcProbeDirection.inbound,
        envelope.id,
        envelope.kind === RpcEnvelopeKind.request ? envelope.method : route.route.method,
        members,
        (this.#probe.captureMask & (1 << RpcProbeStage.envelope)) !== 0 ? envelope : undefined,
        route.route.senderId,
        route.route.trace,
        physical.carrierSeq,
        envelope.kind === RpcEnvelopeKind.variation ? envelope.data.route.variation : undefined
      )
    const pendingAdmission = this.inboundIdentity.admitPrepared(
      physical,
      {
        senderId: route.route.senderId,
        targetId: route.route.targetId,
        data: route.payload,
        inbound: message
      },
      this.#batch && envelope.kind !== RpcEnvelopeKind.stream
    )
    /** Established identity is synchronous; only genuine asynchronous verification yields. */
    const admission =
      this.#batch && !(pendingAdmission instanceof Promise)
        ? pendingAdmission
        : await pendingAdmission
    if (!admission) return
    if (this.#probe !== undefined && (this.#probe.mask & (1 << RpcProbeStage.message)) !== 0)
      this.#probe.message(
        RpcProbeDirection.inbound,
        envelopeProbeKind(envelope),
        RpcProbeOutcome.received,
        envelope.id,
        envelope.kind === RpcEnvelopeKind.request ? envelope.method : route.route.method,
        route.route.senderId,
        route.route.targetId,
        route.route.trace,
        -1,
        undefined,
        undefined,
        envelope.kind === RpcEnvelopeKind.variation ? envelope.data.route.variation : undefined
      )
    try {
      this.kernel.assertActive(generation)
      /** Reverse freshness is retained only after the original identity owner admitted this member. */
      this.#rememberAuthenticationReply(envelope, route.route.senderId)
      const handled = await this.kernel.dispatchRoute(
        envelope.kind,
        Object.freeze({ envelope, route, inbound: message, admission })
      )
      if (!handled && envelope.kind === RpcEnvelopeKind.stream)
        this.emitFailure(
          createRpcProtocolError(RpcCoreErrorText.streamRouteUnclaimed),
          RpcCoreErrorCode.protocolInvalid
        )
    } finally {
      admission.release()
    }
  }

  /** Sends one request through the canonical single-attempt deadline and cancellation closure. */
  send<T>(targetId: string, method: string, data: unknown, options: ISendOptions = {}): Promise<T> {
    if (options.idempotencyKey !== undefined) assertRpcIdempotencyKey(options.idempotencyKey)
    if (
      options.trace !== undefined &&
      (typeof options.trace !== 'string' ||
        options.trace.length < 1 ||
        options.trace.length > RpcWireLimit.maxTraceChars ||
        !/^[\x20-\x7E]+$/u.test(options.trace))
    )
      throw createRpcContractError(RpcCoreErrorText.traceInvalid)
    return this.#sendAsync(targetId, method, data, options)
  }

  /** Keep inherited send admission and rejection timing after the new synchronous option gates. */
  async #sendAsync<T>(
    targetId: string,
    method: string,
    data: unknown,
    options: ISendOptions
  ): Promise<T> {
    this.kernel.assertActive()
    const generation = this.kernel.generation
    assertMethod(targetId)
    assertMethod(method)
    this.#validateData(method, 'params', data)
    if (options.signal) this.#assertAbortSignal(options.signal)
    const timeoutMs = this.#timeout.resolveTimeout(options.timeoutMs)
    assertTimeout(timeoutMs)
    const operation = new OperationScope(
      generation,
      timeoutMs,
      this.kernel.closingSignal,
      () => this.kernel.time.scheduler.now(),
      this.#fast
    )
    try {
      /** Notify's deadline ends at physical send; it never imposes a provider business deadline. */
      const remaining = operation.remaining(timeoutMs)
      operation.assertActive(this.kernel.generation)
      if (remaining === 0) throw createRpcTimeoutError()
      /** The original options copy retains only Core's exact captured input and forward association. */
      const callOptions = retainForwardOptions(options, { ...options, timeoutMs: remaining })
      /**
       * Private fields are deliberately not copied by spread; Core carries its own input
       * explicitly.
       */
      const input = readRuntimeRequestInput(options, method, data, 2)
      if (input) retainRuntimeRequestInput(callOptions, input)
      return this.#requestOnce<T>(
        targetId,
        method,
        data,
        callOptions,
        this.#fast
          ? options.signal
            ? [options.signal]
            : []
          : [operation.signal, ...(options.signal ? [options.signal] : [])],
        operation
      ).finally(() => operation.finish())
    } catch (error) {
      // Preserve the normal request's original finally reaction and release synchronous admission failures.
      operation.finish()
      throw error
    }
  }

  /** Own one ordinary request's pending settlement, cancellation and physical-send admission. */
  static #RequestOperation = class RequestOperation<T> {
    /** The original attachment remains the only transport, replay and endpoint lifecycle owner. */
    #owner: RpcOutboundAttachment
    /** The logical target stays fixed while asynchronous discovery chooses its physical receiver. */
    #targetId: string
    /** The admitted method is reused for wire capture, validation and probe correlation. */
    #method: string
    /** The original payload is retained until the established outbound codec captures it. */
    #data: unknown
    /** The caller options retain their original reads during deadline and physical-write admission. */
    #options: ISendOptions
    /** The admitted signal list defines cancellation sources and registration order. */
    #signals: readonly NonNullable<ISendOptions['signal']>[]
    /** The existing lifecycle operation owns request generation and terminal cleanup. */
    #operation: OperationScope
    /** The reserved correlation id joins pending settlement to replay ownership. */
    #taskId: string
    /** The original monotonic start time measures this request without another clock read. */
    #probeStartedAt: number
    /** The original endpoint timer receipt owns this request deadline. */
    #timer: IEndpointTimer | undefined
    /** First completion wins and prevents duplicate pending/replay release. */
    #settled: boolean = false
    /** A hostile reason getter cannot reenter this abort settlement. */
    #abortHandling: boolean = false
    /** A queued physical send observes the exact original terminal refusal. */
    #settlementError: unknown
    /** Only the original physical writer can mark that sending has started. */
    #startedSending: boolean = false
    /** Only actually admitted listeners are removed in original reverse order. */
    #registeredSignals: NonNullable<ISendOptions['signal']>[] = []
    /** The original native Promise resolves with the exact provider result. */
    #resolve!: (value: T | PromiseLike<T>) => void
    /** Rejection preserves the original request, cancellation or transport reason. */
    #reject!: (reason?: unknown) => void
    /** The caller observes one native settlement Promise from this operation. */
    readonly promise: Promise<T>
    /** Capture the admitted operation before registering any listeners or starting physical work. */
    constructor(
      owner: RpcOutboundAttachment,
      targetId: string,
      method: string,
      data: unknown,
      options: ISendOptions,
      signals: readonly NonNullable<ISendOptions['signal']>[],
      operation: OperationScope,
      taskId: string,
      probeStartedAt: number
    ) {
      this.#owner = owner
      this.#targetId = targetId
      this.#method = method
      this.#data = data
      this.#options = options
      this.#signals = signals
      this.#operation = operation
      this.#taskId = taskId
      this.#probeStartedAt = probeStartedAt
      this.promise = new Promise<T>((resolve, reject) => {
        this.#resolve = resolve
        this.#reject = reject
        this.#run()
      })
    }
    /** Register original pending/abort/deadline ownership before selecting the receiver. */
    #run(): void {
      this.#owner.#pending.set(this.#taskId, {
        targetId: this.#targetId,
        method: this.#method,
        resolve: this.#settleResolve,
        reject: this.#settleReject,
        cleanup: this.#cleanup
      })
      try {
        for (const signal of this.#signals) {
          this.#registeredSignals.push(signal)
          signal.addEventListener('abort', this.#onAbort, { once: true })
          if (signal.aborted) this.#onAbort()
          if (this.#settled) return
        }
      } catch (error) {
        this.#settleReject(
          createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.abortSignalInvalid, error)
        )
        return
      }
      if (this.#settled) return
      if (this.#options.timeoutMs !== false && this.#options.timeoutMs !== undefined)
        this.#timer = this.#owner.kernel.time.setTimeout(() => {
          this.#notifyRemoteAbort()
          this.#settleReject(createRpcTimeoutError())
        }, this.#options.timeoutMs)
      void this.#owner
        .resolveReceiver(
          this.#targetId,
          (this.#options as ISendOptions & { receiverId?: string }).receiverId
        )
        .then(this.#sendToReceiver)
        .catch(this.#settleReject)
    }
    /** Validate original terminal, cancellation and generation facts at physical admission. */
    #assertCanSend = (): void => {
      if (this.#settled) throw this.#settlementError
      if (this.#options.signal?.aborted) throw createRpcAbortError()
      this.#operation.assertActive(this.#owner.kernel.generation)
      this.#owner.kernel.assertActive()
    }

    /** Capture the original request envelope and hand it to the one canonical physical sender. */
    #sendToReceiver = (receiver: IOutboundReceiver): void | Promise<void> => {
      if (this.#settled) return
      const request = {
        kind: 'request' as const,
        id: this.#taskId,
        method: this.#method,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'request' as const,
            applicationVersion: this.#owner.#version,
            senderId: this.#owner.id,
            targetId: this.#targetId,
            ...(receiver.receiverId === undefined ? {} : { receiverId: receiver.receiverId }),
            sentAt: this.#owner.kernel.time.timestamp(),
            ...(this.#options.timeoutMs === false || this.#options.timeoutMs === undefined
              ? {}
              : {
                  timeoutMs: Math.ceil(this.#operation.remaining(this.#options.timeoutMs) as number)
                }),
            ...(this.#options.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: this.#options.idempotencyKey }),
            ...(this.#options.trace === undefined ? {} : { trace: this.#options.trace })
          },
          ...(this.#data === undefined ? {} : { payload: this.#data as IRpcPortableValue })
        }
      }

      /** Keep the queue signal lazy on the original operation, independent of getter receiver. */
      const operation = this.#operation
      return this.#owner.#pipeline.send(
        createOutboundEnvelope(request, this.#options),
        this.#options,
        this.#owner.#outboundGate
          ? {
              get queueSignal() {
                return operation.signal
              },
              signals: this.#signals,
              assertCanSend: this.#assertCanSend
            }
          : undefined,
        this.#owner.#outboundGate
          ? () => {
              this.#assertCanSend()
              /**
               * Notify's deadline ends at physical send; it never imposes a provider business
               * deadline.
               */
              const remaining = this.#operation.remaining(this.#options.timeoutMs)
              if (remaining === 0) throw createRpcTimeoutError()
              request.data.route.sentAt = this.#owner.kernel.time.timestamp()
              if (typeof remaining === 'number')
                (request.data.route as { timeoutMs?: number }).timeoutMs = Math.ceil(remaining)
              return createOutboundEnvelope(request, this.#options)
            }
          : undefined,
        () => {
          this.#startedSending = true
        }
      )
    }

    /** Release the exact original timer, listeners, pending slot and replay reservation. */
    #cleanup = (): void => {
      if (this.#timer !== undefined) this.#owner.kernel.time.clearTimeout(this.#timer)
      for (const signal of this.#registeredSignals.reverse()) {
        try {
          signal.removeEventListener('abort', this.#onAbort)
        } catch (error) {
          this.#owner.emitFailure(error)
        }
      }
      this.#registeredSignals.length = 0
      this.#owner.#pending.delete(this.#taskId)
      this.#owner.#replay.releaseId(this.#taskId)
    }
    /** Commit the first failure before diagnostics and native rejection. */
    #settleReject = (error: unknown): void => {
      if (this.#settled) return
      this.#settled = true
      this.#settlementError = error
      this.#cleanup()
      if (
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#owner.#probe.message(
          RpcProbeDirection.outbound,
          RpcProbeKind.request,
          RpcProbeOutcome.failed,
          this.#taskId,
          this.#method,
          this.#owner.id,
          this.#targetId,
          this.#options.trace,
          this.#probeStartedAt < 0
            ? 0
            : this.#owner.kernel.time.scheduler.now() - this.#probeStartedAt,
          undefined,
          error
        )
      this.#reject(error)
    }
    /** Commit the original successful value and operation mark before native resolution. */
    #settleResolve = (value: unknown): void => {
      if (this.#settled) return
      this.#settled = true
      this.#cleanup()
      this.#operation.markSuccess()
      if (
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#owner.#probe.message(
          RpcProbeDirection.outbound,
          RpcProbeKind.request,
          RpcProbeOutcome.settled,
          this.#taskId,
          this.#method,
          this.#owner.id,
          this.#targetId,
          this.#options.trace,
          this.#probeStartedAt < 0
            ? 0
            : this.#owner.kernel.time.scheduler.now() - this.#probeStartedAt,
          undefined,
          undefined
        )
      this.#resolve(value as T)
    }
    /** Notify only an actually started provider through the original abort variation route. */
    #notifyRemoteAbort = (reason?: unknown): void => {
      if (!this.#owner.#abortEnabled) return
      if (this.#owner.#outboundGate && !this.#startedSending) return
      void this.#owner
        .resolveReceiver(this.#targetId)
        .then((receiver) => {
          const payload =
            reason === undefined
              ? undefined
              : normalizeAbortReason(reason, (failure) =>
                  this.#owner.emitFailure(failure.error, RpcCoreErrorCode.payloadInvalid)
                )
          return this.#owner.#pipeline.send(
            createOutboundEnvelope({
              kind: 'variation',
              id: this.#taskId,
              data: {
                route: {
                  profile: RpcRouteProfile,
                  type: 'variation',
                  applicationVersion: this.#owner.#version,
                  senderId: this.#owner.id,
                  targetId: this.#targetId,
                  receiverId: receiver.receiverId,
                  sentAt: this.#owner.kernel.time.timestamp(),
                  variation: RpcControl.abort
                },
                ...(payload === undefined ? {} : { payload })
              }
            })
          )
        })
        .catch((error) => this.#owner.#reportOutboundFailure(error))
    }
    /**
     * Read the selected outside abort once, then reject through this operation's original
     * settlement.
     */
    #onAbort = (): void => {
      if (this.#settled || this.#abortHandling) return
      this.#abortHandling = true
      /** Read the selected signal once for both the remote notification and local rejection. */
      const aborted = this.#registeredSignals.find((signal) => signal.aborted)
      const reason = aborted === undefined ? undefined : resolveAbortReason(aborted)
      this.#notifyRemoteAbort(reason)
      this.#settleReject(createRpcAbortError(undefined, undefined, reason))
    }
  }

  /** Owns one request's task id, pending settlement, timeout, and abort listeners. */
  #requestOnce<T>(
    targetId: string,
    method: string,
    data: unknown,
    options: ISendOptions,
    signals: readonly NonNullable<ISendOptions['signal']>[],
    operation: OperationScope
  ): Promise<T> {
    const taskId = allocateRpcId(this.#uuid, 'task', this.id, targetId, (id) =>
      this.#replay.hasReservedId(id)
    )
    if (!this.#replay.reserveId(taskId)) {
      /** Preserve the original caller error object while exposing only numeric local capacity. */
      const error = createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
      this.#reportReplayCapacity(error)
      return Promise.reject(error)
    }
    /** Duration is read only for a subscribed logical stage and uses no separate timing owner. */
    const probeStartedAt =
      this.#probe !== undefined && (this.#probe.mask & (1 << RpcProbeStage.message)) !== 0
        ? this.kernel.time.scheduler.now()
        : -1
    if (this.#probe !== undefined && (this.#probe.mask & (1 << RpcProbeStage.message)) !== 0)
      this.#probe.message(
        RpcProbeDirection.outbound,
        RpcProbeKind.request,
        RpcProbeOutcome.created,
        taskId,
        method,
        this.id,
        targetId,
        options.trace,
        -1,
        undefined,
        undefined
      )
    return new RpcOutboundAttachment.#RequestOperation<T>(
      this,
      targetId,
      method,
      data,
      options,
      signals,
      operation,
      taskId,
      probeStartedAt
    ).promise
  }

  /** Sends one dispatch-only request without creating pending response state. */
  dispatch(targetId: string, method: string, data: unknown): void {
    void this.#sendDispatchOnly(targetId, method, data).catch((error) =>
      this.#reportOutboundFailure(error)
    )
  }

  /** Keeps capacity refusal distinct from a physical transport failure in fire-and-forget paths. */
  #reportOutboundFailure(error: unknown): void {
    this.emitFailure(
      error,
      isLocalRpcError(error, RpcError) && localRpcErrorCode(error) === RpcCoreErrorCode.overloaded
        ? RpcCoreErrorCode.overloaded
        : RpcCoreErrorCode.transport
    )
  }

  /** Reuse request's existing signal validation and native reason contract for controlled one-way. */
  #assertAbortSignal(signal: NonNullable<ISendOptions['signal']>): void {
    /** The native listener probe retains request's original supported-signal admission. */
    const probe = (): void => undefined
    try {
      signal.addEventListener('abort', probe, { once: true })
      signal.removeEventListener('abort', probe)
    } catch (error) {
      try {
        signal.removeEventListener('abort', probe)
      } catch (cleanup) {
        this.emitFailure(cleanup)
      }
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.abortSignalInvalid,
        error
      )
    }
    if (!this.#abortEnabled)
      throw createRpcError(
        RpcCoreErrorCode.middlewareMissing,
        RpcCoreErrorText.abortMiddlewareMissing
      )
    if (signal.aborted) throw createRpcAbortError(undefined, undefined, resolveAbortReason(signal))
  }

  /** Opt-in controls retain the same outbound operation scope without allocating a response waiter. */
  #sendControlledOneWay(
    targetId: string,
    method: string,
    data: unknown,
    options: IRpcOneWayOptions
  ): Promise<void> {
    this.kernel.assertActive()
    if (options.signal) this.#assertAbortSignal(options.signal)
    assertTimeout(options.timeoutMs)
    /** The original endpoint generation and clock own cancellation and the one total deadline. */
    const operation = new OperationScope(
      this.kernel.generation,
      options.timeoutMs,
      this.kernel.closingSignal,
      () => this.kernel.time.scheduler.now()
    )
    return raceWithAsyncControl({
      time: this.kernel.time,
      timeoutMs: options.timeoutMs,
      signals: [operation.signal, ...(options.signal ? [options.signal] : [])],
      operation: () =>
        this.#sendDispatchOnly(targetId, method, data, options.transfer, {
          signal: operation.signal,
          remaining: () => operation.remaining(options.timeoutMs)
        })
          .then(() => {
            operation.markSuccess()
          })
          .catch((error: unknown) => {
            if (
              operation.signal.aborted &&
              !isLocalRpcError(error, RpcAbortError) &&
              !isLocalRpcError(error, RpcTimeoutError) &&
              !isLocalRpcError(error, RpcLifecycleError)
            )
              this.emitFailure(
                error,
                isLocalRpcError(error, RpcError)
                  ? localRpcErrorCode(error)!
                  : RpcCoreErrorCode.internal
              )
            throw error
          }),
      createTimeoutError: () => {
        /** The same classified timeout both seals send admission and rejects the caller. */
        const error = createRpcTimeoutError()
        operation.abort(error)
        return error
      },
      createAbortError: (reason) => {
        /** Preserve lifecycle departure, otherwise retain the exact original caller reason as cause. */
        const error = isLocalRpcError(reason, RpcLifecycleError)
          ? reason
          : createRpcAbortError(undefined, undefined, reason)
        operation.abort(error)
        return error
      },
      onDiagnostic: (error) => this.emitFailure(error)
    }).finally(() => operation.finish())
  }

  /** Sends a dispatch-only request and exposes canonical physical completion to the caller. */
  sendOneWay(
    targetId: string,
    method: string,
    data: unknown,
    options?: IRpcOneWayOptions
  ): Promise<void> {
    if (options?.signal === undefined && options?.timeoutMs === undefined)
      return this.#sendDispatchOnly(targetId, method, data, options?.transfer)
    return this.#sendControlledOneWay(targetId, method, data, options)
  }

  /** Owns all dispatch-only request construction, reservation, physical send and release. */
  #sendDispatchOnly(
    targetId: string,
    method: string,
    data: unknown,
    transfer?: readonly unknown[],
    operation?: IRpcStreamOpenCommand['operation']
  ): Promise<void> {
    this.kernel.assertActive()
    assertMethod(targetId)
    assertMethod(method)
    this.#validateData(method, 'params', data)
    const taskId = allocateRpcId(this.#uuid, 'message', this.id, targetId, (id) =>
      this.#replay.hasReservedId(id)
    )
    return this.#sendUnansweredRequest({
      id: taskId,
      targetId,
      method,
      data,
      transfer,
      dispatchOnly: true,
      operation
    })
  }

  /** Emits the initial stream request without a normal response waiter or idempotency key. */
  sendStreamOpen(command: IRpcStreamOpenCommand): Promise<void> {
    this.kernel.assertActive()
    assertMethod(command.targetId)
    assertMethod(command.method)
    this.#validateData(command.method, 'params', command.data)
    return this.#sendUnansweredRequest(command)
  }

  /** Reuse one route header and replay reservation path for dispatch and stream-open. */
  #sendUnansweredRequest(
    command: Readonly<{
      id: string
      targetId: string
      method: string
      data: unknown
      transfer?: readonly unknown[]
      dispatchOnly?: true
      operation?: IRpcStreamOpenCommand['operation']
    }>
  ): Promise<void> {
    if (!this.#replay.reserveId(command.id)) {
      /** Reservation fails synchronously, before dispatch can install its asynchronous reporter. */
      const error = createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
      this.#reportReplayCapacity(error)
      throw error
    }
    return Promise.resolve()
      .then(() => this.resolveReceiver(command.targetId))
      .then((receiver) => {
        if (command.operation?.signal.aborted) throw createRpcAbortError()
        /** Notify's deadline ends at physical send; it never imposes a provider business deadline. */
        const remaining = command.dispatchOnly ? undefined : command.operation?.remaining()
        const wireTimeout = typeof remaining === 'number' ? Math.floor(remaining) : undefined
        if (wireTimeout === 0) throw createRpcTimeoutError()
        const request = {
          kind: 'request' as const,
          id: command.id,
          method: command.method,
          data: {
            route: {
              profile: RpcRouteProfile,
              type: 'request' as const,
              applicationVersion: this.#version,
              senderId: this.id,
              targetId: command.targetId,
              ...(receiver.receiverId === undefined ? {} : { receiverId: receiver.receiverId }),
              ...(command.dispatchOnly ? { dispatchOnly: true } : {}),
              sentAt: this.kernel.time.timestamp(),
              ...(wireTimeout === undefined ? {} : { timeoutMs: wireTimeout })
            },
            ...(command.data === undefined ? {} : { payload: command.data as IRpcPortableValue })
          }
        }
        const assertCanSend = (): void => {
          this.kernel.assertActive()
          if (command.operation?.signal.aborted) throw createRpcAbortError()
          if (command.operation?.remaining() === 0) throw createRpcTimeoutError()
        }
        return this.#pipeline.send(
          createOutboundEnvelope(request, command),
          command.transfer === undefined ? undefined : { transfer: command.transfer },
          (this.#outboundGate || command.dispatchOnly) && command.operation
            ? {
                queueSignal: command.operation.signal,
                signals: [command.operation.signal],
                assertCanSend
              }
            : undefined,
          (this.#outboundGate || command.dispatchOnly) && command.operation
            ? () => {
                assertCanSend()
                const updated = command.operation?.remaining()
                request.data.route.sentAt = this.kernel.time.timestamp()
                if (!command.dispatchOnly && typeof updated === 'number')
                  (request.data.route as { timeoutMs?: number }).timeoutMs = Math.ceil(updated)
                return createOutboundEnvelope(request, command)
              }
            : undefined
        )
      })
      .finally(() => this.#replay.releaseId(command.id))
  }

  /** Installs the one discovery-backed selector for all outbound operation kinds. */
  setReceiverResolver(resolver: (targetId: string) => Promise<IOutboundReceiver>): void {
    this.#receiverResolver = resolver
  }

  /** Only the exact registered canonical port can expose a synchronous established selection. */
  // The nested RuntimeCall record uses this private member through its held owner.
  // eslint-disable-next-line no-unused-private-class-members
  #selectRuntimeReceiver(targetId: string): IOutboundReceiver | Promise<IOutboundReceiver> {
    const resolver = this.#discoveryResolver?.()
    if (resolver) {
      const selected = readCanonicalReceiver(resolver, targetId)
      return selected === undefined ? Promise.resolve(resolver.resolve(targetId)) : selected
    }
    // Unknown installed selectors retain native assimilation without probing their then property.
    return Promise.resolve(this.#receiverResolver(targetId))
  }

  /** Resolves an explicit receiver or delegates to the endpoint-local discovery owner. */
  resolveReceiver(targetId: string, receiverId?: string): Promise<IOutboundReceiver> {
    const discoveryResolver = this.#discoveryResolver?.()
    if (discoveryResolver) return discoveryResolver.resolve(targetId, receiverId)
    if (receiverId !== undefined) return Promise.resolve({ receiverId, verifiedPeerKey: undefined })
    return this.#receiverResolver(targetId)
  }

  /** Sends a frame generated by the provider attachment through the canonical pipeline. */
  sendFrame(
    message: IRpcEnvelope,
    transfer?: readonly unknown[],
    admission?: IRpcFrameAdmission
  ): Promise<void> {
    return Promise.resolve().then(() => {
      admission?.assertCanSend()
      return this.#pipeline.send(
        message,
        transfer === undefined ? undefined : { transfer },
        this.#outboundGate && admission
          ? {
              queueSignal: admission.queueSignal,
              signals: admission.queueSignal ? [admission.queueSignal] : [],
              assertCanSend: admission.assertCanSend
            }
          : undefined,
        undefined,
        admission?.onStarted
      )
    })
  }

  /**
   * Sends one request to every statically configured target. Matches the legacy fanout contract:
   * results are keyed by the canonical `fanoutDeliveryKey` tagged shape and accumulated into a
   * `createSafeRecord` dictionary (a plain `{}` would let an attacker-controlled `__proto__`-shaped
   * target silently mutate the accumulator's prototype instead of appearing as a delivery result),
   * and a `RpcLifecycleError` raised by any individual `send()` (construction/dispose racing the
   * fanout) is rethrown rather than folded into the per-target result, exactly like legacy
   * `sendAll`/`pingAll` and this class's own `pingAll`. Per-receiver keys are not produced here:
   * this composed `sendAll` fans out over the statically configured target list, not a
   * discovery-resolved receiver set (the same discovery-driven receiver resolution gap applies to
   * `ping`).
   */
  async sendAll<T>(
    method: string,
    data: unknown,
    options?: ISendOptions
  ): Promise<IRpcFanoutResult<T>> {
    const results = await Promise.allSettled(
      this.targetIds.map(
        async (targetId) => [targetId, await this.send<T>(targetId, method, data, options)] as const
      )
    )
    const lifecycleFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && isLocalRpcError(result.reason, RpcLifecycleError)
    )
    if (lifecycleFailure) throw lifecycleFailure.reason
    const fulfilled = createSafeRecord<T>()
    const rejected = createSafeRecord<unknown>()
    results.forEach((result, index) => {
      const key = fanoutDeliveryKey(this.targetIds[index])
      if (result.status === 'fulfilled') fulfilled[key] = result.value[1]
      else rejected[key] = result.reason
    })
    return { fulfilled, rejected }
  }

  /** Dispatches to every configured target. */
  dispatchAll(method: string, data: unknown): void {
    for (const targetId of this.targetIds) this.dispatch(targetId, method, data)
  }

  /** Returns the public hook registration surface. */
  get hooks(): { on(listener: IRpcHook): () => void } {
    return { on: (listener) => this.#hooks.add(listener) }
  }

  /** Reports one diagnostic without allowing reporter failure to re-enter runtime work. */
  emitFailure(
    error: unknown,
    code: string = RpcCoreErrorCode.internal,
    field?: string,
    detail?: IRpcHookEvent['detail']
  ): void {
    if (detail !== undefined) {
      /** Monotonic rate limiting is local and allocates neither timers nor identity collections. */
      const now = this.kernel.time.scheduler.now()
      if (
        this.#lastCapacityReportAt !== undefined &&
        now - this.#lastCapacityReportAt < RPC_REPLAY_CAPACITY_REPORT_INTERVAL_MS
      )
        return
      this.#lastCapacityReportAt = now
    }
    /** Capacity details are frozen numeric facts; ordinary failure hooks retain their old shape. */
    const event = {
      name: 'failure',
      at: this.kernel.time.timestamp(),
      localId: this.id,
      error,
      code,
      ...(field === undefined ? {} : { field }),
      ...(detail === undefined ? {} : { detail })
    }
    this.#emit(event)
    try {
      this.#hookErrorReporter?.(error, event)
    } catch {
      // Diagnostics are observational and cannot change the terminal operation outcome.
    }
  }

  /** Reports only actual outbound capacity exhaustion, never duplicate-id admission failures. */
  #reportReplayCapacity(error: RpcError): void {
    if (this.#replay.size < this.#replay.maxEntries) return
    this.emitFailure(
      error,
      RpcCoreErrorCode.overloaded,
      undefined,
      Object.freeze({
        namespace: RpcReplayCapacityNamespace.outbound,
        reason: RpcProviderRejectionReason.outboundReplayFull,
        occupancy: this.#replay.size,
        limit: this.#replay.maxEntries
      })
    )
  }

  /** Register an optional flow owner without creating another transport subscription. */
  onTransportFailure(listener: (error: unknown) => void): () => void {
    this.#transportFailureListener = listener
    return () => {
      if (this.#transportFailureListener === listener) this.#transportFailureListener = undefined
    }
  }

  /** Emits one package-owned diagnostic through the canonical hook owner. */
  emitDiagnostic(event: Omit<IRpcHookEvent, 'at' | 'localId'>): void {
    this.#emit(Object.freeze({ ...event, at: this.kernel.time.timestamp(), localId: this.id }))
  }

  /** Applies the canonical contract validation snapshot for provider execution. */
  validate(method: string, side: 'params' | 'result', data: unknown): void {
    this.#validateData(method, side, data)
  }

  /** Reads live package-private owner counts for hostile lifecycle verification. */
  debugSnapshot(): IRpcEndpointDebugSnapshot {
    /** Existing enumerable shape stays stable; replay counts are an explicit passive read. */
    const snapshot: IRpcEndpointDebugSnapshot = {
      phase: this.kernel.state === 'disposed' ? 'disposed' : 'active',
      pending: this.#pending.size,
      pingPending: 0,
      activeControllers: 0,
      chunks: readSelectedFramerChunks(this.#components),
      providers: 0,
      events: 0,
      hooks: this.#hooks.size,
      resources: this.kernel.resources.size,
      owners: this.kernel.ownerKeys,
      discovery: {
        local: 0,
        remote: 0,
        waiters: 0,
        tasks: 0,
        timers: 0,
        manualWaiters: 0,
        inboundQueries: 0,
        inboundTimers: 0
      }
    }
    Object.defineProperty(snapshot, RpcDebugProperty.replayState, {
      value: Object.freeze({
        active: this.#replay.activeSize,
        completed: this.#replay.size - this.#replay.activeSize
      })
    })
    return snapshot
  }

  /** Releases outbound-owned state once; the composed kernel plugin closes root resources later. */
  dispose(): Promise<void> {
    if (this.#featureDisposePromise) return this.#featureDisposePromise
    this.#featureDisposePromise = Promise.resolve().then(() => {
      this.#native?.retire()
      this.kernel.beginClose()
      this.#failAll(createRpcAbortError())
      this.#responseBindings.clear()
      this.#hooks.clear()
      this.#replay.clear()
    })
    return this.#featureDisposePromise
  }

  /** Settles one authenticated response owned by this endpoint. */
  async #receiveResponse(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IRpcEnvelope
      route?: IRpcEnvelopeData
      inbound?: IRpcInboundMessage<unknown>
      admission?: IInboundIdentityAdmission
    }
    const canonical = record.envelope
    const route = record.route
    if (canonical?.kind !== 'response' || route?.route.type !== 'response') return
    if (
      route.route.targetId !== this.id ||
      (route.route.receiverId !== this.receiverId && route.route.receiverId !== this.id)
    )
      return
    const method = route.route.method
    if (typeof method !== 'string') return
    const pending = this.#pending.get(canonical.id)
    if (
      !pending ||
      pending.runtimeTask ||
      pending.targetId !== route.route.senderId ||
      pending.method !== method
    )
      return
    const binding = record.admission?.bindingKey
    if (!binding || this.kernel.state !== 'active') return
    const existing = this.#responseBindings.get(route.route.senderId)
    if (existing !== undefined && existing !== binding) {
      this.#emit({
        name: 'authentication.rejected',
        at: this.kernel.time.timestamp(),
        localId: this.id,
        code: 'SOURCE_BINDING_CONFLICT'
      })
      return
    }
    this.#responseBindings.set(route.route.senderId, binding)
    if (canonical.ok) {
      try {
        this.#validateData(method, 'result', route.payload)
        pending.resolve(route.payload)
      } catch (error) {
        pending.reject(error)
      }
    } else
      pending.reject(
        restoreRemoteError(canonical, route.payload, (error) =>
          this.emitFailure(error, RpcCoreErrorCode.protocolInvalid)
        )
      )
  }

  /** Rejects and removes every pending operation after transport or lifecycle failure. */
  #failAll(error: unknown): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    try {
      this.#transportFailureListener?.(error)
    } catch (failure) {
      this.emitFailure(failure)
    }
  }

  /** Emits a hook event while preserving the configured hook-error boundary. */
  #emit(event: IRpcHookEvent): void {
    this.#hooks.emit(event, this.#hookErrorReporter)
  }
}

/** Normalizes configured hook listeners into one immutable iteration snapshot. */
function normalizeHooks(value: IRpcHook | readonly IRpcHook[] | undefined): readonly IRpcHook[] {
  if (value === undefined) return []
  return Object.freeze(Array.isArray(value) ? [...value] : [value as IRpcHook])
}

/** Projects an abort reason through RPC portable/error owners before it crosses the wire. */
function normalizeAbortReason(
  reason: unknown,
  report: (failure: IRpcWireErrorFailure) => void
): IRpcPortableValue {
  return normalizePortable(serializeRpcError(reason, { report }))
}

/** Always settle a failed call, reporting a malformed optional remote error once. */
function restoreRemoteError(
  canonical: IRpcResponseFailure,
  payload: unknown,
  report: (error: unknown) => void
): RpcRemoteError {
  let restored: unknown
  try {
    restored = canonical.error === undefined ? undefined : deserializeRpcError(canonical.error)
  } catch (error) {
    report(error)
    restored = error
  }
  return createRpcRemoteError(
    canonical.code ?? RpcCoreErrorCode.internal,
    canonical.message ?? RpcCoreErrorText.remoteRequestFailed,
    payload,
    restored
  )
}

/** Rejects timeout values outside the inherited finite non-negative domain. */
export function assertTimeout(timeoutMs: number | false | undefined): void {
  if (
    timeoutMs !== undefined &&
    timeoutMs !== false &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0)
  )
    throw createRpcContractError(RpcCoreErrorText.timeoutInvalid)
}
