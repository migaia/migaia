import type { IDisposable } from './types';

export type GenerationToken = object;
export type VersionToken = object;
export type Release = () => void;

export type LifecycleState = 'open' | 'closing' | 'terminal';

export interface TerminalController {
  readonly lifecycle: LifecycleState;
  close(): void;
  forceDispose(): void;
  whenTerminal(): Promise<void>;
}

export interface RequestController {
  readonly current: GenerationToken | undefined;
  begin(): { token: GenerationToken; signal: AbortSignal };
  isCurrent(token: GenerationToken): boolean;
  supersede(reason?: unknown): void;
  dispose(reason?: unknown): void;
}

export interface LeaseRegistry<Key extends object> {
  retain(key: Key): Release;
  count(key: Key): number;
  hasAny(): boolean;
}

export interface LifecycleScope {
  own<T extends IDisposable>(value: T): T;
  release(value: IDisposable): boolean;
  close(): void;
  dispose(): void;
  disposeAsync(): Promise<void>;
}

type AsyncDisposable = IDisposable & {
  disposeAsync?: () => void | PromiseLike<void>;
};

export class RequestControllerImpl implements RequestController {
  #current: GenerationToken | undefined;
  #controller: AbortController | undefined;
  #disposed = false;

  get current(): GenerationToken | undefined {
    return this.#current;
  }

  begin(): { token: GenerationToken; signal: AbortSignal } {
    if (this.#disposed) throw new Error('[store] request controller is disposed');
    this.#controller?.abort();
    const token = {};
    const controller = new AbortController();
    this.#current = token;
    this.#controller = controller;
    return { token, signal: controller.signal };
  }

  isCurrent(token: GenerationToken): boolean {
    return !this.#disposed && this.#current === token;
  }

  supersede(reason?: unknown): void {
    if (this.#disposed) return;
    this.#controller?.abort(reason);
    this.#controller = undefined;
    this.#current = undefined;
  }

  dispose(reason?: unknown): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#controller?.abort(reason);
    this.#controller = undefined;
    this.#current = undefined;
  }
}

export class ObjectLeaseRegistry<Key extends object> implements LeaseRegistry<Key> {
  #counts = new Map<Key, number>();

  retain(key: Key): Release {
    const next = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, next);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const remaining = (this.#counts.get(key) ?? 1) - 1;
      if (remaining <= 0) this.#counts.delete(key);
      else this.#counts.set(key, remaining);
    };
  }

  count(key: Key): number {
    return this.#counts.get(key) ?? 0;
  }

  hasAny(): boolean {
    return this.#counts.size > 0;
  }

  clear(): void {
    this.#counts.clear();
  }
}

export class TerminalControllerImpl implements TerminalController {
  #lifecycle: LifecycleState = 'open';
  #resolveTerminal!: () => void;
  #terminal = new Promise<void>((resolve) => {
    this.#resolveTerminal = resolve;
  });

  get lifecycle(): LifecycleState {
    return this.#lifecycle;
  }

  close(): void {
    if (this.#lifecycle === 'open') this.#lifecycle = 'closing';
  }

  forceDispose(): void {
    if (this.#lifecycle === 'terminal') return;
    this.#lifecycle = 'terminal';
    this.#resolveTerminal();
  }

  whenTerminal(): Promise<void> {
    return this.#terminal;
  }
}

export class LifecycleScopeImpl implements LifecycleScope {
  #values = new Set<AsyncDisposable>();
  #terminal = new TerminalControllerImpl();
  /**
   * Single-flight guard. Set synchronously — before any `await` — by whichever of
   * `dispose()`/`disposeAsync()` runs first, so a second call made on the very same synchronous
   * tick (before the first has any chance to mutate `#values`) can never win a race to iterate and
   * dispose the same snapshot twice. Reused across calls to `disposeAsync()`: they all observe and
   * return the one real disposal in flight instead of starting their own.
   */
  #disposing: Promise<void> | undefined;
  /**
   * Sync-path counterpart of `#disposing`. The async guard only protects against a _second_ sync
   * `dispose()` call — it never set this flag, so a child's `dispose()` reentrantly calling back
   * into this same scope's `dispose()` (parent still `closing`, not yet `terminal`) sailed straight
   * through both guards and re-iterated `#values` mid-teardown, double- disposing whatever had
   * already been visited. Both entry points now check both flags, so either path reentering either
   * method is caught.
   */
  #disposingSync = false;

  get lifecycle(): LifecycleState {
    return this.#terminal.lifecycle;
  }

  own<T extends IDisposable>(value: T): T {
    if (this.#terminal.lifecycle !== 'open')
      throw new Error('[store] cannot add resource to a disposed scope');
    this.#values.add(value);
    return value;
  }

  release(value: IDisposable): boolean {
    return this.#values.delete(value);
  }

  close(): void {
    this.#terminal.close();
  }

  /**
   * Synchronous, complete-by-return-time disposal. Cannot be honored while an async disposal is in
   * flight — this method cannot block on that Promise — so it throws instead of silently doing
   * nothing or double-disposing the same resources `disposeAsync()` is already tearing down. Once
   * that async disposal has actually finished (lifecycle reaches `terminal`), later calls are the
   * ordinary idempotent no-op.
   */
  dispose(): void {
    if (this.#disposing) {
      if (this.#terminal.lifecycle !== 'terminal') {
        throw new Error(
          '[store] cannot call dispose() while disposeAsync() is in flight on the same scope; await it instead'
        );
      }
      return;
    }
    if (this.#terminal.lifecycle === 'terminal') return;
    if (this.#disposingSync) {
      // A disposer we're currently calling reentered dispose() on this same
      // scope. Throwing here (instead of re-iterating #values) means the
      // caught error lands on whichever value's dispose() caused the
      // reentrancy, via the try/catch below — the rest of the teardown
      // still proceeds normally, exactly once.
      throw new Error(
        '[store] cannot call dispose() re-entrantly on the same scope; a disposer must not call back into the scope it is being disposed from'
      );
    }
    this.#disposingSync = true;
    this.#terminal.close();
    const errors: unknown[] = [];
    for (const value of [...this.#values].reverse()) {
      try {
        value.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#values.clear();
    this.#terminal.forceDispose();
    throwCollected(errors, '[store] lifecycle scope disposal failed');
  }

  disposeAsync(): Promise<void> {
    if (this.#disposing) return this.#disposing;
    if (this.#terminal.lifecycle === 'terminal') return Promise.resolve();
    if (this.#disposingSync) {
      throw new Error(
        '[store] cannot call disposeAsync() while a synchronous dispose() is in flight on the same scope'
      );
    }
    this.#terminal.close();
    this.#disposing = this.#performDisposeAsync();
    return this.#disposing;
  }

  async #performDisposeAsync(): Promise<void> {
    const errors: unknown[] = [];
    for (const value of [...this.#values].reverse()) {
      try {
        if (typeof value.disposeAsync === 'function') await value.disposeAsync();
        else await value.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#values.clear();
    this.#terminal.forceDispose();
    throwCollected(errors, '[store] lifecycle scope disposal failed');
  }
}

function throwCollected(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
