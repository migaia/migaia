import { ReplayWindow } from './replay.js';
import { ResourceScope } from './resource-scope.js';
import { VerifiedPeerRegistry } from './identity.js';
import { ChunkAssembler } from './chunk.js';
import { ProviderAdmissionRegistry } from './provider-admission.js';
import { PendingRegistry } from './pending.js';
import { WebRpcError, WebRpcErrorCode, WebRpcLifecycleError } from '../errors.js';
import { WebRpcControlKind, WebRpcMessageKind } from '../protocol-constants.js';

export type IEndpointOperationKind =
  | (typeof WebRpcControlKind)[keyof typeof WebRpcControlKind]
  | typeof WebRpcMessageKind.variation
  | typeof WebRpcMessageKind.chunk
  | 'provider';

export type IOperationResourceScope = {
  readonly kind: IEndpointOperationKind;
  readonly id: string;
  readonly replayRetained: boolean;
  release(): void;
  retainForReplay(): void;
};
type IReplayOwner = { purge(now: number): void; clear(): void };
export type IPingPending = {
  readonly targetId: string;
  readonly receiverId?: string;
  readonly verifiedPeerKey?: string;
  readonly resolve: (value: boolean) => void;
  readonly release?: () => void;
  settle(value: boolean): boolean;
};

/** Coordinates endpoint-wide resource ownership without implementing protocol policies. */
export class EndpointResourceManager {
  /** Owns request caller records and their terminal cleanup. */
  readonly pending = new PendingRegistry<unknown>();
  /** Owns ping caller records and their terminal cleanup. */
  readonly pingPending = new Map<string, IPingPending>();
  /** Owns provider controller records and aborts them during endpoint disposal. */
  readonly activeControllers = new Map<string, AbortController>();
  readonly #replay: ReplayWindow;
  readonly #resources: ResourceScope;
  readonly #verifiedPeers: VerifiedPeerRegistry;
  readonly #operations = new Map<string, IOperationResourceScope>();
  /** 重放保留 id（TTL 有界，`purgeReplay()` 到期清理），值域为创建时间戳。 */
  readonly #replayRetainedIds = new Map<string, number>();
  readonly #timers = new Map<string, { readonly clear: () => void }>();
  readonly #replayOwners: IReplayOwner[] = [];
  readonly #maintenanceOwners: IReplayOwner[] = [];
  readonly #waiters = new Map<string, () => void>();
  /** Settles endpoint callers before lower-level resources are released. */
  #settleCallers: (() => void) | undefined;
  readonly #chunkOperations = new Map<string, IOperationResourceScope>();
  #chunks: ChunkAssembler | undefined;
  #providerAdmission: ProviderAdmissionRegistry | undefined;
  #providerClear: (() => void) | undefined;
  #discoveryClose: (() => void) | undefined;
  #discoveryCloseFailure: unknown;
  #disposed = false;

  constructor(
    replay: ReplayWindow,
    resources: ResourceScope,
    verifiedPeers = new VerifiedPeerRegistry()
  ) {
    this.#replay = replay;
    this.#resources = resources;
    this.#verifiedPeers = verifiedPeers;
  }

