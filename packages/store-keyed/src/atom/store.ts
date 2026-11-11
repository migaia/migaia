import { runAtomCallback, toAtomCallbackFailure } from './callback-failure.ts'
import {
  ReactiveErrorPhase,
  type IReactiveComputed,
  type IDisposer,
  type IRuntime,
  type IReactiveSignal
} from '@migaia/reactive'
import {
  claimOwnership,
  createBatchedOperation,
  createStaticObserver,
  type IStaticSubscriptionSource,
  deferRuntimeCleanup,
  invalidateObservable,
  currentRuntimeVersion,
  internalRuntimeOf,
  type IObservable
} from '@migaia/reactive/extension'
import { createSyncLifecycleScope, type ISyncLifecycleScope } from '@migaia/lifecycle'
import {
  createStoreKeyedAggregateError,
  createStoreKeyedError,
  createStoreKeyedTypeError,
  StoreKeyedErrorCode
} from '../errors.ts'
import { StoreKeyedErrorText } from '../error-text.ts'
import {
  assertNotThenable,
  isAtomDefinition,
  type IAtomDefinition,
  type IAtomGet,
  type IAtomSet,
  type IAtomUpdate,
  type IDerivedDefinition,
  type IPrimitiveDefinition,
  type IPrimitiveFactoryDefinition,
  type IWritableAtomDefinition,
  type IWritableDerivedDefinition
} from './definition.ts'
import { AtomKind } from './kind-constants.ts'

/** Routes atom lifecycle failures to the Runtime reporter, which already contains reporter failures. */
function reportAtomFailure(
  runtime: IRuntime,
  error: unknown,
  phase: Parameters<IRuntime['reportError']>[1]['phase']
): void {
  runtime.reportError(error, { phase })
}

/**
 * 实例化层：把纯定义落到某个 Runtime 上。
 *
 * 定义只说「这是什么」，这里回答「在我这里它是什么值」。**怎么建节点是这一层的 私事**——所以对外不暴露节点本身，只给读、写、订阅三件事。
 *
 * 之前的实现把 `nodeOf` 挂在公共面上，于是 React 适配层直接拿着 Signal 去订阅， 实例化策略从此不能改（换成惰性、换成远端、换成共享内存都会破坏调用方）。
 */

type IInstance<T> = {
  readonly node: IReactiveSignal<T> | IReactiveComputed<T>
  readonly disposed: boolean
  read(): T
  peek(): T
  dispose(): void
}

type IOverrideLayer = {
  readonly replacement: IAtomDefinition<unknown>
}

type IPreview = {
  readonly version: number
  readonly value: unknown
}

/**
 * Primitive definitions are reusable across Provider/SSR scopes. Clone mutable container templates
 * so one scope cannot mutate another scope's initial value.
 */
function cloneInitial<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (typeof structuredClone !== 'function')
    throw createStoreKeyedError(
      StoreKeyedErrorCode.envUnsupported,
      StoreKeyedErrorText.primitiveClone
    )
  try {
    return structuredClone(value)
  } catch (error) {
    // A partial fallback would silently change prototypes and alias functions.
    // Fail closed so the cross-scope clone guarantee remains truthful.
    throw createStoreKeyedError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.primitiveCloneFailed,
      { cause: error }
    )
  }
}

/**
 * A scope that keeps one value per definition: read with `get`/`peek`/`preview`, write with `set`,
 * subscribe with `sub`, replace definitions with `override`, and release with `release`/`dispose`.
 */
