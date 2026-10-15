import { defaultRuntime, ReactiveErrorPhase } from '@migaia/reactive'
import type {
  IDisposable,
  IDisposer,
  IReactiveComputed,
  IReactiveSignal,
  IRuntime
} from '@migaia/reactive'
import {
  isFieldBuilder,
  isRaw,
  type IFieldBuilder,
  type IAsyncFieldBuilder,
  type ILegacyFieldBuilder,
  type IMutationPolicy,
  type IRaw
} from './store-protocol.js'
import {
  assertOwnedBy,
  claimOwnership,
  ownerOf,
  createFieldSource,
  internalRuntimeOf,
  type IObservable,
  type IObserver
} from '@migaia/reactive/extension'
import { createLifecycleScope, type ILifecycleScope } from '@migaia/lifecycle'
import {
  createStoreLightAggregateError,
  createStoreLightError,
  createStoreLightTypeError,
  StoreLightErrorCode
} from './errors.js'
import { StoreLightErrorText } from './error-text.js'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

/**
 * Re-throws the construction primary with the cleanup failure appended to its non-enumerable
 * `errors`. Primitive, frozen or hostile primaries fall back to a coded aggregate whose first entry
 * is the primary, so both failures stay reachable.
 */
function throwConstructionFailure(primary: unknown, cleanup: unknown): never {
  if (attachSecondaryErrors(primary, [cleanup]) === primary) throw primary
  throw createStoreLightAggregateError(
    StoreLightErrorCode.initAndCleanupFailed,
    [primary, cleanup],
    StoreLightErrorText.cleanupFailed
  )
}

/**
 * Reports synchronous-construction cleanup failures without creating a late rejection.
 * `Runtime.reportError` already contains reporter failures, so no host fallback is needed.
 */
function reportSynchronousCleanupFailure(runtime: IRuntime, error: unknown): void {
  runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
}

/** Rejects JavaScript-boundary API values before internal reactive machinery sees them. */
function assertStoreInput(value: unknown, name: string, expected: string): void {
  const valid =
    expected === 'function'
      ? typeof value === 'function'
      : value !== null && typeof value === 'object'
  if (!valid)
    throw createStoreLightTypeError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.inputType(name, expected)
    )
}
import { StoreFieldMode } from './field-mode-constants.js'
import { StoreInitializationStatus } from './resource-state-constants.js'
export { createStoreResource, createStoreResourceScope } from './store-resource.js'
export type {
  IStoreResource,
  IResourceCapture,
  IStoreResourceScope,
  IStoreResourceErrorPhase,
  IStoreResourceFactory,
  IStoreResourceConfig,
  IStoreResourceLoadContext,
  IStoreResourceOptions
} from './store-resource.js'

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
  [K in keyof S]-?: S[K] extends IFieldBuilder<IDisposable> ? K : never
}[keyof S]

export type IStoreShape<S> = {
  readonly [K in IBuilderKeys<S>]: S[K] extends IFieldBuilder<infer F> ? F : never
} & {
  [K in Exclude<keyof S, IBuilderKeys<S>>]: S[K] extends IRaw<infer T>
    ? T // `raw(fn)` becomes a regular function-valued field.
    : S[K] extends IFieldBuilder<infer F>
      ? F
      : S[K] extends (...args: infer A) => infer R
        ? (...args: A) => R
        : S[K]
}

type IIfEquals<X, Y, Then, Else = never> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? Then : Else

type IWritableKeys<S> = {
  [K in keyof S]-?: IIfEquals<Pick<S, K>, { -readonly [P in K]: S[P] }, K>
}[keyof S]

type ISettableKey<S> = {
  [K in IWritableKeys<S>]: S[K] extends IRaw<unknown>
    ? K
    : S[K] extends IFieldBuilder<infer _Field>
      ? never
      : S[K] extends (...args: never[]) => unknown
        ? never
        : K
}[IWritableKeys<S>]

export type IWritableStorePatch<S> = Partial<
  Pick<IStoreShape<S>, ISettableKey<S> & keyof IStoreShape<S>>
>

export type ISubscribeOptions = {
  // Defaults to `false`. When `true`, calls the listener once immediately after subscribing.
  fireImmediately?: boolean
}

export type IHydrateOptions = {
  /** Unknown keys are ignored by default for backwards-compatible partial hydration. */
  readonly unknown?: 'ignore' | 'report' | 'strict'
  readonly onUnknown?: (key: string) => void
}

