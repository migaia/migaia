import type { IDisposer } from '@migaia/reactive';
import { readEnvelope, removeEnvelope, writeEnvelope } from '../storage/codec';
import { defaultJsonCodec } from '../storage/codec';
import { assertEnvelope, type IEnvelope } from './envelope';
import type {
  IHydrationStatus,
  IPersistHandle,
  IPersistStatus,
  IPersistUnit,
  IPersistUnitOptions,
  IWriteStatus
} from './types';

function disposedError(): Error {
  const error = new Error('[store] persist operation was aborted by dispose');
  error.name = 'AbortError';
  return error;
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
  const {
    key,
    runtime,
    storage,
    codec = defaultJsonCodec,
    version = 0,
    migrate,
    partialize = (state: TState) => state as Partial<TState>,
    // 默认"持久化整份替换当前状态"——对 Record/Map/Set/Array 这几种形状都成立，且不会像
    // 对象展开 `{...current, ...persisted}` 那样在 Map/Set/Array 上产出错误结果（展开一个
    // Map/Set 拿到的是 `{}`，展开两个数组拿到的是带数字字符串键的普通对象，都不是想要的合并）。
    // 只有调用方显式收窄了 `partialize`（只持久化部分字段）时，才需要跟着显式提供匹配的
    // `merge`——两者本来就该配对出现，默认值不替调用方猜"怎么合并一个子集"。
    merge = (persisted: Partial<TState>) => persisted as TState,
    debounceMs = 0
  } = options;

  if (!codec) throw new TypeError(`[store] persist "${key}" resolved no codec`);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new TypeError(`[store] persist "${key}" version must be a safe, non-negative integer`);
  }

  const hydrationStatus = runtime.signal<IHydrationStatus>('loading');
  const hydrationError = runtime.signal<unknown>(undefined);
  const writeStatus = runtime.signal<IWriteStatus>('idle');
  const writeError = runtime.signal<unknown>(undefined);
  const lifecycleStatus = runtime.signal<'active' | 'disposed'>('active');
  const status = runtime.computed<IPersistStatus>(() => {
    if (lifecycleStatus.value === 'disposed') return 'disposed';
    if (hydrationStatus.value === 'loading') return 'loading';
    if (hydrationStatus.value === 'error' || writeStatus.value === 'error') return 'error';
    return 'ready';
  });
  const error = runtime.computed<unknown>(() => {
    const hydration = hydrationError.value;
    const write = writeError.value;
    if (hydration !== undefined && write !== undefined) {
      return new AggregateError(
        [hydration, write],
        '[store] persist hydration and write both failed'
      );
    }
    return hydration ?? write ?? undefined;
  });
  const hydrated = runtime.computed(() => hydrationStatus.value === 'success');

  let stopSubscription: IDisposer | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let generationEpoch = 0;
  const activeOperations = new Set<AbortController>();
  let hydrationSettled = false;
  let hydrating = false;
  let dirtyDuringHydrate = false;
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
      if (disposed) throw disposedError();
      throw caught;
    } finally {
      activeOperations.delete(controller);
    }
  }

  async function runWriteOperation(operation: () => void | Promise<void>): Promise<void> {
    const operationGeneration = generationEpoch;
    writeStatus.value = 'writing';
    try {
      await operation();
      if (disposed || operationGeneration !== generationEpoch) return;
      writeStatus.value = 'idle';
      writeError.value = undefined;
    } catch (operationError) {
      if (disposed || operationGeneration !== generationEpoch) throw operationError;
      writeStatus.value = 'error';
      writeError.value = operationError;
      throw operationError;
    }
  }

  function enqueueWrite(rejectOnError = false): Promise<void> {
    writeRequested = true;
    if (!rejectOnError && writeDrain) return writeDrain;

    const operation = writeChain.then(async () => {
      while (!disposed && writeRequested) {
        writeRequested = false;
        try {
          await runWriteOperation(() =>
            runAdapterOperation(async (signal) => {
              const envelope: IEnvelope<Partial<TState>> = {
                version,
                state: partialize(unit.snapshot())
              };
              await writeEnvelope(storage, key, codec, envelope, { signal });
            })
          );
        } catch (writeErr) {
          if (rejectOnError) throw writeErr;
        }
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
      void enqueueWrite();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void enqueueWrite();
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
            throw new Error(
              `[store] persist archive "${key}" is version ${envelope.version}, but this store is version ${version}; provide migrate() to convert it`
            );
          }
          state = migrate(state as TState, envelope.version) as Partial<TState>;
        }
        // 启动阶段用户写优先：hydrate 还没结算时若 unit 已经发生过变化，
        // 整份持久化状态放弃应用，不做字段级合并——通用 TState 形状下无法安全地
        // 逐字段判断"这个具体成员是不是同一个"，宁可整份跳过也不要悄悄丢一部分用户写入。
        if (!dirtyDuringHydrate) {
          hydrating = true;
          try {
            unit.restore(merge(state, unit.snapshot()));
          } finally {
            hydrating = false;
          }
        }
      }
      hydrationStatus.value = 'success';
      hydrationError.value = undefined;
      hydrationSettled = true;
      if (dirtyDuringHydrate) scheduleWrite();
    })
    .catch((caught) => {
      if (disposed) return;
      hydrationError.value = caught;
      hydrationStatus.value = 'error';
      hydrationSettled = true;
      if (dirtyDuringHydrate) scheduleWrite();
    });

  const ready = settled.then(() => {
    if (hydrationStatus.value === 'error') throw hydrationError.value;
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
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await settled;
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
      writeStatus.value = 'disposed';
      lifecycleStatus.value = 'disposed';
      if (timer) clearTimeout(timer);
      stopSubscription?.();
    }
  };
}
