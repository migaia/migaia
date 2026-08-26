import {
  Effect,
  ReactiveErrorPhase,
  Signal,
  type IComputedValue,
  type IDisposer,
  type IObservable,
  type IRuntime,
  type ISignal
} from '@migaia/reactive'
import { internalsOf } from '@migaia/reactive/internals'
import { internalRuntimeOf } from '@migaia/reactive/node-factories'
import { claimOwnership } from '@migaia/reactive/ownership'
import { createSyncLifecycleScope, type ISyncLifecycleScope } from '@migaia/lifecycle'
import {
  createStoreKeyedAggregateError,
  createStoreKeyedError,
  createStoreKeyedTypeError,
  StoreKeyedErrorCode
} from '../errors.js'
import { StoreKeyedErrorText } from '../error-text.js'
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
} from './definition.js'
import { AtomKind } from './kind-constants.js'

/** Contains diagnostics when a Runtime reporter fails during atom lifecycle callbacks. */
function reportAtomFailure(
  runtime: IRuntime,
  error: unknown,
  phase: Parameters<IRuntime['reportError']>[1]['phase']
): void {
  try {
    runtime.reportError(error, { phase })
    return
  } catch (reporterError) {
    const hostReportError = (globalThis as { reportError?: (error: unknown) => void }).reportError
    try {
      if (hostReportError) hostReportError(reporterError)
      else console.error(reporterError)
    } catch {
      // A diagnostic sink is best effort and must not invalidate the atom graph.
    }
  }
}

/**
 * 实例化层：把纯定义落到某个 Runtime 上。
 *
 * 定义只说「这是什么」，这里回答「在我这里它是什么值」。**怎么建节点是这一层的 私事**——所以对外不暴露节点本身，只给读、写、订阅三件事。
 *
 * 之前的实现把 `nodeOf` 挂在公共面上，于是 React 适配层直接拿着 Signal 去订阅， 实例化策略从此不能改（换成惰性、换成远端、换成共享内存都会破坏调用方）。
 */

