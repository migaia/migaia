import { createLifecycleError } from './errors.js';
import { LifecycleErrorCode } from './error-code.js';
import type { IDisposer } from './types.js';

export type IQuiescenceTracker<TKey> = {
  retain(key: TKey): IDisposer;
  count(key: TKey): number;
  /** Strict, exclusive drain: throws synchronously (not a rejected Promise) unless `isSealed(key)`. */
  whenZero(key: TKey): Promise<void>;
  /** Non-exclusive: resolves the next time count reaches zero; does not block new `retain()` calls. */
  whenZeroOnce(key: TKey): Promise<void>;
  /** Blocks further `retain()` calls for `key`. Idempotent. */
  seal(key: TKey): void;
  isSealed(key: TKey): boolean;
  /** Removes a zero-count key and returns whether a state entry was removed. */
  forget(key: TKey): boolean;
};

type IKeyStore<TKey, TValue> = {
  get(key: TKey): TValue | undefined;
  set(key: TKey, value: TValue): void;
  delete(key: TKey): boolean;
};

type IKeyState = {
  count: number;
  sealed: boolean;
  strictWaiters: Array<() => void>;
  looseWaiters: Array<() => void>;
};

function createTrackerCore<TKey>(store: IKeyStore<TKey, IKeyState>): IQuiescenceTracker<TKey> {
  const getOrCreate = (key: TKey): IKeyState => {
    let state = store.get(key);
    if (!state) {
      state = { count: 0, sealed: false, strictWaiters: [], looseWaiters: [] };
      store.set(key, state);
    }
    return state;
  };

  const settle = (key: TKey, state: IKeyState): void => {
    if (state.count > 0) return;
    const strict = state.strictWaiters.splice(0);
    const loose = state.looseWaiters.splice(0);
    for (const resolve of strict) resolve();
    for (const resolve of loose) resolve();
    // A pristine, unsealed key carries no observable state — drop it so string-keyed usage (no
    // WeakMap GC available) doesn't leak forever. A sealed key's "sealed" fact must persist.
    if (!state.sealed) store.delete(key);
  };

  return {
    retain(key) {
      const existing = store.get(key);
      if (existing?.sealed) {
        throw createLifecycleError(
          LifecycleErrorCode.quiescenceSealed,
          '[lifecycle] cannot retain a sealed quiescence key'
        );
      }
      const state = getOrCreate(key);
      state.count++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        state.count--;
        settle(key, state);
      };
    },
    count(key) {
      return store.get(key)?.count ?? 0;
    },
    whenZero(key) {
      const existing = store.get(key);
      if (!existing?.sealed) {
        throw createLifecycleError(
          LifecycleErrorCode.quiescenceUnsealedWait,
          '[lifecycle] whenZero() requires seal() first — use whenZeroOnce() for a non-exclusive wait'
        );
      }
      if (existing.count === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        existing.strictWaiters.push(resolve);
      });
    },
    whenZeroOnce(key) {
      const state = getOrCreate(key);
      if (state.count === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        state.looseWaiters.push(resolve);
      });
    },
    seal(key) {
      const state = getOrCreate(key);
      state.sealed = true;
    },
    isSealed(key) {
      return store.get(key)?.sealed ?? false;
    },
    forget(key) {
      const state = store.get(key);
      if (
        !state ||
        state.count !== 0 ||
        state.strictWaiters.length !== 0 ||
        state.looseWaiters.length !== 0
      )
        return false;
      return store.delete(key);
    }
  };
}

/**
 * Object-keyed variant, `WeakMap`-backed so entries are collected once the key is unreachable
 * elsewhere.
 */
export function createQuiescenceTracker<TKey extends object>(): IQuiescenceTracker<TKey> {
  return createTrackerCore<TKey>(new WeakMap());
}

/**
 * String-keyed variant. `WeakMap` cannot take string keys, so pristine entries are pruned
 * explicitly.
 */
export function createStringQuiescenceTracker(): IQuiescenceTracker<string> {
  return createTrackerCore<string>(new Map());
}

/**
 * `LeaseRegistry` — the same engine as `QuiescenceTracker`, re-exported under the name lease call
 * sites reach for. §4.8 requires it to pass `whenZero()`/`whenZeroOnce()`/`seal()` straight through
 * rather than hiding them behind `count()` polling.
 */
export type ILeaseRegistry<TKey> = IQuiescenceTracker<TKey>;

export function createObjectLeaseRegistry<TKey extends object>(): ILeaseRegistry<TKey> {
  return createQuiescenceTracker<TKey>();
}

export function createStringLeaseRegistry(): ILeaseRegistry<string> {
  return createStringQuiescenceTracker();
}

/**
 * The narrow facade for in-flight operations: unlike `LeaseRegistry`, it never exposes lease
 * semantics (retain/seal) to domain callers — only `track()`/`drain()`/`size`.
 */
export type IPendingTracker = {
  /** Registers `promise` as in-flight; auto-releases on settle. Returns `promise` unchanged. */
  track<T>(promise: Promise<T>): Promise<T>;
  /**
   * Waits until nothing is in flight, looping via `whenZeroOnce()` so work started while draining
   * is never missed (L-T10).
   */
  drain(): Promise<void>;
  readonly size: number;
};

export function createPendingTracker(): IPendingTracker {
  const tracker = createStringQuiescenceTracker();
  const KEY = '@migaia/lifecycle/pending-tracker';
  return {
    track(promise) {
      const release = tracker.retain(KEY);
      const settle = (): void => {
        try {
          release();
        } catch {
          // `release()` is a plain counter decrement and never throws; guarded defensively so a
          // future change here cannot turn into an unhandled rejection on this derived chain.
        }
      };
      // `.then(settle, settle)` always resolves regardless of `promise`'s outcome, so this derived
      // chain never itself becomes an unhandled rejection; the original `promise` is returned
      // untouched for the caller to handle.
      void promise.then(settle, settle);
      return promise;
    },
    async drain() {
      while (tracker.count(KEY) > 0) {
        await tracker.whenZeroOnce(KEY);
      }
    },
    get size() {
      return tracker.count(KEY);
    }
  };
}
