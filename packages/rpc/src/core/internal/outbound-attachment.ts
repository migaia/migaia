import { createOutboundEnvelope, readForwardRoute } from './outbound-envelope.js'
import { hasFastEndpoint, hasFastComponents } from './fast-path.js'
import {
  hasBatchAgreement,
  batchPayloadLimit,
  readTransportCapabilities,
  hasCloneTransferCarrier
} from './batch-frame.js'
import { readRuntimeCarrier } from '../../contract/runtime-api/carrier.js'
import { normalizeRuntimeEnvelope } from '../../contract/runtime-api/normalize.js'
import {
  restoreRpcBinary,
  readRpcNativeBinary,
  measureRpcNativeBinaryFrame,
  isRpcBinaryIntegrityFailure
} from '../../contract/runtime-api/binary.js'
import { RpcMiddlewareErrorText } from '../middleware/error-text.js'
import { RpcBinaryProfile, RpcBinaryStorage } from '../../contract/runtime-api/binary-constants.js'
import { runtimeOperationCapabilities } from '../../contract/runtime-api/capabilities.js'
import {
  RpcRuntimeKind,
  RpcRuntimeOperation,
  RpcRuntimeCancel,
  RpcRuntimeMode,
  RpcRuntimeProfile
} from '../../contract/runtime-api/constants.js'
import type {
  IRpcRuntimeEnvelope,
  IRpcRuntimeGeneration,
  IRpcRuntimeTask,
  IRpcRuntimeOptions,
  IRpcRuntimeStep
} from '../../contract/runtime-api/types.js'
import { RpcCapability, RpcBatchPhysical } from '../../contract/wire-constants.js'
import { readRpcSingleFrameFacts } from '../../contract/framing/reassembler.js'
import type { ProviderAdmissionRegistry, IProviderIngressReceipt } from './provider-admission.js'
import {
  readRpcBatchMembers,
  assertRpcPhysicalFrameSize,
  rejectRpcPhysicalFrameSize
} from '../../contract/batch-frame.js'
import type { IInboundIdentityPreparedSource } from './inbound-identity.js'
import { RpcSerializationError } from '../errors.js'
import { enableFastTimePort } from './time-port.js'
import {
  selectedJsonObjectPort,
  releaseJsonObjectSelection,
  JsonObjectSelectionResource
} from './json-object-port.js'
import { bindRpcFrameIngress } from '../../contract/framing/index.js'
import { RpcPlatform } from '../transport-constants.js'
import {
  RpcAbortError,
  RpcContractError,
  RpcError,
  RpcAuthenticationError,
  RpcCoreErrorCode,
  RpcLifecycleError,
  RpcRemoteError,
  RpcProtocolError,
  RpcTimeoutError,
  tagRpcError
} from '../errors.js'
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
} from '../../contract/index.js'
import { createRpcUnknownFieldWarner } from '../../contract/unknown-field.js'
import { deserializeRpcError, serializeRpcError } from '../../contract/error.js'
import { RpcProtocolEvent } from '../protocol-constants.js'
import { EndpointOwnerKey, type IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IRpcInboundMessage } from '../transport.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import { HookRegistry } from './hooks.js'
import { allocateRpcId, assertRpcIdempotencyKey } from './id.js'
import { PendingRegistry } from './pending.js'
import { RpcOutboundSender } from './outbound-sender.js'
import { outboundGateMatchesFeature, readOutboundGate } from './outbound-gate.js'
import type { IRpcOutboundGate } from './outbound-gate.js'
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
  /** Optional inbound/outbound protection capability. */
  readonly #authentication: IRpcAuthenticationCapability | undefined
  /** Source-less physical channels share the endpoint's authentication partition. */
  readonly #authenticationPhysicalSession = {}
  /** Actual object sources partition authentication weakly; primitive token text grants no proof. */
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
  /** Immutable carrier/component agreement permits physical batch parsing and sending. */
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
      hasCloneTransferCarrier(kernel.transport)
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
    if (this.#native)
      kernel.resources.addSync(
        NativeDefaultIdText.terminalSubscription,
        this.#native.onRetire(() => {
          kernel.beginClose()
          this.#failAll(new RpcAbortError())
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
        const snapshot = event as { readonly name: string; readonly error?: unknown }
        this.emitDiagnostic({ name: snapshot.name, contract: event, error: snapshot.error })
      })
      kernel.resources.addSync('IPC diagnostics', unsubscribe)
    }
    for (const listener of normalizeHooks(prepared.options.hooks?.listeners))
      this.#hooks.add(listener)
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
        receive: async (message) => {
          const generation = this.kernel.generation
          if (this.kernel.state !== 'active') return
          this.#native?.observeOwner()
          if (this.#native && !this.#native.active) return
          const physical = this.inboundIdentity.prepareSource(message)
          if (!physical) return
          /** Default traffic never probes a new selector unless the actual base was negotiated. */
          const carrier = this.#runtimeCapabilities ? readRuntimeCarrier(physical.data) : undefined
          /** Capture arrival in the existing provider scope before any transform can yield. */
          const receipt = carrier
            ? (
                this.kernel.readOwner(EndpointOwnerKey.providerAdmission) as
                  | ProviderAdmissionRegistry
                  | undefined
              )?.captureIngress()
            : undefined
          if (carrier && !receipt) rejectRpcPhysicalFrameSize()
          /** Closing withdraws exact candidates while a caller-owned asynchronous transform waits. */
          const closeCandidate = receipt
            ? () => {
                receipt.release()
              }
            : undefined
          if (closeCandidate)
            this.kernel.closingSignal.addEventListener('abort', closeCandidate, { once: true })
          try {
            let frame = carrier ? carrier.frame : physical.data
            /** Native wrapper admission belongs to the same physical receipt, before authentication. */
            const nativeBinary = carrier
              ? readRpcNativeBinary(frame, this.#physicalLimit)
              : undefined
            /**
             * Only this private accepted validator can supply an already restored semantic
             * envelope.
             */
            let restoredBinary: IRpcRuntimeEnvelope | undefined
            if (nativeBinary) {
              if (
                !hasCloneTransferCarrier(this.kernel.transport) ||
                !readAuthenticationBinaryDigest(this.#authentication) ||
                !this.#runtimeCapabilities?.includes(RpcCapability.portableBinary) ||
                !this.#runtimeCapabilities.includes(RpcCapability.nativeBinary)
              )
                throw new RpcError(
                  RpcCoreErrorCode.capabilityUnsupported,
                  RpcCoreErrorText.capabilityUnsupported
                )
              frame = nativeBinary.protectedMetadata
            }
            if (carrier) {
              /**
               * Only original paired callables prove whole acceptance and the complete frame
               * budget.
               */
              const facts = readRpcSingleFrameFacts(
                this.#components.framer.accept,
                this.#components.framer.frame
              )
              if (!facts)
                throw new RpcError(
                  RpcCoreErrorCode.capabilityUnsupported,
                  RpcCoreErrorText.capabilityUnsupported
                )
              /** Sidecar properties never participate in native serialization or physical bytes. */
              const limit = Math.min(
                RpcBatchPhysical.maxBytes,
                this.#physicalLimit,
                facts.maxMessageBytes
              )
              if (nativeBinary) {
                if (
                  measureRpcNativeBinaryFrame(
                    nativeBinary.protectedMetadata,
                    nativeBinary.sidecars.length,
                    nativeBinary.backingBytes
                  ) > limit
                )
                  rejectRpcPhysicalFrameSize()
              } else assertRpcPhysicalFrameSize(physical.data, limit)
            }
            if (this.#batch && (this.#authentication || typeof frame === 'string'))
              assertRpcPhysicalFrameSize(frame, this.#physicalLimit)
            /** Private physical binding follows this exact context through async transforms. */
            const authenticationContext = {
              direction: 'inbound' as const,
              endpointId: this.id,
              platform: this.kernel.platform
            }
            if (this.#authentication) {
              /** Native or absent (undefined/null) sources use the endpoint partition. */
              let session =
                this.#native || physical.source == null
                  ? this.#authenticationPhysicalSession
                  : undefined
              if (
                !session &&
                physical.source !== null &&
                (typeof physical.source === 'object' || typeof physical.source === 'function')
              ) {
                /** Actual source object is weakly owned; token text cannot create trusted sessions. */
                const source = physical.source as object
                session = this.#authenticationSessions.get(source)
                if (!session) {
                  session = {}
                  this.#authenticationSessions.set(source, session)
                }
              }
              if (session)
                bindAuthenticationReplayContext(
                  authenticationContext,
                  session,
                  () =>
                    this.kernel.state === 'active' &&
                    this.kernel.generation === generation &&
                    (this.#native?.active ?? true),
                  this.kernel.topology !== 'exclusive' && physical.source == null
                    ? {
                        receiverId: this.receiverId,
                        unknown: (nonce, counter) =>
                          this.#pipeline
                            .sendAuthenticationControl({
                              control: RpcAuthenticationControl.unknown,
                              echoNonce: nonce,
                              counter,
                              receiverId: this.receiverId
                            })
                            .catch((error) => this.emitFailure(error))
                      }
                    : undefined
                )
              if (nativeBinary) {
                const digest = readAuthenticationBinaryDigest(this.#authentication)!
                bindAuthenticationBinaryValidation(authenticationContext, async (encoded) => {
                  try {
                    /** Original codec/framer run exactly once, inside final native acceptance. */
                    const accepted = this.#runtimeComponents.framer.accept(encoded, {
                      source: physical.sourceToken,
                      messageId: 'whole'
                    })
                    if (accepted.status !== 'complete')
                      throw new RpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid)
                    const manifest = this.#runtimeComponents.codec.decode(accepted.value)
                    restoredBinary = await restoreRpcBinary(
                      manifest,
                      RpcBinaryStorage.native,
                      nativeBinary.sidecars,
                      this.#physicalLimit,
                      digest
                    )
                    return restoredBinary
                  } catch (cause) {
                    if (isRpcBinaryIntegrityFailure(cause))
                      throw new RpcAuthenticationError(
                        RpcMiddlewareErrorText.inboundFrameAuthenticationFailed,
                        cause
                      )
                    throw new RpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid, cause)
                  }
                })
              }
              frame = await this.#authentication.unprotect(frame, authenticationContext)
              if (frame === consumedAuthenticationFrame) return
            }
            this.#native?.observeOwner()
            this.kernel.assertActive(generation)
            if (this.#native && !this.#native.active) return
            /** Private component proof omits generic whole-frame fanout, never semantic admission. */
            let decoded: unknown
            if (nativeBinary) {
              if (!restoredBinary) throw new RpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid)
              decoded = restoredBinary
            } else if (this.#fast && !carrier) decoded = this.#runtimeComponents.codec.decode(frame)
            else {
              const preparedFrame = this.#runtimeComponents.ingressPrepare(frame, {
                source: physical.sourceToken,
                messageId: 'whole'
              })
              const accepted = this.#runtimeComponents.framer.accept(preparedFrame.frame, {
                source: physical.sourceToken,
                messageId: preparedFrame.messageId
              })
              if (accepted.status === 'pending') return
              if (accepted.status === 'rejected') {
                this.emitFailure(accepted.error, RpcCoreErrorCode.transport)
                return
              }
              decoded = this.#runtimeComponents.codec.decode(accepted.value)
            }
            if (carrier)
              return await this.#receiveRuntimeEnvelope(
                decoded,
                physical,
                message,
                generation,
                authenticationContext,
                receipt!,
                restoredBinary
              )
            /**
             * Unknown/no-capability carriers keep their original normalize path without batch
             * probing.
             */
            let members: readonly unknown[] | undefined
            if (this.#batch) {
              try {
                members = readRpcBatchMembers(decoded)
              } catch (cause) {
                throw new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
              }
            }
            if (!members)
              return this.#receiveEnvelope(
                decoded,
                physical,
                message,
                generation,
                authenticationContext
              )
            /**
             * Each sibling owns its own identity lease and dispatch completion; no member awaits
             * another.
             */
            const proofs = this.inboundIdentity.splitPrepared(physical, members.length)
            await Promise.all(
              members.map((member, index) =>
                this.#receiveEnvelope(
                  member,
                  proofs[index]!,
                  message,
                  generation,
                  authenticationContext
                ).catch((error: unknown) => {
                  this.emitFailure(error)
                })
              )
            )
          } finally {
            receipt?.release()
            if (closeCandidate)
              this.kernel.closingSignal.removeEventListener('abort', closeCandidate)
          }
        },
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
  async #receiveRuntimeEnvelope(
    decoded: unknown,
    physical: IInboundIdentityPreparedSource,
    message: IRpcInboundMessage,
    generation: number,
    authenticationContext: import('../typing.js').IRpcAuthenticationContext,
    receipt: IProviderIngressReceipt,
    restoredBinary?: IRpcRuntimeEnvelope
  ): Promise<void> {
    /** Closed metadata, task association and portable payloads are checked before identity leases. */
    /** The independent binary parser is selected only by its own protected profile. */
    const binary =
      decoded &&
      typeof decoded === 'object' &&
      Object.getOwnPropertyDescriptor(decoded, 'profile')?.value === RpcBinaryProfile
    if (binary && !this.#runtimeCapabilities?.includes(RpcCapability.portableBinary))
      throw new RpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** Inline bytes stay entirely in the original protected physical frame. */
    let envelope: IRpcRuntimeEnvelope
    if (restoredBinary) envelope = restoredBinary
    else if (binary) {
      try {
        envelope = normalizeRuntimeEnvelope(
          await restoreRpcBinary(decoded, RpcBinaryStorage.inline, [], this.#physicalLimit)
        )
      } catch (cause) {
        throw new RpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid, cause)
      }
    } else
      envelope = normalizeRuntimeEnvelope(decoded, (value) =>
        normalizePortable(value, 0, new Set<object>(), () => {
          throw new RpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid)
        })
      )
    assertAuthenticationChallengeEnvelope(authenticationContext, envelope)
    markAuthenticationReplayEnvelope(authenticationContext, envelope)
    /** Every explicitly requested capability must be present in the actual completed intersection. */
    const required = runtimeOperationCapabilities(
      envelope.task.mode,
      'options' in envelope ? envelope.options : {}
    )
    if (required.some((capability) => !this.#runtimeCapabilities?.includes(capability)))
      throw new RpcError(
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
      throw new RpcError(
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
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.providerGenerationMismatch
      )
    this.#runtimeGeneration = generation
  }

  /** Incoming describe binds its exact already-authenticated invocation token. */
  bindRuntimeCaller(token: string, generation: IRpcRuntimeGeneration): void {
    if (!this.inboundIdentity.bindGeneration(token, generation))
      throw new RpcError(
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
      throw new RpcError(
        RpcCoreErrorCode.providerGenerationMismatch,
        RpcCoreErrorText.providerGenerationMismatch
      )
  }

  /** Provider execution reads the same local generation reference held by the original caller owner. */
  get runtimeGeneration(): IRpcRuntimeGeneration | undefined {
    return this.#runtimeGeneration
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
      throw new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
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
    return normalizeRuntimeEnvelope({
      profile: RpcRuntimeProfile,
      kind: RpcRuntimeKind.call,
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
      },
      ...(payload === undefined ? {} : { payload })
    })
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
      throw new RpcError(
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
    const required = runtimeOperationCapabilities(mode, wireOptions, options.signal !== undefined)
    if (required.some((capability) => !this.#runtimeCapabilities?.includes(capability)))
      throw new RpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    if (options.signal) this.#assertAbortSignal(options.signal)
    assertTimeout(options.timeoutMs)
    if (options.signal?.aborted)
      throw new RpcAbortError(undefined, undefined, resolveAbortReason(options.signal))
    return wireOptions
  }

  /** Opted-in business uses the original task allocator, replay budget, pending registry and scope. */
  async sendRuntimeOperation(
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
      throw new RpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    const taskId = allocateRpcId(this.#uuid, 'task', this.id, targetId, (id) =>
      this.#replay.hasReservedId(id)
    )
    if (!this.#replay.reserveId(taskId))
      throw new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
    /** Invalid/custom ID allocation cannot strand a child lifecycle listener. */
    const operation = new OperationScope(
      this.kernel.generation,
      options.timeoutMs,
      this.kernel.closingSignal,
      () => this.kernel.time.scheduler.now()
    )
    const task: IRpcRuntimeTask = {
      mode,
      callerId: this.id,
      callerGeneration: this.#runtimeGeneration!,
      targetGeneration,
      ...(input.method === undefined ? {} : { method: input.method })
    }
    let envelope: IRpcRuntimeEnvelope
    try {
      const receiver = await this.resolveReceiver(targetId)
      operation.assertActive(this.kernel.generation)
      envelope = normalizeRuntimeEnvelope({
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
          applicationVersion: this.#version,
          senderId: this.id,
          targetId,
          receiverId: receiver.receiverId,
          sentAt: this.kernel.time.timestamp(),
          ...(readForwardRoute(options) === undefined
            ? {}
            : { forwardRoute: readForwardRoute(options) })
        },
        ...(mode === RpcRuntimeMode.group
          ? { steps: input.steps }
          : input.payload === undefined
            ? {}
            : { payload: input.payload })
      })
    } catch (error) {
      this.#replay.releaseId(taskId)
      operation.finish()
      throw error
    }
    return new Promise<unknown>((resolve, reject) => {
      /** Opt-in order needs true completion for forwarding leases; public notify still ends at send. */
      const terminalReceipt =
        awaitNotifyTerminal ||
        mode !== RpcRuntimeMode.notify ||
        options.cancel === RpcRuntimeCancel ||
        options.orderKey !== undefined
      /** Physical commit and terminal settlement are distinct for internal notification receipts. */
      let sent = false
      /** Every original registry/budget/listener is released by this one terminal guard. */
      let settled = false
      let timer: IEndpointTimer | undefined
      const cleanup = (): void => {
        if (timer) this.kernel.time.clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        this.#pending.delete(taskId)
        this.#replay.releaseId(taskId)
        operation.finish()
      }
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        if (mode === RpcRuntimeMode.notify && sent && !awaitNotifyTerminal) this.emitFailure(error)
        else reject(error)
      }
      const complete = (result: unknown): void => {
        if (settled) return
        settled = true
        operation.markSuccess()
        cleanup()
        if (mode !== RpcRuntimeMode.notify || awaitNotifyTerminal) resolve(result)
      }
      const cancel = (reason: unknown): void => {
        if (settled) return
        if (!sent || mode === RpcRuntimeMode.outcome) {
          fail(reason)
          return
        }
        void this.sendRuntimeFrame({
          profile: RpcRuntimeProfile,
          id: envelope.id,
          kind: RpcRuntimeKind.control,
          operation: RpcRuntimeOperation.cancel,
          task,
          route: envelope.route,
          reason: serializeRpcError(reason, {
            report: (failure) => this.emitFailure(failure.error)
          })
        }).catch((error) => this.emitFailure(error))
        if (options.cancel !== RpcRuntimeCancel) fail(reason)
      }
      const onAbort = (): void =>
        cancel(
          new RpcAbortError(
            undefined,
            undefined,
            options.signal ? resolveAbortReason(options.signal) : undefined
          )
        )
      if (terminalReceipt)
        this.#pending.set(taskId, {
          targetId,
          method: input.method ?? '',
          runtimeTask: task,
          resolve: complete,
          reject: fail,
          cleanup
        })
      try {
        options.signal?.addEventListener('abort', onAbort, { once: true })
        if (options.signal?.aborted) onAbort()
        if (settled) return
        if (options.timeoutMs !== undefined && options.timeoutMs !== false)
          timer = this.kernel.time.setTimeout(
            () => cancel(new RpcTimeoutError()),
            options.timeoutMs
          )
        void this.#pipeline
          .sendRuntime(
            envelope,
            this.#runtimeCapabilities!,
            {
              queueSignal: operation.signal,
              signals: options.signal ? [options.signal] : [],
              assertCanSend: () => {
                if (settled) throw new RpcAbortError()
                operation.assertActive(this.kernel.generation)
              }
            },
            () => {
              sent = true
            },
            undefined,
            options
          )
          .then(
            () => {
              if (mode === RpcRuntimeMode.notify) {
                if (!terminalReceipt) {
                  settled = true
                  operation.markSuccess()
                  cleanup()
                }
                if (!awaitNotifyTerminal) resolve(undefined)
              }
            },
            (error: unknown) => {
              fail(error)
              /**
               * A terminal may arrive before the physical write settles; neither can hide write
               * failure.
               */
              reject(error)
            }
          )
      } catch (error) {
        fail(error)
      }
    })
  }

  /** Only an authenticated terminal with the full selected task can settle the original pending. */
  async #receiveRuntimeOutcome(message: unknown): Promise<void> {
    const record = message as {
      envelope: IRpcRuntimeEnvelope
      admission: IInboundIdentityAdmission
    }
    const envelope = record.envelope
    if (envelope.kind !== RpcRuntimeKind.outcome) return
    if (envelope.operation === RpcRuntimeOperation.lookup) {
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
  async #receiveEnvelope(
    decoded: unknown,
    physical: IInboundIdentityPreparedSource,
    message: IRpcInboundMessage,
    generation: number,
    authenticationContext: import('../typing.js').IRpcAuthenticationContext
  ): Promise<void> {
    let envelope: IRpcEnvelope
    /** Unknown fields are reported after normalize returns its once-read kind. */
    const ignored: Array<readonly [string, string]> = []
    try {
      envelope = this.#components.protocol.normalize(decoded, {
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
          new RpcProtocolError(RpcCoreErrorText.streamRouteUnclaimed),
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
      throw new RpcContractError(RpcCoreErrorText.traceInvalid)
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
    const remaining = operation.remaining(timeoutMs)
    operation.assertActive(this.kernel.generation)
    if (remaining === 0) throw new RpcTimeoutError()
    return this.#requestOnce<T>(
      targetId,
      method,
      data,
      { ...options, timeoutMs: remaining },
      this.#fast
        ? options.signal
          ? [options.signal]
          : []
        : [operation.signal, ...(options.signal ? [options.signal] : [])],
      operation
    ).finally(() => operation.finish())
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
      const error = new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
      this.#reportReplayCapacity(error)
      return Promise.reject(error)
    }
    return new Promise<T>((resolve, reject) => {
      let timer: IEndpointTimer | undefined
      let settled = false
      /** Prevents a hostile reason getter from reentering abort settlement. */
      let abortHandling = false
      let settlementError: unknown
      let startedSending = false
      const registeredSignals: NonNullable<ISendOptions['signal']>[] = []
      const cleanup = (): void => {
        if (timer !== undefined) this.kernel.time.clearTimeout(timer)
        for (const signal of registeredSignals.reverse()) {
          try {
            signal.removeEventListener('abort', onAbort)
          } catch (error) {
            this.emitFailure(error)
          }
        }
        registeredSignals.length = 0
        this.#pending.delete(taskId)
        this.#replay.releaseId(taskId)
      }
      const settleReject = (error: unknown): void => {
        if (settled) return
        settled = true
        settlementError = error
        cleanup()
        reject(error)
      }
      const settleResolve = (value: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        operation.markSuccess()
        resolve(value as T)
      }
      // Matches legacy `notifyRemoteAbort()`: told the remote provider to cancel its active
      // controller whenever this caller settles a request early for a reason the remote cannot
      // otherwise observe (caller abort signal or caller-side timeout) — never on success, remote
      // failure, or transport failure, which the remote already knows about from its own send.
      const notifyRemoteAbort = (reason?: unknown): void => {
        if (!this.#abortEnabled) return
        if (this.#outboundGate && !startedSending) return
        void this.resolveReceiver(targetId)
          .then((receiver) => {
            const payload =
              reason === undefined
                ? undefined
                : normalizeAbortReason(reason, (failure) =>
                    this.emitFailure(failure.error, RpcCoreErrorCode.payloadInvalid)
                  )
            return this.#pipeline.send(
              createOutboundEnvelope({
                kind: 'variation',
                id: taskId,
                data: {
                  route: {
                    profile: RpcRouteProfile,
                    type: 'variation',
                    applicationVersion: this.#version,
                    senderId: this.id,
                    targetId,
                    receiverId: receiver.receiverId,
                    sentAt: this.kernel.time.timestamp(),
                    variation: RpcControl.abort
                  },
                  ...(payload === undefined ? {} : { payload })
                }
              })
            )
          })
          .catch((error) => this.#reportOutboundFailure(error))
      }
      const onAbort = (): void => {
        if (settled || abortHandling) return
        abortHandling = true
        /** Read the selected signal once for both the remote notification and local rejection. */
        const aborted = registeredSignals.find((signal) => signal.aborted)
        const reason = aborted === undefined ? undefined : resolveAbortReason(aborted)
        notifyRemoteAbort(reason)
        settleReject(new RpcAbortError(undefined, undefined, reason))
      }
      this.#pending.set(taskId, {
        targetId,
        method,
        resolve: settleResolve,
        reject: settleReject,
        cleanup
      })
      try {
        for (const signal of signals) {
          registeredSignals.push(signal)
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
          if (settled) return
        }
      } catch (error) {
        settleReject(
          new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.abortSignalInvalid, error)
        )
        return
      }
      if (settled) return
      if (options.timeoutMs !== false && options.timeoutMs !== undefined)
        timer = this.kernel.time.setTimeout(() => {
          notifyRemoteAbort()
          settleReject(new RpcTimeoutError())
        }, options.timeoutMs)
      void this.resolveReceiver(
        targetId,
        (options as ISendOptions & { receiverId?: string }).receiverId
      )
        .then((receiver) => {
          if (settled) return
          const request = {
            kind: 'request' as const,
            id: taskId,
            method,
            data: {
              route: {
                profile: RpcRouteProfile,
                type: 'request' as const,
                applicationVersion: this.#version,
                senderId: this.id,
                targetId,
                ...(receiver.receiverId === undefined ? {} : { receiverId: receiver.receiverId }),
                sentAt: this.kernel.time.timestamp(),
                ...(options.timeoutMs === false || options.timeoutMs === undefined
                  ? {}
                  : { timeoutMs: Math.ceil(operation.remaining(options.timeoutMs) as number) }),
                ...(options.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: options.idempotencyKey }),
                ...(options.trace === undefined ? {} : { trace: options.trace })
              },
              ...(data === undefined ? {} : { payload: data as IRpcPortableValue })
            }
          }
          const assertCanSend = (): void => {
            if (settled) throw settlementError
            if (options.signal?.aborted) throw new RpcAbortError()
            operation.assertActive(this.kernel.generation)
            this.kernel.assertActive()
          }
          return this.#pipeline.send(
            createOutboundEnvelope(request, options),
            options,
            this.#outboundGate
              ? {
                  get queueSignal() {
                    return operation.signal
                  },
                  signals,
                  assertCanSend
                }
              : undefined,
            this.#outboundGate
              ? () => {
                  assertCanSend()
                  const remaining = operation.remaining(options.timeoutMs)
                  if (remaining === 0) throw new RpcTimeoutError()
                  request.data.route.sentAt = this.kernel.time.timestamp()
                  if (typeof remaining === 'number')
                    (request.data.route as { timeoutMs?: number }).timeoutMs = Math.ceil(remaining)
                  return createOutboundEnvelope(request, options)
                }
              : undefined,
            () => {
              startedSending = true
            }
          )
        })
        .catch(settleReject)
    })
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
      error instanceof RpcError && error.code === RpcCoreErrorCode.overloaded
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
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.abortSignalInvalid, error)
    }
    if (!this.#abortEnabled)
      throw new RpcError(
        RpcCoreErrorCode.middlewareMissing,
        RpcCoreErrorText.abortMiddlewareMissing
      )
    if (signal.aborted) throw new RpcAbortError(undefined, undefined, resolveAbortReason(signal))
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
              !(error instanceof RpcAbortError) &&
              !(error instanceof RpcTimeoutError) &&
              !(error instanceof RpcLifecycleError)
            )
              this.emitFailure(
                error,
                error instanceof RpcError ? error.code : RpcCoreErrorCode.internal
              )
            throw error
          }),
      createTimeoutError: () => {
        /** The same classified timeout both seals send admission and rejects the caller. */
        const error = new RpcTimeoutError()
        operation.abort(error)
        return error
      },
      createAbortError: (reason) => {
        /** Preserve lifecycle departure, otherwise retain the exact original caller reason as cause. */
        const error =
          reason instanceof RpcLifecycleError
            ? reason
            : new RpcAbortError(undefined, undefined, reason)
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
      const error = new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
      this.#reportReplayCapacity(error)
      throw error
    }
    return Promise.resolve()
      .then(() => this.resolveReceiver(command.targetId))
      .then((receiver) => {
        if (command.operation?.signal.aborted) throw new RpcAbortError()
        /** Notify's deadline ends at physical send; it never imposes a provider business deadline. */
        const remaining = command.dispatchOnly ? undefined : command.operation?.remaining()
        const wireTimeout = typeof remaining === 'number' ? Math.floor(remaining) : undefined
        if (wireTimeout === 0) throw new RpcTimeoutError()
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
          if (command.operation?.signal.aborted) throw new RpcAbortError()
          if (command.operation?.remaining() === 0) throw new RpcTimeoutError()
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
   * discovery-resolved receiver set (see the discovery-driven receiver resolution gap disclosed in
   * Achievement Review Round 8/9 for `ping`, which the same architecture applies to).
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
        result.status === 'rejected' && result.reason instanceof RpcLifecycleError
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
      this.#failAll(new RpcAbortError())
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
  return new RpcRemoteError(
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
    throw new RpcContractError(RpcCoreErrorText.timeoutInvalid)
}
