import { WebRpcConfigurationError, WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcMessageKind, WebRpcVariation } from '../protocol-constants.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcProvider } from '../typing.js'
import type { IWebRpcRequest } from '../wire.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type {
  IWebRpcIdentityCommand,
  IWebRpcInboundIdentityPort,
  IWebRpcOutboundOperationsPort,
  IWebRpcVariationCoordinatorPort
} from './plugin-shared-keys.js'
import { ProviderAdmissionRegistry } from './provider-admission.js'
import { ProviderExecutor } from './provider-executor.js'
import { ProviderRegistry } from './provider.js'
import { RequestReplayLedger } from './request-replay-ledger.js'
import { tupleKey } from './safe-value.js'
import { recordProviderRegistration, type IWebRpcEndpointDebugSnapshot } from './test-observer.js'
import type { IWebRpcInboundMessage } from '../transport.js'

/** Inbound transport metadata retained only for identity admission. */
type IProviderInbound = {
  readonly peerId?: string
  readonly origin?: string
  readonly source?: unknown
}

/** Native provider ports admitted from the one outbound feature owner. */
export type IWebRpcProviderPorts = {
  readonly outboundOperations: IWebRpcOutboundOperationsPort
  readonly inboundIdentity: IWebRpcInboundIdentityPort
  readonly variationCoordinator: IWebRpcVariationCoordinatorPort
}

/** Canonical provider attachment with an inseparable replay/admission/identity/executor closure. */
export class WebRpcProviderAttachment {
  /** Provider and event callback ownership. */
  readonly #registry = new ProviderRegistry()
  /** Completed request replay ownership. */
  readonly #replay: RequestReplayLedger
  /** Per-task provider execution quotas. */
  readonly #admission = new ProviderAdmissionRegistry()
  /** Active provider abort controllers. */
  readonly #controllers = new Map<string, AbortController>()
  /** Provider execution owner. */
  readonly #executor: ProviderExecutor<string>
  /** Narrow outbound facts and operations owned by the outbound feature. */
  readonly #outbound: IWebRpcOutboundOperationsPort
  /** Verified inbound identity and lease owner. */
  readonly #identity: IWebRpcInboundIdentityPort
  /** Verified variation and cancellation owner. */
  readonly #variations: IWebRpcVariationCoordinatorPort
  /** Kernel lifecycle operations remain owned by the composed endpoint. */
  readonly #kernel: IEndpointKernelHost
  /** Immutable endpoint identity snapshot used by provider request admission. */
  readonly #id: string
  /** Immutable target snapshot used by provider dispatch. */
  readonly #targetIds: readonly string[]
  /** Receiver identity snapshot used by provider request admission. */
  readonly #receiverId: string
  /** Release callback for the provider-owned abort variation handler. */
  readonly #releaseAbortHandler: () => void
  /** True only when the `abort()` capability middleware selected this endpoint into cancellation. */
  readonly #abortEnabled: boolean
  /** Canonical endpoint transaction identity used by the package-test passive recorder. */
  readonly #transaction: object

