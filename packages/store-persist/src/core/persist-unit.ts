import type { IDisposer } from '@migaia/reactive';
import { readEnvelope, removeEnvelope, writeEnvelope } from '../storage/codec.js';
import { defaultJsonCodec } from '../storage/codec.js';
import { assertEnvelope, type IEnvelope } from './envelope.js';
import {
  createStorePersistAbortError,
  createStorePersistAggregateError,
  createStorePersistError,
  createStorePersistTypeError
} from '../errors.js';
import { StorePersistErrorCode } from '../error-code.js';
import type {
  IHydrationStatus,
  IPersistHandle,
  IPersistStatus,
  IPersistUnit,
  IPersistUnitOptions,
  IWriteStatus
} from './types.js';
import { PersistState } from '../state-constants.js';
import { StorePersistErrorText } from '../error-text.js';
import { assertPersistString } from './options.js';

/** Maximum single delay accepted by Web/Node timers. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function disposedError(cause?: unknown): Error {
  return createStorePersistAbortError(
    StorePersistErrorCode.abortedByDispose,
    StorePersistErrorText.aborted,
    cause
  );
}

/** Reconciles plain-object hydration using startup snapshot as the local-write baseline. */
function mergePersistedPlainState<TState>(
  persisted: Partial<TState>,
  current: TState,
  start: TState
): TState {
  /** Accepts ordinary dictionaries regardless of whether they inherit from `Object.prototype`. */
  const isPlainPrototype = (value: object): boolean => {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };
  if (
    persisted === null ||
    typeof persisted !== 'object' ||
    current === null ||
    typeof current !== 'object' ||
    start === null ||
    typeof start !== 'object' ||
    Array.isArray(persisted) ||
    Array.isArray(current) ||
    Array.isArray(start) ||
    !isPlainPrototype(persisted) ||
    !isPlainPrototype(current) ||
    !isPlainPrototype(start)
  )
    return persisted as TState;

  const result: Record<string, unknown> = { ...(current as object) };
  for (const key of Object.keys(persisted as object)) {
    const locallyChanged = !Object.is(
      (current as Record<string, unknown>)[key],
      (start as Record<string, unknown>)[key]
    );
    if (!locallyChanged) result[key] = (persisted as Record<string, unknown>)[key];
  }
  return result as TState;
}

/**
 * 持久化核心引擎：给任意满足 `IPersistUnit<TState>` 的东西接上 hydrate（读 storage → 写回 unit） 与防抖写回（unit 变化 → 写
 * storage）。`persist()`/`persistCollection()`/`persistKeyed()` 内部 各自把自己的原生 API 适配成
 * `IPersistUnit`，然后调这一个函数——debounce、dispose、hydrate 竞态 只在这里实现一遍。
 */
