import { defaultRuntime, Effect } from '@migaia/reactive';
import type { IDisposable, IDisposer, IRuntime } from '@migaia/reactive';
import type { Signal } from '@migaia/reactive/reactive/signal.class';
import type { Computed } from '@migaia/reactive/reactive/computed.class';
import {
  isFieldBuilder,
  isRaw,
  type FieldBuilder,
  type AsyncFieldBuilder,
  type LegacyFieldBuilder,
  type IMutationPolicy,
  type Raw
} from './store-protocol';
import { assertOwnedBy, claimOwnership, ownerOf } from '@migaia/reactive/runtime/ownership';
import { createFieldSource } from '@migaia/reactive/runtime/source';
import { internalRuntimeOf } from '@migaia/reactive/runtime/node-factories';
export { createStoreResource, createStoreResourceScope } from './store-resource';
export type {
  IStoreResource,
  IResourceCapture,
  IStoreResourceScope,
  StoreResourceErrorPhase,
  StoreResourceFactory,
  StoreResourceLoadContext,
  StoreResourceOptions
} from './store-resource';

// 甜 API：一个普通对象字面量进来，自动拆成响应式图——
//   普通值      → Signal（可读可写，读时自动订阅）
//   get 访问器  → Computed（惰性缓存的派生值）
//   方法        → Action（自动 batch + untracked，结束后统一通知）
//   wasm 构造器 → 同步 ready runtime 中的 WASM 字段，或由 createAsyncStore() 异步创建
// 开发者只写「对象 / getter / 方法」，看不到 signal/computed/batch。
// 所有节点都创建在同一个 runtime 上（默认 defaultRuntime，可经 options.runtime 隔离）——
// 保证 SSR 每请求 / 单测 / 多 root 之间状态不串线。

// 把「输入形状」映射成「对外暴露的字段类型」：
//   字段构造器（wasm 等）→ 它 create() 出来的字段类型
//   方法                 → 保持同签名可调用
//   值 / getter          → 保持其类型（getter 在对象字面量类型里本就表现为返回值类型的属性）
type IBuilderKeys<S> = {
  [K in keyof S]-?: S[K] extends FieldBuilder<IDisposable> ? K : never;
}[keyof S];

export type IStoreShape<S> = {
  readonly [K in IBuilderKeys<S>]: S[K] extends FieldBuilder<infer F> ? F : never;
} & {
  [K in Exclude<keyof S, IBuilderKeys<S>>]: S[K] extends Raw<infer T>
    ? T // raw(fn) → 普通函数值字段
    : S[K] extends FieldBuilder<infer F>
      ? F
      : S[K] extends (...args: infer A) => infer R
        ? (...args: A) => R
        : S[K];
};

type IIfEquals<X, Y, Then, Else = never> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? Then : Else;

type IWritableKeys<S> = {
  [K in keyof S]-?: IIfEquals<Pick<S, K>, { -readonly [P in K]: S[P] }, K>;
}[keyof S];

type ISettableKey<S> = {
  [K in IWritableKeys<S>]: S[K] extends Raw<unknown>
    ? K
    : S[K] extends FieldBuilder<infer _Field>
      ? never
      : S[K] extends (...args: never[]) => unknown
        ? never
        : K;
}[IWritableKeys<S>];

export type IWritableStorePatch<S> = Partial<
  Pick<IStoreShape<S>, ISettableKey<S> & keyof IStoreShape<S>>
>;

export type ISubscribeOptions = {
  // 默认 false；设 true 时订阅建立后立即调用一次 listener。
  fireImmediately?: boolean;
};

export type IHydrateOptions = {
  /** Unknown keys are ignored by default for backwards-compatible partial hydration. */
  readonly unknown?: 'ignore' | 'report' | 'strict';
  readonly onUnknown?: (key: string) => void;
};