// Runtime APIs use the `$` prefix and non-enumerable properties to avoid collisions with user fields.
export type IReactiveStoreApi<S> = {
  // Owns all nodes in this store. React adapters create effects in the same runtime to share the graph.
  // The interface exposes the capabilities callers need without requiring a concrete runtime class.
  $runtime: IRuntime
  // Reports whether the store has asynchronous fields, such as WASM fields.
  // A synchronous store is immediately ready and needs no Suspense barrier.
  // `createAsyncStore` and the provider handle asynchronous readiness at the creation boundary.
  $async: boolean
  $snapshot(): IStoreShape<S>
  $subscribe(fn: () => void, options?: ISubscribeOptions): IDisposer
  // Runs the entire `recipe` in one batch, so multiple writes produce one notification.
  // An exception does not roll back writes. This is batching rather than a transaction.
  // `draft` is the store itself. Plain field writes use signal setters; read-only computed writes throw.
  $batch(recipe: (draft: IStoreShape<S>) => void): void
  // Provides low-level batch assignment. Types accept only writable signal fields; runtime checks reject invalid dynamic input.
  $set(patch: IWritableStorePatch<S>): void
  // Returns signal-backed fields for persistence. Computed fields, WASM fields, and methods are excluded.
  $plain(): Record<string, unknown>
  // Hydrates known signal fields in one batch. Unknown, computed, and WASM keys are ignored by default.
  // `options.unknown` can report or reject unknown keys. Writes are not rolled back on failure.
  $hydrate(partial: Record<string, unknown>, options?: IHydrateOptions): void
  // Reports disposal. Public reads, writes, and actions throw after disposal instead of leaving partly usable state.
  readonly $disposed: boolean
  /**
   * Registers an external resource, such as a collection, with this store's ownership scope.
   *
   * A store can hold root UI state and actions while collections hold frequently accessed
   * structures. Sharing a runtime alone does not share disposal ownership; `$own` prevents those
   * structures from leaking when the root is disposed. The resource must be unowned or owned by
   * this `Runtime`. Cross-runtime resources are rejected.
   */
  $own<T extends IDisposable>(resource: T): T
  /**
   * Always asynchronous (`docs/lifecycle/migration.sdd.md` §5.1 — the underlying
   * `@migaia/lifecycle` `LifecycleScope.dispose()` has no synchronous form). Resolves once every
   * owned Signal/Computed/Effect/wasm field has finished releasing. Callers that need "started" is
   * enough (fire React `useEffect` cleanup, tear down a request scope) may call this without
   * awaiting; `$disposed` already flips to `true` synchronously before any owned resource is
   * touched, so read-path guards observe the disposed state immediately regardless of whether the
   * caller awaits.
   */
  $dispose(): Promise<void>
}

export type IReactiveStore<S> = IStoreShape<S> & IReactiveStoreApi<S>

/**
 * Provides fields, getters, methods, and `ThisType` for a store definition.
 *
 * Without `ThisType`, method `this` retains the input literal type, so a WASM field remains an
 * `IFieldBuilder`. `this.price.value` would then fail type checking and require external functions.
 * Here `this` is the resolved `IReactiveStore`, with builders replaced by their created fields.
 */
export type IStoreDefinition<S extends Record<string, unknown>> = S & ThisType<IReactiveStore<S>>

export type ICreateStoreOptions = {
  /**
   * Isolates the runtime explicitly. Defaults to `defaultRuntime`.
   *
   * The facade accepts `IRuntime` because it uses only interface capabilities such as node
   * creation, batching, and scopes. A concrete `Runtime` requirement would force replacement
   * runtimes to inherit the library class.
   */
  runtime?: IRuntime
  debugName?: string
  // Explicitly enables diagnostics. Defaults to `false`; the library does not infer build mode from `process` or `import.meta`.
  warnAsyncActions?: boolean
  /**
   * Optional MobX-style strict mutation policy. Direct field writes must run inside an
   * action/$batch/$set/$hydrate; Store methods are actions.
   */
  mutationPolicy?: IMutationPolicy
}

