import type { IComputedValue, IDisposer, IRuntime } from '@migaia/reactive';

/**
 * 任意持久化单位的最小能力面：同步读快照、同步写回、订阅变化。
 *
 * `persist()`（store-light）、`persistCollection()`（store-indexed）、以及 `persistKeyed()` 内部为每个 key
 * 各自创建的持久化单位，全部实现这同一个接口——`persistUnit()` 只写一遍。
 */
export type IPersistUnit<TState> = {
  /** 同步读当前可持久化状态。 */
  snapshot(): TState;
  /** 同步写回一份状态（hydrate 用）。 */
  restore(state: TState): void;
  /** 注册变化通知，返回取消订阅函数。 */
  subscribe(onChange: () => void): IDisposer;
};

export type IPersistStatus = 'loading' | 'ready' | 'error' | 'disposed';
export type IHydrationStatus = 'loading' | 'success' | 'error';
export type IWriteStatus = 'idle' | 'writing' | 'error' | 'disposed';

export type IReadonlyPersistValue<T> = {
  readonly value: T;
};

export type IPersistHandle = {
  status: IComputedValue<IPersistStatus>;
  error: IComputedValue<unknown>;
  hydrated: IComputedValue<boolean>;
  hydrationStatus: IReadonlyPersistValue<IHydrationStatus>;
  hydrationError: IReadonlyPersistValue<unknown>;
  writeStatus: IReadonlyPersistValue<IWriteStatus>;
  writeError: IReadonlyPersistValue<unknown>;
  /** Hydration 成功 resolve；失败 reject。 */
  ready: Promise<void>;
  /** Hydration 成功或失败都 resolve。 */
  settled: Promise<void>;
  /** 立即写并等待全部在途写入完成；期间 dispose 会以 AbortError 结束。 */
  flush(): Promise<void>;
  /** 排队删除存档；期间 dispose 会以 AbortError 结束。 */
  clear(): Promise<void>;
  readonly disposed: boolean;
  dispose(): void;
};

export type IPersistUnitOptions<TState> = {
  key: string;
  /** 状态信号挂在哪个 Runtime 上——通常传底层 store/collection/AtomStore 自己的 runtime，保证同一张图。 */
  runtime: IRuntime;
  storage: IPersistKeyValueStore;
  /** Codec 编解码的是整份 envelope（`{ version, state }`），天然是类型擦除的，不按 TState 参数化。 */
  codec?: IPersistCodec;
  version?: number;
  migrate?: (persisted: TState, fromVersion: number) => TState;
  partialize?: (state: TState) => Partial<TState>;
  merge?: (persisted: Partial<TState>, current: TState) => TState;
  debounceMs?: number;
};

/**
 * Store-persist 自己只需要 storage-web `IKeyValueStore` 里用得到的这部分——不 import `@migaia/storage-web`
 * 的具体类型定义，只声明结构。真正的 storage-web store 天然满足。
 */
export type IPersistKeyValueStore = {
  readonly capabilities: {
    readonly binary: boolean;
    readonly records: boolean;
  };
  get(key: string, ctx?: { signal?: AbortSignal }): Promise<string | null>;
  set(key: string, value: string, ctx?: { signal?: AbortSignal }): Promise<void>;
  remove(key: string, ctx?: { signal?: AbortSignal }): Promise<void>;
  keys(ctx?: { signal?: AbortSignal }): Promise<string[]>;
  getBytes?(key: string, ctx?: { signal?: AbortSignal }): Promise<Uint8Array | null>;
  setBytes?(key: string, value: Uint8Array, ctx?: { signal?: AbortSignal }): Promise<void>;
};

/** Store-persist 自己需要的 storage-web codec 形状（结构对齐 `@migaia/storage-web` 的 `ICodec`）。 */
export type IPersistCodec<T = unknown> = {
  readonly name: string;
  readonly output: 'text' | 'binary' | 'structured';
  encode(value: T, ctx?: { signal?: AbortSignal }): Promise<string | Uint8Array | unknown>;
  decode(raw: string | Uint8Array | unknown, ctx?: { signal?: AbortSignal }): Promise<T>;
};
