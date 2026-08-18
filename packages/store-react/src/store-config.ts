import { createContext, useContext, type ReactNode } from 'react';
import { createStoreReactError } from './errors.js';
import { StoreReactErrorCode } from './error-code.js';
import { StoreReactErrorText } from './error-text.js';
import { EMPTY_EXPERIMENTAL_ENCODING, StoreProviderState } from './provider-state-constants.js';

/**
 * 应用级 Store 配置（挂在 StoreProvider 上）。
 *
 * 与 Runtime / AtomStore 隔离正交： - Provider 的 registry/runtime = 图的所有权 - config = 这棵树声明要哪些增强、就绪前是否挡住子树
 *
 * `features.wasm === true` 时必须同时提供 `ready`（通常放入 `ensureWasm` from
 * `@migaia/store-wasm`），否则在开发期直接抛错——避免「开了开关却没人 init」。
 */

export type IStoreFeatureExperimental = Readonly<Record<string, boolean>>;

export type IStoreFeatures = {
  /** 声明本树会使用 wasm 字段。 默认 false：不强制就绪屏障。 true：必须配合 `ready` 完成 init（见 StoreProvider）。 */
  readonly wasm?: boolean;
  /** 实验特性白名单。未列出或非严格 `true` 视为关闭。 实验 API 应 `assertStoreFeature('experimental.xxx')`。 */
  readonly experimental?: IStoreFeatureExperimental;
};

/** 就绪屏障：Promise 或零参工厂（便于传 `ensureWasm`）。 */
export type IStoreReadyBarrier = Promise<unknown> | (() => Promise<unknown> | unknown);

export type IStoreProviderDefaults = {
  /**
   * 仅挂在 config 快照上供业务读取（useStoreConfig）， **不会**自动传给 createStore——createStore 仍要自己写
   * options.warnAsyncActions。
   */
  readonly warnAsyncActions?: boolean;
};

export type IStoreProviderConfig = {
  readonly features?: IStoreFeatures;
  /** 子树渲染前必须 settle 的屏障。 例：`ready: [ensureWasm]`（从 `@migaia/store-wasm` 引入）。 */
  readonly ready?: readonly IStoreReadyBarrier[];
  /** 屏障未完成时的占位。 */
  readonly fallback?: ReactNode;
  readonly defaults?: IStoreProviderDefaults;
};

export type IReadyStatus = (typeof StoreProviderState)[keyof typeof StoreProviderState];

export type ITrackedReady = {
  readonly promise: Promise<void>;
  /** 同步可读；已 settle 的 Promise 在 track 后于微任务内更新，首帧可能仍 pending。 */
  status(): IReadyStatus;
  error(): unknown;
};

export type IStoreConfigValue = {
  readonly features: {
    readonly wasm: boolean;
    readonly experimental: Readonly<Record<string, boolean>>;
  };
  readonly defaults: IStoreProviderDefaults;
  /** 归一化后的就绪跟踪；无屏障时为 null。 */
  readonly ready: ITrackedReady | null;
};

export const StoreConfigContext = createContext<IStoreConfigValue | null>(null);

const EMPTY_EXPERIMENTAL: Readonly<Record<string, boolean>> = Object.freeze(
  Object.create(null) as Record<string, boolean>
);
const EXPERIMENTAL_ENCODING_CACHE = new WeakMap<object, string>();

export function normalizeStoreConfig(
  config?: IStoreProviderConfig,
  barrierScope: object = {}
): IStoreConfigValue {
  let wasm = false;
  let experimentalInput: IStoreFeatureExperimental | undefined;
  let barriers: readonly IStoreReadyBarrier[] | undefined;
  let defaults: IStoreProviderDefaults | undefined;
  try {
    const features = config?.features;
    wasm = features?.wasm === true;
    experimentalInput = features?.experimental;
    barriers = config?.ready;
    defaults = config?.defaults;
  } catch (error) {
    throw createStoreReactError(StoreReactErrorCode.invalidConfig, StoreReactErrorText.configRead, {
      cause: error
    });
  }
  const experimental = freezeExperimental(experimentalInput);
  const validBarrier = (barrier: unknown): boolean => {
    if (typeof barrier === 'function') return true;
    if (barrier === null || typeof barrier !== 'object') return false;
    try {
      return typeof (barrier as { then?: unknown }).then === 'function';
    } catch {
      return false;
    }
  };
  if (
    barriers !== undefined &&
    (!Array.isArray(barriers) || barriers.some((barrier) => !validBarrier(barrier)))
  ) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.readyInvalid
    );
  }
  const normalizedBarriers = barriers ?? [];

  const effectiveBarriers =
    wasm && normalizedBarriers.length === 0
      ? ([
          () =>
            Promise.reject(
              createStoreReactError(
                StoreReactErrorCode.invalidConfig,
                StoreReactErrorText.featureReady
              )
            )
        ] as const)
      : normalizedBarriers;

  const ready =
    effectiveBarriers.length === 0
      ? null
      : trackReady(getReadyPromise(effectiveBarriers, barrierScope));

  return {
    features: { wasm, experimental },
    defaults: {
      warnAsyncActions: defaults?.warnAsyncActions === true
    },
    ready
  };
}

const READY_PROMISES = new WeakMap<object, WeakMap<object, Promise<void>>>();

function getReadyPromise(barriers: readonly IStoreReadyBarrier[], scope: object): Promise<void> {
  let scoped = READY_PROMISES.get(scope);
  if (!scoped) {
    scoped = new WeakMap();
    READY_PROMISES.set(scope, scoped);
  }
  const cached = scoped.get(barriers as object);
  if (cached) return cached;
  const promise = Promise.all(barriers.map((barrier) => runBarrier(barrier, scope))).then(
    () => undefined
  );
  scoped.set(barriers as object, promise);
  return promise;
}