/** Shared Store construction engine. Public entry points adapt into this core. */
function createStoreCore<S extends Record<string, unknown>>(
  shape: IStoreDefinition<S>,
  options?: ICreateStoreOptions,
  /** Internal descriptor snapshot; prevents Proxy TOCTOU during strict creation. */
  _descriptors?: Record<string, PropertyDescriptor>
): IReactiveStore<S> {
  let runtime: IRuntime = defaultRuntime
  let warnAsyncActions = false
  let mutationPolicy: IMutationPolicy | undefined
  let debugName = 'Store'
  try {
    runtime = options?.runtime ?? defaultRuntime
    warnAsyncActions = options?.warnAsyncActions ?? false
    mutationPolicy = options?.mutationPolicy
    debugName = options?.debugName ?? 'Store'
  } catch (error) {
    throw createStoreLightError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.optionsObject,
      { cause: error }
    )
  }
  if (
    typeof debugName !== 'string' ||
    typeof warnAsyncActions !== 'boolean' ||
    (mutationPolicy !== undefined &&
      (mutationPolicy === null ||
        typeof mutationPolicy !== 'object' ||
        typeof mutationPolicy.assertMutationAllowed !== 'function' ||
        typeof mutationPolicy.runInAction !== 'function'))
  ) {
    throw createStoreLightError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.optionsInvalid
    )
  }
  const nodeRuntime = internalRuntimeOf(runtime)
  // Store 内部 Computed/Effect/wasm 字段的所有权作用域。混装纯 reactive 节点与 wasm 字段（真实外部
  // 资源），按 D-6 必须用异步 LifecycleScope，不能用 SyncLifecycleScope（migration.sdd.md §4.2）。
  const scope: ILifecycleScope = createLifecycleScope()
  const ownReactiveNode = <T extends IDisposable>(resource: T): T =>
    scope.own(resource, { syncSafe: true, force: () => resource.dispose() })
  const initAbort = new AbortController() // $dispose 时中止在途的异步字段初始化
  const store = {} as Record<string, unknown>
  const contextMembers = new Set<PropertyKey>()

  /** Store-owned writable nodes retain graph relationships for field subscription and disposal. */
  const signals = new Map<string, IReactiveSignal<unknown> & IObservable>()
  /** Derived fields retain observer operations while their public values remain read-only. */
  const computeds = new Map<string, IReactiveComputed<unknown> & IObservable & IObserver>()
  const wasmFields = new Map<string, unknown>()
  const fieldSources = new Set<ReturnType<typeof createFieldSource>>()
  const createTrackedFieldSource = (debugName?: string) => {
    const source = ownReactiveNode(createFieldSource(runtime, debugName))
    fieldSources.add(source)
    return source
  }
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
      claimOwnership(field, runtime)
    } catch (error) {
      try {
        field.dispose()
      } catch (cleanupError) {
        throwConstructionFailure(error, cleanupError)
      }
      throw error
    }
    try {
      // wasm 字段持有真实外部资源，不是纯 reactive 节点：syncSafe: false + gcFallback（§4.2）。
      scope.own(field, { syncSafe: false, gcFallback: true, force: () => field.dispose() })
    } catch (error) {
      try {
        field.dispose()
      } catch (cleanupError) {
        throwConstructionFailure(error, cleanupError)
      }
      throw error
    }
    return field
  }
  const readyList: Promise<void>[] = []
  let status: (typeof StoreInitializationStatus)[keyof typeof StoreInitializationStatus] =
    StoreInitializationStatus.pending
  let disposed = false
  /** Stable completion shared by every `$dispose()` caller, including after rejection. */
  let disposePromise: Promise<void> | undefined
  let initializationFailed = false

  function assertNotDisposed() {
    if (disposed)
      throw createStoreLightError(
        StoreLightErrorCode.storeDisposed,
        StoreLightErrorText.storeDisposed
      )
  }

  function assertMutationAllowed(operation: string) {
    mutationPolicy?.assertMutationAllowed(operation)
  }

  function runMutation<T>(fn: () => T): T {
    return mutationPolicy ? mutationPolicy.runInAction(() => runtime.batch(fn)) : runtime.batch(fn)
  }

  let descriptors: Record<string, PropertyDescriptor>
  try {
    if (_descriptors !== undefined) descriptors = _descriptors
    else {
      const descriptorSnapshot = snapshotOwnDescriptors(shape)
      if (!descriptorSnapshot.ok) throw descriptorSnapshot.error
      descriptors = descriptorSnapshot.descriptors as Record<string, PropertyDescriptor>
    }
  } catch (error) {
    disposed = true
    initAbort.abort()
    void scope
      .dispose()
      .catch((cleanupError: unknown) => reportSynchronousCleanupFailure(runtime, cleanupError))
    throw createStoreLightError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.shapeInvalid,
      { cause: error }
    )
  }
  try {
    for (const key of Object.keys(descriptors)) {
      const desc = descriptors[key]

      // get 访问器 → Computed。getter 里的 this 绑到 store，读到的都是响应式字段。
      if (typeof desc.get === 'function') {
        const getter = desc.get
        const contextKey = Symbol(key)
        Object.defineProperty(store, contextKey, { configurable: true, get: getter })
        contextMembers.add(contextKey)
        const node = ownReactiveNode(
          nodeRuntime.computed(() => (store as Record<PropertyKey, unknown>)[contextKey], {
            debugName: `${debugName}.${key}`
          })
        )
        computeds.set(key, node)
        Object.defineProperty(store, key, {
          enumerable: true,
          get: () => {
            assertNotDisposed() // 统一：释放后读任何字段都抛 'store is disposed'
            return node.value
          } // 派生值只读，不给 set
        })
        continue
      }

      const value = desc.value

      // raw(x) → 普通值字段（即使 x 是函数也不当 action）。必须在方法检查之前解包。
      if (isRaw(value)) {
        const node = ownReactiveNode(
          nodeRuntime.signal(value.value, {
            debugName: `${debugName}.${key}`
          })
        )
        signals.set(key, node)
        Object.defineProperty(store, key, {
          enumerable: true,
          get: () => {
            assertNotDisposed()
            return node.value
          },
          set: (v: unknown) => {
            assertNotDisposed()
            assertMutationAllowed(`set(${key})`)
            node.value = v
          }
        })
        continue
      }

      if (typeof value === 'function') {
        // 方法 → Action：只自动 batch 同步执行片段 + untracked。async 方法跨过首个 await 后已离开 batch；
        // 需要合并后续写入时，调用方应在续体里显式使用 $batch。
        const fn = value as (...args: unknown[]) => unknown
        const contextKey = Symbol(key)
        Object.defineProperty(store, contextKey, { configurable: true, value: fn })
        contextMembers.add(contextKey)
        let warnedAsync = false
        store[key] = (...args: unknown[]) => {
          assertNotDisposed()
          const actionName = `${debugName}.${key}`
          const result = runtime.runTracedAction(actionName, () =>
            runMutation(() =>
              runtime.untracked(() =>
                (store as Record<PropertyKey, (...values: unknown[]) => unknown>)[contextKey](
                  ...args
                )
              )
            )
          )
          if (warnAsyncActions && !warnedAsync && result !== null) {
            // 诊断必须不可观察：then 可能是会抛错的用户 getter，console 也可能被替换。
            try {
              const candidate = result as { then?: unknown }
              if (
                (typeof result === 'object' || typeof result === 'function') &&
                typeof candidate.then === 'function'
              ) {
                warnedAsync = true
                console.warn(StoreLightErrorText.asyncAction(key))
              }
            } catch {
              // 忽略所有诊断异常，保持 action 的 DEV/PROD 行为一致。
            }
          }
          return result
        }
        continue
      }

      if (isFieldBuilder(value)) {
        if ('mode' in value && value.mode === StoreFieldMode.sync) {
          const field = adoptField(
            value.create({
              runtime,
              signal: initAbort.signal,
              createSource: createTrackedFieldSource
            })
          )
          wasmFields.set(key, field)
          Object.defineProperty(store, key, {
            enumerable: true,
            get: () => {
              assertNotDisposed()
              return wasmFields.get(key)
            }
          })
          continue
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
                field.dispose()
                return
              }
              adoptField(field)
              wasmFields.set(key, field)
            })
            .catch((error: unknown) => {
              // A disposed or synchronously failed store no longer has a caller
              // waiting for this builder. Observe cancellation rejections here so
              // a late abort cannot become an unhandled rejection.
              if (disposed || initializationFailed || initAbort.signal.aborted) return
              throw error
            })
        )
        Object.defineProperty(store, key, {
          enumerable: true,
          get: () => {
            assertNotDisposed()
            assertReady()
            return wasmFields.get(key)
          }
        })
        continue
      }

      // 普通值 → Signal：读订阅、写触发。必须进 scope——否则 $dispose 只拆派生/订阅，
      // 源节点带着 version/subs 常驻，与「释放后不留半死图」的契约矛盾。
      const node = ownReactiveNode(
        nodeRuntime.signal(value, {
          debugName: `${debugName}.${key}`
        })
      )
      signals.set(key, node)
      Object.defineProperty(store, key, {
        enumerable: true,
        get: () => {
          assertNotDisposed()
          return node.value
        },
        set: (v: unknown) => {
          assertNotDisposed()
          assertMutationAllowed(`set(${key})`)
          node.value = v
        }
      })
    }
  } catch (error) {
    // A synchronous builder failure is terminal too: async builders that are still
    // resolving must see both guards before attempting to adopt their field.
    initializationFailed = true
    disposed = true
    status = StoreInitializationStatus.failed
    initAbort.abort()
    // `createStoreCore()` itself is synchronous (D-1 gives LifecycleScope no sync dispose()), so
    // this cleanup cannot be awaited here — it runs fire-and-forget and any failure goes through
    // `runtime.reportError()`, the same diagnostic channel used elsewhere in this module, instead
    // of being attached as `error.cause` (which required a *synchronous* cleanup failure).
    void scope
      .dispose()
      .catch((cleanupError: unknown) => reportSynchronousCleanupFailure(runtime, cleanupError))
    signals.clear()
    computeds.clear()
    wasmFields.clear()
    fieldSources.clear()
    for (const key of contextMembers) delete (store as Record<PropertyKey, unknown>)[key]
    contextMembers.clear()
    throw error
  }

  if (readyList.length === 0) status = StoreInitializationStatus.ready
  const ready = Promise.all(readyList).then(
    () => {
      status = StoreInitializationStatus.ready
    },
    async (error: unknown) => {
      status = StoreInitializationStatus.failed
      initializationFailed = true
      disposed = true
      initAbort.abort()
      // 初始化失败即回收已创建资源。清理错误不能替换原始初始化错误。这里已经在异步延续里，可以
      // 真正 await scope.dispose()（D-1：LifecycleScope 没有同步 dispose()），因此仍能像迁移前
      // 一样把 cleanup 失败原样附加到原始错误的 cause 上，不需要退化成 fire-and-forget。
      try {
        await scope.dispose()
      } catch (cleanupError) {
        // 保留原始初始化 Error 身份，同时附加清理失败用于诊断。
        if (error instanceof Error) {
          try {
            error.cause =
              error.cause === undefined
                ? cleanupError
                : createStoreLightAggregateError(
                    StoreLightErrorCode.initAndCleanupFailed,
                    [error.cause, cleanupError],
                    StoreLightErrorText.cleanupFailed
                  )
          } catch {
            // A frozen/non-configurable Error cannot carry cause; promote both values
            // into a tagged aggregate instead of silently losing cleanup diagnostics.
            throw createStoreLightAggregateError(
              StoreLightErrorCode.initAndCleanupFailed,
              [error, cleanupError],
              StoreLightErrorText.cleanupFailed
            )
          }
        } else {
          throw createStoreLightAggregateError(
            StoreLightErrorCode.initAndCleanupFailed,
            [error, cleanupError],
            StoreLightErrorText.cleanupFailed
          )
        }
      }
      throw error
    }
  )

  function assertReady() {
    if (status !== StoreInitializationStatus.ready)
      throw createStoreLightError(
        StoreLightErrorCode.storeNotReady,
        StoreLightErrorText.asyncStore(status)
      )
  }

  const api: IReactiveStoreApi<S> = {
    $runtime: runtime,
    $async: readyList.length > 0,
    $snapshot() {
      assertNotDisposed()
      // 异步字段未就绪时不能返回「缺字段的假完整对象」——先 assertReady，类型与运行时一致
      assertReady()
      return runtime.untracked(() => {
        const out = Object.create(null) as Record<string, unknown>
        for (const [k, n] of signals) out[k] = n.value
        for (const [k, n] of computeds) out[k] = n.value
        for (const [k, f] of wasmFields) out[k] = f
        return out
      }) as IStoreShape<S>
    },
    $subscribe(fn, options) {
      assertNotDisposed()
      assertStoreInput(fn, '$subscribe listener', 'function')
      let initialRun = true
      // The public subscription observes every store-owned reactive field. Reading Computed
      // nodes here is required for complete external-store semantics when a computed has no
      // direct source signal in this store.
      const e = ownReactiveNode(
        runtime.effect(
          () => {
            for (const n of signals.values()) void n.value
            for (const n of computeds.values()) void n.value
            for (const source of fieldSources) source.track()
            if (!initialRun || options?.fireImmediately === true) {
              try {
                const result = runtime.untracked(() => (fn as () => unknown)())
                if (result && typeof (result as { then?: unknown }).then === 'function') {
                  void Promise.resolve(result).catch((error: unknown) =>
                    runtime.reportError(error, { phase: ReactiveErrorPhase.subscriptionListener })
                  )
                }
              } catch (error) {
                runtime.reportError(error, { phase: ReactiveErrorPhase.subscriptionListener })
              }
            }
            initialRun = false
          },
          { debugName: `${debugName}.$subscribe` }
        )
      )
      // 单独退订同时从 scope 解除登记，避免反复订阅/退订造成 scope 滞留泄漏
      return () => {
        e.dispose()
        scope.release(e)
      }
    },
    $batch(recipe) {
      assertNotDisposed()
      assertStoreInput(recipe, '$batch recipe', 'function')
      // batch（非事务，不回滚）；draft = store 本身，写只读 computed 字段会自然抛错。
      runMutation(() => recipe(store as unknown as IStoreShape<S>))
    },
    $set(patch) {
      assertNotDisposed()
      assertStoreInput(patch, '$set patch', 'object')
      let entries: Array<readonly [string, unknown]>
      try {
        entries = Object.entries(patch)
      } catch (error) {
        throw createStoreLightError(
          StoreLightErrorCode.invalidOption,
          StoreLightErrorText.patchInvalid,
          { cause: error }
        )
      }
      runMutation(() => {
        const prepared = entries.map(([key, value]) => {
          const node = signals.get(key)
          if (!node)
            throw createStoreLightError(
              StoreLightErrorCode.invalidOption,
              StoreLightErrorText.fieldNotSettable(key)
            )
          return [node, value] as const
        })
        for (const [node, value] of prepared) node.value = value
      })
    },
    $plain() {
      assertNotDisposed()
      return runtime.untracked(() => {
        const out = Object.create(null) as Record<string, unknown>
        for (const [k, n] of signals) out[k] = n.value
        return out
      })
    },
    $hydrate(partial, options = {}) {
      assertNotDisposed()
      assertStoreInput(partial, '$hydrate partial', 'object')
      if (options === null || typeof options !== 'object')
        throw createStoreLightError(
          StoreLightErrorCode.invalidOption,
          StoreLightErrorText.optionsObject
        )
      const descriptorSnapshot = snapshotOwnDescriptors(options)
      if (!descriptorSnapshot.ok) {
        throw createStoreLightError(
          StoreLightErrorCode.invalidOption,
          StoreLightErrorText.optionsObject,
          { cause: descriptorSnapshot.error }
        )
      }
      /** Capture each public option once, preserving inherited accessors and their receiver. */
      let unknownPolicy: IHydrateOptions['unknown']
      /** Every unknown field uses the same callback observed at admission. */
      let onUnknown: IHydrateOptions['onUnknown']
      try {
        unknownPolicy = options.unknown
        onUnknown = options.onUnknown
      } catch (error) {
        throw createStoreLightError(
          StoreLightErrorCode.invalidOption,
          StoreLightErrorText.optionsObject,
          { cause: error }
        )
      }
      let entries: Array<[string, unknown]>
      try {
        entries = Object.entries(partial)
      } catch (error) {
        throw createStoreLightError(
          StoreLightErrorCode.invalidOption,
          StoreLightErrorText.patchInvalid,
          { cause: error }
        )
      }
      let firstUnknown: string | undefined
      if (unknownPolicy === 'strict' || unknownPolicy === 'report') {
        for (const [key] of entries) {
          if (signals.has(key)) continue
          if (unknownPolicy === 'strict') {
            firstUnknown = key
            break
          }
          if (onUnknown) Reflect.apply(onUnknown, options, [key])
        }
      }
      if (firstUnknown !== undefined) {
        throw createStoreLightError(
          StoreLightErrorCode.invalidOption,
          StoreLightErrorText.unknownHydrationField(firstUnknown)
        )
      }
      runMutation(() => {
        for (const [k, v] of entries) {
          const node = signals.get(k)
          if (node) node.value = v
        }
      })
    },
    get $disposed() {
      return disposed
    },
    $own(resource) {
      assertNotDisposed()
      assertOwnedBy(resource, runtime, 'resource')
      if (!ownerOf(resource)) claimOwnership(resource, runtime)
      // 外部资源（典型：collections），来源不明，保守按 syncSafe: false 处理（§4.2）。
      return scope.own(resource, { syncSafe: false, force: () => resource.dispose() })
    },
    $dispose() {
      disposePromise ??= (async () => {
        disposed = true
        initAbort.abort() // 中止在途异步字段初始化
        // scope 释放 Signal / Computed / $subscribe Effect / 已登记的 wasm 字段。总是异步
        // （D-1：LifecycleScope 没有同步 dispose()）；失败时按 scope 的错误策略（默认 'throw'）
        // 拒绝，与迁移前 scope.dispose() 同步抛错时 $dispose() 直接抛穿的行为一致，只是现在是
        // 一个 rejected Promise 而不是同步 throw。
        try {
          await scope.dispose()
        } finally {
          // 丢掉强引用，避免「已 dispose 仍被 store 地图钉住」的假性常驻
          signals.clear()
          computeds.clear()
          wasmFields.clear()
          fieldSources.clear()
          for (const key of contextMembers) delete (store as Record<PropertyKey, unknown>)[key]
          contextMembers.clear()
        }
      })()
      return disposePromise
    }
  }

  // $-API 挂成不可枚举，$snapshot 遍历用户字段时不会把它们也带出去。
  // 用 getOwnPropertyDescriptor 复制：保留 $disposed 这类 getter 的「实时」语义（不被求值成静态快照）。
  for (const k of Object.keys(api)) {
    const desc = Object.getOwnPropertyDescriptor(api, k)!
    Object.defineProperty(store, k, { ...desc, enumerable: false })
  }

  // 登记归属：Registry 与 SSR scope 据此校验，不再靠 $runtime 字段名
  claimOwnership(store, runtime)
  STORE_READY.set(store, ready)
  return store as IReactiveStore<S>
}

