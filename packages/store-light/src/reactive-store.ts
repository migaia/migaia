import { deferred } from '@migaia/utils/promise'
import { probeThenable, ThenableProbeKind } from '@migaia/utils/function'
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
  type IMutationPolicy,
  type IRaw
} from './store-protocol.ts'
import {
  getDefaultRuntime,
  ReactiveErrorPhase,
  assertOwnedBy,
  claimOwnership,
  ownerOf,
  createFieldSource,
  internalRuntimeOf,
  type IObservable,
  type IObserver
} from '@migaia/reactive/extension'
import {
  createAbortController,
  createLifecycleScope,
  type ILifecycleScope
} from '@migaia/lifecycle'
import {
  createStoreLightAggregateError,
  createStoreLightError,
  createStoreLightTypeError,
  StoreLightErrorCode
} from './errors.ts'
import { StoreLightErrorText } from './error-text.ts'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { snapshotOwnDescriptors } from '@migaia/utils/object'
import { identifyStoreLightFailure } from './error-boundary.ts'

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
 * Reports construction and late-field cleanup failures without creating a late rejection.
 * `Runtime.reportError` already contains reporter failures, so no host fallback is needed.
 */
function reportCleanupFailure(runtime: IRuntime, error: unknown): void {
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
import { StoreFieldMode } from './field-mode-constants.ts'
import { StoreInitializationStatus } from './resource-state-constants.ts'
export { createStoreResource, createStoreResourceScope } from './store-resource.ts'
export type {
  IStoreResource,
  IResourceCapture,
  IStoreResourceScope,
  IStoreResourceErrorPhase,
  IStoreResourceFactory,
  IStoreResourceConfig,
  IStoreResourceLoadContext,
  IStoreResourceOptions
} from './store-resource.ts'

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

/**
 * Public shape of a store built from definition `S`: builders become the fields they create,
 * `raw()` values become plain fields, methods keep their signatures and getters keep their value
 * types.
 */
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

/**
 * Partial patch accepted by `$set()`: only writable value fields, never getters, builders or
 * methods.
 */
export type IWritableStorePatch<S> = Partial<
  Pick<IStoreShape<S>, ISettableKey<S> & keyof IStoreShape<S>>
>

/** Options of `$subscribe()`. */
export type ISubscribeOptions = {
  // Defaults to `false`. When `true`, calls the listener once immediately after subscribing.
  fireImmediately?: boolean
}

/** Options of `$hydrate()`, read once per call before any field is written. */
export type IHydrateOptions = {
  /**
   * What to do with keys the store has no writable field for: `ignore` (default) skips them,
   * `report` calls `onUnknown` for each one, `strict` rejects the whole input before writing.
   */
  readonly unknown?: 'ignore' | 'report' | 'strict'
  /** Called once per skipped key when `unknown` is `report`. */
  readonly onUnknown?: (key: string) => void
}

// Runtime APIs use the `$` prefix and non-enumerable properties to avoid collisions with user fields.
/** The non-enumerable `$` methods and properties every store carries next to its fields. */
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
   * Always returns a Promise. Native reactive nodes release synchronously in LIFO segments;
   * external fields and owned resources drain through lifecycle. Resolves once every owned
   * Signal/Computed/Effect/wasm field has finished releasing. Callers that need "started" is enough
   * (fire React `useEffect` cleanup, tear down a request scope) may call this without awaiting;
   * `$disposed` already flips to `true` synchronously before any owned resource is touched, so
   * read-path guards observe the disposed state immediately regardless of whether the caller
   * awaits.
   */
  $dispose(): Promise<void>
}

/** A store: the resolved fields of definition `S` plus the `$` API. */
export type IReactiveStore<S> = IStoreShape<S> & IReactiveStoreApi<S>

/**
 * Provides fields, getters, methods, and `ThisType` for a store definition.
 *
 * Without `ThisType`, method `this` retains the input literal type, so a WASM field remains an
 * `IFieldBuilder`. `this.price.value` would then fail type checking and require external functions.
 * Here `this` is the resolved `IReactiveStore`, with builders replaced by their created fields.
 */
export type IStoreDefinition<S extends Record<string, unknown>> = S & ThisType<IReactiveStore<S>>

