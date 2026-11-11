import { use, useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  defaultRuntime,
  type IDisposer,
  type IRuntime,
  type IReactiveSignal
} from '@migaia/reactive'
import type { Resource, IResourceState } from '@migaia/resource'
import { useNodeValue } from './useNode.ts'
import {
  storeReady,
  type IReactiveStore,
  type IStoreShape,
  type IStoreResource
} from '@migaia/store-light'
import { createObserverBinding, type ICapture } from '@migaia/reactive/extension'
import { notifyReact } from './notify-react.ts'

/**
 * Read an IStoreResource render snapshot and subscribe through its external-store protocol.
 * Committed layouts acquire/release captures, with deferred cleanup tolerating StrictMode replay;
 * speculative/server renders do not commit a lease. The resource owner controls value creation and
 * retirement, and capture/read failures propagate from that protocol.
 */
export function useStoreResource<T>(resource: IStoreResource<T>): T {
  useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot)
  const leaseState = useRef<{
    epoch: number
    committed?: {
      resource: IStoreResource<T>
      version: number
      capture: object
      release: () => void
    }
  }>({ epoch: 0 }).current
  const existingLease =
    leaseState.committed?.resource === resource ? leaseState.committed.release : undefined
  const { snapshot, capture } = resource.captureSnapshot(existingLease)
  useLayoutEffect(() => {
    if (!capture) return
    if (leaseState.committed?.resource === resource && leaseState.committed.capture === capture)
      return
    const release = resource.commitCapture(capture)
    const previous = leaseState.committed
    leaseState.committed = {
      resource,
      version: snapshot.version,
      capture,
      release
    }
    previous?.release()
  }, [resource, capture, snapshot.version, leaseState])
  useLayoutEffect(() => {
    leaseState.epoch++
    return () => {
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- epoch guards StrictMode replay
      const cleanupEpoch = ++leaseState.epoch
      queueMicrotask(() => {
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- read latest replay epoch
        if (leaseState.epoch !== cleanupEpoch) return
        const latest = leaseState.committed
        if (latest?.resource === resource) {
          latest.release()
          leaseState.committed = undefined
        }
      })
    }
  }, [resource, leaseState])
  return snapshot.value
}

type ISnapshot<T> = {
  value: T
}

type IRenderSnapshotState<T> = {
  snapshot?: ISnapshot<T>
  capture?: ICapture<T>
  capturedRead?: () => T
  captureGeneration: number
  getSnapshot: () => ISnapshot<T>
}

type ISubscriptionState = {
  externalRevision: number
  candidate?: ISnapshot<unknown>
  candidateRead?: () => unknown
  candidateEqual?: unknown
  candidateRevision: number
}

type ITrackingInstance<T> = {
  read: () => T
  isEqual: (a: T, b: T) => boolean
  hasLatestTracked: boolean
  latestTracked?: T
  committedSnapshot?: ISnapshot<T>
  subscriptionState: ISubscriptionState
  onChange: () => void
  suppress: boolean
}

function createTrackingInstance<T>(
  read: () => T,
  isEqual: (a: T, b: T) => boolean
): ITrackingInstance<T> {
  return {
    read,
    isEqual,
    hasLatestTracked: false,
    subscriptionState: {
      externalRevision: 0,
      candidateRevision: -1
    },
    onChange: () => {},
    suppress: false
  }
}

/**
 * Track a pure selector across React renders using the chosen Runtime, default defaultRuntime.
 * Equality defaults to Object.is and reuses equal snapshot values. Render captures become active
 * dependencies only at commit; abandoned selectors do not replace committed dependencies. React
 * cleanup releases the observer, while Runtime and selected values remain caller-owned. Selectors
 * and equality functions can be evaluated repeatedly and must not perform application mutations.
 */