// $-前缀的运行时 API，挂成不可枚举属性，避免和用户字段撞名
export type IReactiveStoreApi<S> = {
  // 本 store 所有节点所属的 runtime——React 适配层据此在同一个 runtime 上建 effect，保证同图。
  // 暴露接口而非具体类：调用方只需要「在同一张图上建节点」这组能力。
  $runtime: IRuntime;
  // 是否含异步字段（wasm 等）。为 false 时整个 store 同步就绪，React 适配层无需 Suspense 门控，
  // 纯同步 store 不需要 Suspense 门控；异步 Store 由 createAsyncStore/Provider 在创建边界解决。
  $async: boolean;
  $snapshot(): IStoreShape<S>;
  $subscribe(fn: () => void, options?: ISubscribeOptions): IDisposer;
  // 批量写入：整个 recipe 在一个 batch 里执行，改多个字段只触发一次通知。
  // 注意：这是「批处理」不是「事务」——recipe 中途抛错不回滚已改字段（改名自 $patch 以免误导为 Immer draft）。
  // draft 就是 store 本身：写普通字段走 signal setter；写 computed（只读）会抛错。
  $batch(recipe: (draft: IStoreShape<S>) => void): void;
  // 低层批量赋值（次要 API）：编译期只接受可写 signal 字段，运行期仍防御非法动态输入。
  $set(patch: IWritableStorePatch<S>): void;
  // 仅取可持久化的标量字段（signal 支撑的）——computed（派生）/wasm/方法都排除。持久化层用。
  $plain(): Record<string, unknown>;
  // 宽松写回 signal 字段（持久化 hydration 用）：只写已知 signal 键，未知/派生/wasm 键静默跳过，一次事务。
  $hydrate(partial: Record<string, unknown>, options?: IHydrateOptions): void;
  // 是否已释放。释放后所有公开读写/动作统一抛错——不留「部分字段能用、部分不能用」的半死状态。
  readonly $disposed: boolean;
  /**
   * 把外部资源挂进本 store 的所有权作用域（典型：collections）。
   *
   * 中型场景的正确拆法是「store 持根 UI/动作，collections 承载热路径结构」； 没有 $own 时两者共 Runtime 却各管 dispose，根一释放结构节点就泄漏。
   * 资源必须未归属或已归属本 Runtime；跨 Runtime 直接拒绝。
   */
  $own<T extends IDisposable>(resource: T): T;
  $dispose(): void;
};

export type IReactiveStore<S> = IStoreShape<S> & IReactiveStoreApi<S>;

/**
 * CreateStore 的输入形状：字段/getter/方法 + **ThisType**。
 *
 * 没有 ThisType 时，方法里的 `this` 仍是「输入字面量」类型——wasm 字段还是 FieldBuilder，写 `this.price.value`
 * 会类型报错，逼人去用外置函数。 加上之后，`this` 是解析后的 IReactiveStore（FieldBuilder → 真实字段）。
 */
export type IStoreDefinition<S extends Record<string, unknown>> = S & ThisType<IReactiveStore<S>>;

export type ICreateStoreOptions = {
  /**
   * 显式隔离运行时；缺省用 defaultRuntime。
   *
   * 收 `IRuntime` 而不是 `Runtime` 具体类：门面只用得到接口上的东西
   * （signal/computed/effect/batch/createScope…），收具体类等于要求第三方 必须继承本库的类才能替换运行时。
   */
  runtime?: IRuntime;
  debugName?: string;
  // 显式诊断开关；默认关闭，独立库不猜测 process/import.meta 等构建环境。
  warnAsyncActions?: boolean;
  /**
   * Optional MobX-style strict mutation policy. Direct field writes must run inside an
   * action/$batch/$set/$hydrate; Store methods are actions.
   */
  mutationPolicy?: IMutationPolicy;
};

