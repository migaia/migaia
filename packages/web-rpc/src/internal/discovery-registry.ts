/** Owns all discovery, DNS, pinning and manual-candidate state for one endpoint. */
export class DiscoveryRegistry {
  readonly #localTargets = new Map<unknown, unknown>();
  readonly #remoteTargets = new Map<string, unknown>();
  readonly #remoteBindings = new Map<string, string>();
  readonly #pinnedReceivers = new Map<unknown, string>();
  readonly #lostPinnedReceivers = new Set<unknown>();
  readonly #waiters = new Map<string, unknown>();
  readonly #tasks = new Map<string, string>();
  readonly #timers = new Map<string, { readonly clear: () => void }>();
  readonly #responseCounts = new Map<string, number>();
  readonly #automaticAdmissions = new Map<
    string,
    { readonly peerKey: string; readonly at: number }
  >();
  readonly #manualQueryWaiters = new Map<string, unknown>();
  readonly #manualInboundQueries = new Map<string, unknown>();
  readonly #manualInboundQueryTimers = new Map<string, { readonly clear: () => void }>();
  readonly #manualCandidates = new WeakMap<object, unknown>();
  readonly #manualRevokedCandidates = new Set<string>();
  readonly #manualCandidateUniqueIds = new WeakMap<object, string | undefined>();
  readonly #retainBinding: ((token: string) => boolean) | undefined;
  readonly #releaseBinding: ((token: string) => void) | undefined;

  constructor(lease?: {
    readonly retain: (token: string) => boolean;
    readonly release: (token: string) => void;
  }) {
    this.#retainBinding = lease?.retain;
    this.#releaseBinding = lease?.release;
  }

  /** Returns counts for package-level lifecycle assertions without exposing registry state. */
  debugSnapshot(): {
    readonly local: number;
    readonly remote: number;
    readonly waiters: number;
    readonly tasks: number;
    readonly timers: number;
    readonly manualWaiters: number;
    readonly inboundQueries: number;
    readonly inboundTimers: number;
  } {
    return {
      local: this.#localTargets.size,
      remote: this.#remoteTargets.size,
      waiters: this.#waiters.size,
      tasks: this.#tasks.size,
      timers: this.#timers.size,
      manualWaiters: this.#manualQueryWaiters.size,
      inboundQueries: this.#manualInboundQueries.size,
      inboundTimers: this.#manualInboundQueryTimers.size
    };
  }