export type IAtomStore = {
  readonly runtime: IRuntime
  readonly disposed: boolean
  get<T>(definition: IAtomDefinition<T>): T
  /**
   * Reads without tracking, so an adapter snapshot does not create edges in another dependency
   * capture.
   */
  peek<T>(definition: IAtomDefinition<T>): T
  /** React/concurrent speculative read; value may be discarded after the turn. */
  preview<T>(definition: IAtomDefinition<T>): T
  /**
   * Writes a source definition with a new value or an updater of the previous value. Listed before
   * the general overload so the updater's `previous` parameter is typed from the definition.
   */
  set<T>(
    definition: IPrimitiveDefinition<T> | IPrimitiveFactoryDefinition<T>,
    update: IAtomUpdate<T>
  ): void
  /** Writes any writable definition; a writable derived one returns its `write` result. */
  set<T, Args extends readonly unknown[], Result>(
    definition: IWritableAtomDefinition<T, Args, Result>,
    ...args: Args
  ): Result
  /**
   * Writes source definitions within one batch and one untracked operation; subscribers are
   * notified once after the batch. The call first resolves every entry and runs every updater in
   * input order, then writes. An entry that resolves to a non-source definition (OVERRIDE_CONTRACT)
   * or an updater that throws leaves every atom unchanged. A repeated definition's updater receives
   * the value from its previous entry; updaters reading other atoms see the values from before the
   * call.
   *
   * Each entry keeps its own value type: `Ts` is inferred from the definitions only, so entries of
   * different types can share one call and each updater is checked against its own definition.
   */
  setMany<Ts extends readonly unknown[]>(entries: {
    readonly [K in keyof Ts]: readonly [
      IPrimitiveDefinition<Ts[K]> | IPrimitiveFactoryDefinition<Ts[K]>,
      IAtomUpdate<NoInfer<Ts[K]>>
    ]
  }): void
  /**
   * Subscribes to a definition and returns an unsubscribe function.
   *
   * Adapters subscribe through this boundary instead of accessing graph nodes, leaving
   * instantiation strategies independent.
   */
  sub<T>(definition: IAtomDefinition<T>, onChange: () => void): IDisposer
  /** Routes a read-only derived definition to any definition with the same value type. */
  override<T>(
    definition: IDerivedDefinition<T>,
    replacement: IAtomDefinition<NoInfer<T>>
  ): IDisposer
  /** Replaces a primitive only with a definition that preserves standard `set(update)` semantics. */
  override<T>(
    definition: IPrimitiveDefinition<T> | IPrimitiveFactoryDefinition<T>,
    replacement: IPrimitiveDefinition<NoInfer<T>> | IPrimitiveFactoryDefinition<NoInfer<T>>
  ): IDisposer
  /** Preserves the exact `Args` and `Result` contract of a writable derived definition. */
  override<T, Args extends readonly unknown[], Result>(
    definition: IWritableDerivedDefinition<T, Args, Result>,
    replacement: IWritableDerivedDefinition<NoInfer<T>, NoInfer<Args>, NoInfer<Result>>
  ): IDisposer
  /** Reports whether this store has observers for the definition without exposing its graph node. */
  isObserved<T>(definition: IAtomDefinition<T>): boolean
  /**
   * Releases the instance for one definition.
   *
   * Unlike disposing the whole store, disposal of a legacy atom instance releases only its own
   * definition. Other definitions in the same store remain intact.
   */
  release<T>(definition: IAtomDefinition<T>): boolean
  /** Reports the number of instantiated definitions so release behavior is observable. */
  readonly size: number
  dispose(): void
}

/**
 * Creates a new, independent store on `runtime`. Each call gives separate values for the same
 * definitions; dispose it to release every node it created.
 */
export function createAtomStore(runtime: IRuntime): IAtomStore {
  /** Store state and behavior; members are arrow fields so the store stays destructurable. */
  const store = new AtomStore(runtime)
  claimOwnership(store, runtime)
  return store
}

/** Undo record of one override layer; the returned disposer removes only this layer. */
type IOverrideRecord = {
  readonly definition: IAtomDefinition<unknown>
  readonly layer: IOverrideLayer
  active: boolean
}

/**
 * One independent atom store on a runtime: instances, override routing, speculative previews and
 * subscriptions. Members are arrow fields so a store stays destructurable.
 */