const READY_TRACK = new WeakMap<Promise<void>, { status: IReadyStatus; error: unknown }>();
const READY_OBJECTS = new WeakMap<Promise<void>, ITrackedReady>();

function trackReady(promise: Promise<void>): ITrackedReady {
  const tracked = READY_OBJECTS.get(promise);
  if (tracked) return tracked;
  let state = READY_TRACK.get(promise);
  if (!state) {
    state = { status: StoreProviderState.pending, error: undefined };
    READY_TRACK.set(promise, state);
    promise.then(
      () => {
        state!.status = StoreProviderState.ready;
      },
      (reason: unknown) => {
        state!.status = StoreProviderState.error;
        state!.error = reason;
      }
    );
  }
  const result = {
    promise,
    status: () => state!.status,
    error: () => state!.error
  };
  READY_OBJECTS.set(promise, result);
  return result;
}

function freezeExperimental(
  input: IStoreFeatureExperimental | undefined
): Readonly<Record<string, boolean>> {
  if (!input) return EMPTY_EXPERIMENTAL;
  return decodeStoreExperimental(encodeStoreExperimental(input));
}

/**
 * Canonical, getter-free feature snapshot used by StoreProvider memoization. Accessors are rejected
 * closed and a sorted tuple encoding makes key order irrelevant. `__proto__` remains an inert
 * string key on the decoded null- prototype object.
 */
export function encodeStoreExperimental(input: IStoreFeatureExperimental | undefined): string {
  if (!input) return '[]';
  try {
    const cacheable = Object.isFrozen(input);
    const cached = cacheable ? EXPERIMENTAL_ENCODING_CACHE.get(input) : undefined;
    if (cached !== undefined) return cached;
    const entries: Array<readonly [string, boolean]> = [];
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
      if (!descriptor.enumerable || !('value' in descriptor)) continue;
      entries.push([key, descriptor.value === true]);
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    const encoded = JSON.stringify(entries);
    if (cacheable) EXPERIMENTAL_ENCODING_CACHE.set(input, encoded);
    return encoded;
  } catch (error) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.experimentalInvalid,
      { cause: error }
    );
  }
}

export function decodeStoreExperimental(encoded: string): Readonly<Record<string, boolean>> {
  if (encoded === EMPTY_EXPERIMENTAL_ENCODING) return EMPTY_EXPERIMENTAL;
  const entries = JSON.parse(encoded) as Array<readonly [string, boolean]>;
  const out = Object.create(null) as Record<string, boolean>;
  for (const [key, enabled] of entries) out[key] = enabled === true;
  return Object.freeze(out);
}

type IBarrierFactory = Extract<IStoreReadyBarrier, () => unknown>;
// Cache by the normalized barrier-list identity, never by factory globally.
// This keeps separate Provider/SSR scopes isolated. Factory execution is not
// guaranteed exactly once across abandoned React renders; callers should pass
// a memoized Promise/resource for non-idempotent work.
const BARRIER_CACHE = new WeakMap<object, WeakMap<IBarrierFactory, Promise<unknown>>>();

function runBarrier(barrier: IStoreReadyBarrier, scope: object): Promise<unknown> {
  if (typeof barrier !== 'function') return Promise.resolve(barrier);
  let scoped = BARRIER_CACHE.get(scope);
  if (!scoped) {
    scoped = new WeakMap();
    BARRIER_CACHE.set(scope, scoped);
  }
  let cached = scoped.get(barrier);
  if (!cached) {
    try {
      cached = Promise.resolve(barrier());
    } catch (error) {
      cached = Promise.reject(error) as Promise<unknown>;
    }
    scoped.set(barrier, cached);
    cached.catch(() => {
      if (scoped?.get(barrier) === cached) scoped.delete(barrier);
    });
  }
  return cached;
}

export type IStoreFeaturePath = 'wasm' | `experimental.${string}`;

export function readStoreFeature(config: IStoreConfigValue, path: IStoreFeaturePath): boolean {
  if (path === 'wasm') return config.features.wasm;
  if (path.startsWith('experimental.')) {
    const key = path.slice('experimental.'.length);
    if (!key) return false;
    return config.features.experimental[key] === true;
  }
  return false;
}

export function assertStoreFeature(
  config: IStoreConfigValue | null,
  path: IStoreFeaturePath,
  apiName = 'this API'
): void {
  if (!config) {
    throw createStoreReactError(
      StoreReactErrorCode.providerRequired,
      StoreReactErrorText.apiProvider(apiName, path)
    );
  }
  if (!readStoreFeature(config, path)) {
    throw createStoreReactError(
      StoreReactErrorCode.featureDisabled,
      StoreReactErrorText.apiFeature(apiName, path)
    );
  }
}

/** 完整配置；无 Provider 时返回 null（与 registry 不同，配置是可选的）。 */
export function useStoreConfig(): IStoreConfigValue | null {
  return useContext(StoreConfigContext);
}

/** 查询特性开关。 - 无 Provider：一律 false（不抛），便于可选增强 - 有 Provider：读归一化后的 features */
export function useStoreFeature(path: IStoreFeaturePath): boolean {
  const config = useStoreConfig();
  if (!config) return false;
  return readStoreFeature(config, path);
}

/** 实验 / 增强 API 入口处调用：未开启则抛明确错误。 无 Provider 也抛（实验 API 不允许「默默在树外半开」）。 */
export function useAssertStoreFeature(path: IStoreFeaturePath, apiName?: string): void {
  const config = useStoreConfig();
  assertStoreFeature(config, path, apiName);
}