/** Shared Store construction engine. Public entry points adapt into this core. */
function createStoreCore<S extends Record<string, unknown>>(
  shape: IStoreDefinition<S>,
  options?: ICreateStoreOptions,
  /** Internal descriptor snapshot; prevents Proxy TOCTOU during strict creation. */
  _descriptors?: Record<string, PropertyDescriptor>
): IReactiveStore<S> {
  const runtime = options?.runtime ?? defaultRuntime;
  const nodeRuntime = internalRuntimeOf(runtime);
  const warnAsyncActions = options?.warnAsyncActions ?? false;
  const mutationPolicy = options?.mutationPolicy;
  const debugName = options?.debugName ?? 'Store';
  const scope = runtime.createScope(); // Store 内部 Computed/Effect/wasm 字段的所有权作用域
  const initAbort = new AbortController(); // $dispose 时中止在途的异步字段初始化
  const store = {} as Record<string, unknown>;

  // 分类后的底层节点
  const signals = new Map<string, Signal<unknown>>();
  const computeds = new Map<string, Computed<unknown>>();
  const wasmFields = new Map<string, unknown>();
  const fieldSources = new Set<ReturnType<typeof createFieldSource>>();
  const createTrackedFieldSource = (debugName?: string) => {
    const source = scope.own(createFieldSource(runtime, debugName));
    fieldSources.add(source);
    return source;
  };
  /**
   * Claim ownership of a Builder-produced field and hand it to the scope, as one transaction. A
   * Builder can return a value that's already owned by a foreign Runtime (a shared singleton, a
   * field reused across store instances by mistake) — `claimOwnership` rejects that, but the field
   * itself was never registered anywhere by that point, so the outer try/catch's `scope.dispose()`
   * has nothing to call it through. Its _sources_ are already safe (`createTrackedFieldSource` owns
   * those the moment the Builder asks for one, regardless of what happens to the field object
   * afterward) — this closes the remaining gap: whatever the field itself holds beyond its sources.
   * Roll back by disposing the field directly instead of routing through the scope, which never got
   * to adopt it either way.
   */
  const adoptField = <F extends IDisposable>(field: F): F => {
    try {
      claimOwnership(field, runtime);
    } catch (error) {
      try {
        field.dispose();
      } catch {
        /* the ownership error is what the caller needs to see */
      }
      throw error;
    }
    try {
      scope.own(field);
    } catch (error) {
      try {
        field.dispose();
      } catch {
        /* the scope error is what the caller needs to see */
      }
      throw error;
    }
    return field;
  };
  const readyList: Promise<void>[] = [];
  let status: 'pending' | 'ready' | 'failed' = 'pending';
  let disposed = false;
  let initializationFailed = false;

  function assertNotDisposed() {
    if (disposed) throw new Error('[store] store is disposed');
  }

  function assertMutationAllowed(operation: string) {
    mutationPolicy?.assertMutationAllowed(operation);
  }

  function runMutation<T>(fn: () => T): T {
    return mutationPolicy ? mutationPolicy.runInAction(() => runtime.batch(fn)) : runtime.batch(fn);
  }

  const descriptors = _descriptors ?? Object.getOwnPropertyDescriptors(shape);
  try {
    for (const key of Object.keys(descriptors)) {
      const desc = descriptors[key];

      // get 访问器 → Computed。getter 里的 this 绑到 store，读到的都是响应式字段。
      if (typeof desc.get === 'function') {
        const getter = desc.get;
        const node = scope.own(
          nodeRuntime.computed(() => getter.call(store), {
            debugName: `${debugName}.${key}`
          })
        );
        computeds.set(key, node);
        Object.defineProperty(store, key, {
          enumerable: true,
          get: () => {
            assertNotDisposed(); // 统一：释放后读任何字段都抛 'store is disposed'
            return node.value;
          } // 派生值只读，不给 set
        });
        continue;
      }

      const value = desc.value;

      // raw(x) → 普通值字段（即使 x 是函数也不当 action）。必须在方法检查之前解包。
      if (isRaw(value)) {
        const node = scope.own(
          nodeRuntime.signal(value.value, {
            debugName: `${debugName}.${key}`
          })
        );
        signals.set(key, node);
        Object.defineProperty(store, key, {
          enumerable: true,
          get: () => {
            assertNotDisposed();
            return node.value;
          },
          set: (v: unknown) => {
            assertNotDisposed();
            assertMutationAllowed(`set(${key})`);
            node.value = v;
          }
        });
        continue;
      }

      if (typeof value === 'function') {
        // 方法 → Action：只自动 batch 同步执行片段 + untracked。async 方法跨过首个 await 后已离开 batch；
        // 需要合并后续写入时，调用方应在续体里显式使用 $batch。
        const fn = value as (...args: unknown[]) => unknown;
        let warnedAsync = false;
        store[key] = (...args: unknown[]) => {
          assertNotDisposed();
          const actionName = `${debugName}.${key}`;
          const result = runtime.runTracedAction(actionName, () =>
            runMutation(() => runtime.untracked(() => fn.apply(store, args)))
          );
          if (warnAsyncActions && !warnedAsync && result !== null) {
            // 诊断必须不可观察：then 可能是会抛错的用户 getter，console 也可能被替换。
            try {
              const candidate = result as { then?: unknown };
              if (
                (typeof result === 'object' || typeof result === 'function') &&
                typeof candidate.then === 'function'
              ) {
                warnedAsync = true;
                console.warn(
                  `[store] async action "${key}" only batches work before the first await; use $batch() for later writes`
                );
              }
            } catch {
              // 忽略所有诊断异常，保持 action 的 DEV/PROD 行为一致。
            }
          }
          return result;
        };
        continue;
      }

      if (isFieldBuilder(value)) {
        if ('mode' in value && value.mode === 'sync') {
          const field = adoptField(
            value.create({
              runtime,
              signal: initAbort.signal,
              createSource: createTrackedFieldSource
            })
          );
          wasmFields.set(key, field);
          Object.defineProperty(store, key, {
            enumerable: true,
            get: () => {
              assertNotDisposed();
              return wasmFields.get(key);
            }
          });
          continue;
        }
        // 异步字段（wasm 等）：Store 负责所有权登记（不让 Builder 自己 own）。传 AbortSignal，$dispose 可中止初始化。
        // 若在初始化完成前 store 已 dispose，立即释放刚创建的字段，避免泄漏。
        readyList.push(
          Promise.resolve()
            .then(() =>
              value.create({
                runtime,
                signal: initAbort.signal,
                createSource: (debugName) =>
                  // Store owns every capability it signs, not only
                  // the final Field object. A rejected builder or a
                  // third-party Field that forgets to dispose its
                  // source therefore cannot leak graph edges.
                  createTrackedFieldSource(debugName)
              })
            )
            .then((field) => {
              if (disposed || initializationFailed) {
                field.dispose();
                return;
              }
              adoptField(field);
              wasmFields.set(key, field);
            })
        );
        Object.defineProperty(store, key, {
          enumerable: true,
          get: () => {
            assertNotDisposed();
            assertReady();
            return wasmFields.get(key);
          }
        });
        continue;
      }

      // 普通值 → Signal：读订阅、写触发。必须进 scope——否则 $dispose 只拆派生/订阅，
      // 源节点带着 version/subs 常驻，与「释放后不留半死图」的契约矛盾。
      const node = scope.own(
        nodeRuntime.signal(value, {
          debugName: `${debugName}.${key}`
        })
      );
      signals.set(key, node);
      Object.defineProperty(store, key, {
        enumerable: true,
        get: () => {
          assertNotDisposed();
          return node.value;
        },
        set: (v: unknown) => {
          assertNotDisposed();
          assertMutationAllowed(`set(${key})`);
          node.value = v;
        }
      });
    }
  } catch (error) {
    initAbort.abort();
    try {
      scope.dispose();
    } catch (cleanupError) {
      if (error instanceof Error) {
        try {
          error.cause ??= cleanupError;
        } catch {
          /* preserve original */
        }
      }
    }
    signals.clear();
    computeds.clear();
    wasmFields.clear();
    fieldSources.clear();
    throw error;
  }

  if (readyList.length === 0) status = 'ready';
  const ready = Promise.all(readyList).then(
    () => {
      status = 'ready';
    },
    (error: unknown) => {
      status = 'failed';
      initializationFailed = true;
      disposed = true;
      initAbort.abort();
      // 初始化失败即回收已创建资源。清理错误不能替换原始初始化错误。
      try {
        scope.dispose();
      } catch (cleanupError) {
        // 保留原始初始化 Error 身份，同时附加清理失败用于诊断。
        if (error instanceof Error) {
          try {
            error.cause =
              error.cause === undefined
                ? cleanupError
                : new AggregateError(
                    [error.cause, cleanupError],
                    '[store] initialization and cleanup both failed'
                  );
          } catch {
            // 冻结 Error 无法附加 cause；仍不得替换原始初始化错误。
          }
        }
      }
      throw error;
    }
  );

  function assertReady() {
    if (status !== 'ready')
      throw new Error(
        `[store] store is ${status}; use createAsyncStore() before accessing async fields`
      );
  }

  const api: IReactiveStoreApi<S> = {
    $runtime: runtime,
    $async: readyList.length > 0,
    $snapshot() {
      assertNotDisposed();
      // 异步字段未就绪时不能返回「缺字段的假完整对象」——先 assertReady，类型与运行时一致
      assertReady();
      return runtime.untracked(() => {
        const out = Object.create(null) as Record<string, unknown>;
        for (const [k, n] of signals) out[k] = n.value;
        for (const [k, n] of computeds) out[k] = n.value;
        for (const [k, f] of wasmFields) out[k] = f;
        return out;
      }) as IStoreShape<S>;
    },
    $subscribe(fn, options) {
      assertNotDisposed();
      let initialRun = true;
      // 粗粒度订阅只读取可变源字段。派生字段由这些源字段的变更
      // 间接触发；不在这里主动读取全部 Computed，避免一次持久化
      // 订阅把整个 Store 的昂贵 getter 变成常驻 keepAlive 节点。
      const e = scope.own(
        new Effect(
          () => {
            for (const n of signals.values()) void n.value;
            for (const source of fieldSources) source.track();
            if (!initialRun || options?.fireImmediately === true) {
              try {
                runtime.untracked(fn);
              } catch (error) {
                runtime.reportError(error, {
                  phase: 'subscription-listener'
                });
              }
            }
            initialRun = false;
          },
          runtime,
          { debugName: `${debugName}.$subscribe` }
        )
      );
      // 单独退订同时从 scope 解除登记，避免反复订阅/退订造成 scope 滞留泄漏
      return () => {
        e.dispose();
        scope.release(e);
      };
    },
    $batch(recipe) {
      assertNotDisposed();
      // batch（非事务，不回滚）；draft = store 本身，写只读 computed 字段会自然抛错。
      runMutation(() => recipe(store as unknown as IStoreShape<S>));
    },
    $set(patch) {
      assertNotDisposed();
      runMutation(() => {
        const entries = Object.entries(patch).map(([key, value]) => {
          const node = signals.get(key);
          if (!node) throw new Error(`[store] field is not settable: ${key}`);
          return [node, value] as const;
        });
        for (const [node, value] of entries) node.value = value;
      });
    },
    $plain() {
      assertNotDisposed();
      return runtime.untracked(() => {
        const out = Object.create(null) as Record<string, unknown>;
        for (const [k, n] of signals) out[k] = n.value;
        return out;
      });
    },
    $hydrate(partial, options = {}) {
      assertNotDisposed();
      const entries = Object.entries(partial);
      const unknown = entries.filter(([key]) => !signals.has(key)).map(([key]) => key);
      if (options.unknown === 'strict' && unknown.length > 0) {
        throw new Error(`[store] unknown hydration field: ${unknown[0]}`);
      }
      if (options.unknown === 'report') {
        for (const key of unknown) options.onUnknown?.(key);
      }
      runMutation(() => {
        for (const [k, v] of entries) {
          const node = signals.get(k);
          if (node) node.value = v;
        }
      });
    },
    get $disposed() {
      return disposed;
    },
    $own(resource) {
      assertNotDisposed();
      assertOwnedBy(resource, runtime, 'resource');
      if (!ownerOf(resource)) claimOwnership(resource, runtime);
      return scope.own(resource);
    },
    $dispose() {
      if (disposed) return;
      disposed = true;
      initAbort.abort(); // 中止在途异步字段初始化
      // scope 释放 Signal / Computed / $subscribe Effect / 已登记的 wasm 字段（best-effort）
      try {
        scope.dispose();
      } finally {
        // 丢掉强引用，避免「已 dispose 仍被 store 地图钉住」的假性常驻
        signals.clear();
        computeds.clear();
        wasmFields.clear();
        fieldSources.clear();
      }
    }
  };

  // $-API 挂成不可枚举，$snapshot 遍历用户字段时不会把它们也带出去。
  // 用 getOwnPropertyDescriptor 复制：保留 $disposed 这类 getter 的「实时」语义（不被求值成静态快照）。
  for (const k of Object.keys(api)) {
    const desc = Object.getOwnPropertyDescriptor(api, k)!;
    Object.defineProperty(store, k, { ...desc, enumerable: false });
  }

  // 登记归属：Registry 与 SSR scope 据此校验，不再靠 $runtime 字段名
  claimOwnership(store, runtime);
  STORE_READY.set(store, ready);
  return store as IReactiveStore<S>;
}