  /** Commits one remote receiver snapshot. */
  setRemote(key: string, value: unknown, maxEntries = 4096): boolean {
    if (!this.#remoteTargets.has(key) && this.#remoteTargets.size >= maxEntries) return false;
    this.#remoteTargets.set(key, value);
    return true;
  }

  /** Atomically commits a remote snapshot together with its verified identity lease. */
  setRemoteWithBinding(key: string, value: unknown, token: string, maxEntries = 4096): boolean {
    if (!this.#remoteTargets.has(key) && this.#remoteTargets.size >= maxEntries) return false;
    const previous = this.#remoteBindings.get(key);
    if (previous !== token && this.#retainBinding && !this.#retainBinding(token)) return false;
    if (previous !== undefined && previous !== token) this.#releaseBinding?.(previous);
    this.#remoteTargets.set(key, value);
    this.#remoteBindings.set(key, token);
    return true;
  }

  /** Reads one remote receiver snapshot through the registry owner. */
  getRemote<T>(key: string): T | undefined {
    return this.#remoteTargets.get(key) as T | undefined;
  }

  /** Reads the verified source token owned by one remote snapshot. */
  getRemoteBinding(key: string): string | undefined {
    return this.#remoteBindings.get(key);
  }

  /** Returns an immutable snapshot of remote receiver entries. */
  remoteSnapshot<T>(): readonly (readonly [string, T])[] {
    return Object.freeze(
      [...this.#remoteTargets.entries()].map(([key, value]) =>
        Object.freeze([key, value as T] as const)
      )
    );
  }

  /** Tests whether a remote receiver snapshot exists. */
  hasRemote(key: string): boolean {
    return this.#remoteTargets.has(key);
  }

  /** Purges stale unprotected remote snapshots and returns the number removed. */
  purgeRemote<T>(isStale: (value: T) => boolean, isProtected: (value: T) => boolean): number {
    let removed = 0;
    for (const [key, value] of this.#remoteTargets) {
      const typed = value as T;
      if (isStale(typed) && !isProtected(typed) && this.#remoteTargets.delete(key)) {
        this.#releaseRemoteBinding(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Removes one remote receiver snapshot. */
  deleteRemote(key: string): boolean {
    this.#releaseRemoteBinding(key);
    return this.#remoteTargets.delete(key);
  }

  /** Commits one automatic discovery waiter. */
  setWaiter(key: string, value: unknown, maxEntries = 1024): boolean {
    if (!this.#waiters.has(key) && this.#waiters.size >= maxEntries) return false;
    this.#waiters.set(key, value);
    return true;
  }

  /** Checks waiter capacity before an operation allocates a task identifier. */
  canAdmitWaiter(key: string, maxEntries = 1024): boolean {
    return this.#waiters.has(key) || this.#waiters.size < maxEntries;
  }

  /** Reads one automatic discovery waiter. */
  getWaiter<T>(key: string): T | undefined {
    return this.#waiters.get(key) as T | undefined;
  }

  /** Removes one automatic discovery waiter. */
  deleteWaiter(key: string): boolean {
    return this.#waiters.delete(key);
  }

  /** Commits one manual query waiter. */
  setManualWaiter(key: string, value: unknown): void {
    this.#manualQueryWaiters.set(key, value);
  }

  /** Reads one manual outbound waiter. */
  getManualWaiter<T>(key: string): T | undefined {
    return this.#manualQueryWaiters.get(key) as T | undefined;
  }

  /** Removes one manual query waiter. */
  deleteManualWaiter(key: string): boolean {
    return this.#manualQueryWaiters.delete(key);
  }

  /** Owns one inbound manual-query expiry timer. */
  setInboundTimer(key: string, timer: { readonly clear: () => void }): void {
    this.#manualInboundQueryTimers.set(key, timer);
  }

  /** Reads one inbound manual query. */
  getInboundQuery<T>(key: string): T | undefined {
    return this.#manualInboundQueries.get(key) as T | undefined;
  }

  /** Tests whether an inbound manual query is already registered. */
  hasInboundQuery(key: string): boolean {
    return this.#manualInboundQueries.has(key);
  }

  /** Returns the number of inbound manual queries. */
  inboundQuerySize(): number {
    return this.#manualInboundQueries.size;
  }

  /** Removes one inbound manual-query expiry timer. */
  deleteInboundTimer(key: string): boolean {
    return this.#manualInboundQueryTimers.delete(key);
  }

  /** Stores an opaque manual candidate proof and its captured identity. */
  setCandidate(candidate: object, proof: unknown, uniqueTargetId: string | undefined): void {
    this.#manualCandidates.set(candidate, proof);
    this.#manualCandidateUniqueIds.set(candidate, uniqueTargetId);
  }

  /** Reads an opaque candidate proof without exposing the backing WeakMap. */
  getCandidate(candidate: object): unknown {
    return this.#manualCandidates.get(candidate);
  }

  /** Reads the identity captured when a candidate was issued. */
  getCandidateUniqueId(candidate: object): string | undefined {
    return this.#manualCandidateUniqueIds.get(candidate);
  }

  /** Tests whether a candidate receiver key was revoked. */
  isCandidateRevoked(key: string): boolean {
    return this.#manualRevokedCandidates.has(key);
  }

  /** Records a revoked candidate receiver key. */
  revokeCandidate(key: string, maxEntries: number): boolean {
    if (!this.#manualRevokedCandidates.has(key) && this.#manualRevokedCandidates.size >= maxEntries)
      return false;
    this.#manualRevokedCandidates.add(key);
    return true;
  }

  /** Checks whether a new revocation record can be admitted without eviction. */
  canRevokeCandidate(key: string, maxEntries: number): boolean {
    return (
      this.#manualRevokedCandidates.has(key) || this.#manualRevokedCandidates.size < maxEntries
    );
  }

  /** Settles one manual query and releases its timer and abort listener. */
  resolveManualWaiter(key: string): boolean {
    const waiter = this.#manualQueryWaiters.get(key) as
      | {
          timer: { readonly clear: () => void };
          candidates: readonly unknown[];
          signal?: IAbortSignal;
          onAbort?: () => void;
          resolve: (value: readonly unknown[]) => void;
        }
      | undefined;
    if (!waiter) return false;
    waiter.timer.clear();
    this.deleteManualWaiter(key);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.resolve(Object.freeze([...waiter.candidates]));
    return true;
  }

  /** Rejects one manual query and releases its timer and abort listener. */
  rejectManualWaiter(key: string, error: unknown): boolean {
    const waiter = this.#manualQueryWaiters.get(key) as
      | {
          timer: { readonly clear: () => void };
          signal?: IAbortSignal;
          onAbort?: () => void;
          reject: (reason: unknown) => void;
        }
      | undefined;
    if (!waiter) return false;
    waiter.timer.clear();
    this.deleteManualWaiter(key);
    let cleanupError: unknown;
    if (waiter.signal && waiter.onAbort) {
      try {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      } catch (error) {
        cleanupError = error;
      }
    }
    waiter.reject(error);
    if (cleanupError !== undefined) throw cleanupError;
    return true;
  }

  /** Removes and returns an inbound manual query with its expiry timer. */
  takeInboundQuery(key: string): unknown | undefined {
    const query = this.#manualInboundQueries.get(key);
    if (query === undefined) return undefined;
    this.deleteInboundQuery(key);
    this.#manualInboundQueryTimers.get(key)?.clear();
    this.deleteInboundTimer(key);
    return query;
  }

  /** Commits one inbound manual query. */
  setInboundQuery(key: string, value: unknown): void {
    this.#manualInboundQueries.set(key, value);
  }

  /** Removes one inbound manual query. */
  deleteInboundQuery(key: string): boolean {
    return this.#manualInboundQueries.delete(key);
  }

  /** Commits local receiver ownership. */
  setLocal(key: unknown, value: unknown): void {
    this.#localTargets.set(key, value);
  }

  /** Reads one local receiver ownership record. */
  getLocal<T>(key: unknown): T | undefined {
    return this.#localTargets.get(key) as T | undefined;
  }

  /** Returns an immutable snapshot of local receiver ownership records. */
  localSnapshot<T>(): readonly T[] {
    return Object.freeze([...this.#localTargets.values()] as T[]);
  }

  /** Pins one receiver for a target. */
  pin(key: unknown, receiverId: string): void {
    this.#pinnedReceivers.set(key, receiverId);
  }

  /** Reads the receiver pinned for one target. */
  getPin(key: unknown): string | undefined {
    return this.#pinnedReceivers.get(key);
  }

  /** Marks a target whose pinned receiver disappeared. */
  markPinLost(key: unknown): void {
    this.#lostPinnedReceivers.add(key);
  }

  /** Clears the lost-pin marker for one target. */
  clearPinLost(key: unknown): void {
    this.#lostPinnedReceivers.delete(key);
  }

  /** Tests whether a target has lost its pinned receiver. */
  isPinLost(key: unknown): boolean {
    return this.#lostPinnedReceivers.has(key);
  }

  /** Removes a target pin. */
  unpin(key: unknown): boolean {
    return this.#pinnedReceivers.delete(key);
  }

  /** Tracks one automatic discovery task. */
  setTask(key: string, targetId: string): void {
    this.#tasks.set(key, targetId);
  }

  /** Reads the target associated with one discovery task. */
  getTask(key: string): string | undefined {
    return this.#tasks.get(key);
  }

  /** Removes one automatic discovery task. */
  deleteTask(key: string): boolean {
    return this.#tasks.delete(key);
  }

  /** Tracks one discovery timer. */
  setTimer(key: string, timer: { readonly clear: () => void }): void {
    this.#timers.set(key, timer);
  }

  /** Removes one discovery timer. */
  deleteTimer(key: string): boolean {
    return this.#timers.delete(key);
  }

  /** Stores the response count for one discovery task. */
  setResponseCount(key: string, count: number): void {
    this.#responseCounts.set(key, count);
  }

  /** Reads the current response count for one discovery task. */
  getResponseCount(key: string): number | undefined {
    return this.#responseCounts.get(key);
  }

  /** Removes one discovery response count. */
  deleteResponseCount(key: string): boolean {
    return this.#responseCounts.delete(key);
  }

  /** Records one automatic-discovery admission. */
  setAdmission(key: string, value: { readonly peerKey: string; readonly at: number }): void {
    this.#automaticAdmissions.set(key, value);
  }

  /** Returns an immutable snapshot of automatic admission records. */
  admissionSnapshot(): readonly (readonly [
    string,
    { readonly peerKey: string; readonly at: number }
  ])[] {
    return Object.freeze(
      [...this.#automaticAdmissions.entries()].map(([key, value]) =>
        Object.freeze([key, value] as const)
      )
    );
  }

  /** Returns the number of active automatic admissions. */
  admissionSize(): number {
    return this.#automaticAdmissions.size;
  }

  /** Removes one automatic-discovery admission. */
  deleteAdmission(key: string): boolean {
    return this.#automaticAdmissions.delete(key);
  }

  /** Releases an automatic waiter on first response and owns its collection timer. */
  resolveAutomatic(
    targetId: string,
    createCollectionTimer: (onExpire: () => void) => { readonly clear: () => void }
  ): boolean {
    const waiter = this.#waiters.get(targetId) as
      | {
          settled: boolean;
          taskId?: string;
          timer?: { readonly clear: () => void };
          resolve: () => void;
        }
      | undefined;
    if (!waiter || waiter.settled) return false;
    waiter.timer?.clear();
    if (waiter.taskId) this.deleteTimer(waiter.taskId);
    const collectionTimer = createCollectionTimer(() => {
      if (this.#waiters.get(targetId) !== waiter) return;
      this.deleteWaiter(targetId);
      if (waiter.taskId) {
        this.deleteTask(waiter.taskId);
        this.deleteResponseCount(waiter.taskId);
        this.deleteTimer(waiter.taskId);
      }
      waiter.timer = undefined;
    });
    waiter.timer = collectionTimer;
    if (waiter.taskId) this.setTimer(waiter.taskId, collectionTimer);
    waiter.resolve();
    return true;
  }

  /** Clears registry-owned state after all externally owned timers are stopped. */
  clear(): void {
    this.close(new Error('discovery registry closed'));
  }

  /** Settles every outbound waiter and releases all registry-owned timers/listeners. */
  close(reason: unknown): void {
    let cleanupError: unknown;
    for (const [targetId, rawWaiter] of Array.from(this.#waiters.entries())) {
      const waiter = rawWaiter as {
        readonly taskId?: string;
        readonly timer?: { readonly clear: () => void };
        readonly reject?: (error: unknown) => void;
      };
      const trackedTimer = waiter.taskId ? this.#timers.get(waiter.taskId) : undefined;
      if (!trackedTimer) waiter.timer?.clear();
      if (waiter.taskId) {
        this.#tasks.delete(waiter.taskId);
        this.#responseCounts.delete(waiter.taskId);
      }
      this.#waiters.delete(targetId);
      waiter.reject?.(reason);
    }
    for (const key of Array.from(this.#manualQueryWaiters.keys())) {
      try {
        this.rejectManualWaiter(key, reason);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    for (const timer of this.#timers.values()) timer.clear();
    for (const timer of this.#manualInboundQueryTimers.values()) timer.clear();
    this.#localTargets.clear();
    this.#remoteTargets.clear();
    for (const key of this.#remoteBindings.keys()) this.#releaseRemoteBinding(key);
    this.#pinnedReceivers.clear();
    this.#lostPinnedReceivers.clear();
    this.#waiters.clear();
    this.#tasks.clear();
    this.#timers.clear();
    this.#responseCounts.clear();
    this.#automaticAdmissions.clear();
    this.#manualQueryWaiters.clear();
    this.#manualInboundQueries.clear();
    this.#manualInboundQueryTimers.clear();
    this.#manualRevokedCandidates.clear();
    if (cleanupError !== undefined) throw cleanupError;
  }

  /** Releases the identity lease associated with one remote snapshot. */
  #releaseRemoteBinding(key: string): void {
    const token = this.#remoteBindings.get(key);
    if (token === undefined) return;
    this.#remoteBindings.delete(key);
    this.#releaseBinding?.(token);
  }
}
import type { IAbortSignal } from './async-control';
