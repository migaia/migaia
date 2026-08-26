import { useCallback, useSyncExternalStore } from 'react'
import { Effect, type IDisposer, type IRuntime } from '@migaia/reactive'
import { assertReactiveOwnedBy } from '@migaia/reactive/ownership'
import { notifyReact } from './notify-react.js'

/**
 * 稳定节点的专用订阅路径。
 *
 * `useTracked` 要应付任意闭包与动态依赖，所以每次更新都得做：render 期捕获依赖、 commit 期提交捕获、候选值与版本号记账、selector 换了还要重追踪依赖。
 *
 * 但 `useSignal` / `useAtomValue` 的**依赖集合恒为 `{node}`**——节点身份稳定， 依赖不会变。上面那套一样都不需要，它们付的是通用性的钱而没有享受通用性。
 *
 * 这条路径只砍掉不需要的记账，**不砍必要的提交验证**。它不是性能承诺； Effect 生命周期与 useSyncExternalStore 调度成本仍然存在。
 *
 * - 订阅仍走 Effect，所有权校验、observed/unobserved 生命周期、trace 全部保留
 * - 读取用 `peek()`：非追踪、且永远返回当前值，因此 React 在 render 与 subscribe 之间、或 transition 被中止后重读，拿到的都是最新值，不存在撕裂窗口
 * - 不缓存快照：值就在节点里，缓存反而制造「缓存与真值不一致」的可能
 *
 * 刻意不照搬 jotai 绕开 useSyncExternalStore 的做法：那建立在它自己的内部约束上， 整体搬过来有很大概率把已经修过的 selector/并发窗口重新引入。
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