class AtomStore implements IAtomStore {
  /** Runtime that owns every node this store creates. */
  readonly runtime: IRuntime
  /**
   * 实例表用 Map 而不是 WeakMap，且这里必须说实话：
   *
   * 释放实例需要遍历它们（断开依赖边、dispose Computed），而 WeakMap 不可遍历。之前的注释宣称「定义不再被引用时实例可回收」，但同时又用一个数组强引着全部
   * 实例——两者矛盾，实际一个都回收不了。
   *
   * 所以改成诚实的做法：**store 强引它建出来的实例，随 store.dispose() 一起释放**。生命周期的单位是 store，不是单个定义。要提前释放某个键，调用
   * store.release(definition)；family.forget 仅管理 token 缓存。
   */
  readonly #instances = new Map<IAtomDefinition<unknown>, IInstance<unknown>>()
  /**
   * Instance ownership is orthogonal to atom routing: releasing a definition removes only that
   * instance, while store disposal drains the scope in LIFO. Every owned instance wraps a pure
   * reactive node (Signal/Computed) — never wasm/I/O — so this can stay the synchronous scope and
   * `IAtomStore.dispose()` keeps its sync contract.
   */
  readonly #instanceScope: ISyncLifecycleScope = createSyncLifecycleScope()
  /** Internal node factory of the runtime. */
  readonly #nodeRuntime: ReturnType<typeof internalRuntimeOf>
  /** Override layers per definition; the last layer wins. */
  readonly #overrides = new Map<IAtomDefinition<unknown>, IOverrideLayer[]>()
  /** Active subscription disposers, released on store dispose. */
  readonly #subscriptions = new Set<IDisposer>()
  /**
   * Speculative React snapshots for definitions that have not been committed. These values are
   * versioned and do not create graph nodes or ownership edges.
   */
  readonly #previews = new Map<IAtomDefinition<unknown>, IPreview>()
  /** Definitions currently being previewed, for cycle detection. */
  readonly #previewStack = new Set<IAtomDefinition<unknown>>()
  /** Set by dispose. */
  #disposed = false
  /** True inside `preview`; peeks made then are reclaimed if never committed. */
  #previewing = false
  /** Bulk primitive update in one batch. */
  readonly setMany: IAtomStore['setMany']

  /** Binds the runtime and its node factory. */
  constructor(runtime: IRuntime) {
    this.runtime = runtime
    this.#nodeRuntime = internalRuntimeOf(runtime)
    this.setMany = createBatchedOperation(runtime, (entries) =>
      this.#setManyNow(entries as never)
    ) as IAtomStore['setMany']
  }

  /** Whether the store was disposed. */
  get disposed(): boolean {
    return this.#disposed
  }

  /** Number of instantiated definitions. */
  get size(): number {
    return this.#instances.size
  }

  /**
   * A render can be abandoned without ever committing a subscription. Keep the preview only through
   * the current commit turn, then drop both the definition and its value so a long-lived Provider
   * cannot retain a speculative object forever.
   */
  #schedulePreviewCleanup(key: IAtomDefinition<unknown>, version: number): void {
    deferRuntimeCleanup(this.runtime, () => this.#dropPreview(key, version))
  }

  /** Drops an uncommitted preview of `key` if it is still that version. */
  #dropPreview(key: IAtomDefinition<unknown>, version: number): void {
    /** Current preview entry. */
    const cached = this.#previews.get(key)
    if (!this.#disposed && cached?.version === version && !this.#instances.has(key))
      this.#previews.delete(key)
  }

  /** Throws ATOM_STORE_DISPOSED after dispose. */
  #assertUsable(): void {
    if (this.#disposed)
      throw createStoreKeyedError(
        StoreKeyedErrorCode.atomStoreDisposed,
        StoreKeyedErrorText.disposedAtomStore
      )
  }

