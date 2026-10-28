import { useCallback, useSyncExternalStore } from 'react'
import type { IDisposer, IRuntime } from '@migaia/reactive'
import { assertReactiveOwnedBy } from '@migaia/reactive/extension'
import { notifyReact } from './notify-react.ts'

/**
 * Stable reactive source already registered to its Runtime. Its tracked value and untracked peek
 * must describe the same current state; unchanged object snapshots must retain identity for React's
 * external-store checks. A plain lookalike object does not establish Runtime ownership.
 */
export type IStableNode<T> = {
  /** Tracked read used by the mounted subscription's Runtime Effect. */
  readonly value: T
  /** Current untracked snapshot used in render, server rendering and commit consistency checks. */
  peek(): T
}

/**
 * Subscribe to one stable node rather than capturing an arbitrary selector. Ownership is checked
 * during render, with dependency-owned NOT_RUNTIME_OWNED/CROSS_RUNTIME failures. enabled defaults
 * to true; false disables the Effect subscription but still validates ownership and reads peek.
 * React cleanup disposes the observer, leaving the node and Runtime with their existing owner.
 */
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
      /** The runtime-created observer owns this subscription and releases it on React cleanup. */
      const effect = runtime.effect(() => {
        // 读 .value 才会建立依赖边；首跑只为登记，不通知
        void node.value
        if (first) {
          first = false
          return
        }
        notifyReact(runtime, onChange)
      })
      return () => effect.dispose()
    },
    [node, runtime, enabled]
  )

  // peek() 是非追踪读且恒为当前值：React 可以在任何时刻调用它而不影响依赖图
  const getSnapshot = useCallback(() => node.peek(), [node])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