/** Options shared by `createStore()` and `createAsyncStore()`. */
export type ICreateStoreOptions = {
  /**
   * Isolates the runtime explicitly. Defaults to `defaultRuntime`.
   *
   * Pass a registered `createRuntime()` result from the owning reactive package instance. Runtime
   * branding and ownership are validated; an arbitrary structural `IRuntime` is not a SPI.
   */
  runtime?: IRuntime
  /** Prefix of internal node names in diagnostics (`${debugName}.${key}`); defaults to `'Store'`. */
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
  _descriptors?: Record<string, PropertyDescriptor>,
  /** Field builder modes already read once by a strict entry; reused instead of a second read. */
  _modes?: ReadonlyMap<string, unknown>
): IReactiveStore<S> {
  /** Store state and behavior; the returned plain store object forwards to it. */
  const core = new StoreCore<S>(readStoreOptions(options), _modes)
  core.defineFields(core.readDescriptors(shape, _descriptors))
  core.installApi()
  // 登记归属：Registry 与 SSR scope 据此校验，不再靠 $runtime 字段名
  claimOwnership(core.store, core.runtime)
  STORE_READY.set(core.store, core.ready)
  return core.store as IReactiveStore<S>
}

/** Validated store options. */
type IResolvedStoreOptions = Readonly<{
  runtime: IRuntime
  warnAsyncActions: boolean
  mutationPolicy: IMutationPolicy | undefined
  debugName: string
}>