  /**
   * Override 是路由变化，不是节点销毁。切换时通知「旧解析目标」的现有下游重新运行；它们下一次读会解析到新目标。不在每次 get 上额外挂一条 revision
   * 依赖，因此正常热路径仍是一 atom 一依赖；也不 dispose 原节点或 replacement，双方状态都能完整保留。
   */
  #assertOverrideCompatible(
    definition: IAtomDefinition<unknown>,
    replacement: IAtomDefinition<unknown>
  ): void {
    // 只读定义本身没有公开 write 契约，因此可以把读路由到任意同值定义。反方向不成立：可写定义一旦指向只读目标，类型仍承诺 set() 可用；
    // 更糟的是还可经该只读目标继续路由到参数不同的 writable-derived，绕过直接配对校验。
    if (definition.kind === AtomKind.derived) return
    /** Whether the overridden definition is a primitive source. */
    const definitionIsPrimitive =
      definition.kind === AtomKind.primitive || definition.kind === AtomKind.primitiveFactory
    /** Whether the replacement is a primitive source. */
    const replacementIsPrimitive =
      replacement.kind === AtomKind.primitive || replacement.kind === AtomKind.primitiveFactory
    if (
      (definitionIsPrimitive && replacementIsPrimitive) ||
      (definition.kind === AtomKind.writableDerived &&
        replacement.kind === AtomKind.writableDerived)
    ) {
      return
    }
    throw createStoreKeyedTypeError(
      StoreKeyedErrorCode.overrideContract,
      StoreKeyedErrorText.writeContract
    )
  }

  /** 按 override 栈解析；循环在入口暴露为可读错误，而不是递归爆栈。 */
  #resolve<T>(definition: IAtomDefinition<T>): IAtomDefinition<T> {
    assertAtomDefinition(definition)
    // Ordinary reads and unrelated overrides need no cycle ledger.
    if (!this.#overrides.get(definition as IAtomDefinition<unknown>)?.length) return definition
    /** Definitions already visited on this route. */
    const seen = new Set<IAtomDefinition<unknown>>()
    /** Current route step. */
    let current = definition as IAtomDefinition<unknown>
    while (true) {
      if (seen.has(current)) {
        throw createStoreKeyedError(
          StoreKeyedErrorCode.cyclicOverride,
          StoreKeyedErrorText.cyclicOverride
        )
      }
      seen.add(current)
      /** Override layers of the current step. */
      const layers = this.#overrides.get(current)
      /** Top replacement, if any. */
      const replacement = layers?.[layers.length - 1]?.replacement
      if (!replacement) return current as IAtomDefinition<T>
      current = replacement
    }
  }

  /**
   * 先摘旧边再强制下游重跑，避免 stale 检查先 pull 一个已经不再路由到的 dirty Computed；节点本身不 dispose，状态与缓存仍归 store 所有。 受控
   * extension 操作只断下游；Computed.dispose() 会同时销毁上游与缓存，因而不能代替仍由本 store 持有的节点失效。
   */
  #invalidateResolved<T>(definition: IAtomDefinition<T>): void {
    /** Materialized instance of the old route target, if any. */
    const instance = this.#instances.get(definition as IAtomDefinition<unknown>)
    if (!instance) return
    /** Graph view of the instance node. */
    const observable = instance.node as unknown as IObservable
    invalidateObservable(this.runtime, observable)
    if (observable.subs.size === 0) {
      try {
        observable.onUnobserved?.()
      } catch (error) {
        reportAtomFailure(this.runtime, error, ReactiveErrorPhase.lifecycleHook)
      }
    }
  }

  /** Creates the instance (Signal or Computed) of one resolved definition. */
  #build<T>(definition: IAtomDefinition<T>): IInstance<T> {
    if (definition.kind === AtomKind.primitive || definition.kind === AtomKind.primitiveFactory)
      return this.#buildPrimitive(definition)
    // 派生：读函数收的是本 store 的 get，因此依赖解析永远在同一张实例表内
    /** Derived node reading through this store. */
    const node = this.#nodeRuntime.computed(() => definition.read(this.get), {
      equals: definition.equals,
      debugName: definition.debugLabel
    })
    return {
      node,
      get disposed() {
        return node.disposed
      },
      read: () => node.value,
      peek: () => previewOrPeek(node as unknown as { peek: () => T; preview?: () => T }),
      dispose: () => node.dispose()
    }
  }

  /** Primitive instance: a committed preview seeds a factory; otherwise init/create runs. */
  #buildPrimitive<T>(
    definition: IPrimitiveDefinition<T> | IPrimitiveFactoryDefinition<T>
  ): IInstance<T> {
    /** Committed preview of this definition, if any. */
    const preview = this.#previews.get(definition as IAtomDefinition<unknown>)
    /** Initial value of the source. */
    let initial: T
    if (definition.kind === AtomKind.primitive) {
      initial = cloneInitial(definition.init)
    } else if (preview?.version === currentRuntimeVersion(this.runtime)) {
      this.#previews.delete(definition as IAtomDefinition<unknown>)
      initial = preview.value as T
    } else {
      initial = runAtomCallback(() => definition.create())
      assertNotThenable(initial, 'atomDefFactory create()')
    }
    /** Source node. */
    const node = this.#nodeRuntime.signal(initial, { debugName: definition.debugLabel })
    return {
      node,
      get disposed() {
        return node.disposed
      },
      read: () => node.value,
      peek: () => node.peek(),
      // 源节点的释放：断开下游边。Signal 现在自带 dispose，不必再走内部面。
      dispose: () => node.dispose()
    }
  }

  /** Speculative value of a definition without materializing nodes. */
  #previewDefinition<T>(definition: IAtomDefinition<T>): T {
    /** Resolved route target. */
    const target = this.#resolve(definition)
    const key = target as IAtomDefinition<unknown>
    /** Materialized instance, if any. */
    const existing = this.#instances.get(key)
    if (existing) return existing.peek() as T
    /** Preview cache entries are valid only within the current runtime clock generation. */
    const version = currentRuntimeVersion(this.runtime)
    /** Cached preview of this generation, if any. */
    const cached = this.#previews.get(key)
    if (cached?.version === version) return cached.value as T
    if (this.#previewStack.has(key)) {
      throw createStoreKeyedError(
        StoreKeyedErrorCode.circularPreview,
        StoreKeyedErrorText.circularPreview
      )
    }
    this.#previewStack.add(key)
    try {
      /** Speculative value. */
      let value = this.#computePreview(target)
      if (
        cached &&
        (target.kind === AtomKind.derived || target.kind === AtomKind.writableDerived) &&
        target.equals?.(value, cached.value as T)
      ) {
        value = cached.value as T
      }
      this.#previews.set(key, { version, value })
      this.#schedulePreviewCleanup(key, version)
      return value
    } finally {
      this.#previewStack.delete(key)
    }
  }

  /**
   * Computes one speculative value. A React snapshot can be abandoned before subscription commit,
   * so no Signal is materialized here; the factory itself is still necessarily invoked, and callers
   * should keep primitive factories side-effect free and cheap.
   */
  #computePreview<T>(target: IAtomDefinition<T>): T {
    if (target.kind === AtomKind.primitive) return cloneInitial(target.init)
    if (target.kind === AtomKind.primitiveFactory) {
      if (!target.previewSafe) {
        throw createStoreKeyedError(
          StoreKeyedErrorCode.previewUnsafe,
          StoreKeyedErrorText.previewUnsafe
        )
      }
      /** Factory value. */
      const value = runAtomCallback(() => target.create())
      assertNotThenable(value, 'atomDefFactory create()')
      return value
    }
    try {
      return target.read((dependency) => this.#previewDefinition(dependency))
    } catch (error) {
      throw toAtomCallbackFailure(error)
    }
  }

  /** 按已解析的键释放一份实例。返回是否确实释放了。 */
  #releaseByKey(key: IAtomDefinition<unknown>): boolean {
    /** Instance under this key. */
    const instance = this.#instances.get(key)
    if (!instance) return false
    this.#instances.delete(key)
    this.#instanceScope.release(instance)
    instance.dispose()
    return true
  }

  /**
   * React may call getSnapshot during a render that is later abandoned. Keep the value long enough
   * for the matching subscription commit, then reclaim an instance that was only a speculative
   * peek.
   */
  #schedulePeekCleanup<T>(key: IAtomDefinition<T>, instance: IInstance<T>): void {
    deferRuntimeCleanup(this.runtime, () => this.#reclaimPeek(key, instance))
  }

  /** Releases a peeked instance nobody subscribed to. */
  #reclaimPeek<T>(key: IAtomDefinition<T>, instance: IInstance<T>): void {
    /** Instance currently stored under `key`. */
    const stored = this.#instances.get(key as IAtomDefinition<unknown>)
    if (!this.#disposed && stored === instance && !instance.node.observed)
      this.#releaseByKey(key as IAtomDefinition<unknown>)
  }

  /** Materializes one already-resolved definition; public callers own override resolution. */
  #instanceOf<T>(target: IAtomDefinition<T>): IInstance<T> {
    this.#assertUsable()
    assertAtomDefinition(target)
    const key = target as IAtomDefinition<unknown>
    /** Existing instance. */
    const existing = this.#instances.get(key)
    if (existing) return existing as IInstance<T>
    /** New instance owned by the store scope. */
    const created = this.#build(target)
    this.#instances.set(key, created as IInstance<unknown>)
    this.#instanceScope.own(created, { syncSafe: true, force: () => created.dispose() })
    return created
  }

  /** Shared source update semantics are identical for set and the additive bulk operation. */
  #setPrimitive<T>(
    target: IPrimitiveDefinition<T> | IPrimitiveFactoryDefinition<T>,
    update: IAtomUpdate<T>
  ): void {
    /** Only source definitions enter this path; the instance retains its existing lifecycle owner. */
    const node = this.#instanceOf(target).node as IReactiveSignal<T> & IObservable
    node.value = typeof update === 'function' ? (update as (previous: T) => T)(node.peek()) : update
  }

  /** Writes through the resolved route inside one untracked step. */
  #writeResolved<T, Args extends readonly unknown[], Result>(
    target: IAtomDefinition<T>,
    args: Args
  ): Result {
    if (target.kind === AtomKind.primitive || target.kind === AtomKind.primitiveFactory) {
      const [update] = args as unknown as [IAtomUpdate<T>]
      this.#setPrimitive(target, update)
      return undefined as Result
    }
    if (target.kind === AtomKind.derived) {
      throw createStoreKeyedTypeError(
        StoreKeyedErrorCode.overrideContract,
        StoreKeyedErrorText.readonlyOverride
      )
    }
    /** Writable derived route. */
    const writable = target as IWritableDerivedDefinition<T, Args, Result>
    return writable.write(this.get as IAtomGet, this.set as IAtomSet, ...args)
  }

  /** Resolves every entry first, runs every updater, then writes; any failure writes nothing. */
  #setManyNow<T>(
    entries: readonly (readonly [
      IPrimitiveDefinition<T> | IPrimitiveFactoryDefinition<T>,
      IAtomUpdate<T>
    ])[]
  ): void {
    this.#assertUsable()
    /** Source nodes resolved for every entry before any updater runs or any value is written. */
    const nodes: (IReactiveSignal<T> & IObservable)[] = []
    for (const [definition] of entries) {
      assertAtomDefinition(definition)
      /** Current override route; a read-only route rejects the whole call before any write. */
      const target = this.#resolve(definition)
      if (target.kind !== AtomKind.primitive && target.kind !== AtomKind.primitiveFactory) {
        throw createStoreKeyedTypeError(
          StoreKeyedErrorCode.overrideContract,
          StoreKeyedErrorText.readonlyOverride
        )
      }
      nodes.push(this.#instanceOf(target).node as IReactiveSignal<T> & IObservable)
    }
    /**
     * Next value per node, in first-occurrence order. A repeated node's updater receives the value
     * computed by its previous entry, so duplicates chain exactly as sequential writes would.
     */
    const pending = new Map<IReactiveSignal<T> & IObservable, T>()
    for (let index = 0; index < entries.length; index++) {
      const node = nodes[index]!
      const update = entries[index]![1]
      /** Value this entry's updater sees: an earlier entry's result or the committed value. */
      const previous = pending.has(node) ? (pending.get(node) as T) : node.peek()
      pending.set(
        node,
        typeof update === 'function' ? (update as (previous: T) => T)(previous) : update
      )
    }
    // Writes start only after every route and updater succeeded, so a failure above leaves all
    // atoms unchanged.
    for (const [node, next] of pending) node.value = next
  }

  /** Tracked read through the current route. */
  readonly get: IAtomStore['get'] = (definition) => {
    /** Resolved route target. */
    const target = this.#resolve(definition)
    /** Its instance. */
    const instance = this.#instanceOf(target)
    if (this.#previewing) this.#schedulePeekCleanup(target, instance)
    return instance.read()
  }

  /** Untracked read through the current route. */
  readonly peek: IAtomStore['peek'] = (definition) => {
    this.#assertUsable()
    return this.#instanceOf(this.#resolve(definition)).peek()
  }

  /** Speculative read that materializes nothing new. */
  readonly preview: IAtomStore['preview'] = (definition) => {
    this.#assertUsable()
    /** Outer preview state, restored after this call. */
    const wasPreviewing = this.#previewing
    this.#previewing = true
    try {
      return this.#previewDefinition(definition)
    } finally {
      this.#previewing = wasPreviewing
    }
  }

  /** Writes through the current route in one batch. */
  readonly set = (<T, Args extends readonly unknown[], Result>(
    definition: IWritableAtomDefinition<T, Args, Result>,
    ...args: Args
  ): Result => {
    this.#assertUsable()
    assertAtomDefinition(definition)
    /** Resolved route target. */
    const target = this.#resolve(definition)
    return this.runtime.batch(() =>
      this.runtime.untracked(() => this.#writeResolved<T, Args, Result>(target, args))
    )
  }) as IAtomStore['set']

  /**
   * Subscribes to a definition. Known-node ticks stay inside reactive; initial/override
   * materialization keeps normal tracking.
   */
  readonly sub: IAtomStore['sub'] = (definition, onChange) => {
    this.#assertUsable()
    /** Static observer of the routed instance. */
    const observer = createStaticObserver(
      this.runtime,
      () => this.#instanceOf(this.#resolve(definition)) as unknown as IStaticSubscriptionSource,
      () => this.#notify(onChange)
    )
    /** This subscription's idempotent disposer. */
    const subscription = new AtomSubscription(this.#subscriptions, observer)
    this.#subscriptions.add(subscription.unsubscribe)
    return subscription.unsubscribe
  }

  /** Runs a subscriber untracked; its failure is reported, never thrown into the graph. */
  #notify(onChange: () => void): void {
    try {
      this.runtime.untracked(onChange)
    } catch (error) {
      reportAtomFailure(this.runtime, error, ReactiveErrorPhase.subscriptionListener)
    }
  }

  /** Routes `definition` to `replacement` until the returned disposer runs. */
  readonly override = ((
    definition: IAtomDefinition<unknown>,
    replacement: IAtomDefinition<unknown>
  ): IDisposer => {
    this.#assertUsable()
    assertAtomDefinition(definition)
    assertAtomDefinition(replacement)
    this.#assertOverrideCompatible(definition, replacement)
    const key = definition as IAtomDefinition<unknown>
    this.#previews.clear()
    /** Route target before the new layer. */
    const before = this.#resolve(definition)
    /** The new top layer. */
    const layer: IOverrideLayer = { replacement: replacement as IAtomDefinition<unknown> }
    /** Existing layers of this key. */
    const layers = this.#overrides.get(key)
    if (layers) layers.push(layer)
    else this.#overrides.set(key, [layer])
    try {
      /** Route target after the new layer. */
      const after = this.#resolve(definition)
      if (after !== before) this.#invalidateResolved(before)
    } catch (error) {
      /** Layers to roll back. */
      const active = this.#overrides.get(key)
      active?.pop()
      if (active?.length === 0) this.#overrides.delete(key)
      throw error
    }
    /** Undo record of this layer. */
    const record: IOverrideRecord = { definition: key, layer, active: true }
    return () => this.#undoOverride(record)
  }) as IAtomStore['override']

  /** Removes one override layer once and invalidates the old route target if routing changed. */
  #undoOverride(record: IOverrideRecord): void {
    if (!record.active || this.#disposed) return
    record.active = false
    /** Layers of the overridden key. */
    const stack = this.#overrides.get(record.definition)
    if (!stack) return
    /** Route target before undo. */
    const beforeUndo = this.#resolve(record.definition)
    /** Position of this layer. */
    const index = stack.indexOf(record.layer)
    if (index < 0) return
    stack.splice(index, 1)
    if (stack.length === 0) this.#overrides.delete(record.definition)
    this.#previews.clear()
    /** Route target after undo. */
    const afterUndo = this.#resolve(record.definition)
    if (afterUndo !== beforeUndo) this.#invalidateResolved(beforeUndo)
  }

  /** Whether the routed instance has observers, without exposing its graph node. */
  readonly isObserved: IAtomStore['isObserved'] = (definition) => {
    this.#assertUsable()
    assertAtomDefinition(definition)
    /** Routed key. */
    const key = this.#resolve(definition) as IAtomDefinition<unknown>
    return this.#instances.get(key)?.node.observed ?? false
  }

  /**
   * Releases one instance. Releases the resolved instance when the alias was never materialized;
   * retains compatibility with an instance created before an override.
   */
  readonly release: IAtomStore['release'] = (definition) => {
    this.#assertUsable()
    assertAtomDefinition(definition)
    /** Definition as given. */
    const original = definition as IAtomDefinition<unknown>
    return (
      this.#releaseByKey(this.#resolve(definition) as IAtomDefinition<unknown>) ||
      this.#releaseByKey(original)
    )
  }

  /** Releases subscriptions and every instance; failures are thrown (aggregated when several). */
  readonly dispose = (): void => {
    if (this.#disposed) return
    this.#disposed = true
    // Idle cleanup deliberately skips terminal stores, so disposal must release speculative values.
    this.#previews.clear()
    this.#overrides.clear()
    /** Subscriptions to release. */
    const activeSubscriptions = [...this.#subscriptions]
    this.#subscriptions.clear()
    // 逆序释放：后建的派生可能依赖先建的源
    this.#instances.clear()
    /** Cleanup failures. */
    const errors: unknown[] = []
    for (const unsubscribe of activeSubscriptions) {
      try {
        unsubscribe()
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      this.#instanceScope.dispose()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw createStoreKeyedAggregateError(
        StoreKeyedErrorCode.disposalFailed,
        errors,
        StoreKeyedErrorText.atomDisposalFailed
      )
    }
  }
}

/** One store subscription; its disposer is idempotent and forgets itself from the store. */
class AtomSubscription {
  /** Store's active subscription set. */
  readonly #subscriptions: Set<IDisposer>
  /** Static observer to dispose. */
  readonly #observer: { dispose(): void }
  /** True until unsubscribed. */
  #active = true
  /** Binds one observer to the store's subscription set. */
  constructor(subscriptions: Set<IDisposer>, observer: { dispose(): void }) {
    this.#subscriptions = subscriptions
    this.#observer = observer
  }
  /** Unsubscribes once. */
  readonly unsubscribe = (): void => {
    if (!this.#active) return
    this.#active = false
    this.#subscriptions.delete(this.unsubscribe)
    this.#observer.dispose()
  }
}

/** Throws INVALID_OPTION unless `definition` is an atom definition. */
function assertAtomDefinition(definition: unknown): asserts definition is IAtomDefinition<unknown> {
  if (!isAtomDefinition(definition)) {
    throw createStoreKeyedTypeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.notDefinition
    )
  }
}

/** Derived peek: a preview-capable node previews, otherwise peeks. */
function previewOrPeek<T>(readable: { peek: () => T; preview?: () => T }): T {
  return readable.preview ? readable.preview() : readable.peek()
}

/**
 * Runtime 的**默认** store。
 *
 * 刻意叫「默认」而不是「唯一」：所有权不该只有 runtime→store 这一条全局映射， 否则 Provider 想给子树一份独立的 atom 状态就无处安放，测试也没法在不换 Runtime
 * 的前提下换一份干净的表。
 *
 * Provider 自己持有 store（见 React 适配层）；这张表只服务于不经 Provider 的 实例式旧 API，让它们在同一个 Runtime 上仍然共享一份状态。
 */
const DEFAULT_STORES = new WeakMap<IRuntime, IAtomStore>()

/**
 * Returns the default store of `runtime`, creating it on first use and again after the previous one
 * was disposed. Meant for instance-style APIs used without a Provider.
 */
export function defaultAtomStore(runtime: IRuntime): IAtomStore {
  const existing = DEFAULT_STORES.get(runtime)
  if (existing && !existing.disposed) return existing
  const created = createAtomStore(runtime)
  DEFAULT_STORES.set(runtime, created)
  return created
}
