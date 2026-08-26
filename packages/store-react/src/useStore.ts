import { use, useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { defaultRuntime, type IDisposer, type IRuntime, type ISignal } from '@migaia/reactive'
import type { Resource, IResourceState } from '@migaia/resource'
import { useNodeValue } from './useNode.js'
import {
  storeReady,
  type IReactiveStore,
  type IStoreShape,
  type IStoreResource
} from '@migaia/store-light'
import { createObserverBinding, type ICapture } from '@migaia/reactive/runtime'
import { notifyReact } from './notify-react.js'

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

// 稳定订阅 + 无限渲染防护：
// - 已提交 read 存 ref；订阅 effect 只读 ref.current，内联 selector（每渲染新引用）不改 subscribe 身份，不重建订阅。
// - getSnapshot 返回包含 selector 值的原子快照，并用 equality 复用旧快照；React 检查的值和 hook 返回值完全相同。
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
    (onChange: () => void): IDisposer => {
      tracking.onChange = onChange
      let initialRun = true
      const stopObserving = binding.observe(() => {
        const activeRead = tracking.read
        const next = activeRead() // 追踪依赖，同时缓存候选值供 getSnapshot 复用
        const hadLatestTracked = tracking.hasLatestTracked
        const previousTracked = tracking.latestTracked
        tracking.hasLatestTracked = true
        tracking.latestTracked = next
        if (!tracking.suppress) {
          const previous = tracking.committedSnapshot
          const changed =
            initialRun || !hadLatestTracked || !tracking.isEqual(previousTracked as T, next)
          if (changed) {
            subscriptionState.externalRevision++
            const candidate =
              previous && tracking.isEqual(previous.value, next) ? previous : { value: next }
            // `activeRead` 已提交，Effect 的结果就是当前 external-store
            // snapshot。立即发布它，稳定 selector 的 React commit 因而不再
            // 需要额外跑一次 layout effect 只为复制同一个引用。
            tracking.committedSnapshot = candidate
            subscriptionState.candidate = candidate
            subscriptionState.candidateRead = activeRead
            subscriptionState.candidateEqual = tracking.isEqual
            subscriptionState.candidateRevision = subscriptionState.externalRevision
            if (!initialRun) notifyReact(runtime, tracking.onChange)
          }
        }
        initialRun = false
      })
      return () => {
        stopObserving()
      }
    },
    [binding, runtime, subscriptionState, tracking]
  )

  // selector/equality 身份变化时创建隔离 reader，避免 concurrent render 泄漏新闭包；
  // 身份稳定时保留 reader 的 revision cache，让 React 的重复 getSnapshot 成为 O(1)。
  const renderSnapshot = useMemo<IRenderSnapshotState<T>>(() => {
    let evaluatedRevision = -1
    let snapshot: ISnapshot<T> | undefined
    const state: IRenderSnapshotState<T> = {
      captureGeneration: 0,
      getSnapshot: () => {
        if (snapshot && evaluatedRevision === subscriptionState.externalRevision) {
          return snapshot
        }
        const candidate =
          subscriptionState.candidateRevision === subscriptionState.externalRevision &&
          subscriptionState.candidateRead === read &&
          subscriptionState.candidateEqual === isEqual
            ? (subscriptionState.candidate as ISnapshot<T>)
            : undefined
        const captured = candidate ? undefined : binding.capture(read)
        const next = candidate ? candidate.value : captured!.result
        const previous = snapshot ?? tracking.committedSnapshot
        snapshot =
          previous && isEqual(previous.value, next) ? previous : (candidate ?? { value: next })
        state.snapshot = snapshot
        // Do not retain an abandoned render capture in the hook-local
        // snapshot state. Only the current render may bridge into layout;
        // committed tokens are tracked by the resource registry itself.
        state.capture = captured
        state.capturedRead = captured ? read : undefined
        if (captured) state.captureGeneration++
        evaluatedRevision = subscriptionState.externalRevision
        return snapshot
      }
    }
    return state
  }, [binding, isEqual, read, subscriptionState, tracking])

  const snapshot = useSyncExternalStore(
    subscribe,
    renderSnapshot.getSnapshot,
    renderSnapshot.getSnapshot
  )
  const captureGeneration = renderSnapshot.captureGeneration

  // 只在提交后发布当前 selector/snapshot，并重追踪依赖；被丢弃的 render 不改变共享订阅语义。
  useLayoutEffect(() => {
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
      subscriptionState.externalRevision++
      subscriptionState.candidate = undefined
      subscriptionState.candidateRead = undefined
      subscriptionState.candidateEqual = undefined
      subscriptionState.candidateRevision = -1
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
      subscriptionState.externalRevision++
      subscriptionState.candidate = { value: latest }
      subscriptionState.candidateRead = read
      subscriptionState.candidateEqual = isEqual
      subscriptionState.candidateRevision = subscriptionState.externalRevision
      notifyReact(runtime, tracking.onChange)
    }
  }, [
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
  ])

  return snapshot.value
}

export function useSignal<T>(s: ISignal<T>) {
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

// 甜 store 的精细订阅 hook（use-前缀标识符，适配 React Compiler）。
export function useStore<S extends Record<string, unknown>, R>(
  store: IReactiveStore<S>,
  selector: (state: IStoreShape<S>) => R,
  isEqual?: (a: R, b: R) => boolean
): R {
  if (store.$async) use(storeReady(store))
  const read = useCallback(() => selector(store as unknown as IStoreShape<S>), [selector, store])
  return useTracked(read, isEqual, store.$runtime)
}

// 订阅一个 resource 的状态——状态变化（pending/success/error）自动重渲染。
export function useResource<T>(res: Resource<T>): IResourceState<T> {
  // Resource identity already captures the complete read semantics. Keep this
  // selector stable so each state transition can reuse the Effect candidate.
  const read = useCallback(() => res.state, [res])
  return useTracked(read, Object.is, res.runtime)
}