export function useTracked<T>(
  read: () => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
  runtime: IRuntime = defaultRuntime
): T {
  // Runtime 是订阅实例边界。切换 Runtime 时旧实例留给旧 Effect 直到 cleanup，
  // 新实例从当前 selector 初始化，绝不让新 Runtime 执行旧 Runtime 的 selector。
  const trackingRef = useRef<{
    runtime: IRuntime
    instance: ITrackingInstance<T>
  }>(undefined)
  if (!trackingRef.current || trackingRef.current.runtime !== runtime) {
    trackingRef.current = {
      runtime,
      instance: createTrackingInstance(read, isEqual)
    }
  }
  const tracking = trackingRef.current.instance
  // 走公开的三段式绑定，而不是 import runtime/internals 拿 tracker：并发安全
  // 不该是本适配层的特权，第三方适配层必须能做出等价的东西。
  // 只依赖 runtime：tracking 实例仅在 runtime 变化时重建（见上面的 ref 判断），
  // 把它列进来只是重复同一个条件
  const binding = useMemo(() => createObserverBinding(runtime), [runtime])
  const subscriptionState = tracking.subscriptionState

  const subscribe = useCallback(
    (onChange: () => void): IDisposer => subscribeTracked(tracking, binding, runtime, onChange),
    [binding, runtime, subscriptionState, tracking]
  )

  // selector/equality 身份变化时创建隔离 reader，避免 concurrent render 泄漏新闭包；
  // 身份稳定时保留 reader 的 revision cache，让 React 的重复 getSnapshot 成为 O(1)。
  const renderSnapshot = useMemo<IRenderSnapshotState<T>>(
    () => new RenderSnapshotReader(binding, isEqual, read, tracking),
    [binding, isEqual, read, subscriptionState, tracking]
  )

  const snapshot = useSyncExternalStore(
    subscribe,
    renderSnapshot.getSnapshot,
    renderSnapshot.getSnapshot
  )
  const captureGeneration = renderSnapshot.captureGeneration

  // 只在提交后发布当前 selector/snapshot，并重追踪依赖；被丢弃的 render 不改变共享订阅语义。
  useLayoutEffect(
    () => commitTrackedSnapshot(tracking, binding, renderSnapshot, read, isEqual, runtime),
    [
      captureGeneration,
      isEqual,
      read,
      renderSnapshot,
      // runtime 必须在依赖里：失效路径要用它 untracked 地通知 React。
      // 漏掉的话 runtime 切换后会拿旧 runtime 去 untracked，正确那个的追踪
      // 上下文就没被抑制，通知期间的读可能被记成一条假依赖。
      runtime,
      binding,
      subscriptionState,
      tracking
    ]
  )

  return snapshot.value
}

/**
 * Read a Runtime-owned signal and return [value, setter], keeping setter identity until s changes.
 * The setter assigns a value, not an updater function. Mounted observation is released by React;
 * the signal and its Runtime are borrowed, and render/server snapshots use its current peek value.
 */
export function useSignal<T>(s: IReactiveSignal<T>) {
  // 快路径：Signal 的依赖集合恒为它自己，不需要 useTracked 的捕获/提交记账
  const value = useNodeValue(s, s.runtime)
  const set = useCallback(
    (next: T) => {
      s.value = next
    },
    [s]
  )
  return [value, set] as const
}

/**
 * Select Store fields through its own Runtime, subscribing only to captured reads. isEqual defaults
 * to Object.is; an async Store first uses its readiness Promise and can suspend/reject in render.
 * The hook releases its observer on unmount without disposing the borrowed Store or Runtime.
 */
export function useStore<S extends Record<string, unknown>, R>(
  store: IReactiveStore<S>,
  selector: (state: IStoreShape<S>) => R,
  isEqual?: (a: R, b: R) => boolean
): R {
  if (store.$async) use(storeReady(store))
  const read = useCallback(() => selector(store as unknown as IStoreShape<S>), [selector, store])
  return useTracked(read, isEqual, store.$runtime)
}

/**
 * Read the Resource state union and subscribe to its transitions in the Resource's Runtime. This
 * hook returns error/pending states instead of throwing them for Suspense; useResourceValue selects
 * that render behavior. React releases only this subscription, not the borrowed Resource.
 */
export function useResource<T>(res: Resource<T>): IResourceState<T> {
  // Resource identity already captures the complete read semantics. Keep this
  // selector stable so each state transition can reuse the Effect candidate.
  const read = useCallback(() => res.state, [res])
  return useTracked(read, Object.is, res.runtime)
}