  /** Acquires an identity lease on behalf of an endpoint-owned operation. */
  retainPeer(token: string): boolean {
    if (this.#disposed) return false;
    return this.#verifiedPeers.retain(token);
  }

  /** Checks an authenticated source binding through the lifecycle owner. */
  hasPeer(senderId: string, peerId?: string, origin?: string, sourceToken?: string): boolean {
    return this.#verifiedPeers.has(senderId, peerId, origin, sourceToken);
  }

  /** Registers an authenticated source binding through the lifecycle owner. */
  registerPeer(
    senderId: string,
    peerId?: string,
    origin?: string,
    sourceToken?: string
  ): string | false {
    if (this.#disposed) return false;
    return this.#verifiedPeers.register(senderId, peerId, origin, sourceToken);
  }

  /** Releases an identity lease on behalf of a replay or operation owner. */
  releasePeer(token: string): void {
    this.#verifiedPeers.release(token);
  }

  /** Acquires one provider execution lease through the endpoint owner. */
  acquire(taskKey: string, peerKey: string): boolean {
    if (this.#disposed || !this.#providerAdmission) return false;
    return this.#providerAdmission.acquire(taskKey, peerKey);
  }

  /** Releases one provider execution lease through the endpoint owner. */
  release(taskKey: string): void {
    this.#providerAdmission?.release(taskKey);
  }

  /** Tests whether a provider controller is already owned by this endpoint. */
  has(key: string): boolean {
    return this.activeControllers.has(key);
  }

  /** Returns one manager-owned ping caller record without exposing the registry. */
  getPingPending(taskId: string): IPingPending | undefined {
    return this.pingPending.get(taskId);
  }

  /** Returns one manager-owned request caller record. */
  getPending<T>(taskId: string): T | undefined {
    return this.pending.get(taskId) as T | undefined;
  }

  /** Commits one request caller record under the manager owner. */
  commitPending<T>(taskId: string, pending: T, canCommit: () => boolean): boolean {
    if (this.#disposed) return false;
    return this.pending.commit(taskId, pending, canCommit);
  }

  /** Removes one request caller record during settlement. */
  deletePending(taskId: string): void {
    this.pending.delete(taskId);
  }

  /** Returns the number of manager-owned request caller records. */
  get pendingSize(): number {
    return this.pending.tasks.size;
  }

  /** Returns the number of manager-owned ping caller records. */
  get pingPendingSize(): number {
    return this.pingPending.size;
  }

  /** Registers one ping caller record under the operation owner. */
  setPingPending(taskId: string, pending: IPingPending): void {
    if (this.#disposed) return;
    this.pingPending.set(taskId, pending);
  }

  /** Removes one ping caller record and releases its operation identifier. */
  deletePingPending(taskId: string): void {
    this.pingPending.delete(taskId);
    this.releaseId(taskId);
  }

  /** Registers one active provider controller under the endpoint owner. */
  set(key: string, controller: AbortController): void {
    if (this.#disposed) return;
    if (this.activeControllers.has(key)) return;
    this.activeControllers.set(key, controller);
  }

  /** Removes one active provider controller under the endpoint owner. */
  delete(key: string): void {
    this.activeControllers.delete(key);
  }

  /** Accepts one inbound chunk through the endpoint-owned assembler. */
  acceptChunk(
    frame: { messageId: string; index: number; total: number; data: string },
    peerKey: string
  ): string | undefined {
    // Late transport callbacks after dispose must be harmless and must not recreate scopes.
    if (this.#disposed || !this.#chunks) return undefined;
    const operationKey = JSON.stringify([peerKey, frame.messageId]);
    let operation = this.#chunkOperations.get(operationKey);
    if (!operation) {
      operation = this.begin('chunk', operationKey, true);
      this.#chunkOperations.set(operationKey, operation);
    }
    const assembled = this.#chunks.accept(frame, peerKey);
    if (assembled !== undefined || !this.#chunks.hasAssembly(frame.messageId, peerKey)) {
      operation.release();
      this.#chunkOperations.delete(operationKey);
    }
    return assembled;
  }

  /** Releases an expired chunk assembly from its operation scope. */
  releaseChunk(messageId: string, peerKey: string): void {
    const operationKey = JSON.stringify([peerKey, messageId]);
    this.#chunkOperations.get(operationKey)?.release();
    this.#chunkOperations.delete(operationKey);
  }

  /** Registers a discovery or lifecycle timer under the endpoint owner. */
  trackTimer(key: string, timer: { readonly clear: () => void }): void {
    if (this.#disposed) return;
    this.#timers.get(key)?.clear();
    this.#timers.set(key, timer);
  }

  /** Removes and clears one manager-owned timer idempotently. */
  releaseTimer(key: string): void {
    const timer = this.#timers.get(key);
    if (!timer) return;
    this.#timers.delete(key);
    timer.clear();
  }

  /** Registers a replay owner whose TTL and disposal are coordinated by the endpoint. */
  registerReplayOwner(owner: IReplayOwner): void {
    if (this.#disposed) throw new WebRpcLifecycleError('EndpointResourceManager is disposed');
    if (this.#replayOwners.includes(owner)) return;
    this.#replayOwners.push(owner);
  }

  /** Purges all registered replay owners and the TTL-bounded replay-retained id set. */
  purgeReplay(now = Date.now()): void {
    for (const owner of this.#replayOwners) owner.purge(now);
    for (const owner of this.#maintenanceOwners) owner.purge(now);
    this.#purgeReplayRetained(now);
  }

  /** Purges expired entries from the replay-retained id set (same TTL as the shared `ReplayWindow`). */
  #purgeReplayRetained(now = Date.now()): void {
    const ttl = this.#replay.ttlMs;
    for (const [id, createdAt] of this.#replayRetainedIds)
      if (now - createdAt >= ttl) this.#replayRetainedIds.delete(id);
  }

  /** Registers bounded admission/TTL maintenance under the endpoint owner. */
  registerMaintenanceOwner(owner: IReplayOwner): void {
    if (this.#disposed) throw new WebRpcLifecycleError('EndpointResourceManager is disposed');
    if (this.#maintenanceOwners.includes(owner)) return;
    this.#maintenanceOwners.push(owner);
  }

  /** Registers one discovery waiter cleanup transaction under the endpoint owner. */
  trackWaiter(key: string, cleanup: () => void): void {
    if (this.#disposed) return;
    this.#waiters.get(key)?.();
    this.#waiters.set(key, cleanup);
  }

  /** Releases one discovery waiter cleanup transaction idempotently. */
  releaseWaiter(key: string): void {
    const cleanup = this.#waiters.get(key);
    if (!cleanup) return;
    this.#waiters.delete(key);
    cleanup();
  }

  /** Attaches runtime registries after endpoint construction has created them. */
  attachRuntime(chunks: ChunkAssembler, providerAdmission: ProviderAdmissionRegistry): void {
    if (this.#disposed) throw new WebRpcLifecycleError('EndpointResourceManager is disposed');
    this.#chunks = chunks;
    this.#providerAdmission = providerAdmission;
  }

  /** Assigns provider-registry cleanup to the endpoint-wide lifecycle owner. */
  attachProviderRegistry(provider: { readonly clear: () => void }): void {
    if (this.#disposed) throw new WebRpcLifecycleError('EndpointResourceManager is disposed');
    this.#providerClear = () => provider.clear();
  }

  /** Assigns discovery waiter/session shutdown to the endpoint-wide lifecycle owner. */
  attachDiscoveryRegistry(close: () => void): void {
    if (this.#disposed) throw new WebRpcLifecycleError('EndpointResourceManager is disposed');
    this.#discoveryClose = close;
  }

  /** Registers the endpoint-specific caller settlement transaction. */
  attachCallerSettlement(settle: () => void): void {
    if (this.#disposed) throw new WebRpcLifecycleError('EndpointResourceManager is disposed');
    this.#settleCallers = settle;
  }

  /** Reserves an outbound identifier across active and replay-retained operations. */
  reserveId(id: string): boolean {
    if (this.#disposed) return false;
    return this.#replay.reserveId(id);
  }

  /** Checks the shared identifier ledger. */
  hasReservedId(id: string): boolean {
    return this.#replay.hasReservedId(id);
  }

  /** Releases an operation identifier exactly once. */
  releaseId(id: string): void {
    this.#replayRetainedIds.delete(id);
    this.#replay.releaseId(id);
  }

  /** Registers an operation scope and centralizes its terminal release policy. */
  begin(kind: IEndpointOperationKind, id: string, replayRetained = false): IOperationResourceScope {
    if (this.#disposed) throw new WebRpcLifecycleError('EndpointResourceManager is disposed');
    this.#purgeReplayRetained();
    if (this.#operations.has(id) || this.#replayRetainedIds.has(id))
      throw new WebRpcError(WebRpcErrorCode.overloaded, 'operation identifier is already active');
    // 只有「出站」kind（本 endpoint 发起）才占用出站 id 账本（ReplayWindow）。入站 kind
    // （provider/variation/chunk）的 id 来自对端 wire，若同样 reserve 会让已认证 peer 用 ~4096 个
    // 入站操作耗尽本 endpoint 的出站发送预算（overloaded）——见 hardening 2G.2 的跨命名空间容量攻击。
    const isOutbound =
      kind === WebRpcControlKind.request ||
      kind === WebRpcControlKind.dispatch ||
      kind === WebRpcControlKind.ping ||
      kind === WebRpcControlKind.discovery;
    if (isOutbound && !this.#replay.hasReservedId(id) && !this.#replay.reserveId(id))
      throw new WebRpcError(WebRpcErrorCode.overloaded, 'operation identifier is not available');
    let active = true;
    let retained = replayRetained;
    const scope: IOperationResourceScope = {
      kind,
      id,
      get replayRetained() {
        return retained;
      },
      release: () => {
        if (!active) return;
        active = false;
        if (this.#operations.get(id) === scope) this.#operations.delete(id);
        if (retained) this.#replayRetainedIds.set(id, Date.now());
        else if (isOutbound) this.#replay.releaseId(id);
      },
      retainForReplay: () => {
        if (!active) return;
        retained = true;
      }
    };
    this.#operations.set(id, scope);
    return scope;
  }

  /** Returns a stable count for diagnostics and lifecycle tests. */
  get size(): number {
    return this.#operations.size + this.#resources.size;
  }

  /** Stops new operations and releases operation-owned resources before endpoint resources. */
  async dispose(): Promise<readonly { readonly resource: string; readonly error: unknown }[]> {
    if (this.#disposed) return [];
    this.#disposed = true;
    this.#settleCallers?.();
    this.#settleCallers = undefined;
    this.pending.clear();
    this.pingPending.clear();
    try {
      this.#discoveryClose?.();
    } catch (error) {
      this.#discoveryCloseFailure = error;
    }
    this.#discoveryClose = undefined;
    for (const operation of this.#operations.values()) operation.release();
    this.#operations.clear();
    this.#replayRetainedIds.clear();
    this.#chunkOperations.clear();
    for (const key of this.#timers.keys()) this.releaseTimer(key);
    for (const owner of this.#replayOwners) owner.clear();
    this.#replayOwners.length = 0;
    for (const owner of this.#maintenanceOwners) owner.clear();
    this.#maintenanceOwners.length = 0;
    this.#replay.clear();
    this.#verifiedPeers.clear();
    for (const key of this.#waiters.keys()) this.releaseWaiter(key);
    for (const controller of this.activeControllers.values()) controller.abort();
    this.activeControllers.clear();
    this.#chunks?.clear();
    this.#providerAdmission?.clear();
    this.#providerClear?.();
    const resourceErrors = await this.#resources.releaseAll();
    if (this.#discoveryCloseFailure !== undefined)
      return [
        { resource: 'manual discovery abort listener', error: this.#discoveryCloseFailure },
        ...resourceErrors
      ];
    return resourceErrors;
  }
}
