import { createRuntime, type IDisposable, type IDisposer, type IRuntime } from '@migaia/reactive';
import { claimOwnership, ownerOf } from '@migaia/reactive/runtime/ownership';
import {
  TerminalControllerImpl,
  type LifecycleState
} from '@migaia/reactive/runtime/lifecycle-primitives';
import { createAtomStore, type IAtomStore } from '@migaia/store-keyed/atom/store';

const STORE_TOKEN_VALUE = Symbol('store-token-value');

/**
 * React gives no public hook for "this render/component instance was discarded before it committed"
 * — no callback fires for an effect that never ran. `prepareForRender()`'s timer is the only signal
 * available, and it is inherently a heuristic: too short risks disposing a candidate a legitimately
 * slow (not abandoned) render still needs; too long delays reclaiming a genuinely abandoned one.
 * This is the bound for the case that matters most — `armInitial` (a readiness barrier promise)
 * that never settles must not turn into a permanent leak just because the "check sooner once the
 * barrier resolves" path then never fires either.
 */
const ABANDONED_RENDER_FALLBACK_MS = 4000;

export type StoreToken<T> = Readonly<{
  key: symbol;
  debugName: string;
  readonly [STORE_TOKEN_VALUE]?: (value: T) => T;
}>;

export type IStoreRegistrationOptions = {
  readonly owned?: boolean;
};

type IRegistryEntry = {
  readonly value: unknown;
  readonly owned: boolean;
};

export function createStoreToken<T>(debugName: string): StoreToken<T> {
  if (debugName.length === 0) {
    throw new Error('[store] StoreToken requires a debug name');
  }
  return Object.freeze({
    key: Symbol(debugName),
    debugName
  });
}

/** Runtime-bound registry shared by React Provider and SSR request scopes. */
export class StoreRegistry implements IDisposable {
  readonly runtime: IRuntime;
  /** Provider-local atom state/override boundary. Same Runtime may host many registries. */
  readonly atomStore: IAtomStore;
  #entries = new Map<symbol, IRegistryEntry>();
  #disposed = false;
  #retainCount = 0;
  #lifecycleGeneration = 0;
  #renderCommitted = false;
  #terminal = new TerminalControllerImpl();
  // Disposers invoked from the synchronous dispose() path whose return value
  // turned out to be a thenable. dispose() can't await them (it's sync),
  // but a later disposeAsync() call must — and a rejection must never
  // become an unhandled rejection just because nothing was watching yet.
  #pendingSyncDisposals = new Set<Promise<void>>();
  #disposingAsync: Promise<void> | undefined;

  constructor(runtime: IRuntime = createRuntime()) {
    this.runtime = runtime;
    this.atomStore = createAtomStore(runtime);
    claimOwnership(this, runtime);
  }

  /** Part of the project's unified AsyncLifecycle shape (see lifecycle-primitives.ts). */
  get lifecycle(): LifecycleState {
    return this.#terminal.lifecycle;
  }

