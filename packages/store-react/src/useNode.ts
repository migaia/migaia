import { useCallback, useSyncExternalStore } from 'react'
import { Effect, type IDisposer, type IRuntime } from '@migaia/reactive'
import { assertReactiveOwnedBy } from '@migaia/reactive/ownership'
import { notifyReact } from './notify-react.js'

/**
 * Provides subscriptions for stable nodes with a fixed `{node}` dependency set.
 *
 * `useTracked` supports arbitrary closures and changing dependencies. It captures dependencies
 * during render, commits captures, records candidate values and versions, and retracks changed
 * selectors. `useSignal` and `useAtomValue` do not need that bookkeeping because their node
 * identity and dependency set are stable.
 *
 * This path retains required commit validation. It makes no performance guarantee. Effect lifecycle
 * and `useSyncExternalStore` scheduling still have a cost.
 *
 * Subscriptions use `Effect`, preserving ownership checks, observed and unobserved lifecycle, and
 * tracing. `peek()` reads the current value without tracking, including rereads between render and
 * subscription or after an abandoned transition. Snapshots are not cached separately from the node
 * value.
 *
 * This path keeps `useSyncExternalStore` rather than adopting Jotai's bypass, which depends on
 * different internal constraints. Bypassing it here could reintroduce selector and concurrency
 * failures.
 */
export type IStableNode<T> = {
  readonly value: T
  peek(): T
}

export function useNodeValue<T>(node: IStableNode<T>, runtime: IRuntime, enabled = true): T {
  // Fail in render, where an Error Boundary can handle it. Waiting until the
  // subscription Effect runs would surface the ownership error in commit.
  assertReactiveOwnedBy(node, runtime, 'reactive node')

  // 订阅只依赖 node 与 runtime——两者都稳定，所以这个闭包也稳定，
  // React 不会因为它变化而反复退订重订。
  const subscribe = useCallback(
    (onChange: () => void): IDisposer => {
      if (!enabled) return () => {}
      let first = true
      const effect = new Effect(() => {
        // 读 .value 才会建立依赖边；首跑只为登记，不通知
        void node.value
        if (first) {
          first = false
          return
        }
        notifyReact(runtime, onChange)
      }, runtime)
      return () => effect.dispose()
    },
    [node, runtime, enabled]
  )

  // peek() 是非追踪读且恒为当前值：React 可以在任何时刻调用它而不影响依赖图
  const getSnapshot = useCallback(() => node.peek(), [node])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