/** Binding type produced by `createObserverBinding`. */
type IObserverBinding = ReturnType<typeof createObserverBinding>

/**
 * Subscribes one tracking instance: observes `read` through the public binding, publishes each
 * changed value as the current external-store snapshot and notifies React after the first run.
 */
function subscribeTracked<T>(
  tracking: ITrackingInstance<T>,
  binding: IObserverBinding,
  runtime: IRuntime,
  onChange: () => void
): IDisposer {
  tracking.onChange = onChange
  /** Observer state for this subscription; its first run only seeds the snapshot. */
  const observer = new TrackedObserver(tracking, runtime)
  /** Stops the binding's observation. */
  const stopObserving = binding.observe(() => observer.run())
  return () => {
    stopObserving()
  }
}

/** One subscription's observer: tracks dependencies and publishes changed snapshots. */
class TrackedObserver<T> {
  /** Tracking instance shared with render and layout. */
  readonly #tracking: ITrackingInstance<T>
  /** Runtime used to notify React without tracking. */
  readonly #runtime: IRuntime
  /** True until the first observation run finishes. */
  #initialRun = true
  /** Binds one tracking instance and runtime. */
  constructor(tracking: ITrackingInstance<T>, runtime: IRuntime) {
    this.#tracking = tracking
    this.#runtime = runtime
  }
  /** One observation run: re-read, record the latest value and publish it if it changed. */
  run(): void {
    const tracking = this.#tracking
    const subscriptionState = tracking.subscriptionState
    const activeRead = tracking.read
    const next = activeRead() // 追踪依赖，同时缓存候选值供 getSnapshot 复用
    const hadLatestTracked = tracking.hasLatestTracked
    const previousTracked = tracking.latestTracked
    tracking.hasLatestTracked = true
    tracking.latestTracked = next
    if (!tracking.suppress) {
      const previous = tracking.committedSnapshot
      const changed =
        this.#initialRun || !hadLatestTracked || !tracking.isEqual(previousTracked as T, next)
      if (changed) {
        subscriptionState.externalRevision++
        const candidate =
          previous && tracking.isEqual(previous.value, next) ? previous : { value: next }
        // `activeRead` 已提交，Effect 的结果就是当前 external-store snapshot。立即发布它，稳定
        // selector 的 React commit 因而不再需要额外跑一次 layout effect 只为复制同一个引用。
        tracking.committedSnapshot = candidate
        subscriptionState.candidate = candidate
        subscriptionState.candidateRead = activeRead
        subscriptionState.candidateEqual = tracking.isEqual
        subscriptionState.candidateRevision = subscriptionState.externalRevision
        if (!this.#initialRun) notifyReact(this.#runtime, tracking.onChange)
      }
    }
    this.#initialRun = false
  }
}

/**
 * Isolated snapshot reader for one selector/equality identity. Keeps a revision cache so React's
 * repeated getSnapshot calls are O(1) while the identity is stable.
 */
class RenderSnapshotReader<T> implements IRenderSnapshotState<T> {
  /** Public observer binding used to capture a render read. */
  readonly #binding: IObserverBinding
  /** Equality used to keep snapshot identity. */
  readonly #isEqual: (a: T, b: T) => boolean
  /** Selector of this render identity. */
  readonly #read: () => T
  /** Shared tracking instance. */
  readonly #tracking: ITrackingInstance<T>
  /** External revision the cached snapshot was computed at; -1 before the first read. */
  #evaluatedRevision = -1
  /** Cached snapshot of this reader. */
  #cached: ISnapshot<T> | undefined
  /** Snapshot published to the layout effect. */
  snapshot?: ISnapshot<T>
  /** Render capture awaiting commit in layout; abandoned renders never keep one. */
  capture?: ICapture<T>
  /** Selector the pending capture belongs to. */
  capturedRead?: () => T
  /** Incremented per new render capture so the layout effect re-runs. */
  captureGeneration = 0
  /** Binds one selector identity. */
  constructor(
    binding: IObserverBinding,
    isEqual: (a: T, b: T) => boolean,
    read: () => T,
    tracking: ITrackingInstance<T>
  ) {
    this.#binding = binding
    this.#isEqual = isEqual
    this.#read = read
    this.#tracking = tracking
  }
  /** React getSnapshot: reuses the subscription candidate or captures a fresh render read. */
  readonly getSnapshot = (): ISnapshot<T> => {
    const subscriptionState = this.#tracking.subscriptionState
    if (this.#cached && this.#evaluatedRevision === subscriptionState.externalRevision)
      return this.#cached
    const candidate =
      subscriptionState.candidateRevision === subscriptionState.externalRevision &&
      subscriptionState.candidateRead === this.#read &&
      subscriptionState.candidateEqual === this.#isEqual
        ? (subscriptionState.candidate as ISnapshot<T>)
        : undefined
    const captured = candidate ? undefined : this.#binding.capture(this.#read)
    const next = candidate ? candidate.value : captured!.result
    const previous = this.#cached ?? this.#tracking.committedSnapshot
    this.#cached =
      previous && this.#isEqual(previous.value, next) ? previous : (candidate ?? { value: next })
    this.snapshot = this.#cached
    // Do not retain an abandoned render capture in the hook-local snapshot state. Only the
    // current render may bridge into layout; committed tokens are tracked by the resource registry.
    this.capture = captured
    this.capturedRead = captured ? this.#read : undefined
    if (captured) this.captureGeneration++
    this.#evaluatedRevision = subscriptionState.externalRevision
    return this.#cached
  }
}

/**
 * Layout-phase commit: publishes the current selector/snapshot and re-tracks dependencies only
 * after commit, so abandoned renders never change shared subscription semantics.
 */
function commitTrackedSnapshot<T>(
  tracking: ITrackingInstance<T>,
  binding: IObserverBinding,
  renderSnapshot: IRenderSnapshotState<T>,
  read: () => T,
  isEqual: (a: T, b: T) => boolean,
  runtime: IRuntime
): void {
  const currentSnapshot = renderSnapshot.snapshot
  if (!currentSnapshot) return
  const selectorChanged = tracking.read !== read
  tracking.read = read
  tracking.isEqual = isEqual
  tracking.committedSnapshot = currentSnapshot
  const captured = renderSnapshot.capturedRead === read ? renderSnapshot.capture : undefined
  if (captured) {
    renderSnapshot.capture = undefined
    renderSnapshot.capturedRead = undefined
    const commit = binding.commit(captured)
    if (commit === 'committed') {
      tracking.hasLatestTracked = true
      tracking.latestTracked = captured.result
      return
    }
    if (commit === 'no-observer') return
    // 不在 commit/layout 阶段 pull 脏 Computed；使 snapshot 失效，让用户求值错误回到 render/Error Boundary。
    tracking.subscriptionState.externalRevision++
    tracking.subscriptionState.candidate = undefined
    tracking.subscriptionState.candidateRead = undefined
    tracking.subscriptionState.candidateEqual = undefined
    tracking.subscriptionState.candidateRevision = -1
    notifyReact(runtime, tracking.onChange)
    return
  }
  if (!selectorChanged) return
  tracking.suppress = true
  let retracked: ReturnType<typeof binding.retrack>
  try {
    retracked = binding.retrack()
  } finally {
    tracking.suppress = false
  }
  if (retracked === 'no-observer') return
  const dependenciesChanged = retracked === 'changed'
  // selector 切换依赖时，新依赖可能在 render 与本 layout effect 之间变化。
  // 重追踪已读到最新值；若当前提交快照过期，绘制前同步使 snapshot 失效并通知 React。
  const latest = tracking.latestTracked as T
  if (dependenciesChanged && !isEqual(currentSnapshot.value, latest)) {
    tracking.subscriptionState.externalRevision++
    tracking.subscriptionState.candidate = { value: latest }
    tracking.subscriptionState.candidateRead = read
    tracking.subscriptionState.candidateEqual = isEqual
    tracking.subscriptionState.candidateRevision = tracking.subscriptionState.externalRevision
    notifyReact(runtime, tracking.onChange)
  }
}