type IInstance<T> = {
  readonly node: ISignal<T> | IComputedValue<T>
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

export type IAtomStore = {
  readonly runtime: IRuntime
  readonly disposed: boolean
  get<T>(definition: IAtomDefinition<T>): T
  /** 非追踪读：适配层的 getSnapshot 不该在别人的捕获窗口里建边。 */
  peek<T>(definition: IAtomDefinition<T>): T
  /** React/concurrent speculative read; value may be discarded after the turn. */
  preview<T>(definition: IAtomDefinition<T>): T
  set<T, Args extends readonly unknown[], Result>(
    definition: IWritableAtomDefinition<T, Args, Result>,
    ...args: Args
  ): Result
  /**
   * 订阅一个定义。返回退订函数。
   *
   * 这是适配层唯一需要的东西——比交出节点窄得多，实例化策略因此可以自由演进。
   */
  sub<T>(definition: IAtomDefinition<T>, onChange: () => void): IDisposer
  /** 只读派生可以路由到任意同值类型定义。 */
  override<T>(
    definition: IDerivedDefinition<T>,
    replacement: IAtomDefinition<NoInfer<T>>
  ): IDisposer
  /** Primitive 只能替换为同一种固定 set(update) 写语义。 */
  override<T>(
    definition: IPrimitiveDefinition<T> | IPrimitiveFactoryDefinition<T>,
    replacement: IPrimitiveDefinition<NoInfer<T>> | IPrimitiveFactoryDefinition<NoInfer<T>>
  ): IDisposer
  /** 自定义 writable derived 必须保留完全相同的 Args/Result。 */
  override<T, Args extends readonly unknown[], Result>(
    definition: IWritableDerivedDefinition<T, Args, Result>,
    replacement: IWritableDerivedDefinition<NoInfer<T>, NoInfer<Args>, NoInfer<Result>>
  ): IDisposer
  /** 这个定义在本 store 内是否已有观察者。窄查询，不交出节点。 */
  isObserved<T>(definition: IAtomDefinition<T>): boolean
  /**
   * 释放单个定义的实例。
   *
   * 与 dispose 整个 store 相对：实例式旧 API 一个实例一份定义，它 dispose 时 只该释放自己那一份，不能连累同一 store 里的其它定义。
   */
  release<T>(definition: IAtomDefinition<T>): boolean
  /** 已实例化的定义数量。释放行为的可观测点。 */
  readonly size: number
  dispose(): void
}

export function createAtomStore(runtime: IRuntime): IAtomStore {
  /**
   * 实例表用 Map 而不是 WeakMap，且这里必须说实话：
   *
   * 释放实例需要遍历它们（断开依赖边、dispose Computed），而 WeakMap 不可遍历。 之前的注释宣称「定义不再被引用时实例可回收」，但同时又用一个数组强引着全部
   * 实例——两者矛盾，实际一个都回收不了。
   *
   * 所以改成诚实的做法：**store 强引它建出来的实例，随 store.dispose() 一起释放**。 生命周期的单位是 store，不是单个定义。要提前释放某个键，用 family 的
   * forget 或直接丢弃整个 store。
   */
  const instances = new Map<IAtomDefinition<unknown>, IInstance<unknown>>()
  // Instance ownership is orthogonal to atom routing: releasing a definition
  // removes only that instance, while store disposal drains the scope in LIFO.
  // Every owned instance wraps a pure reactive node (Signal/Computed) — never wasm/I/O — so this
  // can stay the synchronous scope (D-6) and `IAtomStore.dispose()` keeps its sync contract.
  const instanceScope: ISyncLifecycleScope = createSyncLifecycleScope()
  const nodeRuntime = internalRuntimeOf(runtime)
  const overrides = new Map<IAtomDefinition<unknown>, IOverrideLayer[]>()
  const subscriptions = new Set<IDisposer>()
  // Speculative React snapshots for definitions that have not been committed.
  // These values are versioned and do not create graph nodes or ownership edges.
  const previews = new Map<IAtomDefinition<unknown>, IPreview>()
  const previewStack = new Set<IAtomDefinition<unknown>>()
  const schedulePreviewCleanup = (key: IAtomDefinition<unknown>, version: number): void => {
    // A render can be abandoned without ever committing a subscription. Keep
    // the preview only through the current commit turn, then drop both the
    // definition and its value so a long-lived Provider cannot retain a
    // speculative object forever.
    queueMicrotask(() => {
      const cached = previews.get(key)
      if (!disposed && cached?.version === version && !instances.has(key)) {
        previews.delete(key)
      }
    })
  }
  /**
   * Override 是路由变化，不是节点销毁。
   *
   * 切换时通知「旧解析目标」的现有下游重新运行；它们下一次读会解析到新目标。 不在每次 get 上额外挂一条 revision 依赖，因此正常热路径仍是一 atom 一依赖； 也不
   * dispose 原节点或 replacement，双方状态都能完整保留。
   */
  let disposed = false
  let previewing = false

  const assertUsable = (): void => {
    if (disposed)
      throw createStoreKeyedError(
        StoreKeyedErrorCode.atomStoreDisposed,
        StoreKeyedErrorText.disposedAtomStore
      )
  }

  const assertDefinition: (
    definition: unknown
  ) => asserts definition is IAtomDefinition<unknown> = (definition) => {
    if (!isAtomDefinition(definition)) {
      throw createStoreKeyedTypeError(
        StoreKeyedErrorCode.invalidOption,
        StoreKeyedErrorText.notDefinition
      )
    }
  }

  const assertOverrideCompatible = (
    definition: IAtomDefinition<unknown>,
    replacement: IAtomDefinition<unknown>
  ): void => {
    // 只读定义本身没有公开 write 契约，因此可以把读路由到任意同值定义。
    // 反方向不成立：可写定义一旦指向只读目标，类型仍承诺 set() 可用；更糟的是
    // 还可经该只读目标继续路由到参数不同的 writable-derived，绕过直接配对校验。
    if (definition.kind === AtomKind.derived) return
    const definitionIsPrimitive =
      definition.kind === AtomKind.primitive || definition.kind === AtomKind.primitiveFactory
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

  /** 按 override 栈递归解析；循环在入口暴露为可读错误，而不是递归爆栈。 */
  const resolve = <T>(definition: IAtomDefinition<T>): IAtomDefinition<T> => {
    assertDefinition(definition)
    const seen = new Set<IAtomDefinition<unknown>>()
    let current = definition as IAtomDefinition<unknown>
    while (true) {
      if (seen.has(current)) {
        throw createStoreKeyedError(
          StoreKeyedErrorCode.cyclicOverride,
          StoreKeyedErrorText.cyclicOverride
        )
      }
      seen.add(current)
      const layers = overrides.get(current)
      const replacement = layers?.[layers.length - 1]?.replacement
      if (!replacement) return current as IAtomDefinition<T>
      current = replacement
    }
  }

  const invalidateResolved = <T>(definition: IAtomDefinition<T>): void => {
    const instance = instances.get(definition as IAtomDefinition<unknown>)
    if (instance) {
      const observable = instance.node as unknown as IObservable
      // 先摘旧边再强制下游重跑，避免 stale 检查先 pull 一个已经不再路由到的
      // dirty Computed；节点本身不 dispose，状态与缓存仍归 store 所有。
      //
      // 这一处仍走内部面：需要的是「只断下游边」，而 Computed.dispose() 会连
      // 上游边与缓存一起销毁——公开面上没有表达「保留自身、只摘下游」的操作。
      // Signal 那侧已经有 dispose()（语义正是断下游边），所以只剩派生这一种。
      internalsOf(runtime).tracker.disconnectObservable(observable, 'invalidate')
      if (observable.subs.size === 0) {
        try {
          observable.onUnobserved?.()
        } catch (error) {
          reportAtomFailure(runtime, error, ReactiveErrorPhase.lifecycleHook)
        }
      }
    }
  }

  /** 源节点的释放：断开下游边。Signal 现在自带 dispose，不必再走内部面。 */
  const releaseSignal = (node: Signal<unknown>): void => {
    node.dispose()
  }

  const build = <T>(definition: IAtomDefinition<T>): IInstance<T> => {
    if (definition.kind === AtomKind.primitive || definition.kind === AtomKind.primitiveFactory) {
      const preview = previews.get(definition as IAtomDefinition<unknown>)
      let initial: T
      if (definition.kind === AtomKind.primitive) {
        initial = cloneInitial(definition.init)
      } else if (preview?.version === runtime.currentVersion()) {
        previews.delete(definition as IAtomDefinition<unknown>)
        initial = preview.value as T
      } else {
        initial = definition.create()
        assertNotThenable(initial, 'atomDefFactory create()')
      }
      const node = nodeRuntime.signal(initial, {
        debugName: definition.debugLabel
      })
      return {
        node,
        get disposed() {
          return node.disposed
        },
        read: () => node.value,
        peek: () => node.peek(),
        dispose: () => releaseSignal(node as Signal<unknown>)
      }
    }
    // 派生：读函数收的是本 store 的 get，因此依赖解析永远在同一张实例表内
    const node = nodeRuntime.computed(() => definition.read(store.get), {
      equals: definition.equals,
      debugName: definition.debugLabel
    })
    return {
      node,
      get disposed() {
        return node.disposed
      },
      read: () => node.value,
      peek: () => {
        const readable = node as unknown as {
          peek: () => T
          preview?: () => T
        }
        return readable.preview ? readable.preview() : readable.peek()
      },
      dispose: () => node.dispose()
    }
  }

  const previewDefinition = <T>(definition: IAtomDefinition<T>): T => {
    const target = resolve(definition)
    const key = target as IAtomDefinition<unknown>
    const existing = instances.get(key)
    if (existing) return existing.peek() as T
    const version = runtime.currentVersion()
    const cached = previews.get(key)
    if (cached?.version === version) return cached.value as T
    if (previewStack.has(key)) {
      throw createStoreKeyedError(
        StoreKeyedErrorCode.circularPreview,
        StoreKeyedErrorText.circularPreview
      )
    }
    previewStack.add(key)
    try {
      let value: T
      if (target.kind === AtomKind.primitive) {
        value = cloneInitial(target.init)
      } else if (target.kind === AtomKind.primitiveFactory) {
        if (!target.previewSafe) {
          throw createStoreKeyedError(
            StoreKeyedErrorCode.previewUnsafe,
            StoreKeyedErrorText.previewUnsafe
          )
        }
        // A React snapshot can be abandoned before subscription commit. Do
        // not materialize a Signal in that speculative path: doing so would
        // leave a runtime-owned instance behind until store disposal. The
        // factory itself is still necessarily invoked; callers should keep
        // primitive factories side-effect free and cheap.
        value = target.create()
        assertNotThenable(value, 'atomDefFactory create()')
      } else {
        value = target.read((dependency) => previewDefinition(dependency))
      }
      if (
        cached &&
        (target.kind === AtomKind.derived || target.kind === AtomKind.writableDerived) &&
        target.equals?.(value, cached.value as T)
      ) {
        value = cached.value as T
      }
      previews.set(key, { version, value })
      schedulePreviewCleanup(key, version)
      return value
    } finally {
      previewStack.delete(key)
    }
  }

  /** 按已解析的键释放一份实例。返回是否确实释放了。 */
  const releaseByKey = (key: IAtomDefinition<unknown>): boolean => {
    const instance = instances.get(key)
    if (!instance) return false
    instances.delete(key)
    instanceScope.release(instance)
    instance.dispose()
    return true
  }

  const schedulePeekCleanup = <T>(key: IAtomDefinition<T>, instance: IInstance<T>): void => {
    // React may call getSnapshot during a render that is later abandoned.
    // Keep the value long enough for the matching subscription commit, then
    // reclaim an instance that was only a speculative peek.
    queueMicrotask(() => {
      const stored = instances.get(key as IAtomDefinition<unknown>)
      if (!disposed && stored === instance && !instance.node.observed) {
        releaseByKey(key as IAtomDefinition<unknown>)
      }
    })
  }

  const instanceOf = <T>(definition: IAtomDefinition<T>): IInstance<T> => {
    assertUsable()
    assertDefinition(definition)
    const target = resolve(definition)
    const key = target as IAtomDefinition<unknown>
    const existing = instances.get(key)
    if (existing) return existing as IInstance<T>
    const created = build(target)
    instances.set(key, created as IInstance<unknown>)
    instanceScope.own(created, { syncSafe: true, force: () => created.dispose() })
    return created
  }

  const setDefinition = <T, Args extends readonly unknown[], Result>(
    definition: IWritableAtomDefinition<T, Args, Result>,
    ...args: Args
  ): Result => {
    assertUsable()
    assertDefinition(definition)
    const target = resolve(definition)
    return runtime.batch(() => {
      return runtime.untracked(() => {
        if (target.kind === AtomKind.primitive || target.kind === AtomKind.primitiveFactory) {
          const node = instanceOf(target).node as Signal<unknown>
          const [update] = args as unknown as [IAtomUpdate<unknown>]
          node.value =
            typeof update === 'function'
              ? (update as (previous: unknown) => unknown)(node.peek())
              : update
          return undefined as Result
        }
        if (target.kind === AtomKind.derived) {
          throw createStoreKeyedTypeError(
            StoreKeyedErrorCode.overrideContract,
            StoreKeyedErrorText.readonlyOverride
          )
        }
        const writable = target as IWritableDerivedDefinition<T, Args, Result>
        return writable.write(store.get as IAtomGet, store.set as IAtomSet, ...args)
      })
    })
  }

  const store: IAtomStore = {
    runtime,
    get disposed() {
      return disposed
    },
    get: (definition) => {
      const target = resolve(definition)
      const instance = instanceOf(target)
      if (previewing) schedulePeekCleanup(target, instance)
      return instance.read()
    },
    peek: (definition) => {
      assertUsable()
      const instance = instanceOf(definition)
      return instance.peek()
    },
    preview: (definition) => {
      assertUsable()
      const wasPreviewing = previewing
      previewing = true
      try {
        return previewDefinition(definition)
      } finally {
        previewing = wasPreviewing
      }
    },

    set: setDefinition,

    sub: (definition, onChange) => {
      assertUsable()
      let first = true
      // 用 Effect 订阅而不是把节点交出去：所有权校验、observed 生命周期、
      // trace 都留在内核手里，实例化策略也保持可替换
      const effect = new Effect(() => {
        void instanceOf(definition).read()
        if (first) {
          first = false
          return
        }
        // Listener code is outside the reactive graph contract. If it
        // throws while this Effect is still being tracked, runTracked
        // would roll back the replacement dependency and permanently
        // kill the subscription after an override.
        try {
          runtime.untracked(onChange)
        } catch (error) {
          reportAtomFailure(runtime, error, ReactiveErrorPhase.subscriptionListener)
        }
      }, runtime)
      let active = true
      const unsubscribe = () => {
        if (!active) return
        active = false
        subscriptions.delete(unsubscribe)
        effect.dispose()
      }
      subscriptions.add(unsubscribe)
      return unsubscribe
    },

    override: (definition: IAtomDefinition<unknown>, replacement: IAtomDefinition<unknown>) => {
      assertUsable()
      assertDefinition(definition)
      assertDefinition(replacement)
      assertOverrideCompatible(definition, replacement)
      const key = definition as IAtomDefinition<unknown>
      previews.clear()
      const before = resolve(definition)
      const layer: IOverrideLayer = {
        replacement: replacement as IAtomDefinition<unknown>
      }
      const layers = overrides.get(key)
      if (layers) layers.push(layer)
      else overrides.set(key, [layer])
      try {
        const after = resolve(definition)
        if (after !== before) invalidateResolved(before)
      } catch (error) {
        const active = overrides.get(key)
        active?.pop()
        if (active?.length === 0) overrides.delete(key)
        throw error
      }
      let active = true
      return () => {
        if (!active || disposed) return
        active = false
        const stack = overrides.get(key)
        if (!stack) return
        const beforeUndo = resolve(definition)
        const index = stack.indexOf(layer)
        if (index < 0) return
        stack.splice(index, 1)
        if (stack.length === 0) overrides.delete(key)
        previews.clear()
        const afterUndo = resolve(definition)
        if (afterUndo !== beforeUndo) invalidateResolved(beforeUndo)
      }
    },

    isObserved: (definition) => {
      assertUsable()
      assertDefinition(definition)
      const key = resolve(definition) as IAtomDefinition<unknown>
      const instance = instances.get(key)
      return instance?.node.observed ?? false
    },

    release: (definition) => {
      assertUsable()
      assertDefinition(definition)
      // Release the resolved instance when the alias was never materialized;
      // retain compatibility with an instance created before an override.
      const original = definition as IAtomDefinition<unknown>
      return releaseByKey(resolve(definition) as IAtomDefinition<unknown>) || releaseByKey(original)
    },

    get size() {
      return instances.size
    },

    dispose: () => {
      if (disposed) return
      disposed = true
      overrides.clear()
      const activeSubscriptions = [...subscriptions]
      subscriptions.clear()
      // 逆序释放：后建的派生可能依赖先建的源
      instances.clear()
      const errors: unknown[] = []
      for (const unsubscribe of activeSubscriptions) {
        try {
          unsubscribe()
        } catch (error) {
          errors.push(error)
        }
      }
      try {
        instanceScope.dispose()
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
  claimOwnership(store, runtime)
  return store
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

export function defaultAtomStore(runtime: IRuntime): IAtomStore {
  const existing = DEFAULT_STORES.get(runtime)
  if (existing && !existing.disposed) return existing
  const created = createAtomStore(runtime)
  DEFAULT_STORES.set(runtime, created)
  return created
}
