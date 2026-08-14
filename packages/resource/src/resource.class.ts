import type { IDisposable, IObservable, IObserver, IRuntime } from '@migaia/reactive/runtime/types';
import type { Signal } from '@migaia/reactive/reactive/signal.class';
import { internalsOf } from '@migaia/reactive/runtime/internals';
import { internalRuntimeOf } from '@migaia/reactive/runtime/node-factories';
import { claimOwnership } from '@migaia/reactive/runtime/ownership';
import { registerDeps, registerDepVersions } from '@migaia/reactive/runtime/node-internals';
import { GenerationController } from '@migaia/reactive/runtime/generation-controller';
import type { GenerationToken } from '@migaia/reactive/runtime/lifecycle-primitives';
import { TerminalControllerImpl } from '@migaia/reactive/runtime/lifecycle-primitives';

export type IResourceState<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: T; refreshing?: boolean }
  | { status: 'error'; error: unknown }
  | { status: 'cancelled'; error: DOMException };

export type IResourceFetchStatus = 'idle' | 'fetching';

export type IResourceFetcher<T> = (ctx: { signal: AbortSignal }) => T | PromiseLike<T>;

export type IResourceCacheSnapshot<T> = {
  readonly version: 1;
  readonly data: T;
  readonly updatedAt: number;
  /** `null` represents an infinite lifetime in JSON-safe form. */
  readonly expiresAt: number | null;
};

export type IResourceRetryPolicy = number | ((failureCount: number, error: unknown) => boolean);

export type IResourceOptions<T = unknown> = {
  debugName?: string;
  /**
   * Successful values remain fresh for this many milliseconds. `Infinity` keeps them fresh until a
   * dependency changes or `refetch()` is called.
   */
  ttl?: number;
  /** Start the first request in the constructor. Defaults to true. */
  autoStart?: boolean;
  /** Keep stale success data visible while a background refresh runs. */
  staleWhileRevalidate?: boolean;
  /** Retry count or predicate. Suspense Promise throws do not count. */
  retry?: IResourceRetryPolicy;
  retryDelay?: number | ((failureCount: number, error: unknown) => number);
  /** Keep upstream reactive edges while no state consumer exists. */
  keepAlive?: boolean;
  /** SSR/persisted success cache used before optional revalidation. */
  initialSnapshot?: IResourceCacheSnapshot<T>;
};

function abortError(): DOMException {
  return new DOMException('[store] resource request aborted', 'AbortError');
}

class ResourceCancelledError extends DOMException {
  constructor() {
    super('[store] resource request cancelled', 'AbortError');
  }
}

function validateTtl(ttl: number): void {
  if (ttl < 0 || Number.isNaN(ttl)) {
    throw new RangeError('[store] resource ttl must be non-negative');
  }
}

function validateRetry(retry: IResourceRetryPolicy): void {
  if (typeof retry === 'number' && (!Number.isInteger(retry) || retry < 0)) {
    throw new RangeError('[store] resource retry count must be a non-negative integer');
  }
}

