import { RpcPlatform } from '../transport-constants.js'
import {
  RpcAbortError,
  RpcContractError,
  RpcError,
  RpcCoreErrorCode,
  RpcLifecycleError,
  RpcTimeoutError
} from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import type {
  IRpcConnectControl,
  IRpcDiscoveryControl,
  IRpcDiscoveryCandidate,
  IRpcAbortSignal,
  IRpcInboundDiscoveryQuery,
  IRpcServerMetadata,
  IRpcPlatform,
  IRpcConnectCapability,
  IRpcHookEvent,
  IRpcUuidConfig
} from '../typing.js'
import {
  normalizeRpcEnvelope,
  RpcRouteProfile,
  RpcRouteType,
  type IRpcEnvelope,
  type IRpcEnvelopeData,
  type IRpcPortableValue
} from '../../contract/index.js'
import type { IRpcInboundMessage } from '../transport.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import type { IOutboundReceiver } from './outbound-attachment.js'
import type { IInboundIdentityAdmission } from './inbound-identity.js'
import type {
  IRpcInboundIdentityPort,
  IRpcOutboundOperationsPort,
  IRpcTimePort,
  IRpcEndpointTimer
} from './plugin-shared-keys.js'
import { DiscoveryRegistry } from './discovery-registry.js'
import { RequestReplayLedger } from './request-replay-ledger.js'
import { safeRead, tupleKey, type IRpcPropertyReadReporter } from './safe-value.js'
import { raceWithAsyncControl } from './async-control.js'
import type { IRpcDiscoveryCleanupFaults } from './test-observer.js'
import { allocateRpcId } from './id.js'

/** Narrow ports consumed by the native discovery attachment. */
type IDiscoveryPorts = {
  readonly inboundIdentity: IRpcInboundIdentityPort
  readonly outboundOperations: IRpcOutboundOperationsPort
  readonly time: IRpcTimePort
  readonly candidatePing: (
    candidate: IRpcDiscoveryCandidate<string>,
    options?: { readonly timeoutMs?: number; readonly signal?: IRpcAbortSignal }
  ) => Promise<boolean>
}

/** Immutable endpoint facts needed by discovery without retaining the outbound owner. */
type IDiscoveryIdentity = {
  readonly id: string
  readonly receiverId: string
}

/** Opaque manual query state retained by the discovery owner until the application settles it. */
type IManualDiscoveryWaiter<TTargetId extends string> = {
  readonly targetId: TTargetId
  readonly candidates: IRpcDiscoveryCandidate<TTargetId>[]
  readonly candidateKeys: Set<string>
  readonly candidatePeerCounts: Map<string, number>
}

/** Shared automatic-discovery session state with reference-counted callers. */
type IAutomaticDiscoveryWaiter = {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  references: number
  taskId?: string
  timer?: IRpcEndpointTimer
  sessionDeadlineAt?: number
  settled: boolean
}

/** Inbound manual query data owned by the discovery attachment until expiry or settlement. */
type IManualInboundQuery = {
  readonly queryId: string
  readonly senderId: string
  readonly targetId: string
  readonly verifiedPeerKey: string
  readonly data: unknown
  readonly platform: IRpcPlatform
  readonly origin?: string
}