/** Compatibility facade for the historical Store definition API. */
export function createLegacyStore<S extends Record<string, unknown>>(
  shape: IStoreDefinition<S>,
  options?: ICreateStoreOptions
): IReactiveStore<S> {
  return createStoreCore(shape, options)
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
  const store = createStoreCore(shape, options)
  if (store.$async) await storeReady(store)
  return store
}

const STORE_READY = new WeakMap<object, Promise<void>>()

/** Internal readiness bridge; readiness is no longer a property on Store instances. */
/** Internal bridge retained for the React adapter and legacy migration tests. */
export function storeReady(store: object): Promise<void> {
  const ready = STORE_READY.get(store)
  if (!ready)
    throw createStoreLightError(
      StoreLightErrorCode.noAsyncInit,
      StoreLightErrorText.noAsyncInitialization
    )
  return ready
}

/**
 * Main synchronous creation contract. It rejects FieldBuilders before their create() method can
 * start I/O; use createAsyncStore for async definitions.
 */
export function createStore<S extends Record<string, unknown>>(
  shape: IStoreDefinition<S> & {
    [K in keyof S]: S[K] extends IAsyncFieldBuilder<IDisposable> | ILegacyFieldBuilder<IDisposable>
      ? never
      : S[K]
  },
  options?: ICreateStoreOptions
): IReactiveStore<S> {
  let descriptors: Record<string, PropertyDescriptor>
  try {
    const descriptorSnapshot = snapshotOwnDescriptors(shape)
    if (!descriptorSnapshot.ok) throw descriptorSnapshot.error
    descriptors = descriptorSnapshot.descriptors as Record<string, PropertyDescriptor>
  } catch (error) {
    throw createStoreLightError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.shapeInvalid,
      { cause: error }
    )
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      'value' in descriptor &&
      isFieldBuilder(descriptor.value) &&
      (!('mode' in descriptor.value) || descriptor.value.mode !== StoreFieldMode.sync)
    ) {
      throw createStoreLightError(
        StoreLightErrorCode.syncFieldRequired,
        StoreLightErrorText.syncStoreField(key)
      )
    }
  }
  const snapshot = Object.create(Object.getPrototypeOf(shape)) as S
  Object.defineProperties(snapshot, descriptors)
  return createStoreCore(snapshot as IStoreDefinition<S>, options, descriptors) as IReactiveStore<S>
}

/** Explicit naming alias for `createStore()`; no separate lifecycle semantics. */
export const createStoreSync = createStore