function asThenable(value: unknown): PromiseLike<unknown> | undefined {
  if ((value === null || typeof value !== 'object') && typeof value !== 'function') {
    return undefined;
  }
  try {
    return typeof (value as { then?: unknown }).then === 'function'
      ? (value as PromiseLike<unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cancellable async derivation.
 *
 * Reactive values read synchronously by the fetcher (including an async function's work before its
 * first await) become dependencies. A dependency change coalesces into one fresh request. Reads
 * after an await cannot be tracked by JavaScript's synchronous dependency context and should be
 * moved into a Computed read before awaiting.
 */
export class Resource<T> implements IObserver, IDisposable {
  #_deps = new Set<IObservable>();
  #_depVersions = new Map<IObservable, number>();
  readonly deps: ReadonlySet<IObservable>;
  readonly depVersions: ReadonlyMap<IObservable, number>;
  readonly runtime: IRuntime;
  debugName?: string;
  #stateSignal: Signal<IResourceState<T>>;
  #fetcher: IResourceFetcher<T>;
  #ttl: number;
  #staleWhileRevalidate: boolean;
  #retry: IResourceRetryPolicy;
  #retryDelay: number | ((failureCount: number, error: unknown) => number);
  #keepAlive: boolean;
  #requests = new GenerationController();
  #currentPromise: Promise<T> | undefined;
  #expiresAt = 0;
  #updatedAt = 0;
  #requestPending = false;
  #refreshScheduled = false;
  #forceRefresh = false;
  #suspensionGeneration = 0;
  #paused = false;
  #staleAfterSettlement = false;
  #terminal = new TerminalControllerImpl();

  constructor(fetcher: IResourceFetcher<T>, runtime: IRuntime, options: IResourceOptions<T> = {}) {
    this.deps = registerDeps(this, this.#_deps);
    this.depVersions = registerDepVersions(this, this.#_depVersions);
    const ttl = options.ttl ?? Infinity;
    const retry = options.retry ?? 0;
    validateTtl(ttl);
    validateRetry(retry);
    this.runtime = runtime;
    // 归属登记走唯一那张表，不再靠字段名让下游去猜
    claimOwnership(this, runtime);
    this.debugName = options.debugName;
    this.#fetcher = fetcher;
    this.#ttl = ttl;
    this.#retry = retry;
    this.#retryDelay = options.retryDelay ?? 0;
    this.#staleWhileRevalidate = options.staleWhileRevalidate ?? false;
    this.#keepAlive = options.keepAlive ?? false;
    this.#stateSignal = internalRuntimeOf(runtime).signal<IResourceState<T>>(
      { status: 'idle' },
      {
        debugName: options.debugName ? `${options.debugName}.state` : undefined
      }
    );
    this.#stateSignal.addObservedHooks({
      onObserved: () => {
        this.#suspensionGeneration++;
      },
      onUnobserved: () => {
        // Suspended renders have not committed a subscription yet. Aborting
        // here would reject the exact Promise React is waiting for.
        this.#scheduleSuspension();
      }
    });
    if (options.initialSnapshot) this.hydrate(options.initialSnapshot);
    if ((options.autoStart ?? true) && (!options.initialSnapshot || !this.#isFresh())) {
      this.#observe(this.#startRequest());
    }
  }

  /** Reactive state-machine snapshot. Expired success values revalidate. */
  get state(): IResourceState<T> {
    this.#assertUsable();
    this.#ensureFresh();
    return this.#stateSignal.value;
  }

  /**
   * Shared promise for the current request or fresh cached value. Multiple readers receive the same
   * promise; it starts work only when idle/stale.
   */
  get promise(): Promise<T> {
    this.#assertUsable();
    this.#ensureFresh();
    if (!this.#currentPromise) {
      throw new Error('[store] resource has no active or cached promise');
    }
    return this.#currentPromise;
  }

  get disposed(): boolean {
    return this.#terminal.lifecycle === 'terminal';
  }

  /** True while a fresh request runs without hiding an existing success value. */
  get refreshing(): boolean {
    if (this.#terminal.lifecycle !== 'open') return false;
    const state = this.#stateSignal.peek();
    return state.status === 'success' && state.refreshing === true;
  }

  /** Transport status, separate from the visible data/error state. */
  get fetchStatus(): IResourceFetchStatus {
    this.#assertUsable();
    return this.#requestPending ? 'fetching' : 'idle';
  }

  /** Whether the currently cached success value has crossed its TTL. */
  get isStale(): boolean {
    this.#assertUsable();
    const state = this.#stateSignal.peek();
    return state.status === 'success' && !this.#isFresh();
  }

  /** Whether reactive consumers currently observe this resource's state. */
  get observed(): boolean {
    return this.#stateSignal.subs.size > 0;
  }

  /**
   * Suspense-compatible read: returns cached data, throws the active Promise while pending, and
   * throws the fetch error after failure.
   */
  read(): T {
    this.#assertUsable();
    this.#ensureFresh();
    const state = this.#stateSignal.value;
    return this.#materialize(state);
  }

  /**
   * 非追踪读，形状与 `read()` 相同（success 返回值，pending throw Promise，error throw）。
   *
   * 与 `read()` 的差别只有两条：不建依赖边；不顺手 `ensureFresh()` 启动请求。 React getSnapshot /
   * 外部诊断需要「读当前快照但不加入别人的追踪窗口」。
   */
  peek(): T {
    this.#assertUsable();
    return this.#materialize(this.#stateSignal.peek());
  }

  /**
   * Force a new request. Explicit refetches do not reuse a fresh cache entry; passive
   * `promise`/`read()` consumers do.
   */
  refetch(): Promise<T> {
    this.#assertUsable();
    return this.#startRequest();
  }

  /** Mark cached data stale and immediately start a replacement request. */
  invalidate(): Promise<T> {
    this.#assertUsable();
    this.#expiresAt = 0;
    return this.#startRequest();
  }

  /** Cancel only the active generation; the Resource remains reusable. */
  cancel(): void {
    this.#assertUsable();
    this.#abortActiveRequest(true);
  }

  dehydrate(): IResourceCacheSnapshot<T> | undefined {
    this.#assertUsable();
    const state = this.#stateSignal.peek();
    if (state.status !== 'success') return undefined;
    return {
      version: 1,
      data: state.data,
      updatedAt: this.#updatedAt,
      expiresAt: this.#expiresAt === Infinity ? null : this.#expiresAt
    };
  }

  hydrate(snapshot: IResourceCacheSnapshot<T>): void {
    this.#assertUsable();
    if (
      snapshot.version !== 1 ||
      !Number.isFinite(snapshot.updatedAt) ||
      (snapshot.expiresAt !== null && !Number.isFinite(snapshot.expiresAt))
    ) {
      throw new Error('[store] invalid resource cache snapshot');
    }
    this.#requests.supersede();
    this.#requestPending = false;
    this.#paused = false;
    internalsOf(this.runtime).tracker.clearDependencies(this);
    this.#updatedAt = snapshot.updatedAt;
    this.#expiresAt = snapshot.expiresAt ?? Infinity;
    this.#stateSignal.value = {
      status: 'success',
      data: snapshot.data
    };
    this.#currentPromise = Promise.resolve(snapshot.data);
  }

  /** A reactive dependency changed. Coalesce diamond/batched invalidations. */
  markDirty(): void {
    this.#scheduleDependencyRefresh(false);
  }

  /** A dependency was disposed; force re-evaluation so failure is observable. */
  onDependencyDisconnected(): void {
    this.#scheduleDependencyRefresh(true);
  }

  dispose(): void {
    if (this.#terminal.lifecycle === 'terminal') return;
    this.#terminal.close();
    this.#requests.dispose();
    this.#refreshScheduled = false;
    this.#forceRefresh = false;
    this.#requestPending = false;
    internalsOf(this.runtime).tracker.clearDependencies(this);
    this.#stateSignal.dispose();
    this.#terminal.forceDispose();
  }

  #assertUsable(): void {
    if (this.#terminal.lifecycle !== 'open') {
      throw new Error('[store] cannot use a disposed resource');
    }
  }

  #materialize(state: IResourceState<T>): T {
    switch (state.status) {
      case 'success':
        return state.data;
      case 'error':
        throw state.error;
      case 'cancelled':
        throw state.error;
      case 'pending':
      case 'idle':
        if (!this.#currentPromise) {
          throw new Error('[store] resource has no active or cached promise');
        }
        throw this.#currentPromise;
    }
  }

  #isFresh(): boolean {
    const state = this.#stateSignal.peek();
    return state.status === 'success' && Date.now() < this.#expiresAt;
  }

  #ensureFresh(): void {
    if (this.#requestPending || this.#paused) return;
    const state = this.#stateSignal.peek();
    // error/cancelled are stable, inspectable states. Only explicit
    // refetch()/invalidate() retries them; passive reads must not loop.
    if (state.status === 'idle' || (state.status === 'success' && !this.#isFresh())) {
      this.#observe(this.#startRequest());
    }
  }

  #startRequest(): Promise<T> {
    this.#refreshScheduled = false;
    this.#forceRefresh = false;
    this.#paused = false;
    const requestToken = this.#requests.begin();
    const token = requestToken.token;
    const signal = requestToken.signal;
    this.#requestPending = true;
    this.#staleAfterSettlement = false;
    const current = this.#stateSignal.peek();
    if (this.#staleWhileRevalidate && current.status === 'success') {
      this.#stateSignal.value = { ...current, refreshing: true };
    } else {
      this.#stateSignal.value = { status: 'pending' };
    }

    const request = this.#withAbort(this.#executeFetcher({ signal }, 0), signal);
    this.#currentPromise = request;
    this.#observeSettlement(request, token);
    return request;
  }

  #executeFetcher(controller: { signal: AbortSignal }, failureCount: number): Promise<T> {
    if (controller.signal.aborted) return Promise.reject(abortError());
    let fetched: T | PromiseLike<T>;
    try {
      fetched = internalsOf(this.runtime).tracker.runTracked(this, () =>
        this.#fetcher({ signal: controller.signal })
      );
    } catch (error) {
      const suspended = asThenable(error);
      if (!suspended) {
        return this.#retryFailure(error, controller, failureCount);
      }
      return Promise.resolve(suspended).then(() => this.#executeFetcher(controller, failureCount));
    }
    return Promise.resolve(fetched).catch((error: unknown) =>
      this.#retryFailure(error, controller, failureCount)
    );
  }

  #retryFailure(
    error: unknown,
    controller: { signal: AbortSignal },
    failureCount: number
  ): Promise<T> {
    if (controller.signal.aborted) return Promise.reject(abortError());
    const nextFailureCount = failureCount + 1;
    let shouldRetry: boolean;
    try {
      shouldRetry =
        typeof this.#retry === 'number'
          ? nextFailureCount <= this.#retry
          : this.#retry(nextFailureCount, error);
    } catch (policyError) {
      return Promise.reject(policyError);
    }
    if (!shouldRetry) return Promise.reject(error);
    let delay: number;
    try {
      delay =
        typeof this.#retryDelay === 'number'
          ? this.#retryDelay
          : this.#retryDelay(nextFailureCount, error);
    } catch (policyError) {
      return Promise.reject(policyError);
    }
    if (!Number.isFinite(delay) || delay < 0) {
      return Promise.reject(
        new RangeError('[store] resource retry delay must be a non-negative finite number')
      );
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        controller.signal.removeEventListener('abort', onAbort);
        resolve();
      }, delay);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    }).then(() => this.#executeFetcher(controller, nextFailureCount));
  }

  #withAbort(source: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const abort = () => reject(abortError());
      signal.addEventListener('abort', abort, { once: true });
      source.then(
        (value) => {
          signal.removeEventListener('abort', abort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        }
      );
    });
  }

  #observeSettlement(request: Promise<T>, token: GenerationToken): void {
    void request
      .then(
        (data) => {
          if (!this.#requests.isCurrentToken(token) || this.#terminal.lifecycle !== 'open') return;
          this.#updatedAt = Date.now();
          this.#expiresAt = this.#ttl === Infinity ? Infinity : this.#updatedAt + this.#ttl;
          if (this.#staleAfterSettlement) {
            this.#expiresAt = 0;
            this.#staleAfterSettlement = false;
          }
          try {
            this.#stateSignal.value = { status: 'success', data };
          } finally {
            this.#requestPending = false;
          }
          // autoStart 后从未被观察 → 主动休眠，防止上游边永驻
          if (this.#stateSignal.subs.size === 0) {
            this.#scheduleSuspension();
          }
        },
        (error: unknown) => {
          if (!this.#requests.isCurrentToken(token) || this.#terminal.lifecycle !== 'open') return;
          this.#staleAfterSettlement = false;
          try {
            this.#stateSignal.value = { status: 'error', error };
          } finally {
            this.#requestPending = false;
          }
          // autoStart 后从未被观察 → 主动休眠
          if (this.#stateSignal.subs.size === 0) {
            this.#scheduleSuspension();
          }
        }
      )
      .catch((error: unknown) => {
        this.runtime.reportError(error, { phase: 'async-flush' });
      });
  }

  /** Attach a rejection handler without replacing the public Promise. */
  #observe(request: Promise<T>): void {
    void request.catch(() => undefined);
  }

  /**
   * Explicit cancellation pauses passive reads until refetch. Suspension aborts the same transport
   * work without pausing, so a later observer can restart the derivation.
   */
  #abortActiveRequest(pause: boolean): void {
    if (!this.#requestPending) return;
    this.#requests.supersede();
    this.#requestPending = false;
    this.#paused = pause;
    if (this.#stateSignal.peek().status === 'pending') {
      this.#stateSignal.value = pause
        ? { status: 'cancelled', error: new ResourceCancelledError() }
        : { status: 'idle' };
    }
  }

  #scheduleDependencyRefresh(force: boolean): void {
    if (this.#terminal.lifecycle !== 'open') return;
    this.#forceRefresh ||= force;
    if (this.#refreshScheduled) return;
    this.#refreshScheduled = true;
    // 与 Computed 挂起同一条 idle 通道：Resource 不得私自 queueMicrotask，
    // 否则 setSchedulerStrategy / scheduleIdle 对异步失效无效。
    internalsOf(this.runtime).deferIdle(() => {
      if (!this.#refreshScheduled || this.#terminal.lifecycle !== 'open') return;
      this.#refreshScheduled = false;
      const mustRefresh = this.#forceRefresh;
      this.#forceRefresh = false;
      try {
        if (!mustRefresh && !internalsOf(this.runtime).tracker.hasStaleDependencies(this)) {
          return;
        }
        this.#observe(this.#startRequest());
      } catch (error) {
        this.#requestPending = false;
        this.#expiresAt = 0;
        this.#stateSignal.value = { status: 'error', error };
      }
    });
  }

  #scheduleSuspension(): void {
    if (this.#keepAlive || this.#terminal.lifecycle !== 'open') return;
    const generation = ++this.#suspensionGeneration;
    internalsOf(this.runtime).deferIdle(() => {
      if (
        this.#terminal.lifecycle !== 'open' ||
        this.#keepAlive ||
        this.#stateSignal.subs.size > 0 ||
        generation !== this.#suspensionGeneration
      ) {
        return;
      }
      const hadDependencies = this.deps.size > 0;
      internalsOf(this.runtime).tracker.clearDependencies(this);
      if (hadDependencies) {
        if (this.#stateSignal.peek().status === 'success') this.#expiresAt = 0;
        else if (this.#requestPending) this.#staleAfterSettlement = true;
      }
    });
  }
}