  /** Installs the complete provider security closure before the receiver becomes active. */
  constructor(
    kernel: IEndpointKernelHost,
    ports: IWebRpcProviderPorts,
    prepared: IPreparedEndpoint<string>
  ) {
    this.#kernel = kernel
    this.#outbound = ports.outboundOperations
    this.#identity = ports.inboundIdentity
    this.#variations = ports.variationCoordinator
    this.#id = prepared.id
    this.#targetIds = Object.freeze([...(prepared.options.targetIds ?? [])])
    const uniqueTargetId = prepared.options.connect?.uniqueTargetId
    this.#receiverId =
      kernel.platform === 'BroadcastChannel' && typeof uniqueTargetId === 'string'
        ? `${prepared.id}:${uniqueTargetId}`
        : prepared.id
    this.#abortEnabled = prepared.options.features?.abort === true
    this.#transaction = kernel
    this.#replay = new RequestReplayLedger(4096, 1024, 310_000)
    this.#executor = new ProviderExecutor({
      id: this.#id,
      registry: this.#registry,
      controllers: this.#controllers,
      admission: this.#admission,
      peers: this.#targetIds,
      dispatch: (targetId, method, data) => {
        this.#outbound.send({ kind: 'dispatch', targetId, method, data })
      },
      send: (response, transfer) =>
        this.#outbound.send({ kind: 'response', message: response, transfer }),
      validate: (method, side, data) =>
        this.#outbound.send({ kind: 'validate', method, side, data }),
      emitFailure: (error, code) => {
        this.#outbound.send({ kind: 'report', error, code })
      },
      isReplay: (request, peerKey) =>
        this.#replay.has(tupleKey(peerKey, request.senderId, request.taskId)),
      admitReplay: (request, peerKey) =>
        this.#replay.admit(tupleKey(peerKey, request.senderId, request.taskId), peerKey),
      consumePendingAbort: (key) =>
        this.#variations.admit({ operation: 'consumeAbort', key }) as boolean,
      responseReceiverId: (request) => request.senderId
    })
    kernel.registerOwner('provider-registry', this.#registry)
    kernel.registerOwner('request-replay', this.#replay)
    kernel.registerOwner('provider-admission', this.#admission)
    kernel.registerOwner('provider-controllers', this.#controllers)
    kernel.registerOwner('provider-executor', this.#executor)
    kernel.registerRoute(WebRpcMessageKind.request, (message) => this.#receiveRequest(message))
    this.#releaseAbortHandler = this.#variations.admit({
      operation: 'register',
      variation: WebRpcVariation.abort,
      handler: (message, peerKey) => this.#receiveAbort(message, peerKey)
    }) as () => void
    for (const [method, provider] of snapshotProviderEntries(prepared.providers))
      this.provide(method, provider)
  }

  /** Registers one provider and preserves duplicate-owner failure semantics. */
  provide(method: string, provider: IWebRpcProvider): this {
    this.#kernel.assertActive()
    if (typeof method !== 'string' || method.length === 0 || typeof provider !== 'function')
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        WebRpcErrorText.providerDescriptorInvalid
      )
    if (!this.#registry.register(method, provider))
      throw new WebRpcError(
        WebRpcErrorCode.providerDuplicated,
        WebRpcErrorText.providerDuplicated(method)
      )
    recordProviderRegistration(this.#transaction, method, provider)
    return this
  }

  /** Aborts the active provider task identified by its canonical task key or task id. */
  abort(id: string): void {
    const direct = this.#controllers.get(id)
    if (direct) {
      direct.abort()
      return
    }
    for (const [key, controller] of this.#controllers) {
      let parts: unknown
      try {
        parts = JSON.parse(key)
      } catch {
        continue
      }
      if (Array.isArray(parts) && parts[2] === id) controller.abort()
    }
  }

  /** Extends outbound live counts with the provider security closure's current ownership. */
  debugSnapshot(): IWebRpcEndpointDebugSnapshot {
    /**
     * Keeps provider-only counters available to provider RED evidence without widening the
     * enumerable endpoint snapshot consumed by the pre-existing B12b04 exact-shape contracts.
     */
    const snapshot: IWebRpcEndpointDebugSnapshot = {
      phase: this.#kernel.state === 'disposed' ? 'disposed' : 'active',
      pending: 0,
      pingPending: 0,
      chunks: 0,
      hooks: 0,
      resources: this.#kernel.resources.size,
      owners: this.#kernel.ownerKeys,
      discovery: {
        local: 0,
        remote: 0,
        waiters: 0,
        tasks: 0,
        timers: 0,
        manualWaiters: 0,
        inboundQueries: 0,
        inboundTimers: 0
      },
      activeControllers: this.#controllers.size,
      providers: this.#registry.providers.size,
      events: [...this.#registry.events.values()].reduce(
        (total, listeners) => total + listeners.length,
        0
      )
    }
    Object.defineProperty(snapshot, 'providerState', {
      configurable: false,
      enumerable: false,
      value: Object.freeze({ admission: this.#admission.size, replay: this.#replay.size }),
      writable: false
    })
    return snapshot
  }

  /** Releases all security and callback owners during reverse feature disposal. */
  dispose(): void {
    this.#releaseAbortHandler()
    for (const controller of this.#controllers.values()) controller.abort()
    this.#controllers.clear()
    this.#registry.clear()
    this.#replay.clear()
    this.#admission.clear()
  }

  /**
   * Cancels only the provider task named by a source-verified abort variation. Gated on
   * `#abortEnabled` exactly like legacy `src/endpoint.ts`'s `#features.abort === true` check: a
   * receiver that never selected the `abort()` middleware must not cancel an active controller or
   * record an early-abort tombstone, even though the variation route stays registered (matching the
   * legacy single always-listening receiver).
   */
  #receiveAbort(message: unknown, peerKey: string): void {
    if (!this.#abortEnabled) return
    const envelope = (message as { envelope?: { senderId?: string; taskId?: string } }).envelope
    if (!envelope?.senderId || !envelope.taskId) return
    const key = tupleKey(peerKey, envelope.senderId, envelope.taskId)
    this.#variations.admit({
      operation: 'abort',
      key,
      controller: this.#controllers.get(key),
      expiresAt: this.#kernel.time.now() + 310_000
    })
  }

  /** Verifies source identity, rejects replay, and executes one provider request. */
  async #receiveRequest(message: unknown): Promise<void> {
    const record = message as { envelope?: IWebRpcRequest; inbound?: IProviderInbound }
    const request = record.envelope
    const inbound = record.inbound
    if (
      !request ||
      request.kind !== WebRpcMessageKind.request ||
      request.targetId !== this.#id ||
      request.receiverId !== this.#receiverId
    )
      return
    if (this.#kernel.state !== 'active') return
    const admission = await this.#identity.verify({
      operation: 'admit',
      request: {
        senderId: request.senderId,
        targetId: request.targetId,
        data: request.data,
        inbound: inbound as IWebRpcInboundMessage
      }
    } as IWebRpcIdentityCommand)
    if (!admission || typeof admission !== 'object' || typeof admission.release !== 'function')
      return
    try {
      await this.#executor.execute(request, admission.token)
    } finally {
      admission.release()
    }
  }
}

/** Snapshots provider entries once and preserves the original getter failure as the cause. */
function snapshotProviderEntries(
  providers: Readonly<Record<string, IWebRpcProvider>> | undefined
): readonly (readonly [string, IWebRpcProvider])[] {
  try {
    return Object.entries(providers ?? {})
  } catch (error) {
    throw new WebRpcConfigurationError(WebRpcErrorText.providerDescriptorInvalid, error)
  }
}