/** Resolves an explicit owner first; cold imports and custom runtimes never request the default. */
function readStoreOptions(options: ICreateStoreOptions | undefined): IResolvedStoreOptions {
  /** Owning runtime. */
  let runtime: IRuntime
  /** Whether async actions are reported once. */
  let warnAsyncActions = false
  /** Optional action admission policy. */
  let mutationPolicy: IMutationPolicy | undefined
  /** Debug name prefix of every node. */
  let debugName = 'Store'
  try {
    runtime = options?.runtime ?? getDefaultRuntime()
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
  return { runtime, warnAsyncActions, mutationPolicy, debugName }
}

/** Native nodes contain their lifecycle callbacks and release synchronously in registration LIFO. */
function releasePureNodes(nodes: IDisposable[]): void {
  for (let index = nodes.length - 1; index >= 0; index--) nodes[index].dispose()
  nodes.length = 0
}

/** Per-action mutable state: whether the async-action warning was already reported. */
type IActionState = { warnedAsync: boolean }

/** Holder for one action invocation's return value, written inside the untracked step. */
type IActionResult = { value: unknown }

/** One `$subscribe` registration: its listener, options and first-run marker. */
type IStoreSubscription = {
  readonly fn: () => unknown
  readonly fireImmediately: boolean
  initialRun: boolean
}

/**
 * State and behavior behind one light store: field nodes, owned resources, initialization and the
 * `$`-API. The public store is a plain object whose properties forward here.
 */
class StoreCore<S extends Record<string, unknown>> {
  /** Owning runtime. */
  readonly runtime: IRuntime
  /** Internal node factory of the runtime. */
  readonly #nodeRuntime: ReturnType<typeof internalRuntimeOf>
  /** Whether async actions are reported once. */
  readonly #warnAsyncActions: boolean
  /** Optional action admission policy. */
  readonly #mutationPolicy: IMutationPolicy | undefined
  /** Debug name prefix of every node. */
  readonly #debugName: string
  /** Field builder modes already read once by a strict entry. */
  readonly #modes: ReadonlyMap<string, unknown> | undefined
  /** Generic release machinery exists only once a field, subscription or external owner needs it. */
  #scope: ILifecycleScope | undefined
  /** Consecutive native nodes share one synchronous release entry, preserving mixed-owner order. */
  #pureNodes: IDisposable[] = []
  /** Cancellation is required only by builders, never by plain reactive fields. */
  #initAbort: ReturnType<typeof createAbortController> | undefined
  /** Public store object. */
  readonly store = {} as Record<string, unknown>
  /** Symbol-keyed getter/action slots on the store, removed on dispose. */
  readonly #contextMembers = new Set<PropertyKey>()
  /** Store-owned writable nodes retain graph relationships for field subscription and disposal. */
  readonly #signals = new Map<string, IReactiveSignal<unknown> & IObservable>()
  /** Derived fields retain observer operations while their public values remain read-only. */
  readonly #computeds = new Map<string, IReactiveComputed<unknown> & IObservable & IObserver>()
  /** Builder-produced fields by key. */
  readonly #wasmFields = new Map<string, unknown>()
  /** Every field Source handed to builders. */
  readonly #fieldSources = new Set<ReturnType<typeof createFieldSource>>()
  /** Async builder completions. */
  readonly #readyList: Promise<void>[] = []
  /** Initialization status. */
  #status: (typeof StoreInitializationStatus)[keyof typeof StoreInitializationStatus] =
    StoreInitializationStatus.pending
  /** Set by dispose or a failed initialization. */
  #disposed = false
  /** Stable completion shared by every `$dispose()` caller, including after rejection. */
  #disposePromise: Promise<void> | undefined
  /** Set when initialization failed; late async fields are released instead of adopted. */
  #initializationFailed = false
  /** Readiness of every async field. */
  ready!: Promise<void>

  /** Binds the validated options. */
  constructor(options: IResolvedStoreOptions, modes: ReadonlyMap<string, unknown> | undefined) {
    this.runtime = options.runtime
    this.#nodeRuntime = internalRuntimeOf(options.runtime)
    this.#warnAsyncActions = options.warnAsyncActions
    this.#mutationPolicy = options.mutationPolicy
    this.#debugName = options.debugName
    this.#modes = modes
  }

  /** Fields acquire their scope before starting initialization so late registration stays closed. */
  #ensureScope(): ILifecycleScope {
    return (this.#scope ??= createLifecycleScope())
  }

  /** Seals the previous pure segment before a different kind of resource is registered. */
  #flushPureNodes(): void {
    if (this.#pureNodes.length === 0) return
    /** Segment being sealed. */
    const nodes = this.#pureNodes
    this.#ensureScope().own(nodes, { syncSafe: true, force: () => releasePureNodes(nodes) })
    this.#pureNodes = []
  }

  /** Only library-owned Signal/Computed nodes belong in a pure segment. */
  #ownPureNode<T extends IDisposable>(resource: T): T {
    this.#pureNodes.push(resource)
    return resource
  }

  /** Capabilities and subscriptions retain individually releasable canonical scope ownership. */
  #ownReactiveNode<T extends IDisposable>(resource: T): T {
    this.#flushPureNodes()
    return this.#ensureScope().own(resource, { syncSafe: true, force: () => resource.dispose() })
  }

  /** Pure stores release directly; mixed stores drain the original interleaved registration order. */
  #disposeOwned(): ReturnType<ILifecycleScope['dispose']> | Promise<void> {
    if (this.#scope === undefined) {
      releasePureNodes(this.#pureNodes)
      return Promise.resolve()
    }
    this.#flushPureNodes()
    return this.#scope.dispose()
  }

  /** The shared native signal belongs to this Store's one initialization generation. */
  #initSignal(): ReturnType<typeof createAbortController>['signal'] {
    return (this.#initAbort ??= createAbortController()).signal
  }

  /** Creates a field Source owned by the store and tracked for `$subscribe`. */
  readonly #createTrackedFieldSource = (debugName?: string) => {
    /** Store-owned Source. */
    const source = this.#ownReactiveNode(createFieldSource(this.runtime, debugName))
    this.#fieldSources.add(source)
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
  #adoptField<F extends IDisposable>(field: F): F {
    try {
      claimOwnership(field, this.runtime)
    } catch (error) {
      try {
        field.dispose()
      } catch (cleanupError) {
        throwConstructionFailure(error, cleanupError)
      }
      throw error
    }
    try {
      // wasm 字段持有真实外部资源，不是纯 reactive 节点：syncSafe: false + gcFallback。
      this.#flushPureNodes()
      this.#ensureScope().own(field, {
        syncSafe: false,
        gcFallback: true,
        force: () => field.dispose()
      })
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

  /** Throws STORE_DISPOSED after dispose. */
  #assertNotDisposed(): void {
    if (this.#disposed)
      throw createStoreLightError(
        StoreLightErrorCode.storeDisposed,
        StoreLightErrorText.storeDisposed
      )
  }

  /** Batches `fn`, inside an admitted action when a mutation policy exists. */
  #runMutation<T>(fn: () => T): T {
    return this.#mutationPolicy
      ? this.#mutationPolicy.runInAction(() => this.runtime.batch(fn))
      : this.runtime.batch(fn)
  }

  /** Clears every field map and removes the symbol slots from the store. */
  #clearFields(): void {
    this.#signals.clear()
    this.#computeds.clear()
    this.#wasmFields.clear()
    this.#fieldSources.clear()
    for (const key of this.#contextMembers) delete (this.store as Record<PropertyKey, unknown>)[key]
    this.#contextMembers.clear()
  }

  /** Snapshots the shape's own descriptors once; an unreadable shape is INVALID_OPTION. */
  readDescriptors(
    shape: IStoreDefinition<S>,
    descriptors: Record<string, PropertyDescriptor> | undefined
  ): Record<string, PropertyDescriptor> {
    try {
      if (descriptors !== undefined) return descriptors
      /** Own-descriptor snapshot of the shape. */
      const descriptorSnapshot = snapshotOwnDescriptors(shape)
      if (!descriptorSnapshot.ok) throw descriptorSnapshot.error
      return descriptorSnapshot.descriptors as Record<string, PropertyDescriptor>
    } catch (error) {
      this.#disposed = true
      this.#initAbort?.abort()
      void this.#disposeOwned().catch((cleanupError: unknown) =>
        reportCleanupFailure(this.runtime, cleanupError)
      )
      throw createStoreLightError(
        StoreLightErrorCode.invalidOption,
        StoreLightErrorText.shapeInvalid,
        { cause: error }
      )
    }
  }

  /** Roll back the same owned resources for every synchronous construction failure. */
  #failConstruction(error: unknown): never {
    // A synchronous builder failure is terminal too: async builders that are still resolving must
    // see both guards before attempting to adopt their field.
    this.#initializationFailed = true
    this.#disposed = true
    this.#status = StoreInitializationStatus.failed
    this.#initAbort?.abort()
    // `createStoreCore()` itself is synchronous (LifecycleScope has no sync dispose()), so this
    // cleanup cannot be awaited here — it runs fire-and-forget and any failure goes through
    // `runtime.reportError()`, the same diagnostic channel used elsewhere in this module, instead of
    // being attached as `error.cause` (which required a *synchronous* cleanup failure).
    void this.#disposeOwned().catch((cleanupError: unknown) =>
      reportCleanupFailure(this.runtime, cleanupError)
    )
    this.#clearFields()
    throw identifyStoreLightFailure(
      error,
      StoreLightErrorCode.initializationFailed,
      StoreLightErrorText.initializationFailed
    )
  }

  /** Defines every field of the shape, then starts readiness tracking. */
  defineFields(descriptors: Record<string, PropertyDescriptor>): void {
    this.#descriptors = descriptors
    try {
      for (const key of Object.keys(descriptors)) this.#defineField(key, descriptors[key]!)
    } catch (error) {
      this.#failConstruction(error)
    }
    if (this.#readyList.length === 0) this.#status = StoreInitializationStatus.ready
    this.ready = Promise.all(this.#readyList).then(
      () => {
        this.#status = StoreInitializationStatus.ready
      },
      (error: unknown) => this.#failInitialization(error)
    )
  }

  /** Shape descriptors, kept for the reserved-name check of the `$`-API. */
  #descriptors: Record<string, PropertyDescriptor> = {}

  /** Defines one field by kind: getter, raw value, action, field builder, or plain value. */
  #defineField(key: string, desc: PropertyDescriptor): void {
    // get 访问器 → Computed。getter 里的 this 绑到 store，读到的都是响应式字段。
    if (typeof desc.get === 'function') return this.#defineComputed(key, desc.get)
    /** Data value of the field. */
    const value = desc.value
    // raw(x) → 普通值字段（即使 x 是函数也不当 action）。必须在方法检查之前解包。
    if (isRaw(value)) return this.#defineSignal(key, value.value)
    if (typeof value === 'function')
      return this.#defineAction(key, value as (...args: unknown[]) => unknown)
    if (isFieldBuilder(value)) return this.#defineBuilderField(key, value)
    // 普通值 → Signal：读订阅、写触发。Store 的纯节点段在 dispose 时同步断开所有边。
    this.#defineSignal(key, value)
  }

  /** Getter field: a Computed over the getter called with the store as `this`. */
  #defineComputed(key: string, getter: () => unknown): void {
    /** Symbol slot holding the original getter on the store. */
    const contextKey = Symbol(key)
    Object.defineProperty(this.store, contextKey, { configurable: true, get: getter })
    this.#contextMembers.add(contextKey)
    /** Derived node. */
    const node = this.#ownPureNode(
      this.#nodeRuntime.computed(() => (this.store as Record<PropertyKey, unknown>)[contextKey], {
        debugName: `${this.#debugName}.${key}`
      })
    )
    this.#computeds.set(key, node)
    Object.defineProperty(this.store, key, {
      enumerable: true,
      // 统一：释放后读任何字段都抛 'store is disposed'；派生值只读，不给 set
      get: () => {
        this.#assertNotDisposed()
        return node.value
      }
    })
  }

  /** Plain or raw value field: a writable Signal. */
  #defineSignal(key: string, value: unknown): void {
    /** Source node. */
    const node = this.#ownPureNode(
      this.#nodeRuntime.signal(value, { debugName: `${this.#debugName}.${key}` })
    )
    this.#signals.set(key, node)
    Object.defineProperty(this.store, key, {
      enumerable: true,
      get: () => {
        this.#assertNotDisposed()
        return node.value
      },
      // Hot write path: checks read the fields directly, and the operation label is built only
      // when a mutation policy exists to receive it.
      set: (v: unknown) => {
        if (this.#disposed) this.#assertNotDisposed()
        /** Write admission policy, read once per write. */
        const policy = this.#mutationPolicy
        if (policy) policy.assertMutationAllowed(`set(${key})`)
        node.value = v
      }
    })
  }

  /**
   * 方法 → Action：只自动 batch 同步执行片段 + untracked。async 方法跨过首个 await 后已离开 batch；需要合并后续写入时，调用方应在续体里显式使用
   * $batch。
   */
  #defineAction(key: string, fn: (...args: unknown[]) => unknown): void {
    /** Symbol slot holding the original method, called with the store as `this`. */
    const contextKey = Symbol(key)
    Object.defineProperty(this.store, contextKey, { configurable: true, value: fn })
    this.#contextMembers.add(contextKey)
    /** Stable diagnostic identity belongs to the action definition, not each invocation. */
    const actionName = `${this.#debugName}.${key}`
    /** Per-action warning state. */
    const state: IActionState = { warnedAsync: false }
    Object.assign(this.store, {
      [key]: (...args: unknown[]) => this.#invokeAction(key, contextKey, actionName, state, args)
    })
  }

  /** Runs one action call traced, batched and untracked; warns once about an async result. */
  #invokeAction(
    key: string,
    contextKey: symbol,
    actionName: string,
    state: IActionState,
    args: unknown[]
  ): unknown {
    this.#assertNotDisposed()
    /** The Action owns its return value; synchronous mutation callbacks return void. */
    const result: IActionResult = { value: undefined }
    this.runtime.runTracedAction(actionName, () =>
      this.#runMutation(() => this.#untrackedAction(contextKey, args, result))
    )
    if (this.#warnAsyncActions && !state.warnedAsync)
      this.#warnAsyncAction(key, state, result.value)
    return result.value
  }

  /** Calls the original method untracked and records its return value. */
  #untrackedAction(contextKey: symbol, args: unknown[], result: IActionResult): void {
    this.runtime.untracked(() => {
      result.value = (this.store as Record<PropertyKey, (...values: unknown[]) => unknown>)[
        contextKey
      ](...args)
    })
  }

  /** Inspects the result once without consuming or replacing the action's returned thenable. */
  #warnAsyncAction(key: string, state: IActionState, result: unknown): void {
    /** Thenable probe of the result. */
    const probe = probeThenable(result)
    if (probe.kind === ThenableProbeKind.failed)
      this.runtime.reportError(probe.error, { phase: ReactiveErrorPhase.asyncFlush })
    else if (probe.kind === ThenableProbeKind.thenable) {
      state.warnedAsync = true
      this.runtime.reportError(
        createStoreLightError(
          StoreLightErrorCode.actionBatchBoundary,
          StoreLightErrorText.asyncAction(key)
        ),
        { phase: ReactiveErrorPhase.asyncFlush }
      )
    }
  }

  /** Field builder: sync builders create now; async ones are tracked by readiness. */
  #defineBuilderField(key: string, builder: IFieldBuilder<IDisposable>): void {
    this.#ensureScope()
    /** Capture before later siblings can fail and abort this generation. */
    const signal = this.#initSignal()
    /** Capture the public discriminant once; pre-discriminant builders are no longer supported. */
    const mode = this.#modes?.has(key) ? this.#modes.get(key) : builder.mode
    if (mode !== StoreFieldMode.sync && mode !== StoreFieldMode.async)
      throw createStoreLightTypeError(
        StoreLightErrorCode.invalidOption,
        StoreLightErrorText.fieldBuilderMode
      )
    if (mode === StoreFieldMode.sync) {
      // `mode` came from the strict entry's single read; this branch is the sync builder.
      /** Adopted sync field. */
      const field = this.#adoptField(
        builder.create({
          runtime: this.runtime,
          signal,
          createSource: this.#createTrackedFieldSource
        }) as IDisposable
      )
      this.#wasmFields.set(key, field)
      Object.defineProperty(this.store, key, {
        enumerable: true,
        get: () => {
          this.#assertNotDisposed()
          return this.#wasmFields.get(key)
        }
      })
      return
    }
    // 异步字段（wasm 等）：Store 负责所有权登记（不让 Builder 自己 own）。传 AbortSignal，$dispose 可中止初始化。
    // 若在初始化完成前 store 已 dispose，立即释放刚创建的字段，避免泄漏。Store owns every capability it signs, not
    // only the final Field object, so a rejected builder or a third-party Field that forgets to
    // dispose its source cannot leak graph edges.
    this.#readyList.push(
      Promise.resolve()
        .then(() =>
          builder.create({
            runtime: this.runtime,
            signal,
            createSource: this.#createTrackedFieldSource
          })
        )
        .then((field) => this.#settleAsyncField(key, field as IDisposable))
        .catch((error: unknown) => this.#observeAsyncFieldFailure(error))
    )
    Object.defineProperty(this.store, key, {
      enumerable: true,
      get: () => {
        this.#assertNotDisposed()
        this.#assertReady()
        return this.#wasmFields.get(key)
      }
    })
  }

  /** Adopts a resolved async field, or releases it when the store already ended. */
  #settleAsyncField(key: string, field: IDisposable): Promise<void> | void {
    if (this.#disposed || this.#initializationFailed) {
      try {
        return Promise.resolve(field.dispose()).catch(this.#reportLateDisposeFailure)
      } catch (error) {
        this.#reportLateDisposeFailure(error)
        return
      }
    }
    this.#adoptField(field)
    this.#wasmFields.set(key, field)
  }

  /** Late cleanup has no awaiting factory caller, so its Runtime owns diagnostics. */
  readonly #reportLateDisposeFailure = (error: unknown): void =>
    reportCleanupFailure(
      this.runtime,
      identifyStoreLightFailure(
        error,
        StoreLightErrorCode.fieldDisposeFailed,
        StoreLightErrorText.fieldDisposeFailed
      )
    )

  /**
   * A disposed or synchronously failed store no longer has a caller waiting for this builder.
   * Observe cancellation rejections here so a late abort cannot become an unhandled rejection.
   */
  #observeAsyncFieldFailure(error: unknown): void {
    if (this.#disposed || this.#initializationFailed || this.#initAbort?.signal.aborted) return
    throw error
  }

  /**
   * 初始化失败即回收已创建资源。清理错误不能替换原始初始化错误。这里已经在异步延续里，可以真正 await disposeOwned()（LifecycleScope 没有同步
   * dispose()），因此仍能像迁移前一样把 cleanup 失败原样附加到原始错误的 cause 上，不需要退化成 fire-and-forget。
   */
  async #failInitialization(error: unknown): Promise<never> {
    this.#status = StoreInitializationStatus.failed
    this.#initializationFailed = true
    this.#disposed = true
    this.#initAbort?.abort()
    try {
      await this.#disposeOwned()
    } catch (cleanupError) {
      attachInitializationCleanupFailure(error, cleanupError)
    }
    throw identifyStoreLightFailure(
      error,
      StoreLightErrorCode.initializationFailed,
      StoreLightErrorText.initializationFailed
    )
  }

  /** Throws STORE_NOT_READY until every async field is ready. */
  #assertReady(): void {
    if (this.#status !== StoreInitializationStatus.ready)
      throw createStoreLightError(
        StoreLightErrorCode.storeNotReady,
        StoreLightErrorText.asyncStore(this.#status)
      )
  }

  /**
   * Installs the `$`-API as non-enumerable properties, so `$snapshot` never lists them. Copying
   * descriptors keeps `$disposed` a live getter rather than a static snapshot.
   */
  installApi(): void {
    /** `$`-API descriptors in their public order. */
    const api: Array<readonly [string, PropertyDescriptor]> = [
      ['$runtime', apiValue(this.runtime)],
      ['$async', apiValue(this.#readyList.length > 0)],
      ['$snapshot', apiValue(() => this.#snapshot())],
      [
        '$subscribe',
        apiValue((fn: () => unknown, options?: { fireImmediately?: boolean }) =>
          this.#subscribe(fn, options)
        )
      ],
      ['$batch', apiValue((recipe: (draft: IStoreShape<S>) => void) => this.#batch(recipe))],
      ['$set', apiValue((patch: Record<string, unknown>) => this.#set(patch))],
      ['$plain', apiValue(() => this.#plain())],
      [
        '$hydrate',
        apiValue((partial: Record<string, unknown>, options?: IHydrateOptions) =>
          this.#hydrate(partial, options)
        )
      ],
      ['$disposed', { configurable: true, enumerable: true, get: () => this.#disposed }],
      ['$own', apiValue((resource: IDisposable) => this.#own(resource))],
      ['$dispose', apiValue(() => this.#dispose())]
    ]
    try {
      for (const [k, desc] of api) {
        if (Object.hasOwn(this.#descriptors, k))
          throw createStoreLightTypeError(
            StoreLightErrorCode.invalidOption,
            StoreLightErrorText.reservedField(k)
          )
        Object.defineProperty(this.store, k, { ...desc, enumerable: false })
      }
    } catch (error) {
      this.#failConstruction(error)
    }
  }

  /** `$snapshot`: every field value, after readiness. */
  #snapshot(): IStoreShape<S> {
    this.#assertNotDisposed()
    // 异步字段未就绪时不能返回「缺字段的假完整对象」——先 assertReady，类型与运行时一致
    this.#assertReady()
    return this.runtime.untracked(() => this.#collectSnapshot()) as IStoreShape<S>
  }

  /** Reads every signal, computed and builder field into a null-prototype record. */
  #collectSnapshot(): Record<string, unknown> {
    /** Snapshot record. */
    const out = Object.create(null) as Record<string, unknown>
    for (const [k, n] of this.#signals) out[k] = n.value
    for (const [k, n] of this.#computeds) out[k] = n.value
    for (const [k, f] of this.#wasmFields) out[k] = f
    return out
  }

  /**
   * `$subscribe`. The public subscription observes every store-owned reactive field. Reading
   * Computed nodes here is required for complete external-store semantics when a computed has no
   * direct source signal in this store.
   */
  #subscribe(fn: () => unknown, options?: { fireImmediately?: boolean }): () => void {
    this.#assertNotDisposed()
    assertStoreInput(fn, '$subscribe listener', 'function')
    /** This subscription's run state. */
    const subscription: IStoreSubscription = {
      fn,
      fireImmediately: options?.fireImmediately === true,
      initialRun: true
    }
    /** Store-owned effect tracking every field. */
    const e = this.#ownReactiveNode(
      this.runtime.effect(() => this.#runSubscription(subscription), {
        debugName: `${this.#debugName}.$subscribe`
      })
    )
    // 单独退订同时从 scope 解除登记，避免反复订阅/退订造成 scope 滞留泄漏
    return () => this.#unsubscribe(e)
  }

  /** Effect body: track every field; call the listener after the first run (or immediately). */
  #runSubscription(subscription: IStoreSubscription): void {
    for (const n of this.#signals.values()) void n.value
    for (const n of this.#computeds.values()) void n.value
    for (const source of this.#fieldSources) source.track()
    if (!subscription.initialRun || subscription.fireImmediately) this.#notify(subscription.fn)
    subscription.initialRun = false
  }

  /** Calls one listener untracked; sync throws and async rejections are reported. */
  #notify(fn: () => unknown): void {
    try {
      /** Listener result. */
      const result = this.runtime.untracked(() => fn())
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch((error: unknown) =>
          this.runtime.reportError(error, { phase: ReactiveErrorPhase.subscriptionListener })
        )
      }
    } catch (error) {
      this.runtime.reportError(error, { phase: ReactiveErrorPhase.subscriptionListener })
    }
  }

  /** Disposes one subscription effect and drops it from the scope. */
  #unsubscribe(effect: IDisposable): void {
    effect.dispose()
    this.#scope!.release(effect)
  }

  /** `$batch`: batch（非事务，不回滚）；draft = store 本身，写只读 computed 字段会自然抛错。 */
  #batch(recipe: (draft: IStoreShape<S>) => void): void {
    this.#assertNotDisposed()
    assertStoreInput(recipe, '$batch recipe', 'function')
    this.#runMutation(() => recipe(this.store as unknown as IStoreShape<S>))
  }

  /** `$set`: writes known signal fields in one batch; an unknown key fails before any write. */
  #set(patch: Record<string, unknown>): void {
    this.#assertNotDisposed()
    assertStoreInput(patch, '$set patch', 'object')
    /** Patch entries, read once. */
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
    this.#runMutation(() => this.#applyPatch(entries))
  }

  /** Resolves every patch node first, then writes. */
  #applyPatch(entries: ReadonlyArray<readonly [string, unknown]>): void {
    /** Target nodes paired with their values. */
    const prepared: Array<readonly [IReactiveSignal<unknown> & IObservable, unknown]> = []
    for (const [key, value] of entries) {
      /** Signal of this key. */
      const node = this.#signals.get(key)
      if (!node)
        throw createStoreLightError(
          StoreLightErrorCode.invalidOption,
          StoreLightErrorText.fieldNotSettable(key)
        )
      prepared.push([node, value])
    }
    for (const [node, value] of prepared) node.value = value
  }

  /** `$plain`: signal fields only. */
  #plain(): Record<string, unknown> {
    this.#assertNotDisposed()
    return this.runtime.untracked(() => this.#collectPlain())
  }

  /** Reads every signal field into a null-prototype record. */
  #collectPlain(): Record<string, unknown> {
    /** Plain record. */
    const out = Object.create(null) as Record<string, unknown>
    for (const [k, n] of this.#signals) out[k] = n.value
    return out
  }

  /** `$hydrate`: writes known signal fields; unknown keys follow the `unknown` policy. */
  #hydrate(partial: Record<string, unknown>, options: IHydrateOptions = {}): void {
    this.#assertNotDisposed()
    assertStoreInput(partial, '$hydrate partial', 'object')
    /** Unknown-field policy and callback, each read once. */
    const { unknownPolicy, onUnknown } = readHydrateOptions(options)
    /** Partial entries, read once. */
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
    /** First unknown key under the strict policy. */
    let firstUnknown: string | undefined
    if (unknownPolicy === 'strict' || unknownPolicy === 'report') {
      for (const [key] of entries) {
        if (this.#signals.has(key)) continue
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
    this.#runMutation(() => this.#applyHydration(entries))
  }

  /** Writes every known signal field of the hydration entries. */
  #applyHydration(entries: ReadonlyArray<readonly [string, unknown]>): void {
    for (const [k, v] of entries) {
      /** Signal of this key, if any. */
      const node = this.#signals.get(k)
      if (node) node.value = v
    }
  }

  /** `$own`: 外部资源（典型：collections），来源不明，保守按 syncSafe: false 处理。 */
  #own<R extends IDisposable>(resource: R): R {
    this.#assertNotDisposed()
    assertOwnedBy(resource, this.runtime, 'resource')
    if (!ownerOf(resource)) claimOwnership(resource, this.runtime)
    this.#flushPureNodes()
    return this.#ensureScope().own(resource, { syncSafe: false, force: () => resource.dispose() })
  }

  /** `$dispose`: one stable completion shared by every caller. */
  #dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    /** Publish completion before abort listeners or owned disposers can synchronously reenter. */
    const completion = deferred<void>()
    this.#disposePromise = completion.promise
    void this.#disposeNow().then(() => completion.resolve(), completion.reject)
    return this.#disposePromise
  }

  /** Marks disposed, aborts in-flight builders, releases resources and drops field references. */
  async #disposeNow(): Promise<void> {
    this.#disposed = true
    this.#initAbort?.abort() // 中止在途异步字段初始化
    // Pure nodes release synchronously; mixed entries retain canonical scope ordering and failure
    // policy. The public completion remains one stable Promise in both cases.
    try {
      await this.#disposeOwned()
    } finally {
      // 丢掉强引用，避免「已 dispose 仍被 store 地图钉住」的假性常驻
      this.#clearFields()
    }
  }
}

/** Data descriptor of one `$`-API member, as an object-literal method would have. */
function apiValue(value: unknown): PropertyDescriptor {
  return { configurable: true, enumerable: true, writable: true, value }
}

/**
 * Attaches a cleanup failure to the original initialization error without replacing it: as its
 * `cause` (aggregated with an existing cause), or — when the error cannot carry one — by throwing a
 * tagged aggregate of both.
 */
function attachInitializationCleanupFailure(error: unknown, cleanupError: unknown): void {
  if (!(error instanceof Error)) {
    throw createStoreLightAggregateError(
      StoreLightErrorCode.initAndCleanupFailed,
      [error, cleanupError],
      StoreLightErrorText.cleanupFailed
    )
  }
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
    // A frozen/non-configurable Error cannot carry cause; promote both values into a tagged
    // aggregate instead of silently losing cleanup diagnostics.
    throw createStoreLightAggregateError(
      StoreLightErrorCode.initAndCleanupFailed,
      [error, cleanupError],
      StoreLightErrorText.cleanupFailed
    )
  }
}

/** Reads `$hydrate` options once, preserving inherited accessors and their receiver. */
function readHydrateOptions(options: IHydrateOptions): {
  unknownPolicy: IHydrateOptions['unknown']
  onUnknown: IHydrateOptions['onUnknown']
} {
  if (options === null || typeof options !== 'object')
    throw createStoreLightError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.optionsObject
    )
  /** Own-descriptor snapshot proving the options object is readable. */
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStoreLightError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.optionsObject,
      { cause: descriptorSnapshot.error }
    )
  }
  try {
    // Every unknown field uses the same callback observed at admission.
    return { unknownPolicy: options.unknown, onUnknown: options.onUnknown }
  } catch (error) {
    throw createStoreLightError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.optionsObject,
      { cause: error }
    )
  }
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

/** Returns the registered initialization Promise for Store adapters such as React. */
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
 * Creates a store from a plain object: values become reactive fields, getters derived values and
 * methods actions that publish their writes once when they return. Rejects async FieldBuilders
 * before their create() method can start I/O; use createAsyncStore for async definitions. Invalid
 * definitions throw `INVALID_OPTION` or `SYNC_FIELD_REQUIRED` after rolling back created nodes.
 */
export function createStore<S extends Record<string, unknown>>(
  shape: IStoreDefinition<S> & {
    [K in keyof S]: S[K] extends IAsyncFieldBuilder<IDisposable> ? never : S[K]
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
  /** Each builder's mode, read exactly once here and reused by store construction. */
  const modes = new Map<string, unknown>()
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor) || !isFieldBuilder(descriptor.value)) continue
    /** One read of the builder's mode; a throwing getter is a shape error with the cause. */
    let mode: unknown
    try {
      mode = descriptor.value.mode
    } catch (error) {
      throw createStoreLightError(
        StoreLightErrorCode.invalidOption,
        StoreLightErrorText.shapeInvalid,
        {
          cause: error
        }
      )
    }
    if (mode !== StoreFieldMode.sync)
      throw createStoreLightError(
        StoreLightErrorCode.syncFieldRequired,
        StoreLightErrorText.syncStoreField(key)
      )
    modes.set(key, mode)
  }
  const snapshot = Object.create(Object.getPrototypeOf(shape)) as S
  Object.defineProperties(snapshot, descriptors)
  return createStoreCore(
    snapshot as IStoreDefinition<S>,
    options,
    descriptors,
    modes
  ) as IReactiveStore<S>
}