/** Compatibility facade for the historical Store definition API. */
export function createLegacyStore<S extends Record<string, unknown>>(
  shape: IStoreDefinition<S>,
  options?: ICreateStoreOptions
): IReactiveStore<S> {
  return createStoreCore(shape, options);
}

/**
 * Explicit asynchronous creation for definitions containing async FieldBuilders. The returned store
 * has completed initialization; callers do not need to expose a half-ready object or gate every
 * field access with an explicit async creation boundary.
 */
export async function createAsyncStore<S extends Record<string, unknown>>(
  shape: IStoreDefinition<S>,
  options?: ICreateStoreOptions
): Promise<IReactiveStore<S>> {
  const store = createStoreCore(shape, options);
  if (store.$async) await storeReady(store);
  return store;
}

const STORE_READY = new WeakMap<object, Promise<void>>();

/** Internal readiness bridge; readiness is no longer a property on Store instances. */
/** Internal bridge retained for the React adapter and legacy migration tests. */
export function storeReady(store: object): Promise<void> {
  const ready = STORE_READY.get(store);
  if (!ready) throw new Error('[store] store has no asynchronous initialization');
  return ready;
}

/**
 * Main synchronous creation contract. It rejects FieldBuilders before their create() method can
 * start I/O; use createAsyncStore for async definitions.
 */
export function createStore<S extends Record<string, unknown>>(
  shape: IStoreDefinition<S> & {
    [K in keyof S]: S[K] extends AsyncFieldBuilder<IDisposable> | LegacyFieldBuilder<IDisposable>
      ? never
      : S[K];
  },
  options?: ICreateStoreOptions
): IReactiveStore<S> {
  const descriptors = Object.getOwnPropertyDescriptors(shape);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      'value' in descriptor &&
      isFieldBuilder(descriptor.value) &&
      (!('mode' in descriptor.value) || descriptor.value.mode !== 'sync')
    ) {
      throw new Error(
        `[store] createStore() only accepts synchronous fields; "${key}" is a FieldBuilder. Use createAsyncStore().`
      );
    }
  }
  const snapshot = Object.create(Object.getPrototypeOf(shape)) as S;
  Object.defineProperties(snapshot, descriptors);
  return createStoreCore(
    snapshot as IStoreDefinition<S>,
    options,
    descriptors
  ) as IReactiveStore<S>;
}

/** Explicit naming alias for `createStore()`; no separate lifecycle semantics. */
export const createStoreSync = createStore;