/** Owns discovery protocol frames and the canonical discovery registry on one kernel. */
export class RpcDiscoveryAttachment<TTargetId extends string = string> {
  /** Narrow shared ports used for identity admission, frame emission and clock reads. */
  readonly #ports: IDiscoveryPorts
  /** Endpoint identity facts copied from the prepared construction snapshot. */
  readonly #identity: IDiscoveryIdentity
  /** Kernel lifecycle and platform owner retained outside the compatibility bridge. */
  readonly #kernel: IEndpointKernelHost
  /** Canonical peer/query/timer owner migrated from the legacy endpoint. */
  readonly #registry: DiscoveryRegistry
  /** Discovery replay namespace, retained separately from request replay by protocol contract. */
  readonly #replay: RequestReplayLedger
  /** Release handles for both discovery protocol routes. */
  readonly #releaseRoutes: readonly (() => void)[]
  /** Stable public controls projected after installation. */
  readonly #controls: IRpcConnectControl<TTargetId> & IRpcDiscoveryControl<TTargetId>
  /** Stable configured identity included in automatic discovery responses. */
  readonly #uniqueTargetId: string | undefined
  /** Immutable discovery mode captured from the prepared endpoint snapshot. */
  readonly #mode: 'automatic' | 'manual'
  /** Immutable identifier contract captured from the prepared endpoint snapshot. */
  readonly #maxIdentifierLength: number
  /** Immutable UUID capability used only for discovery correlation IDs. */
  readonly #uuid: IRpcUuidConfig
  /** Optional receiver selector retained as executable connect configuration. */
  readonly #receiverSelector: IRpcConnectCapability['receiverSelector']
  /** Contract version retained for discovery negotiation envelopes. */
  readonly #applicationVersion: string
  /** Compatible versions retained for discovery negotiation envelopes. */
  readonly #acceptVersions: readonly string[]
  /** Last receiver identity snapshot reported for one target. */
  readonly #multipleReceiverSnapshots = new Map<TTargetId, string>()
  /** Manual query listeners are discovery-owner state, not endpoint state. */
  readonly #manualQueryListeners = new Set<
    (query: IRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
  >()
  /** Monotonic local receiver suffix used for non-broadcast receiver identity. */
  #nextReceiverId = 0
  /** Freshness bound for discovery receiver snapshots. */
  readonly #receiverStaleAfterMs = 300_000
  /** Receiver admission bound. */
  readonly #maxReceiversPerTarget = 64
  /** Makes direct attachment disposal idempotent while preserving the first failure identity. */
  #disposed = false
  /** Stores the exact first disposal failure for repeated direct disposal calls. */
  #disposeError: unknown
  /** Distinguishes an absent disposal failure from a disposer that threw undefined. */
  #hasDisposeError = false

  /** Installs discovery protocol ownership without creating another endpoint or receiver. */
  constructor(
    kernel: IEndpointKernelHost,
    prepared: IPreparedEndpoint<string>,
    ports: IDiscoveryPorts
  ) {
    this.#kernel = kernel
    this.#ports = ports
    const uniqueTargetId =
      typeof prepared.options.connect?.uniqueTargetId === 'string'
        ? prepared.options.connect.uniqueTargetId
        : undefined
    this.#identity = Object.freeze({
      id: prepared.id,
      receiverId:
        kernel.platform === RpcPlatform.broadcastChannel && uniqueTargetId !== undefined
          ? `${prepared.id}:${uniqueTargetId}`
          : prepared.id
    })
    this.#uniqueTargetId = uniqueTargetId
    this.#mode = prepared.options.connect?.discoveryMode ?? 'automatic'
    this.#maxIdentifierLength = prepared.options.contract?.maxIdentifierLength ?? 128
    this.#uuid = Object.freeze({ ...prepared.options.uuid })
    this.#receiverSelector = prepared.options.connect?.receiverSelector
    this.#applicationVersion = prepared.options.contract?.version ?? '1.0.0'
    this.#acceptVersions = Object.freeze([
      ...(prepared.options.contract?.acceptVersions ?? [this.#applicationVersion])
    ])
    this.#registry = new DiscoveryRegistry(
      {
        retain: (token) => this.#retainIdentity(token),
        release: (token) => this.#releaseIdentity(token)
      },
      (error) => this.#report(error)
    )
    this.#replay = new RequestReplayLedger(4096, 1024, 310_000, {
      retain: (token) => this.#retainIdentity(token),
      release: (token) => this.#releaseIdentity(token)
    })
    kernel.registerOwner('discovery-registry', this.#registry)
    kernel.registerOwner('discovery-replay', this.#replay)
    this.#releaseRoutes = [
      kernel.registerRoute('discovery', (message) => this.#receiveDiscovery(message))
    ]
    const baseControls: IRpcDiscoveryControl<TTargetId> = Object.freeze({
      getServerList: (targetId?: TTargetId) => this.#getServerList(targetId),
      pinReceiver: (targetId: TTargetId, receiverId: string) =>
        this.pinReceiver(targetId, receiverId),
      unpinReceiver: (targetId: TTargetId) => this.unpinReceiver(targetId)
    })
    const manualControls =
      this.#mode === 'manual'
        ? {
            query: (
              targetId: TTargetId,
              options?: { readonly timeoutMs?: number; readonly signal?: IRpcAbortSignal }
            ) => this.#manualQuery(targetId, options),
            onQuery: (
              listener: (query: IRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
            ) => {
              this.#assertActive()
              if (typeof listener !== 'function')
                throw new RpcError(
                  RpcCoreErrorCode.invalidConfig,
                  'query listener must be a function'
                )
              return this.addManualQueryListener(listener)
            },
            register: (candidate: IRpcDiscoveryCandidate<TTargetId>) =>
              this.#manualRegister(candidate),
            unregister: (targetId: TTargetId, receiverId?: string) =>
              this.#manualUnregister(targetId, receiverId),
            ...(prepared.options.features?.ping
              ? {
                  ping: (
                    candidate: IRpcDiscoveryCandidate<TTargetId>,
                    options?: {
                      readonly timeoutMs?: number
                      readonly signal?: IRpcAbortSignal
                    }
                  ) => this.#manualPing(candidate, options)
                }
              : {})
          }
        : undefined
    this.#controls = Object.freeze(
      manualControls === undefined ? baseControls : { ...baseControls, ...manualControls }
    )
  }

  /** Registers one manual listener while enforcing the one-listener contract. */
  addManualQueryListener(
    listener: (query: IRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
  ): () => void {
    if (this.#manualQueryListeners.size > 0)
      throw new RpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcCoreErrorText.manualQueryListenerDuplicate
      )
    this.#manualQueryListeners.add(listener)
    return () => this.#manualQueryListeners.delete(listener)
  }

  /** Reads the one manual query listener for inbound dispatch. */
  getManualQueryListener():
    | ((query: IRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>)
    | undefined {
    return this.#manualQueryListeners.values().next().value as
      | ((query: IRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>)
      | undefined
  }

  /** Allocates one receiver suffix under the discovery owner. */
  nextReceiverId(): number {
    this.#nextReceiverId += 1
    return this.#nextReceiverId
  }

  /** Returns active and stale-aware remote receiver metadata. */
  getServerList(targetId?: TTargetId): readonly IRpcServerMetadata<TTargetId>[] {
    this.#assertActive()
    const now = this.#ports.time.now()
    return Object.freeze(
      this.#registry
        .remoteSnapshot<IRpcServerMetadata<TTargetId>>()
        .map(([, entry]) => entry)
        .filter((entry) => targetId === undefined || entry.targetId === targetId)
        .sort((left, right) =>
          tupleKey(left.targetId, left.receiverId).localeCompare(
            tupleKey(right.targetId, right.receiverId)
          )
        )
        .map((entry) =>
          Object.freeze({
            ...entry,
            status:
              entry.status === 'active' &&
              this.#registry.hasRemote(tupleKey(entry.targetId, entry.receiverId)) &&
              now - entry.lastSeenAt >= this.#receiverStaleAfterMs
                ? 'stale'
                : entry.status
          })
        )
    )
  }

  /** Pins one active receiver through the canonical discovery owner. */
  pinReceiver(targetId: TTargetId, receiverId: string): void {
    this.#assertActive()
    this.#validateIdentifier(targetId, 'targetId')
    this.#validateIdentifier(receiverId, 'receiverId')
    if (
      this.#kernel.platform === RpcPlatform.broadcastChannel &&
      receiverId === String(targetId) &&
      this.#uniqueTargetId === undefined
    )
      throw new RpcError(
        RpcCoreErrorCode.targetNotIdentifiable,
        `BroadcastChannel target is not individually identifiable: ${targetId}`
      )
    const entry = this.#registry
      .remoteSnapshot<IRpcServerMetadata<TTargetId>>()
      .map(([, candidate]) => candidate)
      .find((candidate) => candidate.targetId === targetId && candidate.receiverId === receiverId)
    if (!entry || entry.status !== 'active')
      throw new RpcError(RpcCoreErrorCode.targetUnknown, `Unknown receiver: ${receiverId}`)
    this.#registry.pin(targetId, receiverId)
    this.#registry.clearPinLost(targetId)
    this.#registry.setRemote(tupleKey(targetId, receiverId), { ...entry, pinned: true })
    this.#emit({
      name: 'connect.receiver-pinned',
      code: 'RECEIVER_PINNED',
      targetId,
      receiverId
    })
  }

  /** Removes one target pin through the canonical discovery owner. */
  unpinReceiver(targetId: TTargetId): void {
    this.#assertActive()
    this.#validateIdentifier(targetId, 'targetId')
    this.#registry.unpin(targetId)
    this.#registry.clearPinLost(targetId)
    for (const [key, remote] of this.#registry.remoteSnapshot<IRpcServerMetadata<TTargetId>>())
      if (remote.targetId === targetId) this.#registry.setRemote(key, { ...remote, pinned: false })
    this.#emit({ name: 'connect.receiver-unpinned', code: 'RECEIVER_UNPINNED', targetId })
  }

  /** Returns active receiver count used by admission limits. */
  receiverCount(targetId: string): number {
    return this.getServerList(targetId as TTargetId).filter((entry) => entry.status === 'active')
      .length
  }

  /** Returns bounded discovery limits used by both automatic and manual modes. */
  get limits(): {
    readonly maxReceiversPerTarget: number
    readonly receiverStaleAfterMs: number
    readonly maxAutomaticAdmissions: number
    readonly maxAutomaticAdmissionsPerPeer: number
    readonly admissionWindowMs: number
    readonly sessionTtlMs: number
    readonly maxWaitersPerSession: number
    readonly maxManualInboundQueries: number
    readonly manualInboundQueryTtlMs: number
    readonly maxManualCandidatesPerQuery: number
    readonly maxManualCandidatesPerPeer: number
    readonly maxManualRevokedCandidates: number
  } {
    return {
      maxReceiversPerTarget: this.#maxReceiversPerTarget,
      receiverStaleAfterMs: this.#receiverStaleAfterMs,
      maxAutomaticAdmissions: 128,
      maxAutomaticAdmissionsPerPeer: 32,
      admissionWindowMs: 60_000,
      sessionTtlMs: 1_000,
      maxWaitersPerSession: 64,
      maxManualInboundQueries: 128,
      manualInboundQueryTtlMs: 60_000,
      maxManualCandidatesPerQuery: 128,
      maxManualCandidatesPerPeer: 32,
      maxManualRevokedCandidates: 4096
    }
  }

  /** Updates receiver activity without exposing registry ownership. */
  touchRemoteReceiver(targetId: string, receiverId: string): void {
    const key = tupleKey(targetId, receiverId)
    const entry = this.#registry.getRemote<IRpcServerMetadata<TTargetId>>(key)
    if (entry?.status === 'active')
      this.#registry.setRemote(key, { ...entry, lastSeenAt: this.#ports.time.now() })
  }

  /** Checks receiver ownership for inbound route validation. */
  ownsReceiver(targetId: string, receiverId: string): boolean {
    return this.#registry
      .localSnapshot<IRpcServerMetadata<TTargetId>>()
      .some(
        (entry) =>
          entry.targetId === targetId &&
          entry.receiverId === receiverId &&
          entry.status === 'active'
      )
  }

  /** Reports receiver multiplicity once per stable identity set. */
  diagnoseMultipleReceivers(targetId: TTargetId): void {
    const receiverIds = this.getServerList(targetId)
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.receiverId)
      .sort()
    if (receiverIds.length < 2) {
      this.#multipleReceiverSnapshots.delete(targetId)
      return
    }
    const snapshot = tupleKey(...receiverIds)
    if (this.#multipleReceiverSnapshots.get(targetId) === snapshot) return
    this.#multipleReceiverSnapshots.set(targetId, snapshot)
    this.#emit({
      name: 'connect.multiple-receivers',
      code: 'MULTIPLE_RECEIVERS',
      targetId,
      requesterId: this.#identity.id,
      receiverIds: Object.freeze([...receiverIds])
    })
  }

  /** Returns connect/discovery controls backed by the one registry owner. */
  get controls(): IRpcConnectControl<TTargetId> & IRpcDiscoveryControl<TTargetId> {
    return this.#controls
  }

  /** Returns a remote binding for outbound source verification. */
  getRemoteBinding(targetId: string, receiverId: string): string | undefined {
    return this.#registry.getRemoteBinding(tupleKey(targetId, receiverId))
  }

  /** Returns a pinned receiver without exposing registry ownership. */
  getPinnedReceiver(targetId: string): string | undefined {
    return this.#registry.getPin(targetId)
  }

  /** Returns the discovery debug projection owned by this attachment. */
  debugSnapshot(): ReturnType<DiscoveryRegistry['debugSnapshot']> {
    return this.#registry.debugSnapshot()
  }

  /** Purges expired admission state during endpoint resource maintenance. */
  purgeAdmissions(before: number): void {
    this.#registry.purgeAdmissions(before)
  }

  /** Clears discovery admission state during endpoint resource maintenance. */
  clearAdmissions(): void {
    this.#registry.clearAdmissions()
  }

  /** Checks the discovery waiter budget for ping admission. */
  canAdmitWaiter(targetId: string): boolean {
    return this.#registry.canAdmitWaiter(targetId)
  }

  /** Checks whether a discovery replay key has already completed. */
  hasCompletedTask(key: string): boolean {
    return this.#replay.has(key, this.#kernel.time.scheduler.now())
  }

  /** Returns local receiver metadata for endpoint disposal reporting. */
  localReceiverSnapshot<TValue>(): readonly TValue[] {
    return this.#registry.localSnapshot<TValue>()
  }

  /** Creates one local receiver identity through the canonical discovery owner. */
  ensureLocalReceiver(targetId: TTargetId): string {
    this.#assertActive()
    this.#validateIdentifier(targetId, 'targetId')
    const existing = this.#registry.getLocal<IRpcServerMetadata<TTargetId>>(targetId)
    if (existing?.status === 'active') return existing.receiverId
    const now = Math.max(this.#ports.time.now(), (existing?.registeredAt ?? 0) + 1)
    const receiverId = this.#identity.receiverId
    this.#registry.setLocal(targetId, {
      targetId,
      receiverId,
      platform: this.#kernel.platform,
      registeredAt: now,
      lastSeenAt: now,
      pinned: false,
      status: 'active'
    } satisfies IRpcServerMetadata<TTargetId>)
    this.#emit({
      name: 'connect.receiver-registered',
      code: 'RECEIVER_REGISTERED',
      targetId,
      receiverId
    })
    return receiverId
  }

  /** Validates a pinned receiver before an operation uses it. */
  assertReceiverAvailable(targetId: TTargetId, receiverId: string): void {
    const entry = this.getServerList(targetId).find(
      (candidate) => candidate.receiverId === receiverId
    )
    if (entry?.status === 'stale') {
      this.#registry.markPinLost(targetId)
      this.#emit({
        name: 'connect.pinned-receiver-lost',
        code: 'PINNED_RECEIVER_LOST',
        targetId,
        receiverId
      })
    }
    if (entry?.status !== 'active')
      throw new RpcError(
        RpcCoreErrorCode.targetUnknown,
        `Pinned receiver is unavailable: ${receiverId}`
      )
  }

  /** Returns a pinned receiver and its verified binding without exposing registry ownership. */
  receiverForTarget(targetId: TTargetId): {
    readonly receiverId?: string
    readonly verifiedPeerKey?: string
  } {
    const receiverId = this.#registry.getPin(targetId)
    if (receiverId !== undefined) this.assertReceiverAvailable(targetId, receiverId)
    return receiverId === undefined
      ? {}
      : {
          receiverId,
          verifiedPeerKey: this.#registry.getRemoteBinding(tupleKey(targetId, receiverId))
        }
  }

  /** Selects one receiver through the canonical discovery owner and configured selector. */
  async receiverForOperation(
    targetId: TTargetId,
    operation: string,
    timeoutMs?: number | false,
    signal?: IRpcAbortSignal
  ): Promise<{ readonly receiverId?: string; readonly verifiedPeerKey?: string }> {
    const pinned = this.#registry.getPin(targetId)
    if (pinned !== undefined || !this.#receiverSelector) return this.receiverForTarget(targetId)
    const serverList = this.getServerList(targetId)
    const selected = await raceWithAsyncControl({
      time: this.#kernel.time,
      operation: () =>
        Promise.resolve(
          this.#receiverSelector!(serverList, {
            endpointId: this.#identity.id,
            targetId,
            operation: operation as never
          })
        ),
      timeoutMs,
      signals: [this.#kernel.closingSignal, ...(signal ? [signal] : [])],
      createTimeoutError: () => new RpcTimeoutError(),
      createAbortError: () => new RpcAbortError(),
      onDiagnostic: (error) =>
        this.#emit({ name: 'failure', code: RpcCoreErrorCode.internal, error })
    })
    if (selected === undefined) return this.receiverForTarget(targetId)
    if (typeof selected !== 'string')
      throw new RpcError(
        RpcCoreErrorCode.targetUnknown,
        'receiverSelector returned an invalid receiver'
      )
    const entry = serverList.find(
      (candidate) => candidate.receiverId === selected && candidate.status === 'active'
    )
    if (!entry)
      throw new RpcError(
        RpcCoreErrorCode.targetUnknown,
        `receiverSelector returned an unavailable receiver: ${selected}`
      )
    return {
      receiverId: selected,
      verifiedPeerKey: this.#registry.getRemoteBinding(tupleKey(targetId, selected))
    }
  }

  /** Discovers an unknown target using the canonical query/replay owner. */
  async discoverTargetIfNeeded(
    targetId: TTargetId,
    timeoutMs: number | false = 1000,
    signal?: IRpcAbortSignal
  ): Promise<void> {
    this.#assertActive()
    if (this.#kernel.topology === 'exclusive') return
    if (this.getServerList(targetId).some((entry) => entry.status === 'active')) return
    await this.#automaticDiscovery(targetId, timeoutMs, signal)
  }

  /** Sends one automatic discovery query through the shared waiter session owner. */
  async query(targetId: TTargetId): Promise<void> {
    await this.#automaticDiscovery(targetId, false)
  }

  /** Returns one active receiver, discovering the target when its registry is empty. */
  async resolveReceiver(targetId: TTargetId): Promise<IOutboundReceiver> {
    const pinned = this.#registry.getPin(targetId)
    let entries = this.#activeReceivers(targetId, pinned)
    if (entries.length === 0) {
      await this.#automaticDiscovery(targetId, false)
      entries = this.#activeReceivers(targetId, pinned)
    }
    const selected = entries[0]
    if (!selected) return { receiverId: String(targetId) }
    return {
      receiverId: selected.receiverId,
      verifiedPeerKey: this.#registry.getRemoteBinding(
        tupleKey(selected.targetId, selected.receiverId)
      )
    }
  }

  /** Joins one automatic session while retaining its shared deadline and waiter reference. */
  #joinAutomaticDiscovery(
    targetId: TTargetId,
    waiter: IAutomaticDiscoveryWaiter,
    timeoutMs: number | false,
    signal?: IRpcAbortSignal
  ): Promise<void> {
    if (waiter.references >= this.limits.maxWaitersPerSession)
      return Promise.reject(
        new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.discoveryWaiterLimit)
      )
    waiter.references += 1
    return raceWithAsyncControl({
      time: this.#kernel.time,
      operation: () => waiter.promise,
      timeoutMs,
      signals: [this.#kernel.closingSignal, ...(signal ? [signal] : [])],
      createTimeoutError: () => new RpcTimeoutError(),
      createAbortError: (reason) =>
        this.#kernel.closingSignal.aborted
          ? new RpcLifecycleError(RpcCoreErrorText.endpointDisposed)
          : new RpcAbortError(undefined, undefined, reason),
      onDiagnostic: (error) =>
        this.#emit({ name: 'failure', code: RpcCoreErrorCode.internal, error })
    }).finally(() => {
      waiter.references -= 1
      if (waiter.references > 0 || waiter.settled) return
      const key = String(targetId)
      if (this.#registry.getWaiter<IAutomaticDiscoveryWaiter>(key) !== waiter) return
      this.#registry.deleteWaiter(key)
      if (waiter.taskId !== undefined) {
        this.#registry.deleteTask(waiter.taskId)
        this.#registry.deleteResponseCount(waiter.taskId)
        this.#clearAutomaticTimer(waiter.taskId, waiter)
      }
      waiter.reject(new RpcError(RpcCoreErrorCode.targetUnknown, `Unknown target: ${targetId}`))
    })
  }

  /** Shares one discovery session across callers and owns its deadline through the time port. */
  #automaticDiscovery(
    targetId: TTargetId,
    timeoutMs: number | false,
    signal?: IRpcAbortSignal
  ): Promise<void> {
    this.#assertActive()
    const key = String(targetId)
    const existing = this.#registry.getWaiter<IAutomaticDiscoveryWaiter>(key)
    if (existing) {
      if (timeoutMs !== false) {
        const deadline = this.#ports.time.now() + timeoutMs
        if (existing.sessionDeadlineAt === undefined || deadline > existing.sessionDeadlineAt) {
          if (existing.taskId !== undefined) this.#clearAutomaticTimer(existing.taskId, existing)
          existing.sessionDeadlineAt = deadline
          if (existing.taskId !== undefined)
            this.#scheduleAutomaticTimer(
              existing.taskId,
              existing,
              Math.max(0, deadline - this.#ports.time.now()),
              targetId
            )
        }
      }
      return this.#joinAutomaticDiscovery(targetId, existing, timeoutMs, signal)
    }

    const taskId = this.#makeId(targetId)
    let resolveDiscovery!: () => void
    let rejectDiscovery!: (error: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveDiscovery = resolve
      rejectDiscovery = reject
    })
    const waiter: IAutomaticDiscoveryWaiter = {
      promise,
      resolve: resolveDiscovery,
      reject: rejectDiscovery,
      references: 0,
      settled: false
    }
    void promise.then(
      () => {
        waiter.settled = true
      },
      () => {
        waiter.settled = true
      }
    )
    if (!this.#registry.setWaiter(key, waiter)) {
      return Promise.reject(
        new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.discoveryWaiterLimit)
      )
    }
    try {
      this.#registry.setTask(taskId, key)
      waiter.taskId = taskId
      this.#registry.setResponseCount(taskId, 0)
      const sessionTimeoutMs = timeoutMs === false ? this.limits.sessionTtlMs : timeoutMs
      waiter.sessionDeadlineAt = this.#ports.time.now() + sessionTimeoutMs
      this.#scheduleAutomaticTimer(taskId, waiter, sessionTimeoutMs, targetId)
      void this.#sendFrame(taskId, {
        route: {
          profile: RpcRouteProfile,
          type: RpcRouteType.discoveryQuery,
          applicationVersion: this.#applicationVersion,
          senderId: this.#identity.id,
          targetId,
          sentAt: this.#ports.time.timestamp()
        },
        ...(this.#uniqueTargetId === undefined
          ? {}
          : { payload: { __unique_id__: this.#uniqueTargetId } })
      }).catch((error: unknown) => {
        this.#clearAutomaticTimer(taskId, waiter)
        this.#registry.deleteResponseCount(taskId)
        if (this.#registry.deleteTask(taskId)) {
          this.#registry.deleteWaiter(key)
          waiter.reject(error)
        }
      })
    } catch (error) {
      this.#clearAutomaticTimer(taskId, waiter)
      this.#registry.deleteResponseCount(taskId)
      this.#registry.deleteTask(taskId)
      this.#registry.deleteWaiter(key)
      return Promise.reject(error)
    }
    void promise.catch(() => this.#clearAutomaticTimer(taskId, waiter))
    return this.#joinAutomaticDiscovery(targetId, waiter, timeoutMs, signal)
  }

  /** Installs one session timer and clears its waiter/task state on expiry. */
  #scheduleAutomaticTimer(
    taskId: string,
    waiter: IAutomaticDiscoveryWaiter,
    delayMs: number,
    targetId: TTargetId
  ): void {
    waiter.timer = this.#ports.time.setTimeout(() => {
      waiter.timer = undefined
      this.#registry.deleteTimer(taskId)
      this.#registry.deleteResponseCount(taskId)
      if (this.#registry.deleteTask(taskId)) {
        this.#registry.deleteWaiter(String(targetId))
        waiter.reject(new RpcError(RpcCoreErrorCode.targetUnknown, `Unknown target: ${targetId}`))
      }
    }, delayMs)
    this.#registry.setTimer(taskId, waiter.timer)
  }

  /** Clears one session timer without allowing timer cleanup to replace its primary error. */
  #clearAutomaticTimer(taskId: string, waiter: IAutomaticDiscoveryWaiter): void {
    const timer = waiter.timer
    waiter.timer = undefined
    this.#registry.deleteTimer(taskId)
    if (!timer) return
    try {
      this.#ports.time.clearTimeout(timer)
    } catch (error) {
      this.#report(error)
    }
  }

  /** Reads active receivers while honoring a pinned receiver contract. */
  #activeReceivers(
    targetId: TTargetId,
    pinned: string | undefined
  ): readonly IRpcServerMetadata<TTargetId>[] {
    return this.#registry
      .remoteSnapshot<IRpcServerMetadata<TTargetId>>()
      .map(([, value]) => value)
      .filter(
        (value) =>
          value.targetId === targetId &&
          value.status === 'active' &&
          (pinned === undefined || value.receiverId === pinned)
      )
  }

  /** Executes manual discovery against the same authenticated query path without exposing internals. */
  async #manualQuery(
    targetId: TTargetId,
    options?: { readonly timeoutMs?: number; readonly signal?: IRpcAbortSignal }
  ): Promise<readonly IRpcDiscoveryCandidate<TTargetId>[]> {
    this.#assertManualMode()
    this.#validateIdentifier(targetId, 'targetId')
    const timeoutMs = options?.timeoutMs ?? 1000
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        'discovery timeout must be finite and non-negative'
      )
    if (options?.signal?.aborted)
      throw new RpcError(RpcCoreErrorCode.cancelled, 'Discovery aborted')
    const taskId = this.#makeId(targetId)
    return new Promise((resolve, reject) => {
      const settleResolve = (value: readonly IRpcDiscoveryCandidate<TTargetId>[]): void => {
        resolve(value)
      }
      const settleReject = (error: unknown): void => {
        reject(error)
      }
      const timer = this.#ports.time.setTimeout(() => {
        this.#registry.resolveManualWaiter(taskId)
      }, timeoutMs)
      const waiter = {
        targetId,
        resolve: settleResolve,
        reject: settleReject,
        candidates: [],
        candidateKeys: new Set(),
        candidatePeerCounts: new Map(),
        timer,
        signal: options?.signal
      }
      this.#registry.setManualWaiter(taskId, waiter)
      if (options?.signal) {
        const onAbort = (): void => {
          const abortError = new RpcError(RpcCoreErrorCode.cancelled, 'Discovery aborted')
          try {
            this.#registry.rejectManualWaiter(taskId, abortError)
          } catch (error) {
            // DiscoveryRegistry performs external timer/listener cleanup before settling.
            // If that cleanup throws, finish the caller-owned promise here and report only
            // the cleanup failure; the cancellation outcome remains authoritative.
            if (this.#registry.getManualWaiter(taskId) === waiter) {
              this.#registry.deleteManualWaiter(taskId)
              settleReject(abortError)
            }
            this.#emit({ name: 'failure', code: RpcCoreErrorCode.internal, error })
          }
        }
        ;(waiter as { onAbort?: () => void }).onAbort = onAbort
        try {
          options.signal.addEventListener('abort', onAbort, { once: true })
          if (options.signal.aborted) onAbort()
        } catch (error) {
          this.#registry.deleteManualWaiter(taskId)
          timer?.clear()
          settleReject(error)
          return
        }
      }
      void Promise.resolve()
        .then(() => {
          if (this.#registry.getManualWaiter(taskId) !== waiter) return
          return this.#sendFrame(taskId, {
            route: {
              profile: RpcRouteProfile,
              type: RpcRouteType.discoveryQuery,
              applicationVersion: this.#applicationVersion,
              senderId: this.#identity.id,
              targetId,
              sentAt: this.#ports.time.timestamp(),
              manual: true
            },
            ...(this.#uniqueTargetId === undefined
              ? {}
              : { payload: { __unique_id__: this.#uniqueTargetId } })
          })
        })
        .catch((error) => {
          try {
            this.#registry.rejectManualWaiter(taskId, error)
          } catch (cleanupError) {
            if (this.#registry.getManualWaiter(taskId) === waiter) {
              this.#registry.deleteManualWaiter(taskId)
              settleReject(error)
            }
            this.#emit({ name: 'failure', code: RpcCoreErrorCode.internal, error: cleanupError })
          }
        })
    })
  }
  /** Adds an explicitly accepted manual candidate to remote discovery state. */
  #manualRegister(candidate: IRpcDiscoveryCandidate<TTargetId>): void {
    this.#assertManualMode()
    if (!candidate || typeof candidate !== 'object')
      throw new RpcError(RpcCoreErrorCode.invalidConfig, 'discovery candidate is invalid')
    const candidateRecord = this.#registry.getCandidate(candidate as object) as
      | { expiresAt: number; registered: boolean; revoked: boolean }
      | undefined
    if (
      !candidateRecord ||
      candidateRecord.expiresAt <= this.#ports.time.now() ||
      candidateRecord.revoked ||
      candidateRecord.registered
    )
      throw new RpcError(
        RpcCoreErrorCode.targetUnknown,
        'discovery candidate was not produced by a verified manual query'
      )
    this.#validateIdentifier(candidate.targetId, 'targetId')
    if (typeof candidate.receiverId !== 'string')
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        'discovery candidate receiverId is invalid'
      )
    try {
      this.#validateIdentifier(candidate.receiverId, 'receiverId')
    } catch {
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        'discovery candidate receiverId is invalid'
      )
    }
    const uniqueTargetId = this.#registry.getCandidateUniqueId(candidate as object)
    const key = tupleKey(candidate.targetId, candidate.receiverId)
    if (this.#registry.isCandidateRevoked(key))
      throw new RpcError(RpcCoreErrorCode.targetUnknown, 'discovery candidate was revoked')
    if (
      !this.#registry.hasRemote(key) &&
      this.receiverCount(candidate.targetId) >= this.limits.maxReceiversPerTarget
    ) {
      this.#emit({
        name: 'connect.receiver-announcement.failure',
        code: 'RECEIVER_LIMIT',
        targetId: candidate.targetId,
        receiverId: candidate.receiverId
      })
      throw new RpcError(RpcCoreErrorCode.targetUnknown, 'receiver limit exceeded')
    }
    const now = this.#ports.time.now()
    const previous = this.#registry.getRemote<IRpcServerMetadata<TTargetId>>(key)
    const candidateProof = this.#registry.getCandidate(candidate as object) as
      | { verifiedPeerKey?: string }
      | undefined
    if (candidateProof?.verifiedPeerKey === undefined)
      throw new RpcError(
        RpcCoreErrorCode.targetUnknown,
        'verified discovery binding is no longer available'
      )
    if (
      !this.#registry.setRemoteWithBinding(
        key,
        {
          targetId: candidate.targetId,
          receiverId: candidate.receiverId,
          platform: candidate.platform,
          origin: candidate.origin,
          ...(uniqueTargetId === undefined ? {} : { uniqueTargetId }),
          registeredAt: now,
          lastSeenAt: now,
          pinned: previous?.pinned ?? false,
          status: 'active'
        },
        candidateProof.verifiedPeerKey
      )
    )
      throw new RpcError(RpcCoreErrorCode.targetUnknown, 'remote discovery target limit exceeded')
    candidateRecord.registered = true
    if (previous?.status !== 'active')
      this.#emit({
        name: 'connect.receiver-registered',
        code: 'RECEIVER_REGISTERED',
        targetId: candidate.targetId,
        receiverId: candidate.receiverId
      })
    this.diagnoseMultipleReceivers(candidate.targetId)
  }
  /** Removes manually registered remote receiver state. */
  async #manualUnregister(targetId: TTargetId, receiverId?: string): Promise<void> {
    this.#assertManualMode()
    this.#validateIdentifier(targetId, 'targetId')
    if (receiverId !== undefined) this.#validateIdentifier(receiverId, 'receiverId')
    const keysToRevoke: string[] = []
    for (const [key, entry] of this.#registry.remoteSnapshot<IRpcServerMetadata<TTargetId>>()) {
      if (
        entry.targetId === targetId &&
        (receiverId === undefined || entry.receiverId === receiverId) &&
        !keysToRevoke.includes(key)
      )
        keysToRevoke.push(key)
    }
    for (const key of keysToRevoke)
      if (!this.#registry.canRevokeCandidate(key, this.limits.maxManualRevokedCandidates))
        throw new RpcError(RpcCoreErrorCode.overloaded, 'manual revocation capacity exceeded')
    const removed: IRpcServerMetadata<TTargetId>[] = []
    for (const [key, entry] of this.#registry.remoteSnapshot<IRpcServerMetadata<TTargetId>>()) {
      if (
        entry.targetId === targetId &&
        (receiverId === undefined || entry.receiverId === receiverId)
      ) {
        this.#registry.deleteRemote(key)
        if (!this.#registry.revokeCandidate(key, this.limits.maxManualRevokedCandidates))
          throw new RpcError(RpcCoreErrorCode.overloaded, 'manual revocation capacity exceeded')
        removed.push(entry)
      }
    }
    for (const entry of removed) {
      if (entry.pinned) {
        this.#registry.markPinLost(entry.targetId)
        this.#emit({
          name: 'connect.pinned-receiver-lost',
          code: 'PINNED_RECEIVER_LOST',
          targetId: entry.targetId,
          receiverId: entry.receiverId
        })
      }
      this.#emit({
        name: 'connect.server-unregistered',
        code: 'SERVER_UNREGISTERED',
        targetId: entry.targetId,
        receiverId: entry.receiverId
      })
    }
    this.diagnoseMultipleReceivers(targetId)
  }
  /** Pings a manually selected receiver through normal authenticated routing. */
  async #manualPing(
    candidate: IRpcDiscoveryCandidate<TTargetId>,
    options?: { readonly timeoutMs?: number; readonly signal?: IRpcAbortSignal }
  ): Promise<boolean> {
    this.#assertManualMode()
    if (!candidate || typeof candidate !== 'object')
      throw new RpcError(
        RpcCoreErrorCode.targetUnknown,
        'discovery candidate was not produced by a verified manual query'
      )
    if (typeof candidate.receiverId !== 'string')
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        'discovery candidate receiverId is invalid'
      )
    const candidateRecord = this.#registry.getCandidate(candidate as object) as
      | { expiresAt: number; registered: boolean; revoked: boolean }
      | undefined
    if (
      !candidateRecord ||
      candidateRecord.expiresAt <= this.#ports.time.now() ||
      candidateRecord.revoked ||
      this.#registry.isCandidateRevoked(tupleKey(candidate.targetId, candidate.receiverId))
    )
      throw new RpcError(
        RpcCoreErrorCode.targetUnknown,
        'discovery candidate was not produced by a verified manual query'
      )
    return this.#ports.candidatePing(candidate as IRpcDiscoveryCandidate<string>, options)
  }

  /** Handles both inbound discovery protocol branches after endpoint identity verification. */
  async handleInboundDiscovery(
    envelope: IRpcEnvelope,
    route: IRpcEnvelopeData,
    verifiedPeerKey: string,
    source?: IRpcInboundMessage<unknown>
  ): Promise<void> {
    if (
      envelope.kind !== 'discovery' ||
      typeof envelope.id !== 'string' ||
      route.route.targetId !== this.#identity.id
    )
      return
    if (route.route.manual && this.#mode !== 'manual') return
    /** Reports an invalid inbound discovery metadata read through this endpoint's existing hook. */
    const reportRead: IRpcPropertyReadReporter = ({ key, error }) => {
      this.#emit({
        name: 'failure',
        code: RpcCoreErrorCode.invalidConfig,
        error,
        ...(typeof key === 'string' ? { field: key } : {})
      })
      return undefined
    }
    if (route.route.type === RpcRouteType.discoveryQuery) {
      if (route.route.manual && this.#mode === 'manual') {
        const replayKey = tupleKey(
          'manual-query',
          verifiedPeerKey,
          route.route.senderId,
          envelope.id
        )
        if (this.#replay.has(replayKey, this.#kernel.time.scheduler.now())) {
          this.#emit({ name: 'authentication.rejected', code: 'MANUAL_QUERY_REPLAY' })
          return
        }
        const queryKey = tupleKey(
          'manual-query',
          verifiedPeerKey,
          route.route.senderId,
          envelope.id
        )
        if (this.#registry.hasInboundQuery(queryKey)) {
          this.#emit({ name: 'authentication.rejected', code: 'MANUAL_QUERY_COLLISION' })
          return
        }
        if (this.#registry.inboundQuerySize() >= this.limits.maxManualInboundQueries) {
          this.#emit({ name: 'failure', code: 'MANUAL_QUERY_LIMIT' })
          return
        }
        if (!this.#replay.admit(replayKey, verifiedPeerKey, this.#kernel.time.scheduler.now())) {
          this.#emit({ name: 'failure', code: 'DISCOVERY_QUERY_LIMIT' })
          return
        }
        const queryData =
          route.payload && typeof route.payload === 'object' && !Array.isArray(route.payload)
            ? Object.freeze(
                Object.fromEntries(
                  Object.entries(route.payload as Record<string, unknown>).filter(
                    ([key]) => key !== '__unique_id__'
                  )
                )
              )
            : route.payload
        this.#registry.setInboundQuery(queryKey, {
          queryId: envelope.id,
          senderId: route.route.senderId,
          targetId: route.route.targetId,
          verifiedPeerKey,
          data: queryData,
          platform: this.#kernel.platform,
          origin: source?.origin
        } satisfies IManualInboundQuery)
        this.#setInboundDiscoveryTimer(
          queryKey,
          this.#ports.time.setTimeout(() => {
            this.#deleteInboundDiscoveryTimer(queryKey)
            if (!this.#registry.deleteInboundQuery(queryKey)) return
            this.#replay.admit(replayKey, verifiedPeerKey, this.#kernel.time.scheduler.now())
            this.#emit({ name: 'authentication.rejected', code: 'MANUAL_QUERY_EXPIRED' })
          }, this.limits.manualInboundQueryTtlMs)
        )
        const listener = this.getManualQueryListener()
        if (listener) {
          const handle: IRpcInboundDiscoveryQuery<TTargetId> = Object.freeze({
            targetId: this.#identity.id as TTargetId,
            data: queryData,
            platform: this.#kernel.platform,
            origin: source?.origin,
            accept: (data: unknown) => this.#settleManualInboundQuery(queryKey, true, data),
            reject: (reason?: string) =>
              this.#settleManualInboundQuery(queryKey, false, undefined, reason)
          })
          try {
            void Promise.resolve(listener(handle)).catch((error) =>
              this.#emit({ name: 'failure', code: RpcCoreErrorCode.internal, error })
            )
          } catch (error) {
            this.#emit({ name: 'failure', code: RpcCoreErrorCode.internal, error })
          }
        }
        return
      }
      const replayKey = tupleKey(
        'automatic-query',
        verifiedPeerKey,
        route.route.senderId,
        envelope.id
      )
      if (this.#replay.has(replayKey, this.#kernel.time.scheduler.now())) {
        this.#emit({ name: 'authentication.rejected', code: 'DISCOVERY_QUERY_REPLAY' })
        return
      }
      if (!this.#replay.canAdmit(replayKey, verifiedPeerKey, this.#kernel.time.scheduler.now())) {
        this.#emit({ name: 'failure', code: 'DISCOVERY_QUERY_LIMIT' })
        return
      }
      if (!this.#admitAutomaticDiscovery(verifiedPeerKey, replayKey)) {
        this.#emit({ name: 'failure', code: 'DISCOVERY_QUERY_LIMIT' })
        return
      }
      if (!this.#replay.admit(replayKey, verifiedPeerKey, this.#kernel.time.scheduler.now())) {
        this.#registry.deleteAdmission(replayKey)
        this.#emit({ name: 'failure', code: 'DISCOVERY_QUERY_LIMIT' })
        return
      }
      const receiverId = this.ensureLocalReceiver(this.#identity.id as TTargetId)
      const response: IRpcEnvelopeData = {
        route: {
          profile: RpcRouteProfile,
          type: RpcRouteType.discoveryResponse,
          applicationVersion: this.#applicationVersion,
          senderId: this.#identity.id,
          targetId: route.route.senderId,
          resolvedTargetId: this.#identity.id,
          sentAt: this.#ports.time.timestamp(),
          platform: this.#kernel.platform,
          receiverId
        },
        ...(this.#uniqueTargetId === undefined
          ? {}
          : { payload: { __unique_id__: this.#uniqueTargetId } })
      }
      void this.#sendFrame(envelope.id, response).catch((error: unknown) =>
        this.#emit({ name: 'transport.failure', code: RpcCoreErrorCode.transport, error })
      )
      return
    }
    const resolvedTargetId = route.route.resolvedTargetId
    if (typeof resolvedTargetId !== 'string') return
    if (route.route.manual && route.route.operation === 'unregister') {
      this.#emit({
        name: 'authentication.rejected',
        code: 'UNAUTHORIZED_MANUAL_UNREGISTER'
      })
      return
    }
    if (route.route.manual) {
      const waiter = this.#registry.getManualWaiter<IManualDiscoveryWaiter<TTargetId>>(envelope.id)
      if (!waiter || waiter.targetId !== route.route.resolvedTargetId) return
      if (route.route.accepted !== true || typeof route.route.receiverId !== 'string') return
      try {
        this.#validateIdentifier(route.route.receiverId, 'receiverId')
      } catch (error) {
        this.#emit({ name: 'failure', code: RpcCoreErrorCode.invalidConfig, error })
        return
      }
      const candidateUniqueId =
        route.payload && typeof route.payload === 'object'
          ? safeRead<unknown>(route.payload, '__unique_id__', reportRead)
          : undefined
      if (candidateUniqueId !== undefined && typeof candidateUniqueId !== 'string') {
        this.#emit({
          name: 'failure',
          code: RpcCoreErrorCode.invalidConfig,
          error: new RpcError(
            RpcCoreErrorCode.invalidConfig,
            'discovery candidate uniqueTargetId must be a string'
          )
        })
        return
      }
      if (candidateUniqueId !== undefined) {
        try {
          this.#validateIdentifier(candidateUniqueId, 'uniqueTargetId')
        } catch (error) {
          this.#emit({ name: 'failure', code: RpcCoreErrorCode.invalidConfig, error })
          return
        }
      }
      if (
        this.#kernel.platform === RpcPlatform.broadcastChannel &&
        route.route.receiverId !==
          (candidateUniqueId === undefined
            ? route.route.resolvedTargetId
            : `${route.route.resolvedTargetId}:${candidateUniqueId}`)
      )
        return
      const candidateKey = tupleKey(
        verifiedPeerKey,
        route.route.resolvedTargetId,
        route.route.receiverId
      )
      if (waiter.candidateKeys.has(candidateKey)) return
      const peerCandidateCount = waiter.candidatePeerCounts.get(verifiedPeerKey) ?? 0
      if (waiter.candidates.length >= this.limits.maxManualCandidatesPerQuery) {
        this.#emit({ name: 'failure', code: 'MANUAL_CANDIDATE_LIMIT' })
        return
      }
      if (peerCandidateCount >= this.limits.maxManualCandidatesPerPeer) {
        this.#emit({ name: 'failure', code: 'MANUAL_CANDIDATE_PEER_LIMIT' })
        return
      }
      const candidate = Object.freeze({
        queryId: envelope.id,
        targetId: route.route.resolvedTargetId as TTargetId,
        receiverId: route.route.receiverId,
        data: route.payload,
        platform: this.#kernel.platform,
        origin: source?.origin
      })
      waiter.candidateKeys.add(candidateKey)
      waiter.candidatePeerCounts.set(verifiedPeerKey, peerCandidateCount + 1)
      waiter.candidates.push(candidate)
      this.#registry.setCandidate(
        candidate,
        {
          expiresAt: this.#ports.time.now() + this.limits.manualInboundQueryTtlMs,
          registered: false,
          revoked: false,
          verifiedPeerKey
        },
        candidateUniqueId
      )
      return
    }
    const targetId = this.#registry.getTask(envelope.id)
    if (
      targetId === undefined ||
      targetId !== route.route.resolvedTargetId ||
      route.route.targetId !== this.#identity.id
    )
      return
    if (typeof route.route.receiverId !== 'string') {
      this.#emit({ name: 'failure', code: RpcCoreErrorCode.invalidConfig })
      return
    }
    try {
      this.#validateIdentifier(route.route.receiverId, 'receiverId')
    } catch (error) {
      this.#emit({ name: 'failure', code: RpcCoreErrorCode.invalidConfig, error })
      return
    }
    const uniqueTargetId =
      route.payload && typeof route.payload === 'object'
        ? safeRead<unknown>(route.payload, '__unique_id__', reportRead)
        : undefined
    if (uniqueTargetId !== undefined) {
      if (typeof uniqueTargetId !== 'string') {
        this.#emit({ name: 'failure', code: RpcCoreErrorCode.invalidConfig })
        return
      }
      try {
        this.#validateIdentifier(uniqueTargetId, 'uniqueTargetId')
      } catch (error) {
        this.#emit({ name: 'failure', code: RpcCoreErrorCode.invalidConfig, error })
        return
      }
    }
    if (
      this.#kernel.platform === RpcPlatform.broadcastChannel &&
      route.route.receiverId !==
        (uniqueTargetId === undefined
          ? route.route.resolvedTargetId
          : `${route.route.resolvedTargetId}:${uniqueTargetId}`)
    )
      return
    const receiverId = route.route.receiverId
    const responseCount = (this.#registry.getResponseCount(envelope.id) ?? 0) + 1
    this.#registry.setResponseCount(envelope.id, responseCount)
    if (
      responseCount === 2 &&
      this.#kernel.platform === RpcPlatform.broadcastChannel &&
      uniqueTargetId === undefined
    )
      this.#emit({
        name: 'connect.multiple-receivers',
        code: 'MULTIPLE_RECEIVERS',
        targetId: route.route.resolvedTargetId,
        requesterId: this.#identity.id,
        receiverIds: Object.freeze([String(route.route.resolvedTargetId)]),
        ambiguous: true,
        responseCount
      })
    const remoteKey = tupleKey(resolvedTargetId, receiverId)
    const now = this.#ports.time.now()
    this.#registry.purgeRemote<IRpcServerMetadata<TTargetId>>(
      (entry) => entry.status === 'active' && now - entry.lastSeenAt >= this.#receiverStaleAfterMs,
      (entry) => entry.pinned || this.#registry.getPin(entry.targetId) === entry.receiverId
    )
    if (
      !this.#registry.hasRemote(remoteKey) &&
      this.receiverCount(resolvedTargetId) >= this.#maxReceiversPerTarget
    ) {
      this.#emit({
        name: 'connect.receiver-announcement.failure',
        code: 'RECEIVER_LIMIT',
        targetId: resolvedTargetId,
        receiverId
      })
      return
    }
    const previousRemote = this.#registry.getRemote<IRpcServerMetadata<TTargetId>>(remoteKey)
    if (
      !this.#registry.setRemoteWithBinding(
        remoteKey,
        {
          targetId: resolvedTargetId as TTargetId,
          receiverId,
          ...(typeof uniqueTargetId === 'string' ? { uniqueTargetId } : {}),
          platform: this.#kernel.platform,
          origin: source?.origin,
          registeredAt: previousRemote?.registeredAt ?? now,
          lastSeenAt: now,
          pinned:
            previousRemote?.pinned ??
            this.#registry.getPin(resolvedTargetId as TTargetId) === receiverId,
          status: 'active'
        },
        verifiedPeerKey
      )
    ) {
      this.#emit({ name: 'connect.receiver-announcement.failure', code: 'DISCOVERY_LIMIT' })
      return
    }
    this.diagnoseMultipleReceivers(resolvedTargetId as TTargetId)
    this.#registry.resolveAutomatic(targetId, (onExpire) =>
      this.#ports.time.setTimeout(onExpire, 1000)
    )
  }

  /** Admits one automatic query within the discovery owner limits. */
  #admitAutomaticDiscovery(peerKey: string, taskKey: string): boolean {
    this.#replay.purge(this.#kernel.time.scheduler.now())
    if (this.#registry.admissionSize() >= this.limits.maxAutomaticAdmissions) return false
    let peerAdmissions = 0
    for (const [, entry] of this.#registry.admissionSnapshot())
      if (entry.peerKey === peerKey) peerAdmissions += 1
    if (peerAdmissions >= this.limits.maxAutomaticAdmissionsPerPeer) return false
    this.#registry.setAdmission(taskKey, { peerKey, at: this.#ports.time.now() })
    return true
  }

  /** Settles one manual inbound query and emits its response through the owner port. */
  async #settleManualInboundQuery(
    key: string,
    accepted: boolean,
    data?: unknown,
    reason?: string
  ): Promise<boolean> {
    this.#assertManualMode()
    const query = this.#registry.takeInboundQuery(key) as IManualInboundQuery | undefined
    if (!query) return false
    if (reason !== undefined && typeof reason !== 'string')
      throw new RpcError(RpcCoreErrorCode.invalidConfig, 'query rejection reason must be a string')
    this.#replay.admit(
      tupleKey('manual-query', query.verifiedPeerKey, query.senderId, query.queryId),
      query.verifiedPeerKey,
      this.#kernel.time.scheduler.now()
    )
    const receiverId = accepted
      ? this.ensureLocalReceiver(this.#identity.id as TTargetId)
      : undefined
    const acceptedData =
      data && typeof data === 'object' && !Array.isArray(data)
        ? Object.fromEntries(
            Object.entries(data as Record<string, unknown>).filter(
              ([name]) => name !== '__unique_id__'
            )
          )
        : data
    const controlData =
      this.#uniqueTargetId === undefined
        ? acceptedData
        : {
            ...(acceptedData && typeof acceptedData === 'object'
              ? acceptedData
              : { value: acceptedData }),
            __unique_id__: this.#uniqueTargetId
          }
    await this.#sendFrame(query.queryId, {
      route: {
        profile: RpcRouteProfile,
        type: RpcRouteType.discoveryResponse,
        applicationVersion: this.#applicationVersion,
        senderId: this.#identity.id,
        targetId: query.senderId,
        resolvedTargetId: this.#identity.id,
        sentAt: this.#ports.time.timestamp(),
        manual: true,
        accepted,
        ...(accepted
          ? { platform: this.#kernel.platform, ...(receiverId === undefined ? {} : { receiverId }) }
          : {}),
        ...(reason === undefined ? {} : { message: reason })
      },
      ...(accepted ? { payload: controlData as IRpcPortableValue } : {})
    })
    return true
  }

  /** Owns an inbound manual-query timer through the endpoint-local time port. */
  #setInboundDiscoveryTimer(key: string, timer: { readonly clear: () => void }): void {
    this.#registry.setInboundTimer(key, timer)
  }

  /** Releases one inbound manual-query timer through the endpoint-local time port. */
  #deleteInboundDiscoveryTimer(key: string): void {
    this.#registry.deleteInboundTimer(key)
  }

  /** Disposes registry state and route ownership during reverse composition cleanup. */
  dispose(faults?: IRpcDiscoveryCleanupFaults): void {
    if (this.#disposed) {
      if (this.#hasDisposeError) throw this.#disposeError
      return
    }
    this.#disposed = true
    /** Test observation shares the real disposal edge and must never alter cleanup outcomes. */
    try {
      faults?.onDispose?.()
    } catch (error) {
      this.#report(error)
    }
    const cleanupErrors: unknown[] = []
    for (const [index, release] of this.#releaseRoutes.toReversed().entries()) {
      try {
        release()
      } catch (error) {
        cleanupErrors.push(error)
      }
      const routeError = faults?.route?.[index]
      if (routeError !== undefined) cleanupErrors.push(routeError)
    }
    try {
      this.#replay.clear()
    } catch (error) {
      cleanupErrors.push(error)
    }
    const replayError = faults?.replay?.[0]
    if (replayError !== undefined) cleanupErrors.push(replayError)
    cleanupErrors.push(
      ...this.#registry.closeAndCollect(new RpcLifecycleError(RpcCoreErrorText.endpointDisposed))
    )
    for (const registryError of faults?.registry ?? []) cleanupErrors.push(registryError)
    if (cleanupErrors.length === 1) {
      this.#disposeError = cleanupErrors[0]
      this.#hasDisposeError = true
      throw cleanupErrors[0]
    }
    if (cleanupErrors.length > 1) {
      this.#disposeError = new AggregateError(cleanupErrors)
      this.#hasDisposeError = true
      throw this.#disposeError
    }
  }

  /** Returns immutable active receiver metadata for one target or all targets. */
  #getServerList(targetId?: TTargetId): readonly IRpcServerMetadata<TTargetId>[] {
    return this.#registry
      .remoteSnapshot<IRpcServerMetadata<TTargetId>>()
      .map(([, value]) => value)
      .filter((value) => targetId === undefined || value.targetId === targetId)
  }

  /** Admits and answers one discovery query through the shared identity owner. */
  async #receiveQuery(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IRpcEnvelope
      route?: IRpcEnvelopeData
      inbound?: IRpcInboundMessage
      admission?: IInboundIdentityAdmission
    }
    const envelope = record.envelope
    const route = record.route
    if (
      !envelope ||
      envelope.kind !== 'discovery' ||
      typeof envelope.id !== 'string' ||
      route?.route.type !== RpcRouteType.discoveryQuery ||
      route.route.targetId !== this.#identity.id
    )
      return
    if (!record.admission) return
    if (route.route.manual) {
      await this.handleInboundDiscovery(envelope, route, record.admission.token, record.inbound)
      return
    }
    const replayKey = tupleKey(
      'discovery-query',
      record.admission.token,
      route.route.senderId,
      envelope.id
    )
    if (!this.#replay.admit(replayKey, record.admission.token, this.#kernel.time.scheduler.now()))
      return
    const receiverId = this.ensureLocalReceiver(this.#identity.id as TTargetId)
    await this.#sendFrame(envelope.id, {
      route: {
        profile: RpcRouteProfile,
        type: RpcRouteType.discoveryResponse,
        applicationVersion: this.#applicationVersion,
        senderId: this.#identity.id,
        targetId: route.route.senderId,
        resolvedTargetId: this.#identity.id,
        sentAt: this.#ports.time.timestamp(),
        platform: this.#kernel.platform,
        receiverId
      },
      ...(this.#uniqueTargetId === undefined
        ? {}
        : { payload: { __unique_id__: this.#uniqueTargetId } })
    })
  }

  /** Admits one response and settles the matching discovery waiter/snapshot. */
  async #receiveResponse(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IRpcEnvelope
      route?: IRpcEnvelopeData
      inbound?: IRpcInboundMessage
      admission?: IInboundIdentityAdmission
    }
    const envelope = record.envelope
    const route = record.route
    if (
      !envelope ||
      envelope.kind !== 'discovery' ||
      typeof envelope.id !== 'string' ||
      route?.route.type !== RpcRouteType.discoveryResponse ||
      route.route.targetId !== this.#identity.id ||
      typeof route.route.resolvedTargetId !== 'string'
    )
      return
    if (!record.admission) return
    if (route.route.manual) {
      await this.handleInboundDiscovery(envelope, route, record.admission.token, record.inbound)
      return
    }
    const targetId = this.#registry.getTask(envelope.id)
    if (
      !targetId ||
      targetId !== route.route.resolvedTargetId ||
      typeof route.route.receiverId !== 'string'
    )
      return
    this.#validateIdentifier(route.route.receiverId, 'receiverId')
    const key = tupleKey(route.route.resolvedTargetId, route.route.receiverId)
    const now = this.#ports.time.now()
    this.#registry.purgeRemote<IRpcServerMetadata<TTargetId>>(
      (entry) => entry.status === 'active' && now - entry.lastSeenAt >= this.#receiverStaleAfterMs,
      (entry) => entry.pinned || this.#registry.getPin(entry.targetId) === entry.receiverId
    )
    if (
      !this.#registry.hasRemote(key) &&
      this.receiverCount(route.route.resolvedTargetId) >= this.#maxReceiversPerTarget
    )
      return
    this.#registry.setRemoteWithBinding(
      key,
      {
        targetId: route.route.resolvedTargetId as TTargetId,
        receiverId: route.route.receiverId,
        ...(route.payload &&
        typeof route.payload === 'object' &&
        typeof (route.payload as { __unique_id__?: unknown }).__unique_id__ === 'string'
          ? { uniqueTargetId: (route.payload as { __unique_id__: string }).__unique_id__ }
          : {}),
        platform: this.#kernel.platform,
        origin: record.inbound?.origin,
        registeredAt: now,
        lastSeenAt: now,
        pinned: false,
        status: 'active'
      },
      record.admission.token
    )
    const waiter = this.#registry.getWaiter<{ resolve: () => void }>(targetId)
    waiter?.resolve()
    const responseCount = (this.#registry.getResponseCount(envelope.id) ?? 0) + 1
    this.#registry.setResponseCount(envelope.id, responseCount)
    this.diagnoseMultipleReceivers(route.route.resolvedTargetId as TTargetId)
    this.#registry.resolveAutomatic(targetId, (onExpire) =>
      this.#ports.time.setTimeout(onExpire, 1000)
    )
  }

  /** Dispatches only canonical discovery envelope and route pairs after route validation. */
  async #receiveDiscovery(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IRpcEnvelope
      route?: IRpcEnvelopeData
      inbound?: IRpcInboundMessage
      admission?: IInboundIdentityAdmission
    }
    const envelope = record.envelope
    const route = record.route
    if (envelope?.kind !== 'discovery' || !route) return
    if (route.route.type === RpcRouteType.discoveryQuery) {
      await this.#receiveQuery({
        envelope,
        route,
        inbound: record.inbound,
        admission: record.admission
      })
      return
    }
    if (route.route.type !== RpcRouteType.discoveryResponse) return
    /** Response routing requires a concrete target before it can touch discovery state. */
    const resolvedTargetId = route.route.resolvedTargetId
    if (typeof resolvedTargetId !== 'string') return
    await this.#receiveResponse({
      envelope,
      route,
      inbound: record.inbound,
      admission: record.admission
    })
  }

  /** Sends discovery through the canonical semantic envelope and WebRPC route profile. */
  #sendFrame(id: string, route: IRpcEnvelopeData): Promise<void> {
    return this.#ports.outboundOperations.send({
      kind: 'frame',
      message: normalizeRpcEnvelope({
        kind: 'discovery',
        id,
        version: this.#applicationVersion,
        acceptVersions: this.#acceptVersions,
        data: route
      })
    })
  }

  /** Rejects work after composition disposal through the canonical kernel state. */
  #assertActive(): void {
    this.#kernel.assertActive()
  }

  /** Rejects manual-only operations when the immutable endpoint mode is automatic. */
  #assertManualMode(): void {
    this.#assertActive()
    if (this.#mode !== 'manual')
      throw new RpcError(RpcCoreErrorCode.invalidConfig, 'manual discovery is unavailable')
  }

  /** Validates one wire identifier against the prepared contract snapshot. */
  #validateIdentifier(value: string, label: string): void {
    if (typeof value !== 'string' || value.length === 0 || value.length > this.#maxIdentifierLength)
      throw new RpcContractError(`${label} must be a non-empty identifier within the limit`)
  }

  /** Allocates one collision-checked discovery correlation ID without a second ledger owner. */
  #makeId(targetId: TTargetId): string {
    const id = allocateRpcId(
      this.#uuid,
      'variation',
      this.#identity.id,
      targetId,
      (candidate) =>
        this.#registry.getTask(candidate) !== undefined ||
        this.#registry.getManualWaiter(candidate) !== undefined
    )
    this.#validateIdentifier(id, 'variation id')
    return id
  }

  /** Emits one discovery diagnostic through the canonical outbound hook owner. */
  #emit(event: Omit<IRpcHookEvent, 'at' | 'localId'>): void {
    this.#ports.outboundOperations.send({ kind: 'diagnostic', event })
  }

  /** Retains one identity lease without creating a discovery-owned identity registry. */
  #retainIdentity(token: string): boolean {
    return this.#ports.inboundIdentity.verify({ operation: 'retain', token }) === true
  }

  /** Releases one identity lease through the canonical identity owner. */
  #releaseIdentity(token: string): void {
    this.#ports.inboundIdentity.verify({ operation: 'release', token })
  }

  /** Reports discovery failures through the bounded outbound report command. */
  #report(error: unknown): void {
    this.#ports.outboundOperations.send({ kind: 'report', error })
  }
}