export function persistUnit<TState>(
  unit: IPersistUnit<TState>,
  options: IPersistUnitOptions<TState>
): IPersistHandle {
  let extracted: {
    key: string;
    runtime: IPersistUnitOptions<TState>['runtime'];
    storage: IPersistUnitOptions<TState>['storage'];
    codec: IPersistUnitOptions<TState>['codec'];
    version: IPersistUnitOptions<TState>['version'];
    migrate: IPersistUnitOptions<TState>['migrate'];
    partialize: IPersistUnitOptions<TState>['partialize'];
    merge: IPersistUnitOptions<TState>['merge'];
    debounceMs: IPersistUnitOptions<TState>['debounceMs'];
  };
  try {
    extracted = {
      key: options.key,
      runtime: options.runtime,
      storage: options.storage,
      codec: options.codec,
      version: options.version,
      migrate: options.migrate,
      partialize: options.partialize,
      merge: options.merge,
      debounceMs: options.debounceMs
    };
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.optionsObject,
      { cause: error }
    );
  }
  const {
    key,
    runtime,
    storage,
    codec = defaultJsonCodec,
    version = 0,
    migrate,
    partialize = (state: TState) => state as Partial<TState>,
    // Plain-object snapshots use a shallow current-first merge so a startup
    // mutation is not lost while storage is loading. Collection/array shapes
    // remain replacement-based; callers can provide a shape-specific merge.
    merge = (persisted: Partial<TState>, current: TState) => {
      if (
        persisted !== null &&
        typeof persisted === 'object' &&
        current !== null &&
        typeof current === 'object' &&
        !Array.isArray(persisted) &&
        !Array.isArray(current) &&
        (Object.getPrototypeOf(persisted) === Object.prototype ||
          Object.getPrototypeOf(persisted) === null) &&
        (Object.getPrototypeOf(current) === Object.prototype ||
          Object.getPrototypeOf(current) === null)
      )
        return { ...(current as object), ...(persisted as object) } as TState;
      return persisted as TState;
    },
    debounceMs = 0
  } = extracted;

  assertPersistString(key, 'key');
  if (!codec)
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecNotResolved,
      StorePersistErrorText.noCodec(key)
    );
  let codecShapeValid = false;
  try {
    codecShapeValid =
      typeof codec === 'object' &&
      typeof codec.encode === 'function' &&
      typeof codec.decode === 'function';
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.codecInvalid(key),
      { cause: error }
    );
  }
  if (!codecShapeValid) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.codecInvalid(key)
    );
  }
  try {
    if (
      storage === null ||
      typeof storage !== 'object' ||
      typeof storage.get !== 'function' ||
      typeof storage.set !== 'function' ||
      typeof storage.remove !== 'function' ||
      typeof storage.keys !== 'function' ||
      storage.capabilities === null ||
      typeof storage.capabilities !== 'object'
    ) {
      throw new Error(StorePersistErrorText.storageInvalid(key));
    }
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.storageInvalid(key),
      { cause: error }
    );
  }
  for (const [name, callback] of [
    ['migrate', migrate],
    ['partialize', partialize],
    ['merge', merge]
  ] as const) {
    if (callback !== undefined && typeof callback !== 'function') {
      throw createStorePersistTypeError(
        StorePersistErrorCode.invalidOption,
        StorePersistErrorText.callback(key, name)
      );
    }
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.invalidVersion(key)
    );
  }
  if (!Number.isFinite(debounceMs) || debounceMs < 0 || debounceMs > MAX_TIMER_DELAY_MS) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.debounce(key)
    );
  }

  const hydrationStatus = runtime.signal<IHydrationStatus>(PersistState.loading);
  const hydrationError = runtime.signal<unknown>(undefined);
  const writeStatus = runtime.signal<IWriteStatus>(PersistState.idle);
  const writeError = runtime.signal<unknown>(undefined);
  const lifecycleStatus = runtime.signal<typeof PersistState.active | typeof PersistState.disposed>(
    PersistState.active
  );
  const status = runtime.computed<IPersistStatus>(() => {
    if (lifecycleStatus.value === PersistState.disposed) return PersistState.disposed;
    if (hydrationStatus.value === PersistState.loading) return PersistState.loading;
    if (hydrationStatus.value === PersistState.error || writeStatus.value === PersistState.error)
      return PersistState.error;
    return PersistState.ready;
  });
  const error = runtime.computed<unknown>(() => {
    const hydration = hydrationError.value;
    const write = writeError.value;
    if (hydration !== undefined && write !== undefined) {
      return createStorePersistAggregateError(
        StorePersistErrorCode.hydrateAndWriteFailed,
        [hydration, write],
        StorePersistErrorText.hydrationWriteFailed
      );
    }
    return hydration ?? write ?? undefined;
  });
  const hydrated = runtime.computed(() => hydrationStatus.value === PersistState.success);

  let stopSubscription: IDisposer | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let generationEpoch = 0;
  const activeOperations = new Set<AbortController>();
  let hydrationSettled = false;
  let hydrating = false;
  let dirtyDuringHydrate = false;
  const hydrationStartSnapshot = unit.snapshot();
  // 串行写队列：所有写入排成一条链，避免异步存储下"慢的旧写入后完成、覆盖新写入"的乱序问题。
  let writeChain: Promise<void> = Promise.resolve();
  let writeDrain: Promise<void> | undefined;
  let writeRequested = false;

  function assertActive(): void {
    if (disposed) throw disposedError();
  }

  async function runAdapterOperation<T>(
    operation: (signal: AbortSignal) => T | Promise<T>
  ): Promise<T> {
    assertActive();
    const controller = new AbortController();
    activeOperations.add(controller);
    try {
      const result = await operation(controller.signal);
      assertActive();
      return result;
    } catch (caught) {
      if (disposed) throw disposedError(caught);
      throw caught;
    } finally {
      activeOperations.delete(controller);
    }
  }

  async function runWriteOperation(operation: () => void | Promise<void>): Promise<void> {
    const operationGeneration = generationEpoch;
    writeStatus.value = PersistState.writing;
    try {
      await operation();
      if (disposed || operationGeneration !== generationEpoch) return;
      writeStatus.value = PersistState.idle;
      writeError.value = undefined;
    } catch (operationError) {
      if (disposed || operationGeneration !== generationEpoch) throw operationError;
      writeStatus.value = PersistState.error;
      writeError.value = operationError;
      throw operationError;
    }
  }

  function enqueueWrite(rejectOnError = false): Promise<void> {
    writeRequested = true;
    // A strict flush must observe the currently running debounced write itself;
    // chaining after writeChain would only see its error-swallowing recovery promise.
    if (writeDrain) return writeDrain;

    const operation = writeChain.then(async () => {
      while (!disposed && writeRequested) {
        writeRequested = false;
        await runWriteOperation(() =>
          runAdapterOperation(async (signal) => {
            const envelope: IEnvelope<Partial<TState>> = {
              version,
              state: partialize(unit.snapshot())
            };
            await writeEnvelope(storage, key, codec, envelope, { signal });
          })
        );
      }
    });
    writeChain = operation.catch(() => undefined);
    if (!rejectOnError) {
      writeDrain = operation;
      void operation.then(
        () => {
          if (writeDrain === operation) writeDrain = undefined;
        },
        () => {
          if (writeDrain === operation) writeDrain = undefined;
        }
      );
    }
    return operation;
  }

  function scheduleWrite(): void {
    if (disposed || hydrating) return;
    if (!hydrationSettled) {
      dirtyDuringHydrate = true;
      return;
    }
    if (debounceMs <= 0) {
      void enqueueWrite().catch(() => undefined);
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void enqueueWrite().catch(() => undefined);
    }, debounceMs);
  }

  stopSubscription = unit.subscribe(scheduleWrite);

  const settled = Promise.resolve()
    .then(() => runAdapterOperation((signal) => readEnvelope(storage, key, codec, { signal })))
    .then(async (raw) => {
      if (disposed) return;
      if (raw !== undefined) {
        const envelope = assertEnvelope<Partial<TState>>(raw, key);
        let state = envelope.state;
        if (envelope.version !== version) {
          if (!migrate) {
            throw createStorePersistError(
              StorePersistErrorCode.envelopeInvalid,
              StorePersistErrorText.versionMismatch(key, envelope.version, version)
            );
          }
          state = migrate(state as TState, envelope.version) as Partial<TState>;
        }
        // Always reconcile the persisted snapshot with the current snapshot. The
        // default object merge preserves fields initialized or mutated while the
        // async read was in flight; custom store shapes can provide their own merge.
        hydrating = true;
        try {
          const current = unit.snapshot();
          const reconciled =
            options.merge === undefined
              ? mergePersistedPlainState(state, current, hydrationStartSnapshot)
              : merge(state, current);
          unit.restore(reconciled);
        } finally {
          hydrating = false;
        }
      }
      hydrationStatus.value = PersistState.success;
      hydrationError.value = undefined;
      hydrationSettled = true;
      if (dirtyDuringHydrate) scheduleWrite();
    })
    .catch((caught) => {
      if (disposed) return;
      hydrationError.value = caught;
      hydrationStatus.value = PersistState.error;
      hydrationSettled = true;
      if (dirtyDuringHydrate) scheduleWrite();
    });

  const ready = settled.then(() => {
    if (hydrationStatus.value === PersistState.error) throw hydrationError.value;
  });
  void ready.catch(() => undefined);

  return {
    status,
    error,
    hydrated,
    hydrationStatus,
    hydrationError,
    writeStatus,
    writeError,
    ready,
    settled,
    async flush() {
      assertActive();
      const pendingWrite = writeDrain;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await settled;
      // Capture the write already observed by this flush before checking the
      // lifecycle again. If dispose wins while the adapter ignores abort, its
      // late storage failure must remain reachable as the AbortError cause.
      if (pendingWrite) await pendingWrite;
      assertActive();
      await enqueueWrite(true);
      assertActive();
    },
    async clear() {
      assertActive();
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await settled;
      assertActive();
      const operation = writeChain.then(async () => {
        assertActive();
        await runWriteOperation(() =>
          runAdapterOperation((signal) => removeEnvelope(storage, key, { signal }))
        );
      });
      writeChain = operation.catch(() => undefined);
      await operation;
      assertActive();
    },
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generationEpoch++;
      for (const controller of activeOperations) controller.abort();
      activeOperations.clear();
      writeStatus.value = PersistState.disposed;
      lifecycleStatus.value = PersistState.disposed;
      if (timer) clearTimeout(timer);
      stopSubscription?.();
    }
  };
}