  /**
   * Resolves once this registry (and any thenable disposer results) has actually finished tearing
   * down.
   */
  whenTerminal(): Promise<void> {
    return this.#terminal.whenTerminal();
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  register<T>(token: StoreToken<T>, value: T, options: IStoreRegistrationOptions = {}): IDisposer {
    this.#assertActive();
    this.#assertRuntime(token, value);
    if (this.#entries.has(token.key)) {
      throw new Error(`[store] duplicate provider store token: ${token.debugName}`);
    }
    const entry: IRegistryEntry = {
      value,
      owned: options.owned ?? false
    };
    this.#entries.set(token.key, entry);
    return () => {
      if (this.#entries.get(token.key) === entry) {
        this.#entries.delete(token.key);
        if (entry.owned) this.#disposeValueObserved(entry.value);
      }
    };
  }

  replace<T>(token: StoreToken<T>, value: T, options: IStoreRegistrationOptions = {}): void {
    this.#assertActive();
    this.#assertRuntime(token, value);
    const previous = this.#entries.get(token.key);
    this.#entries.set(token.key, {
      value,
      owned: options.owned ?? false
    });
    if (previous?.owned && previous.value !== value) {
      this.#disposeValueObserved(previous.value);
    }
  }

  get<T>(token: StoreToken<T>): T | undefined {
    this.#assertActive();
    return this.#entries.get(token.key)?.value as T | undefined;
  }

  require<T>(token: StoreToken<T>): T {
    this.#assertActive();
    const entry = this.#entries.get(token.key);
    if (!entry) {
      throw new Error(`[store] missing provider store: ${token.debugName}`);
    }
    return entry.value as T;
  }

  has<T>(token: StoreToken<T>): boolean {
    this.#assertActive();
    return this.#entries.has(token.key);
  }

  remove<T>(token: StoreToken<T>, disposeOwned = true): boolean {
    this.#assertActive();
    const entry = this.#entries.get(token.key);
    if (!entry) return false;
    this.#entries.delete(token.key);
    if (disposeOwned && entry.owned) this.#disposeValueObserved(entry.value);
    return true;
  }

  /**
   * React StrictMode probes effect cleanup/setup. Delayed release avoids disposing an
   * internally-owned registry between those two phases.
   */
  retain(disposeOnRelease: boolean, deferTask = false): IDisposer {
    this.#assertActive();
    this.#renderCommitted = true;
    this.#retainCount++;
    this.#lifecycleGeneration++;
    let retained = true;
    return () => {
      if (!retained) return;
      retained = false;
      this.#retainCount--;
      const generation = ++this.#lifecycleGeneration;
      if (!disposeOnRelease || this.#retainCount !== 0) return;
      // React StrictMode may replay passive effects across a microtask
      // boundary. Defer disposal to a task so the replacement setup can
      // retain the registry before the zero-owner check runs.
      const dispose = () => {
        if (
          !this.#disposed &&
          this.#retainCount === 0 &&
          this.#lifecycleGeneration === generation
        ) {
          try {
            this.dispose();
          } catch (error) {
            this.runtime.reportError(error, {
              phase: 'lifecycle-hook'
            });
          }
        }
      };
      if (deferTask) setTimeout(dispose, 0);
      else queueMicrotask(dispose);
    };
  }

  /**
   * Arm an internally-created registry for a concurrent render. If React abandons that render
   * before RegistryBoundary commits, reclaim the candidate instead of leaking a detached
   * runtime/atom graph forever.
   *
   * This is memory cleanup, not an ownership decision: `check()` only ever disposes a registry with
   * `#retainCount === 0` — one that `retain()` (which only ever runs from `RegistryBoundary`'s
   * `useEffect`, i.e. only after React actually committed) has never touched. Nothing holds this
   * registry for correctness purposes until `retain()` runs; until then it's exactly as reclaimable
   * as any other unused render-phase value. Once `retain()` does run, this check is permanently a
   * no-op for that registry — there is no path where a retained, in-use registry gets disposed out
   * from under its owner. So while the timing below is a heuristic (React gives no "this render was
   * discarded" hook to react to instead), getting the timing "wrong" only ever costs memory, never
   * correctness — a mistimed check can leave garbage a little longer or reclaim a candidate that
   * would've been retained moments later, but never disposes something still in use.
   *
   * No `after` (no readiness barrier to wait on): a single short timer is the only check needed —
   * there is nothing else worth waiting for first.
   *
   * With `after`: a short check is armed once `after` settles (the common case — a resolved
   * readiness barrier is itself decent evidence the render is progressing normally, so checking
   * again soon after is a reasonable bet), but that is only ever scheduled _after_ the barrier
   * settles. A barrier that hangs forever must not silently disable cleanup entirely, so a
   * generous, bounded fallback (`ABANDONED_RENDER_FALLBACK_MS`) is always armed too, independent of
   * whether `after` ever settles — that's the bound this module actually guarantees; the short
   * check is purely an optimization on top of it.
   */
  prepareForRender(after?: Promise<void>): void {
    if (this.#disposed || this.#renderCommitted) return;
    const check = () => {
      if (!this.#disposed && !this.#renderCommitted && this.#retainCount === 0) {
        try {
          this.dispose();
        } catch (error) {
          this.runtime.reportError(error, { phase: 'lifecycle-hook' });
        }
      }
    };
    if (!after) {
      setTimeout(check, 0);
      return;
    }
    const fallback = setTimeout(check, ABANDONED_RENDER_FALLBACK_MS);
    const armFastPath = () => {
      clearTimeout(fallback);
      setTimeout(check, 16);
    };
    void after.then(armFastPath, armFastPath);
  }

  /**
   * Idempotent, immediately enters `closing`. If an owned value's disposer returns a thenable, this
   * cannot block on it (it's sync) — the thenable is tracked and observed (never left as an
   * unhandled rejection) so a later `disposeAsync()` call still waits for it instead of resolving
   * early just because `dispose()` already ran (see `disposeAsync()`). `lifecycle` only reaches
   * `terminal` once every tracked thenable has actually settled.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#terminal.close();
    this.#lifecycleGeneration++;
    const entries = [...this.#entries.values()].reverse();
    this.#entries.clear();
    const errors: unknown[] = [];
    for (const entry of entries) {
      if (!entry.owned) continue;
      try {
        this.#disposeValueTracked(entry.value);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.atomStore.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (this.#pendingSyncDisposals.size === 0) this.#terminal.forceDispose();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, '[store] provider registry disposal failed');
    }
  }

  /**
   * Awaitable counterpart. Single-flight: concurrent calls share one completion instead of each
   * racing their own pass over `#entries`. Calling this after a prior synchronous `dispose()` does
   * not resolve early — it waits for whatever thenable disposer results that `dispose()` started
   * but could not block on (see `#pendingSyncDisposals`).
   */
  disposeAsync(): Promise<void> {
    if (this.#disposingAsync) return this.#disposingAsync;
    if (this.#terminal.lifecycle === 'terminal') return Promise.resolve();
    this.#disposingAsync = this.#performDisposeAsync();
    return this.#disposingAsync;
  }

  async #performDisposeAsync(): Promise<void> {
    if (!this.#disposed) {
      this.#disposed = true;
      this.#terminal.close();
      this.#lifecycleGeneration++;
      const entries = [...this.#entries.values()].reverse();
      this.#entries.clear();
      const errors: unknown[] = [];
      for (const entry of entries) {
        if (!entry.owned) continue;
        try {
          const result = disposeValue(entry.value);
          const thenable = asPromiseLike(result);
          if (thenable) await thenable;
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        this.atomStore.dispose();
      } catch (error) {
        errors.push(error);
      }
      this.#terminal.forceDispose();
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, '[store] provider registry disposal failed');
      }
      return;
    }
    // dispose() already ran synchronously; wait for whatever it left in
    // flight rather than treating "already disposed" as "already settled".
    if (this.#pendingSyncDisposals.size) {
      await Promise.all(
        [...this.#pendingSyncDisposals].map((pending) => pending.catch(() => undefined))
      );
    }
    await this.#terminal.whenTerminal();
  }

  /**
   * Sync dispose() path: call a value's disposer, and track+observe a thenable result without
   * blocking on it.
   */
  #disposeValueTracked(value: unknown): void {
    const result = disposeValue(value);
    const thenable = asPromiseLike(result);
    if (!thenable) return;
    const tracked: Promise<void> = thenable.then(
      () => undefined,
      (error: unknown) => {
        this.runtime.reportError(error, { phase: 'lifecycle-hook' });
      }
    );
    this.#pendingSyncDisposals.add(tracked);
    void tracked.finally(() => {
      this.#pendingSyncDisposals.delete(tracked);
      if (this.#disposed && this.#pendingSyncDisposals.size === 0) {
        this.#terminal.forceDispose();
      }
    });
  }

  /**
   * Per-entry disposal outside the whole-registry dispose()/disposeAsync() flow (register()'s
   * returned disposer, replace(), remove()). Not tracked for disposeAsync() to wait on — these are
   * independent, ad-hoc operations — but a rejection still must not become unhandled.
   */
  #disposeValueObserved(value: unknown): void {
    const result = disposeValue(value);
    const thenable = asPromiseLike(result);
    if (!thenable) return;
    void thenable.catch((error: unknown) => {
      this.runtime.reportError(error, { phase: 'lifecycle-hook' });
    });
  }

  #assertRuntime<T>(token: StoreToken<T>, value: T): void {
    const runtime = readStoreRuntime(value);
    if (runtime && runtime !== this.runtime) {
      throw new Error(`[store] provider store "${token.debugName}" belongs to a different Runtime`);
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error('[store] provider registry is disposed');
    }
  }
}

export function createStoreRegistry(runtime: IRuntime = createRuntime()): StoreRegistry {
  return new StoreRegistry(runtime);
}

function readStoreRuntime(value: unknown): IRuntime | undefined {
  // 唯一所有权协议。字段名既可伪造也会漏掉新节点类型，不能再作为边界。
  return ownerOf(value);
}

function disposeValue(value: unknown): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
    return undefined;
  const candidate = value as {
    $dispose?: unknown;
    dispose?: unknown;
  };
  const disposer =
    typeof candidate.$dispose === 'function'
      ? candidate.$dispose
      : typeof candidate.dispose === 'function'
        ? candidate.dispose
        : undefined;
  return disposer ? disposer.call(value) : undefined;
}

function asPromiseLike(value: unknown): Promise<unknown> | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }
  const then = (value as { then?: unknown }).then;
  if (typeof then !== 'function') return undefined;
  return new Promise((resolve, reject) => {
    Reflect.apply(then, value, [resolve, reject]);
  });
}
